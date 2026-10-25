'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname,
    '../../../src/sites/trakt.tv/lookup-duplicated-watch.user.js'), 'utf8');

function textElement(text, attributes = {}) {
    return {
        textContent: text,
        getAttribute: function(name) { return attributes[name] ?? null; },
    };
}

// These classes, the direct card link, and the day ID match the live app history DOM.
function appCard(href, day = '2026-10-24', time = '11:25 PM') {
    const link = textElement('', { href });
    const title = textElement('Watch title');
    const date = textElement('Yesterday', { title: `Yesterday ${time}` });
    const clock = textElement(time);
    return {
        querySelector: function(selector) {
            return {
                '.trakt-card-content > a[href]': href ? link : null,
                '.trakt-card-title': href ? title : null,
                '.trakt-card-subtitle[title]': href ? date : null,
            }[selector] ?? null;
        },
        querySelectorAll: function(selector) {
            assert.equal(selector, '.trakt-card-subtitle');
            return [date, clock];
        },
        closest: function(selector) {
            assert.equal(selector, '.calendar-day-anchor');
            return { id: `day-${day}` };
        },
    };
}

function episode(number, extra = '', day, time) {
    return appCard(`/shows/example?view=episode&season=1&episode=${number}${extra}`, day, time);
}

function legacyCard(href, date) {
    return {
        querySelector: function(selector) {
            return {
                meta: textElement('', { content: href }),
                '.titles-link': textElement('Watch title'),
                '.format-date': textElement(date),
            }[selector] ?? null;
        },
        querySelectorAll: function() { return []; },
        closest: function() { return null; },
    };
}

function load(cards = [], href = 'https://app.trakt.tv/history?mode=media') {
    const state = { cards };
    const alerts = [];
    const timers = new Map();
    const location = new URL(href);
    let nextTimer = 0;
    let observerCallback;
    let menuCallback;

    function forbidNetwork() {
        assert.fail('The userscript must not request data or load more history.');
    }

    const document = {
        body: {},
        querySelectorAll: function(selector) {
            assert.equal(selector, location.hostname === 'app.trakt.tv'
                ? '.calendar-day-anchor .trakt-summary-card' : '#history-items .grid-item');
            return state.cards;
        },
    };

    function MutationObserver(callback) {
        observerCallback = callback;
        this.observe = function(target, options) {
            assert.equal(target, document.body);
            assert.equal(options.subtree, true);
            assert.equal(options.childList, true);
        };
    }

    vm.runInNewContext(source, {
        document,
        location,
        URL,
        MutationObserver,
        GM: {
            registerMenuCommand: function(name, callback) {
                assert.equal(name, 'Lookup duplicated watch');
                menuCallback = callback;
            },
            xmlHttpRequest: forbidNetwork,
        },
        GM_xmlhttpRequest: forbidNetwork,
        fetch: forbidNetwork,
        XMLHttpRequest: forbidNetwork,
        WebSocket: forbidNetwork,
        EventSource: forbidNetwork,
        Image: forbidNetwork,
        scrollTo: forbidNetwork,
        alert: function(message) { alerts.push(message); },
        setTimeout: function(callback) {
            timers.set(++nextTimer, callback);
            return nextTimer;
        },
        clearTimeout: function(id) { timers.delete(id); },
    });

    return {
        state,
        alerts,
        location,
        manual: function() { menuCallback(); },
        mutate: function() { observerCallback([]); },
        flush: function() {
            const callbacks = Array.from(timers.values());
            timers.clear();
            callbacks.forEach(function(callback) { callback(); });
        },
    };
}

test('detects duplicate episode submissions despite query order and display mode', function() {
    const page = load([
        episode(2, '&mode=media', '2026-10-24', '11:25 PM'),
        appCard('/shows/example?mode=show&episode=02&season=01&view=episode',
            '2026-10-24', '11:24 PM'),
    ]);
    page.flush();
    assert.equal(page.alerts.length, 1);
    assert.match(page.alerts[0], /Possible duplicate submissions \(or intentional rewatches\)/);
    assert.match(page.alerts[0], /2026-10-24 11:25 PM/);
    assert.match(page.alerts[0], /2026-10-24 11:24 PM/);
    assert.doesNotMatch(page.alerts[0], /unsorted|missing/);
});

