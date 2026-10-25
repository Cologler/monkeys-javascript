const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFileMetadata, getFileLinks, getReleaseLinks, createReleaseLookup } = require('../../../src/sites/github.com/raw-options.user.js');

const commit = '1234567890abcdef1234567890abcdef12345678';
const repository = 'https://github.com/owner/repo';

test('resolves slash-containing refs and encoded filenames without splitting the ref', function() {
    const metadata = parseFileMetadata(
        `${repository}/blob/feature/new-menu/src/a%20%23%E4%B8%AD%25.js`,
        `${repository}/tree/feature/new-menu`,
        `${repository}/raw/refs/heads/feature/new-menu/src/a%20%23%E4%B8%AD%25.js`,
        `${repository}/commit/${commit}`,
    );
    assert.deepEqual(metadata, {
        owner: 'owner', repo: 'repo', branch: 'feature/new-menu', path: 'src/a #中%.js', commit,
    });
    const links = getFileLinks(metadata);
    assert.equal(links.length, 5);
    assert.equal(links[0].url, `${repository}/raw/${commit}/src/a%20%23%E4%B8%AD%25.js`);
    assert.equal(links[1].url, 'https://cdn.jsdelivr.net/gh/owner/repo@feature%2Fnew-menu/src/a%20%23%E4%B8%AD%25.js');
    assert.equal(links[2].url, `https://cdn.jsdelivr.net/gh/owner/repo@${commit}/src/a%20%23%E4%B8%AD%25.js`);
    assert.equal(links[3].url, 'https://raw.githack.com/owner/repo/feature%2Fnew-menu/src/a%20%23%E4%B8%AD%25.js');
    assert.equal(links[4].url, `https://rawcdn.githack.com/owner/repo/${commit}/src/a%20%23%E4%B8%AD%25.js`);
});

test('accepts tags and commit permalinks', function() {
    for (const [ref, rawRef] of [['v1.0', 'refs/tags/v1.0'], [commit, commit]]) {
        const metadata = parseFileMetadata(
            `${repository}/blob/${ref}/file.js`, `${repository}/tree/${ref}`,
            `${repository}/raw/${rawRef}/file.js`, `${repository}/commit/${commit}`,
        );
        assert.equal(metadata.branch, ref);
        assert.equal(metadata.commit, commit);
    }
});

test('rejects stale Raw or breadcrumb URLs during navigation', function() {
    assert.equal(parseFileMetadata(
        `${repository}/blob/main/new.js`, `${repository}/tree/main`,
        `${repository}/raw/refs/heads/main/old.js`, `${repository}/commit/${commit}`,
    ), null);
    assert.equal(parseFileMetadata(
        `${repository}/blob/main/file.js`, `${repository}/tree/other`,
        `${repository}/raw/refs/heads/main/file.js`, `${repository}/commit/${commit}`,
    ), null);
    assert.equal(parseFileMetadata(
        `${repository}/tree/main`, `${repository}/tree/main`,
        `${repository}/raw/refs/heads/main/file.js`, null,
    ), null);
});

test('omits pinned links when a valid file commit is unavailable', function() {
    for (const commitHref of [null, `${repository}/commit/1234567`, `https://github.com/other/repo/commit/${commit}`]) {
        const metadata = parseFileMetadata(
            `${repository}/blob/main/file.js`, `${repository}/tree/main`,
            `${repository}/raw/refs/heads/main/file.js`, commitHref,
        );
        assert.equal(metadata.commit, null);
        assert.deepEqual(getFileLinks(metadata).map(function(link) { return link.label; }), [
            'jsDelivr · current ref', 'raw.githack · current ref',
        ]);
    }
});

test('rejects malformed encoding and foreign link origins', function() {
    assert.equal(parseFileMetadata(
        `${repository}/blob/main/%.js`, `${repository}/tree/main`, `${repository}/raw/main/%.js`, null,
    ), null);
    assert.equal(parseFileMetadata(
        `${repository}/blob/main/file.js`, 'https://example.com/owner/repo/tree/main',
        `${repository}/raw/main/file.js`, null,
    ), null);
    assert.equal(parseFileMetadata(
        `${repository}/blob/main/file.js`, `${repository}/tree/main`,
        'https://example.com/owner/repo/raw/main/file.js', null,
    ), null);
});

