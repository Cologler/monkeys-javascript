const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFileMetadata, getFileLinks } = require('../../../src/sites/github.com/raw-options.user.js');

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