test('keeps seasons, episodes, shows, and movies distinct', function() {
    const page = load([
        appCard('/shows/example?view=episode&season=2&episode=1'),
        episode(2), episode(1),
        appCard('/shows/other?view=episode&season=1&episode=1'),
        appCard('/movies/example?mode=media'),
    ]);
    page.flush();
    assert.deepEqual(page.alerts, []);
    page.manual();
    assert.match(page.alerts[0], /No problems found in 5 currently rendered watches/);
});

test('detects repeated movies independently of navigation parameters', function() {
    const page = load([
        appCard('/movies/example?mode=movie'),
        appCard('/movies/example/?mode=media#details'),
    ]);
    page.flush();
    assert.match(page.alerts[0], /Possible duplicate submissions/);
    assert.match(page.alerts[0], /https:\/\/app\.trakt\.tv\/movies\/example\n/);
});

test('handles deferred rendering without repeatedly alerting for unchanged records', function() {
    const page = load([appCard(null), appCard(null)]);
    page.flush();
    assert.deepEqual(page.alerts, []);
    page.state.cards = [episode(1), episode(1)];
    page.mutate();
    page.mutate();
    page.flush();
    assert.equal(page.alerts.length, 1);
    page.mutate();
    page.flush();
    assert.equal(page.alerts.length, 1);
    page.manual();
    assert.equal(page.alerts.length, 2);
});

test('checks only current DOM records and forgets cards removed by the app', function() {
    const page = load([episode(1), episode(1)]);
    page.flush();
    page.state.cards = [episode(1)];
    page.mutate();
    page.flush();
    page.manual();
    assert.match(page.alerts.at(-1), /No problems found in 1 currently rendered watches/);
});

test('does not mistake unloaded placeholders for missing episodes', function() {
    const page = load([episode(4), appCard(null), episode(1)]);
    page.flush();
    assert.deepEqual(page.alerts, []);
    page.manual();
    assert.match(page.alerts[0], /2 currently rendered watches/);
});

test('preserves existing order and gap checks within contiguous rendered history', function() {
    const gap = load([episode(4), episode(1)]);
    gap.flush();
    assert.match(gap.alerts[0], /Found missing episode/);
    const order = load([episode(1), episode(2)]);
    order.flush();
    assert.match(order.alerts[0], /Found unsorted watch/);
});

test('starts checking after client-side navigation from another app page', function() {
    const page = load([episode(1), episode(1)], 'https://app.trakt.tv/home');
    page.flush();
    assert.deepEqual(page.alerts, []);
    page.location.href = 'https://app.trakt.tv/history';
    page.mutate();
    page.flush();
    assert.match(page.alerts[0], /Possible duplicate submissions/);
    page.location.href = 'https://app.trakt.tv/users/me/library';
    page.mutate();
    page.flush();
    assert.equal(page.alerts.length, 1);
});

test('does not report an empty or incomplete page as a successful scan', function() {
    const page = load([appCard(null), appCard('/shows/example?view=episode')]);
    page.flush();
    assert.deepEqual(page.alerts, []);
    page.manual();
    assert.equal(page.alerts[0], 'No rendered history records found on this page.');
});

test('continues to support legacy history markup and episode paths', function() {
    const page = load([
        legacyCard('https://trakt.tv/shows/example/seasons/1/episodes/1', 'Oct 24, 11:25 PM'),
        legacyCard('https://trakt.tv/shows/example/seasons/1/episodes/1/', 'Oct 24, 11:24 PM'),
    ], 'https://trakt.tv/users/example/history');
    page.flush();
    assert.match(page.alerts[0], /Possible duplicate submissions/);
    assert.match(page.alerts[0], /Oct 24, 11:24 PM/);
});
