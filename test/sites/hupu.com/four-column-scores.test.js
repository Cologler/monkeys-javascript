const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { unwrapUrl, getStage, getCardUrl } = require('../../../src/sites/hupu.com/four-column-scores.user.js');

const viewer = 'https://bbsactivity.hupu.com/pc-viewer/index.html';
const schedule = 'https://offline-download.hupu.com/online/prod/330003/team-schedule-v2.html?businessType=common&businessId=lol';
const match = 'https://offline-download.hupu.com/online/prod/310016/detail.html?outBizType=lol_match&outBizNo=3817';
const game = 'https://m.hupu.com/score/detail.html?outBizType=lol_bo&outBizNo=6856';

test('unwraps single and double encoded viewer targets without changing inner values', function () {
    const target = `${schedule}&scheduleName=${encodeURIComponent('A & B%')}`;
    assert.equal(unwrapUrl(`${viewer}?t=${encodeURIComponent(target)}`).href, target);
    assert.equal(unwrapUrl(`${viewer}?t=${encodeURIComponent(encodeURIComponent(target))}`).href, target);
    assert.equal(unwrapUrl('%%%'), null);
    assert.equal(unwrapUrl(`${viewer}?t=`), null);
    assert.equal(unwrapUrl(null), null);
});

test('classifies the four production LoL stages', function () {
    assert.equal(getStage(new URL(schedule)), 0);
    assert.equal(getStage(new URL(match)), 1);
    assert.equal(getStage(new URL(game)), 2);
    assert.equal(getStage(new URL(game.replace('lol_bo', 'lol_item'))), 3);
});

test('rejects other sports, pages, hosts, environments, and invalid identifiers', function () {
    for (const url of [
        schedule.replace('businessId=lol', 'businessId=nba'),
        schedule.replace('businessType=common', 'businessType=other'),
        schedule.replace('/prod/', '/stg/'),
        schedule.replace('.com/', '.com.example.org/'),
        match.replace('lol_match', 'nba_match'),
        match.replace('3817', 'abc'),
        game.replace('/detail.html', '/list.html'),
        game.replace('https:', 'http:'),
        game.replace('m.hupu.com', 'user:password@m.hupu.com'),
    ]) {
        assert.equal(getStage(new URL(url)), -1, url);
    }
    assert.equal(getStage(null), -1);
});

test('builds destinations from real card identities and preserves encoded settings', function () {
    const url = getCardUrl('{"itemid":"score_lol_bo_6856"}', 2, `${match}&night=0&biz_code=a%26b`);
    assert.equal(getStage(url), 2);
    assert.equal(url.searchParams.get('outBizNo'), '6856');
    assert.equal(url.searchParams.get('night'), '0');
    assert.equal(url.searchParams.get('biz_code'), 'a&b');
    assert.equal(url.searchParams.get('env'), 'prod');
    assert.equal(getStage(getCardUrl('{"itemid":"score_lol_item_74510"}', 3, game)), 3);
    for (const exposure of ['null', '{}', '{', '{"itemid":"score_comment_12"}', '{"itemid":"score_lol_item_x"}']) {
        assert.equal(getCardUrl(exposure, 2, game), null);
    }
    assert.equal(getCardUrl('{"itemid":"score_lol_item_74510"}', 2, game), null);
});

function loadFrame() {
    const listeners = {};
    const documentListeners = {};
    const messages = [];
    let opened = 0;
    const parent = { postMessage: function (data) { messages.push(data); } };
    const location = new URL(schedule);
    const window = {
        parent,
        top: parent,
        addEventListener: function (type, callback) { listeners[type] = callback; },
        open: function () { opened += 1; return 'native'; },
    };
    const document = {
        readyState: 'loading',
        addEventListener: function (type, callback) { documentListeners[type] = callback; },
    };
    function Element() {}
    const source = fs.readFileSync(path.join(__dirname, '../../../src/sites/hupu.com/four-column-scores.user.js'), 'utf8');
    vm.runInNewContext(source, { window, document, location, URL, Element });
    return { window, parent, listeners, documentListeners, messages, Element, opened: function () { return opened; } };
}

