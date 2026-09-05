const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('marker survives rerenders and settles without repeated DOM writes', function() {
    const source = process.env.MARKER_SOURCE
        || 'src/sites/opencode.ai/mark-replaceable-models.user.js';
    const context = vm.createContext({ module: { exports: {} }, console });
    vm.runInContext(fs.readFileSync(source, 'utf8'), context);
    let writes = 0;
    function createRow(name) {
        const row = {
            dataset: {},
            checkbox: { checked: true },
            badge: null,
            querySelector: function(selector) {
                if (selector === '[data-slot="model-name"] span') return { textContent: name };
                if (selector === 'input[type="checkbox"]') return this.checkbox;
                if (selector === '.replaceable-model-badge') return this.badge;
                return { append: function(badge) { row.badge = badge; writes += 1; } };
            },
            hasAttribute: function() { return this.dataset.replaceableModel !== undefined; },
            removeAttribute: function() { delete this.dataset.replaceableModel; },
        };
        return row;
    }
    let rows = [createRow('GPT 5'), createRow('GPT 5.1')];
    const documentRoot = {
        querySelectorAll: function(selector) {
            return selector.startsWith('tr') ? rows : rows.map(function(row) { return row.badge; }).filter(Boolean);
        },
        createElement: function() {
            return { remove: function() {
                for (const row of rows) {
                    if (row.badge === this) { row.badge = null; writes += 1; }
                }
            } };
        },
    };
    const costs = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
    const mark = context.createModelMarker(documentRoot, new Map([['gpt 5', costs], ['gpt 5.1', costs]]));
    mark();
    assert.ok(rows[0].badge);
    rows[1].checkbox.checked = false;
    mark();
    rows = [createRow('GPT 5'), createRow('GPT 5.1')];
    rows[1].checkbox.checked = false;
    mark();
    assert.ok(rows[0].badge, 'same values on new DOM nodes must regain their marker');
    rows[0].badge.remove();
    mark();
    assert.ok(rows[0].badge, 'removed badge must be restored on a retained row');
    const settledWrites = writes;
    mark();
    assert.equal(writes, settledWrites, 'observer callback must settle');
    rows[0].checkbox.checked = false;
    mark();
    assert.equal(rows[0].badge, null);
    assert.equal(rows[0].dataset.replaceableModel, undefined);
});