test('release links use the returned tag with an explicit GitHub tag ref', function() {
    const links = getReleaseLinks({ owner: 'owner', repo: 'repo', path: 'src/a #中%.js' }, 'release/v1.2');
    assert.deepEqual(links.map(function(link) { return link.url; }), [
        `${repository}/raw/refs/tags/release%2Fv1.2/src/a%20%23%E4%B8%AD%25.js`,
        'https://cdn.jsdelivr.net/gh/owner/repo@release%2Fv1.2/src/a%20%23%E4%B8%AD%25.js',
        'https://rawcdn.githack.com/owner/repo/release%2Fv1.2/src/a%20%23%E4%B8%AD%25.js',
    ]);
});

test('concurrent and repeated lookups share one request per case-insensitive repository', async function() {
    let calls = 0;
    let finish;
    const response = new Promise(function(resolve) { finish = resolve; });
    const lookup = createReleaseLookup(function(url, options) {
        calls += 1;
        assert.equal(url, 'https://api.github.com/repos/Owner/Repo/releases/latest');
        assert.equal(options.credentials, 'omit');
        return response;
    });
    const first = lookup('Owner', 'Repo');
    const second = lookup('owner', 'repo');
    assert.equal(first, second);
    finish(new Response(JSON.stringify({ tag_name: 'v1.2.3' })));
    assert.deepEqual(await first, { tag: 'v1.2.3', error: null });
    assert.deepEqual(await lookup('OWNER', 'REPO'), { tag: 'v1.2.3', error: null });
    assert.equal(calls, 1);
});

test('memory cache expires, isolates repositories, and starts empty in a new instance', async function() {
    let time = 1000;
    let calls = 0;
    function clock() { return time; }
    async function fetchRelease() {
        calls += 1;
        return new Response(JSON.stringify({ tag_name: `v${calls}` }));
    }
    const first = createReleaseLookup(fetchRelease, clock);
    assert.equal((await first('owner', 'repo')).tag, 'v1');
    assert.equal((await first('owner', 'repo')).tag, 'v1');
    assert.equal(calls, 1);
    assert.equal((await first('owner', 'other')).tag, 'v2');
    time += 15 * 60 * 1000;
    assert.equal((await first('owner', 'repo')).tag, 'v3');
    const reloaded = createReleaseLookup(fetchRelease, clock);
    assert.equal((await reloaded('owner', 'repo')).tag, 'v4');
    assert.equal(calls, 4);
});

test('missing latest releases are cached for fifteen minutes', async function() {
    let time = 0;
    let calls = 0;
    const lookup = createReleaseLookup(async function() {
        calls += 1;
        return new Response('{}', { status: 404 });
    }, function() { return time; });
    assert.deepEqual(await lookup('owner', 'repo'), { tag: null, error: null });
    time = 15 * 60 * 1000 - 1;
    assert.deepEqual(await lookup('owner', 'repo'), { tag: null, error: null });
    assert.equal(calls, 1);
    time += 1;
    await lookup('owner', 'repo');
    assert.equal(calls, 2);
});

test('rate-limit failures remain cached until both retry-after and reset have elapsed', async function() {
    let time = 0;
    let calls = 0;
    const lookup = createReleaseLookup(async function() {
        calls += 1;
        return calls === 1 ? new Response('{}', {
            status: 403,
            headers: { 'retry-after': '120', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '600' },
        }) : new Response(JSON.stringify({ tag_name: 'v2' }));
    }, function() { return time; });
    const result = await lookup('owner', 'repo');
    assert.equal(result.tag, null);
    assert.match(result.error, /HTTP 403/);
    time = 600000 - 1;
    assert.deepEqual(await lookup('owner', 'repo'), result);
    assert.equal(calls, 1);
    time += 1;
    assert.equal((await lookup('owner', 'repo')).tag, 'v2');
    assert.equal(calls, 2);
});

test('network failures are distinct from missing releases and retry after one minute', async function() {
    let time = 0;
    let calls = 0;
    const lookup = createReleaseLookup(async function() {
        calls += 1;
        throw new Error('Network failed');
    }, function() { return time; });
    const result = await lookup('owner', 'repo');
    assert.match(result.error, /Network failed/);
    assert.deepEqual(await lookup('owner', 'repo'), result);
    assert.equal(calls, 1);
    time = 60000;
    await lookup('owner', 'repo');
    assert.equal(calls, 2);
});

test('invalid, draft, and prerelease responses do not produce release links', async function() {
    for (const body of [null, {}, { tag_name: '' }, { tag_name: 'v1', draft: true }, { tag_name: 'v1', prerelease: true }]) {
        const lookup = createReleaseLookup(async function() {
            return new Response(JSON.stringify(body));
        });
        const result = await lookup('owner', 'repo');
        assert.equal(result.tag, null);
        assert.match(result.error, /Invalid release response/);
    }
});