test('a frame keeps native navigation until configured by its actual viewer parent', function () {
    const frame = loadFrame();
    const nativeOpen = frame.window.open;
    const data = { channel: 'monkeys.hupu-score-columns.v1', type: 'configure', url: schedule, token: '1' };
    assert.equal(frame.messages[0].type, 'ready');
    frame.listeners.message({ source: {}, origin: new URL(viewer).origin, data });
    frame.listeners.message({ source: frame.parent, origin: 'https://example.org', data });
    frame.listeners.message({ source: frame.parent, origin: new URL(viewer).origin, data: { ...data, url: match } });
    assert.equal(frame.window.open, nativeOpen);
    frame.listeners.message({ source: frame.parent, origin: new URL(viewer).origin, data });
    assert.notEqual(frame.window.open, nativeOpen);
    assert.equal(frame.window.open(match), null);
    assert.equal(frame.messages.at(-1).type, 'navigate');
    assert.equal(frame.messages.at(-1).token, '1');
    assert.equal(frame.window.open('https://example.org'), 'native');
    assert.equal(frame.opened(), 1);
});

test('unstarted matches cannot open the App prompt or change the current columns', function () {
    const frame = loadFrame();
    frame.listeners.message({
        source: frame.parent,
        origin: new URL(viewer).origin,
        data: { channel: 'monkeys.hupu-score-columns.v1', type: 'configure', url: schedule, token: '1' },
    });
    const messageCount = frame.messages.length;
    const target = new frame.Element();
    target.closest = function () {
        return { classList: ['match-VdJkcrWJ', 'match-not-started-iORBu9Am'] };
    };
    for (let count = 0; count < 3; count += 1) {
        let prevented = false;
        let stopped = false;
        frame.documentListeners.click({
            target,
            preventDefault: function () { prevented = true; },
            stopImmediatePropagation: function () { stopped = true; },
        });
        assert.equal(prevented, true);
        assert.equal(stopped, true);
    }
    assert.equal(frame.messages.length, messageCount);
    assert.equal(frame.opened(), 0);
});

test('completed matches still reach the Games column after the unstarted-match guard', function () {
    const frame = loadFrame();
    frame.listeners.message({
        source: frame.parent,
        origin: new URL(viewer).origin,
        data: { channel: 'monkeys.hupu-score-columns.v1', type: 'configure', url: schedule, token: '1' },
    });
    const card = {
        classList: ['match-VdJkcrWJ', 'match-completed-DUvXNFKg'],
        setAttribute: function () {},
    };
    const target = new frame.Element();
    target.closest = function () { return card; };
    frame.documentListeners.click({
        target,
        preventDefault: function () { assert.fail('Completed match was blocked'); },
        stopImmediatePropagation: function () { assert.fail('Completed match was blocked'); },
    });
    assert.equal(frame.window.open(match), null);
    assert.equal(frame.messages.at(-1).type, 'navigate');
    assert.equal(frame.messages.at(-1).url, match);
});

test('only a viewer with a LoL schedule target starts the four-column layout', function () {
    const source = fs.readFileSync(path.join(__dirname, '../../../src/sites/hupu.com/four-column-scores.user.js'), 'utf8');
    for (const [url, enabled] of [
        [`${viewer}?t=${encodeURIComponent(schedule)}`, true],
        [`${viewer}?t=${encodeURIComponent(schedule.replace('businessId=lol', 'businessId=nba'))}`, false],
        [`${viewer}?t=${encodeURIComponent(match)}`, false],
        [`${viewer}?t=%%%`, false],
        [schedule, false],
    ]) {
        let started = false;
        const window = { addEventListener: function () { started = true; } };
        window.top = window;
        vm.runInNewContext(source, {
            window,
            location: new URL(url),
            URL,
            document: { readyState: 'loading', addEventListener: function () {} },
        });
        assert.equal(started, enabled, url);
    }
});
