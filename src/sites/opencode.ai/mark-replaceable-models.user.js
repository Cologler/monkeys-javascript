// ==UserScript==
// @name               OpenCode: Mark Replaceable Models
// @name:zh-CN         OpenCode：标记可替代模型
// @namespace          https://github.com/Cologler/monkeys-javascript
// @version            0.1.6
// @description        Mark enabled OpenCode Zen models that have a newer, no-more-expensive replacement
// @description:zh-CN  标记 OpenCode Zen 中可由价格不高于旧版的新版本替代的已启用模型
// @author             Cologler (skyoflw@gmail.com)
// @match              https://opencode.ai/console/wrk_*/models
// @grant              none
// @noframes
// @license            MIT
// ==/UserScript==

const PRICE_FIELDS = {
    input: 'Input',
    output: 'Output',
    cacheRead: 'Cache Read',
    cacheWrite: 'Cache Write',
};

/**
 * @typedef {object} Prices
 * @property {number | null} input The input price.
 * @property {number | null} output The output price.
 * @property {number | null} cacheRead The cache-read price.
 * @property {number | null} cacheWrite The cache-write price.
 */

/**
 * @typedef {object} PricedModel
 * @property {string} name The displayed model name.
 * @property {string} family The normalized model family.
 * @property {number[]} version The numeric version segments.
 * @property {Prices} costs The model prices.
 */

/**
 * Normalizes a model name for family comparisons.
 * @param {string} value The model name.
 * @returns {string} The normalized model name.
 */
