// ==UserScript==
// @name               OpenCode: Mark Replaceable Models
// @name:zh-CN         OpenCode：标记可替代模型
// @namespace          https://github.com/Cologler/monkeys-javascript
// @version            0.1.3
// @description        Mark enabled OpenCode Zen models that have a newer, no-more-expensive replacement
// @description:zh-CN  标记 OpenCode Zen 中可由价格不高于旧版的新版本替代的已启用模型
// @author             Cologler (skyoflw@gmail.com)
// @match              https://opencode.ai/workspace/*
// @grant              none
// @noframes
// @license            MIT
// ==/UserScript==

const PRICE_URL = 'https://opencode.ai/docs/zh-cn/zen/';
const PRICE_FIELDS = {
    input: '输入',
    output: '输出',
    cacheRead: '缓存读取',
    cacheWrite: '缓存写入',
};

/**
 * @typedef {object} Prices
 * @property {number | null} input The input price.
 * @property {number | null} output The output price.
 * @property {number | null} cacheRead The cache-read price.
 * @property {number | null} cacheWrite The cache-write price.
 */

/**
 * @typedef {object} RawPriceRow
 * @property {string} name The displayed model name.
 * @property {string} input The displayed input price.
 * @property {string} output The displayed output price.
 * @property {string} cacheRead The displayed cache-read price.
 * @property {string} cacheWrite The displayed cache-write price.
 */

/**
 * @typedef {object} PricedModel
 * @property {string} name The displayed model name.
 * @property {string} family The normalized model family.
 * @property {number[]} version The numeric version segments.
 * @property {Prices} costs The model prices.
 */

/**
 * Normalizes a model name for matching between the pricing and workspace pages.
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
 * Fetches the OpenCode Zen pricing page.
 * @param {typeof fetch} fetcher The fetch implementation.
 * @returns {Promise<string>} The pricing page HTML.
 */
async function fetchPriceHtml(fetcher) {
    const response = await fetcher(PRICE_URL);
    if (!response.ok) {
        throw new Error(`Unable to load OpenCode Zen prices: HTTP ${response.status}`);
    }
    return response.text();
}

/**
 * Parses pricing-table rows, retaining only the lowest context tier.
 * @param {RawPriceRow[]} rows The pricing-table rows.
 * @returns {Map<string, Prices>} Prices keyed by normalized model name.
 */
function parsePrices(rows) {
    const prices = new Map();
    for (const row of rows) {
        if (!row.name || /\(\s*>/.test(row.name)) {
            continue;
        }

        const name = row.name.replace(/\s+\([^)]*\)\s*$/, '');
        const costs = {
            input: parsePrice(row.input ?? ''),
            output: parsePrice(row.output ?? ''),
            cacheRead: parsePrice(row.cacheRead ?? ''),
            cacheWrite: parsePrice(row.cacheWrite ?? ''),
        };
        if (Object.values(costs).every(function(cost) {
            return cost === null || Number.isFinite(cost);
        })) {
            prices.set(normalizeName(name), costs);
        }
    }
    return prices;
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
            margin-left: 0.5rem;
            color: #ca8a04;
            font-size: 0.75rem;
            font-weight: 600;
        }
    `;
    documentRoot.head.append(style);
}

function extractPriceRows(pricingDocument) {
    const pricingTable = Array.from(pricingDocument.querySelectorAll('table')).find(function(table) {
        const headers = Array.from(table.querySelectorAll('th'), function(cell) {
            return cell.textContent.trim();
        });
        return Object.values(PRICE_FIELDS).every(function(label) {
            return headers.includes(label);
        });
    });
    if (!pricingTable) {
        throw new Error('Unable to find the OpenCode Zen pricing table.');
    }

    const headers = Array.from(pricingTable.querySelectorAll('th'), function(cell) {
        return cell.textContent.trim();
    });
    return Array.from(pricingTable.querySelectorAll('tbody tr'), function(row) {
        const cells = Array.from(row.cells, function(cell) {
            return cell.textContent.trim();
        });
        return {
            name: cells[0],
            input: cells[headers.indexOf(PRICE_FIELDS.input)],
            output: cells[headers.indexOf(PRICE_FIELDS.output)],
            cacheRead: cells[headers.indexOf(PRICE_FIELDS.cacheRead)],
            cacheWrite: cells[headers.indexOf(PRICE_FIELDS.cacheWrite)],
        };
    });
}

function readPricedModels(rows, prices) {
    return rows.map(function(row) {
        const name = row.querySelector('[data-slot="model-name"] span')?.textContent.trim();
        const parsed = name && parseModel(name);
        return parsed && prices.has(normalizeName(name))
            ? { ...parsed, name, row, costs: prices.get(normalizeName(name)) }
            : null;
    }).filter(Boolean);
}

function createModelMarker(documentRoot, prices) {
    return function markModels() {
        const rows = Array.from(documentRoot.querySelectorAll('tr[data-slot="model-row"]'));
        const models = readPricedModels(rows, prices);

        for (const row of rows) {
            const current = models.find(function(model) {
                return model.row === row;
            });
            const replacement = current && row.querySelector('input[type="checkbox"]')?.checked
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

            // Reconcile actual DOM after page rerenders without retriggering our observer indefinitely.
            if (row.dataset.replaceableModel === replacement.name && existingBadge
                && existingBadge.textContent === `Replace with ${replacement.name}`) {
                continue;
            }

            existingBadge?.remove();
            current.row.dataset.replaceableModel = replacement.name;
            const badge = documentRoot.createElement('span');
            badge.className = 'replaceable-model-badge';
            badge.textContent = `Replace with ${replacement.name}`;
            badge.title = Object.entries(PRICE_FIELDS).map(
                function([field, label]) {
                    return `${label}: ${current.costs[field] ?? '-'} -> ${replacement.costs[field] ?? '-'}`;
                },
            ).join('\n');
            current.row.querySelector('[data-slot="model-name"] > div')?.append(badge);
            logReplacement(console, current, replacement);
        }
    };
}

async function main() {
    'use strict';

    installStyles(document);
    const pricingHtml = await fetchPriceHtml(fetch);
    const pricingDocument = new DOMParser().parseFromString(pricingHtml, 'text/html');
    const prices = parsePrices(extractPriceRows(pricingDocument));
    const markModels = createModelMarker(document, prices);

    const observer = new MutationObserver(markModels);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('change', markModels);
    markModels();
}

// Export helpers for Node.js tests without running the browser-only entry point.
if (typeof module === 'object' && module.exports) {
    module.exports = {
        compareVersions,
        fetchPriceHtml,
        findReplacement,
        isNoMoreExpensive,
        logReplacement,
        normalizeName,
        parseModel,
        parsePrice,
        parsePrices,
    };
} else {
    main().catch(function(error) {
        console.error('[OpenCode replaceable models]', error);
    });
}
