const test = require('node:test');
const assert = require('node:assert/strict');

const {
    compareVersions,
    fetchPriceHtml,
    findReplacement,
    isNoMoreExpensive,
    normalizeName,
    parseModel,
    parsePrice,
    parsePrices,
} = require('../../../src/sites/opencode.ai/mark-replaceable-models.user.js');

const normalizeNameCases = [
    ['GPT 5.3 Codex', 'gpt 5.3 codex'],
    ['Muse-Spark 1.3 Contributor Free', 'muse spark 1.3 free'],
    ['  Claude\u2014Opus   5  ', 'claude opus 5'],
];

for (const [input, expected] of normalizeNameCases) {
    test(`normalizeName: ${input}`, function() {
        assert.equal(normalizeName(input), expected);
    });
}

const parseModelCases = [
    ['Claude Fable 5.1', { family: 'claude fable', version: [5, 1] }],
    ['Claude Opus 4.8', { family: 'claude opus', version: [4, 8] }],
    ['Claude Sonnet 5', { family: 'claude sonnet', version: [5] }],
    ['Claude Haiku 4.5', { family: 'claude haiku', version: [4, 5] }],
    ['GPT 5', { family: 'gpt', version: [5] }],
    ['GPT 5.3 Codex', { family: 'gpt codex', version: [5, 3] }],
    ['GPT 5.1 Codex Max', { family: 'gpt codex max', version: [5, 1] }],
    ['Gemini 3.8 Flash', { family: 'gemini flash', version: [3, 8] }],
    ['Qwen3.7 Plus', { family: 'qwen plus', version: [3, 7] }],
    ['DeepSeek V4 Pro', { family: 'deepseek v pro', version: [4] }],
    ['MiniMax M2.7', { family: 'minimax m', version: [2, 7] }],
    ['GLM 5.2', { family: 'glm', version: [5, 2] }],
    ['Kimi K2.7 Code', { family: 'kimi k code', version: [2, 7] }],
    ['Muse Spark 1.3 Free', { family: 'muse spark free', version: [1, 3] }],
    ['Ling 3.0 Flash Fin Free', { family: 'ling flash fin free', version: [3, 0] }],
    ['Nemotron 3.5 Lightning Free', { family: 'nemotron lightning free', version: [3, 5] }],
    ['Big Pickle', null],
];

for (const [input, expected] of parseModelCases) {
    test(`parseModel: ${input}`, function() {
        assert.deepEqual(parseModel(input), expected);
    });
}

const parsePriceCases = [
    ['Free', 0],
    ['免费', 0],
    ['$3.125', 3.125],
    ['-', 0],
    ['\u2013', 0],
    ['\u2014', 0],
    ['unknown', null],
    ['', null],
    ['3.125', null],
    ['$3.125 extra', null],
    ['USD 3.125', null],
];

for (const [input, expected] of parsePriceCases) {
    test(`parsePrice: ${input}`, function() {
        assert.equal(parsePrice(input), expected);
    });
}

test('compareVersions compares numeric segments', function() {
    assert.equal(compareVersions([5], [5, 0]), 0);
    assert.ok(compareVersions([5, 1], [5, 2]) < 0);
    assert.ok(compareVersions([5, 10], [5, 2]) > 0);
});

test('isNoMoreExpensive compares all four price dimensions', function() {
    const current = {
        input: 1,
        output: 2,
        cacheRead: 0.1,
        cacheWrite: null,
    };

    assert.equal(isNoMoreExpensive({
        cacheWrite: null,
        cacheRead: 0.1,
        output: 2,
        input: 1,
    }, current), true);
    assert.equal(isNoMoreExpensive({
        input: 0.5,
        output: 1,
        cacheRead: 0.05,
        cacheWrite: null,
    }, current), true);
    assert.equal(isNoMoreExpensive({
        input: 1,
        output: 2.1,
        cacheRead: 0.1,
        cacheWrite: null,
    }, current), false);
    assert.equal(isNoMoreExpensive({
        input: 1,
        output: 2,
        cacheRead: 0.1,
        cacheWrite: 1,
    }, current), false);
    assert.equal(isNoMoreExpensive({
        input: 1,
        output: 2,
        cacheRead: 0.1,
        cacheWrite: null,
    }, { ...current, cacheWrite: 1 }), false);
    assert.equal(isNoMoreExpensive({
        input: 1,
        output: 2,
        cacheRead: 0.1,
    }, current), false);
    assert.equal(isNoMoreExpensive({
        input: 1,
        output: null,
        cacheRead: 0.1,
        cacheWrite: 0,
    }, {
        input: 1,
        output: null,
        cacheRead: 0.1,
        cacheWrite: 0,
    }), true);
});