function normalizeName(value) {
    return value
        .toLowerCase()
        .replace(/[-\u2010-\u2015]+/g, ' ')
        .replace(/\bcontributor\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extracts the model family and numeric version from a model name.
 * @param {string} name The model name.
 * @returns {{ family: string, version: number[] } | null} The parsed model, or null when no version exists.
 */
function parseModel(name) {
    const match = /\d+(?:\.\d+)*/.exec(name);
    if (!match) {
        return null;
    }

    return {
        family: normalizeName(`${name.slice(0, match.index)} ${name.slice(match.index + match[0].length)}`),
        version: match[0].split('.').map(Number),
    };
}

/**
 * Parses one price cell.
 * @param {string} value The displayed price.
 * @returns {number | null} The numeric price, or null when the value is unrecognized.
 */
function parsePrice(value) {
    const text = value.trim();
    if (/^(free|免费|[-\u2013\u2014])$/i.test(text)) {
        return 0;
    }
    const match = text.match(/^\$(\d+(?:\.\d+)?)$/);
    return match ? Number(match[1]) : null;
}

/**
 * Compares numeric model versions.
 * @param {number[]} left The left version segments.
 * @param {number[]} right The right version segments.
 * @returns {number} A negative, zero, or positive comparison result.
 */
function compareVersions(left, right) {
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
        const difference = (left[index] ?? 0) - (right[index] ?? 0);
        if (difference) {
            return difference;
        }
    }
    return 0;
}

/**
 * Checks all four price dimensions, including matching unavailable operations.
 * @param {Prices} candidate The replacement prices.
 * @param {Prices} current The current prices.
 * @returns {boolean} Whether the replacement is no more expensive.
 */
function isNoMoreExpensive(candidate, current) {
    return Object.keys(PRICE_FIELDS).every(function(field) {
        const price = candidate[field];
        return price === null
            ? current[field] === null
            : current[field] !== null && price <= current[field];
    });
}

/**
 * Finds the newest same-family model whose four prices do not exceed the current model.
 * @param {PricedModel[]} models All priced models.
 * @param {PricedModel} current The current model.
 * @returns {PricedModel | undefined} The replacement model, if one exists.
 */
function findReplacement(models, current) {
    return models
        .filter(function(candidate) {
            return candidate.family === current.family
                && compareVersions(candidate.version, current.version) > 0
                && isNoMoreExpensive(candidate.costs, current.costs);
        })
        .sort(function(left, right) {
            return compareVersions(right.version, left.version);
        })[0];
}

/**
 * Logs a model replacement with both price sets.
 * @param {{ debug: Function }} logger The console-compatible logger.
 * @param {PricedModel} current The model being replaced.
 * @param {PricedModel} replacement The replacement model.
 * @returns {void}
 */
function logReplacement(logger, current, replacement) {
    logger.debug(
        `[OpenCode replaceable models] ${current.name} -> ${replacement.name}`,
        {
            current: current.costs,
            replacement: replacement.costs,
        },
    );
}

function installStyles(documentRoot) {
    const style = documentRoot.createElement('style');
    style.textContent = `
        tr[data-replaceable-model] {
            background: rgba(234, 179, 8, 0.12);
        }

        .replaceable-model-badge {
            flex: 1;
            min-width: 0;
            /* Keep replacement text out of the table's intrinsic column sizing. */
            contain: inline-size;
            overflow-wrap: anywhere;
            color: #ca8a04;
            font-size: 0.75rem;
            font-weight: 600;
        }
    `;
    documentRoot.head.append(style);
}

/**
 * Locates the four price columns in the current models table.
 * @param {HTMLTableElement} table The workspace models table.
 * @returns {Record<string, number>} Column indexes keyed by price field.
 */
function getPriceColumns(table) {
    const headers = Array.from(table.querySelectorAll('thead th'), function(cell) {
        return cell.textContent.trim();
    });
    const columns = {};
    for (const [field, label] of Object.entries(PRICE_FIELDS)) {
        const index = headers.indexOf(label);
        if (index < 0) {
            throw new Error(`Missing ${label} price column.`);
        }
        columns[field] = index;
    }
    return columns;
}

/**
 * Reads all four displayed prices from one model row.
 * @param {HTMLTableRowElement} row The model row.
 * @param {Record<string, number>} columns The price column indexes.
 * @returns {Prices} The parsed prices.
 */
function readModelCosts(row, columns) {
    return {
        input: parsePrice(row.cells[columns.input]?.textContent ?? ''),
        output: parsePrice(row.cells[columns.output]?.textContent ?? ''),
        cacheRead: parsePrice(row.cells[columns.cacheRead]?.textContent ?? ''),
        cacheWrite: parsePrice(row.cells[columns.cacheWrite]?.textContent ?? ''),
    };
}

function readPricedModels(rows, costsByRow) {
    return rows.map(function(row) {
        const name = row.cells[0]?.firstElementChild?.firstElementChild?.firstElementChild?.textContent.trim();
        const parsed = name && parseModel(name);
        return parsed
            ? { ...parsed, name, row, costs: costsByRow.get(row) }
            : null;
    }).filter(Boolean);
}

function createModelMarker(documentRoot) {
    let priceErrorShown = false;
    return function markModels() {
        const table = Array.from(documentRoot.querySelectorAll('table')).find(function(candidate) {
            return candidate.querySelector('tbody input[data-slot="switch-input"]');
        });
        if (!table) {
            return;
        }

        const rows = Array.from(table.querySelectorAll('tbody tr')).filter(function(row) {
            return row.querySelector('input[data-slot="switch-input"]');
        });
        let costsByRow;
        try {
            const columns = getPriceColumns(table);
            costsByRow = new Map(rows.map(function(row) {
                return [row, readModelCosts(row, columns)];
            }));
            const costs = Array.from(costsByRow.values());
            if (!Object.keys(PRICE_FIELDS).every(function(field) {
                return costs.some(function(modelCosts) {
                    return modelCosts[field] !== null;
                });
            })) {
                throw new Error('One or more model price columns have no usable values.');
            }
        } catch (error) {
            if (!priceErrorShown) {
                priceErrorShown = true;
                console.error('[OpenCode replaceable models]', error);
                window.alert(`Unable to read model prices from this page.\n${error}`);
            }
            return;
        }
        const models = readPricedModels(rows, costsByRow);

        for (const row of rows) {
            const current = models.find(function(model) {
                return model.row === row;
            });
            const replacement = current && row.querySelector('input[data-slot="switch-input"]')?.getAttribute('aria-checked') === 'true'
                ? findReplacement(models, current)
                : undefined;
            const existingBadge = row.querySelector('.replaceable-model-badge');
            if (!replacement) {
                existingBadge?.remove();
                if (row.hasAttribute('data-replaceable-model')) {
                    row.removeAttribute('data-replaceable-model');
                }
                continue;
            }

            const badgeTitle = Object.entries(PRICE_FIELDS).map(
                function([field, label]) {
                    return `${label}: ${current.costs[field] ?? '-'} -> ${replacement.costs[field] ?? '-'}`;
                },
            ).join('\n');
            // Reconcile actual DOM after page rerenders without retriggering our observer indefinitely.
            if (row.dataset.replaceableModel === replacement.name && existingBadge
                && existingBadge.textContent === `Replace with ${replacement.name}`
                && existingBadge.title === badgeTitle) {
                continue;
            }

            existingBadge?.remove();
            current.row.dataset.replaceableModel = replacement.name;
            const badge = documentRoot.createElement('span');
            badge.className = 'replaceable-model-badge';
            badge.textContent = `Replace with ${replacement.name}`;
            badge.title = badgeTitle;
            current.row.cells[0]?.firstElementChild?.firstElementChild?.append(badge);
            logReplacement(console, current, replacement);
        }
    };
}

function main() {
    'use strict';

    installStyles(document);
    const markModels = createModelMarker(document);

    const observer = new MutationObserver(markModels);
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    document.addEventListener('change', markModels);
    markModels();
}

// Export helpers for Node.js tests without running the browser-only entry point.
if (typeof module === 'object' && module.exports) {
    module.exports = {
        compareVersions,
        findReplacement,
        isNoMoreExpensive,
        logReplacement,
        normalizeName,
        parseModel,
        parsePrice,
    };
} else {
    try {
        main();
    } catch (error) {
        console.error('[OpenCode replaceable models]', error);
    }
}
