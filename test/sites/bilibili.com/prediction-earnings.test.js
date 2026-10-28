const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sourcePath = path.join(__dirname, '../../../src/sites/bilibili.com/prediction-earnings.user.js');
const { normalize, summarize, groupEvents, toUnits } = require(sourcePath);

function group(id, overrides = {}, time = 1792886400) {
    return { contest: { stime: time, sid: 806, season: { id: 806, title: 'Worlds 2026' } }, guess: [{
        id: id, stake: 5, income: 7.7, status: 1, stake_type: 1, correct: 1,
        ctime: time - 86400, ...overrides,
    }] };
}

function loadFetcher(pages) {
    const calls = [];
    const context = { module: { exports: {} }, Intl, URL, URLSearchParams, AbortSignal,
        fetch: async function (url, options) {
            calls.push({ url: new URL(url), options: options });
            assert.ok(pages.length, 'Unexpected extra request');
            const result = pages.shift();
            return { ok: true, json: async function () { return result; } };
        } };
    vm.runInNewContext(fs.readFileSync(sourcePath, 'utf8'), context);
    return { fetchHistory: context.module.exports.fetchHistory, calls: calls };
}

function page(pn, total, records, ps = 50) {
    return { code: 0, data: { page: { pn: pn, ps: ps, total: total }, record: records } };
}

test('separates pending stakes, refunds, and token currencies from settled ROI', function () {
    const data = normalize([
        group(1), group(2, { income: 0, correct: 0 }),
        group(3, { income: null, status: 0 }),
        group(4, { income: null, is_delete: 1 }),
        group(5, { stake_type: 2, stake: 1000 }),
        group(6, { guess_season: { activity: { activity_id: 123 } } }),
    ]);
    assert.equal(data.excluded, 2);
    assert.deepEqual(summarize(data.records), {
        count: 2, wins: 1, stake: 1000, income: 770, pending: 1, locked: 500, refunds: 1, net: -230,
    });
});

test('a prediction settling between requests is counted once using the settled result', function () {
    const data = normalize([group(1, { status: 0, income: 0 }), group(1)]);
    assert.equal(data.records.length, 1);
    assert.equal(summarize(data.records).net, 270);
});

test('aggregates decimal returns without floating-point residue', function () {
    const data = normalize([group(1, { stake: '0.1', income: '0.2' }),
        group(2, { stake: 0.2, income: 0.3 })]);
    assert.equal(summarize(data.records).net, 20);
    for (const invalid of [null, '', ' ', false, -1, Infinity, 'unknown']) {
        assert.throws(function () { toUnits(invalid); });
    }
    assert.throws(function () { normalize([group(1, { income: null })]); });
    assert.throws(function () { normalize([group(1, { ctime: 0 }, 0)]); });
});

test('matches the observed 27 settled coin records and recent 16 records', function () {
    const stakes = [5, 10, 10, 5, 5, 5, 5, 10, 5, 5, 5, 5, 5, 5, 10, 10, 2, 10, 5, 10, 5, 5, 10, 5, 5, 10, 5];
    const returns = [7.7, 0, 0, 0, 0, 6.2, 10.7, 0, 0, 0, 0, 9.5, 0, 21.3, 15.4, 19.1, 3.2, 16.2, 8.6, 0, 10.7, 0, 14.3, 0, 0, 0, 7.9];
    const groups = stakes.map(function (stake, index) {
        const record = group(index + 1, { stake: stake, income: returns[index], correct: Number(returns[index] > 0) },
            index < 16 ? 1792886400 : 1762671600);
        if (index >= 16) {
            record.contest.sid = 677;
            record.contest.season = { id: 677, title: 'Worlds 2025' };
        }
        return record;
    });
    const records = normalize(groups).records;
    const all = summarize(records);
    assert.equal(all.stake, 17700);
    assert.equal(all.income, 15080);
    assert.equal(all.net, -2620);
    assert.equal(all.wins, 13);
    const recent = summarize(groupEvents(records)[0].records);
    assert.equal(recent.count, 16);
    assert.equal(recent.net, -1510);
});

test('keeps cross-midnight matches and five-hour BO5 gaps together but splits a twelve-hour gap', function () {
    const times = ['2026-10-24T23:00:00+08:00', '2026-10-25T00:00:00+08:00',
        '2026-10-25T05:00:00+08:00', '2026-10-25T17:00:00+08:00'];
    const records = normalize(times.map(function (time, index) {
        return group(index + 1, {}, Date.parse(time) / 1000);
    })).records.reverse();
    const events = groupEvents(records);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].phases.map(function (phase) { return phase.records.length; }), [3, 1]);
    assert.deepEqual(events[0].phases.map(function (phase) { return phase.number; }), [1, 2]);
    assert.equal(events[0].title, 'Worlds 2026');
});

test('does not mix events played at the same time or split multiple predictions for one match', function () {
    const first = group(1);
    const second = group(2);
    second.contest.sid = 100;
    second.contest.season = { id: 100, title: 'Another event' };
    const events = groupEvents(normalize([first, second, group(3)]).records);
    assert.equal(events.length, 2);
    assert.deepEqual(events.map(function (event) { return event.phases.length; }), [1, 1]);
    assert.equal(events.find(function (event) { return event.id === '806'; }).records.length, 2);
});