test('parsePrices keeps the lowest context tier and all four prices', function() {
    const prices = parsePrices([
        {
            name: 'Claude Sonnet 4.5 (\u2264 200K tokens)',
            input: '$3.00',
            output: '$15.00',
            cacheRead: '$0.30',
            cacheWrite: '$3.75',
        },
        {
            name: 'Claude Sonnet 4.5 (> 200K tokens)',
            input: '$6.00',
            output: '$22.50',
            cacheRead: '$0.60',
            cacheWrite: '$7.50',
        },
        {
            name: 'Muse Spark 1.3 Contributor Free',
            input: 'Free',
            output: 'Free',
            cacheRead: 'Free',
            cacheWrite: '-',
        },
        {
            name: 'Invalid Model 1',
            input: '$1.00',
            output: 'unknown',
            cacheRead: '$0.10',
            cacheWrite: '-',
        },
        {
            name: 'Incomplete Model 1',
            input: '$1.00',
        },
    ]);

    assert.deepEqual(prices.get('claude sonnet 4.5'), {
        input: 3,
        output: 15,
        cacheRead: 0.3,
        cacheWrite: 3.75,
    });
    assert.deepEqual(prices.get('muse spark 1.3 free'), {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
    });
    assert.deepEqual(prices.get('invalid model 1'), {
        input: 1,
        output: null,
        cacheRead: 0.1,
        cacheWrite: 0,
    });
    assert.deepEqual(prices.get('incomplete model 1'), {
        input: 1,
        output: null,
        cacheRead: null,
        cacheWrite: null,
    });
});

test('findReplacement selects the newest affordable model in the same family', function() {
    const current = {
        name: 'GPT 5 Codex',
        family: 'gpt codex',
        version: [5],
        costs: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: null },
    };
    const models = [
        current,
        {
            name: 'GPT 5.1 Codex',
            family: 'gpt codex',
            version: [5, 1],
            costs: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: null },
        },
        {
            name: 'GPT 5.3 Codex',
            family: 'gpt codex',
            version: [5, 3],
            costs: { input: 1.75, output: 8, cacheRead: 0.175, cacheWrite: null },
        },
        {
            name: 'GPT 5.4 Codex',
            family: 'gpt codex',
            version: [5, 4],
            costs: { input: 1.75, output: 12, cacheRead: 0.175, cacheWrite: null },
        },
        {
            name: 'Other 9',
            family: 'other',
            version: [9],
            costs: { input: 0, output: 0, cacheRead: 0, cacheWrite: null },
        },
    ];

    assert.equal(findReplacement(models, current).name, 'GPT 5.3 Codex');
    assert.equal(findReplacement(models, models[2]), undefined);
});

test('fetchPriceHtml uses the supplied fetch implementation', async function() {
    let requestedUrl;
    const html = await fetchPriceHtml(function(url) {
        requestedUrl = url;
        return Promise.resolve({
            ok: true,
            status: 200,
            text: function() {
                return Promise.resolve('<html>prices</html>');
            },
        });
    });

    assert.equal(requestedUrl, 'https://opencode.ai/docs/zh-cn/zen/');
    assert.equal(html, '<html>prices</html>');
});

test('fetchPriceHtml reports HTTP failures without reading the body', async function() {
    let bodyRead = false;
    await assert.rejects(
        fetchPriceHtml(function() {
            return Promise.resolve({
                ok: false,
                status: 503,
                text: function() {
                    bodyRead = true;
                    return Promise.resolve('unavailable');
                },
            });
        }),
        /Unable to load OpenCode Zen prices: HTTP 503/,
    );
    assert.equal(bodyRead, false);
});
