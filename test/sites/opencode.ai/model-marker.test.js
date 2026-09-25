const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('marker survives rerenders and settles without repeated DOM writes', function() {
    const source = process.env.MARKER_SOURCE
        || 'src/sites/opencode.ai/mark-replaceable-models.user.js';
    const context = vm.createContext({
        module: { exports: {} },
        console,
        window: { alert: function(message) { assert.fail(message); } },
    });
    vm.runInContext(fs.readFileSync(source, 'utf8'), context);
    let writes = 0;
    function createRow(name) {
        const row = {
            dataset: {},
            checkbox: {
                checked: true,
                getAttribute: function() { return this.checked ? 'true' : 'false'; },
            },
            badge: null,
            cells: [
                {
                    firstElementChild: {
                        firstElementChild: {
                            firstElementChild: { textContent: name },
                            append: function(badge) { row.badge = badge; writes += 1; },
                        },
                    },
                },
                {},
                { textContent: '$1.00' },
                { textContent: '$1.00' },
                { textContent: '$0.00' },
                { textContent: '$0.00' },
                {},
            ],
            querySelector: function(selector) {
                if (selector === 'input[data-slot="switch-input"]') return this.checkbox;
                if (selector === '.replaceable-model-badge') return this.badge;
                return null;
            },
            hasAttribute: function() { return this.dataset.replaceableModel !== undefined; },
            removeAttribute: function() { delete this.dataset.replaceableModel; },
        };
        return row;
    }
    let rows = [createRow('GPT 5'), createRow('GPT 5.1')];
    const table = {
        querySelector: function(selector) {
            return selector === 'tbody input[data-slot="switch-input"]' ? rows[0]?.checkbox : null;
        },
        querySelectorAll: function(selector) {
            if (selector === 'tbody tr') return rows;
            if (selector === 'thead th') {
                return ['Model', 'Features', 'Input', 'Output', 'Cache Read', 'Cache Write', 'Enabled'].map(
                    function(textContent) { return { textContent }; },
                );
            }
            return [];
        },
    };
    const documentRoot = {
        querySelectorAll: function(selector) {
            return selector === 'table' ? [table] : [];
        },
        createElement: function() {
            return { remove: function() {
                for (const row of rows) {
                    if (row.badge === this) { row.badge = null; writes += 1; }
                }
            } };
        },
    };
    const mark = context.createModelMarker(documentRoot);
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