test('splits the observed seventeen-hour break between yesterday and today', function () {
    const groups = [group(1, {}, Date.parse('2026-10-24T08:00:00+08:00') / 1000),
        group(2, {}, Date.parse('2026-10-25T01:00:00+08:00') / 1000)];
    assert.equal(groupEvents(normalize(groups).records)[0].phases.length, 2);
    assert.deepEqual(groupEvents([]), []);
});

test('hides phases without settled predictions while retaining pending records in mixed phases', function () {
    const start = Date.parse('2026-10-24T01:00:00+08:00') / 1000;
    const records = normalize([
        group(1, { status: 0, income: null }, start),
        group(2, {}, start + 3600),
        group(3, { status: 0, income: null }, start + 20 * 3600),
        group(4, { is_delete: 1, income: null }, start + 40 * 3600),
    ]).records;
    const events = groupEvents(records);
    assert.equal(events.length, 1);
    assert.equal(events[0].phases.length, 1);
    assert.equal(events[0].phases[0].start, start * 1000);
    assert.equal(events[0].phases[0].records.length, 2);
    assert.equal(summarize(events[0].phases[0].records).pending, 1);
    assert.equal(summarize(records).pending, 2);
});

test('hides events with only pending or refunded predictions, including an entirely pending account', function () {
    const pending = group(1, { status: 0, income: null });
    const refunded = group(2, { is_delete: 1, income: null });
    assert.deepEqual(groupEvents(normalize([pending, refunded]).records), []);
    const settled = group(3, { income: 0, correct: 0 });
    settled.contest.sid = 100;
    const events = groupEvents(normalize([pending, refunded, settled]).records);
    assert.deepEqual(events.map(function (event) { return event.id; }), ['100']);
});

test('loads all history pages and sends only credentialed GET requests to the history endpoint', async function () {
    const fixture = loadFetcher([page(1, 3, [group(1), group(2)], 2), page(2, 3, [group(3)], 2)]);
    const records = await fixture.fetchHistory(2, new AbortController().signal, function () {});
    assert.equal(records.length, 3);
    assert.deepEqual(fixture.calls.map(function (call) { return call.url.searchParams.get('pn'); }), ['1', '2']);
    for (const call of fixture.calls) {
        assert.equal(call.url.origin, 'https://api.bilibili.com');
        assert.equal(call.url.pathname, '/x/esports/guess/collection/record');
        assert.equal(call.options.credentials, 'include');
        assert.equal(call.options.method, undefined);
        assert.equal(call.options.body, undefined);
    }
});

test('accepts an empty account without displaying a loading error', async function () {
    const fixture = loadFetcher([page(1, 0, null)]);
    const records = await fixture.fetchHistory(1, new AbortController().signal, function () {});
    assert.equal(records.length, 0);
});

test('loads settled history after the observed empty pending category response', async function () {
    const fixture = loadFetcher([
        { code: -404, message: '啥都木有', ttl: 1, data: { record: null, page: { pn: 1, ps: 50 } } },
        page(1, 1, [group(1)]),
    ]);
    const signal = new AbortController().signal;
    const pending = await fixture.fetchHistory(1, signal, function () {});
    const ended = await fixture.fetchHistory(2, signal, function () {});
    assert.equal(pending.length, 0);
    assert.equal(summarize(normalize(pending.concat(ended)).records).net, 270);
    assert.deepEqual(fixture.calls.map(function (call) { return call.url.searchParams.get('type'); }), ['1', '2']);
});

test('rejects unrelated errors, inconsistent empty responses, and missing later pages', async function () {
    for (const pages of [
        [{ code: -404, message: 'Not found' }],
        [{ code: -500, data: { record: null, page: { pn: 1, ps: 50 } } }],
        [{ code: -404, data: { record: [group(1)], page: { pn: 1, ps: 50 } } }],
        [{ code: -404, data: { record: null, page: { pn: 2, ps: 50 } } }],
        [{ code: -404, data: { record: null, page: { pn: 1, ps: 0 } } }],
        [{ code: -404, data: { record: null, page: { pn: 1, ps: 50, total: 1 } } }],
        [page(1, 2, [group(1)], 1), { code: -404, data: { record: null, page: { pn: 2, ps: 1 } } }],
    ]) {
        const fixture = loadFetcher(pages);
        await assert.rejects(fixture.fetchHistory(2, new AbortController().signal, function () {}));
    }
});

test('rejects partial, repeated, changing, malformed, or unauthenticated history', async function () {
    for (const pages of [
        [page(1, 3, [group(1)], 2), page(2, 3, [], 2)],
        [page(1, 2, [group(1)], 1), page(2, 2, [group(1)], 1)],
        [page(1, 2, [group(1)], 1), page(2, 3, [group(2)], 1)],
        [page(2, 1, [group(1)])],
        [{ code: -101, message: 'Not logged in' }],
        [{ code: 0, data: {} }],
    ]) {
        const fixture = loadFetcher(pages);
        await assert.rejects(fixture.fetchHistory(2, new AbortController().signal, function () {}));
    }
});
