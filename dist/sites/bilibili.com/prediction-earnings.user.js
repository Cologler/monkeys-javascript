// ==UserScript==
// @name               Bilibili: Prediction Earnings
// @name:zh-CN         哔哩哔哩：预测收益分析
// @namespace          https://github.com/Cologler/monkeys-javascript
// @version            0.1.1
// @description        Analyze coin prediction returns by event, inferred phase, and all-time history below My Predictions
// @description:zh-CN  在我的预测下方按赛事、推断阶段及全部历史分析硬币预测收益
// @author             Cologler (skyoflw@gmail.com)
// @match              https://www.bilibili.com/v/game/match/*
// @run-at             document-idle
// @grant              none
// @license            MIT
// ==/UserScript==

(function () {
    'use strict';

    const CARD_ID = 'monkeys-bilibili-earnings';
    const ENDPOINT = 'https://api.bilibili.com/x/esports/guess/collection/record';
    const PHASE_GAP = 12 * 3600000;
    const format = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
    let current = null;
    let mountTimer = 0;

    /**
     * Converts API coin amounts to integer hundredths before aggregation.
     * @param {number | string} value A nonnegative coin amount.
     * @returns {number} The amount in hundredths.
     */
    function toUnits(value) {
        if ((typeof value !== 'number' && typeof value !== 'string')
            || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
            throw new Error('预测记录中的金额格式已变化，无法计算完整收益。');
        }
        return Math.round(Number(value) * 100);
    }

    function coins(units, signed = false) {
        return (signed && units > 0 ? '+' : '') + format.format(units / 100);
    }

    /**
     * Fetches every page of one prediction history category, failing on incomplete results.
     * @param {number} type The site's history category: 1 for pending, 2 for ended.
     * @param {AbortSignal} signal The lifecycle cancellation signal.
     * @param {function(string): void} onProgress The loading status callback.
     * @returns {Promise<object[]>} All contest groups in the category.
     */
    async function fetchHistory(type, signal, onProgress) {
        const records = [];
        const seenGroups = new Set();
        let expectedTotal = null;
        for (let page = 1; page <= 1000; page += 1) {
            const url = new URL(ENDPOINT);
            url.search = new URLSearchParams({ type: String(type), pn: String(page), ps: '50' });
            const response = await fetch(url, {
                credentials: 'include',
                signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
            });
            if (!response.ok) {
                throw new Error('读取预测记录失败（HTTP ' + response.status + '）。');
            }
            const result = await response.json();
            if (result.code === -101) {
                throw new Error('请登录哔哩哔哩后刷新统计。');
            }
            if (result.code !== 0) {
                throw new Error('读取预测记录失败：' + (result.message || result.code));
            }
            const data = result.data;
            const info = data && data.page;
            if (!info || !Number.isInteger(info.total) || info.total < 0
                || info.pn !== page || !Number.isInteger(info.ps) || info.ps <= 0
                || (data.record != null && !Array.isArray(data.record))) {
                throw new Error('预测记录的分页格式已变化，无法确认数据完整性。');
            }
            if (expectedTotal !== null && expectedTotal !== info.total) {
                throw new Error('预测记录在加载时发生变化，请重新刷新统计。');
            }
            expectedTotal = info.total;
            const batch = data.record || [];
            for (const group of batch) {
                const ids = Array.isArray(group.guess) ? group.guess.map(function (guess) {
                    return guess.id;
                }).sort().join(',') : '';
                if (!ids || seenGroups.has(ids)) {
                    throw new Error('预测分页出现重复或无效记录，请重新刷新统计。');
                }
                seenGroups.add(ids);
            }
            records.push(...batch);
            onProgress('正在读取' + (type === 1 ? '进行中' : '已结束') + '预测：'
                + records.length + ' / ' + expectedTotal);
            if (records.length === expectedTotal) {
                return records;
            }
            if (!batch.length || records.length > expectedTotal || page * info.ps >= expectedTotal) {
                throw new Error('预测记录未完整返回，请重新刷新统计。');
            }
        }
        throw new Error('预测记录超过分页上限，未展示不完整的总收益。');
    }

    /**
     * Normalizes and deduplicates predictions while keeping currencies separate.
     * @param {object[]} groups Contest groups returned by the official history endpoint.
     * @returns {{records: object[], excluded: number}} Coin records and the excluded token count.
     */
    function normalize(groups) {
        const unique = new Map();
        for (const group of groups) {
            if (!Array.isArray(group.guess)) {
                throw new Error('预测记录格式已变化，无法计算完整收益。');
            }
            for (const guess of group.guess) {
                if (!guess.id || !Number.isInteger(guess.status) || guess.status < 0) {
                    throw new Error('预测记录缺少编号或结算状态。');
                }
                // A prediction can settle between the pending and ended requests.
                const previous = unique.get(guess.id);
                if (!previous || guess.status !== 0) {
                    unique.set(guess.id, { guess: guess, contest: group.contest });
                }
            }
        }
        const records = [];
        let excluded = 0;
        for (const entry of unique.values()) {
            const guess = entry.guess;
            const activity = guess.guess_season && guess.guess_season.activity;
            if (guess.stake_type !== 1 || (activity && activity.activity_id)) {
                excluded += 1;
                continue;
            }
            const stake = toUnits(guess.stake);
            const refunded = Boolean(guess.is_delete || guess.is_deleted);
            const pending = !refunded && guess.status === 0;
            const timestamp = Number(entry.contest && entry.contest.stime) * 1000;
            const time = timestamp > 0 ? timestamp : Number(guess.ctime) * 1000;
            if (!Number.isFinite(time) || time <= 0) {
                throw new Error('预测记录缺少有效时间，无法计算近期收益。');
            }
            records.push({
                id: guess.id,
                time: time,
                stake: stake,
                income: refunded ? stake : pending ? 0 : toUnits(guess.income),
                state: refunded ? 'refunded' : pending ? 'pending' : 'settled',
                won: guess.correct === 1,
                eventId: String(entry.contest && (entry.contest.sid
                    || (entry.contest.season && entry.contest.season.id)) || 'unknown'),
                eventTitle: entry.contest && entry.contest.season && entry.contest.season.title || '未标注赛事',
            });
        }
        return { records: records, excluded: excluded };
    }

    /**
     * Summarizes settled returns without treating pending stakes as losses.
     * @param {object[]} records Normalized coin predictions in the selected period.
     * @returns {object} The period totals in integer coin hundredths.
     */
    function summarize(records) {
        const total = { count: 0, wins: 0, stake: 0, income: 0, pending: 0, locked: 0, refunds: 0 };
        for (const record of records) {
            if (record.state === 'pending') {
                total.pending += 1;
                total.locked += record.stake;
            } else if (record.state === 'refunded') {
                total.refunds += 1;
            } else {
                total.count += 1;
                total.wins += Number(record.won);
                total.stake += record.stake;
                total.income += record.income;
            }
        }
        total.net = total.income - total.stake;
        return total;
    }

    /**
     * Groups personal predictions by event and by gaps between consecutive match starts.
     * @param {object[]} records Normalized coin predictions.
     * @returns {object[]} Events and inferred phases with at least one settled prediction, newest event first.
     */
    function groupEvents(records) {
        const events = new Map();
        for (const record of records) {
            if (!events.has(record.eventId)) {
                events.set(record.eventId, { id: record.eventId, title: record.eventTitle, records: [], phases: [] });
            }
            events.get(record.eventId).records.push(record);
        }
        for (const event of events.values()) {
            event.records.sort(function (left, right) { return left.time - right.time; });
            let phase = null;
            for (const record of event.records) {
                // Calendar days split cross-midnight sessions and cannot accommodate long BO5 matches.
                if (!phase || record.time - phase.end >= PHASE_GAP) {
                    phase = { id: String(record.time), number: event.phases.length + 1,
                        start: record.time, end: record.time, records: [] };
                    event.phases.push(phase);
                }
                phase.end = record.time;
                phase.records.push(record);
            }
            // Filter after segmentation so pending matches still determine phase boundaries.
            event.phases = event.phases.filter(function (item) {
                return item.records.some(function (record) { return record.state === 'settled'; });
            });
        }
        return Array.from(events.values()).filter(function (event) {
            return event.phases.length > 0;
        }).sort(function (left, right) {
            return right.records[right.records.length - 1].time - left.records[left.records.length - 1].time;
        });
    }

    function phaseLabel(phase) {
        const dateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai',
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
        return '阶段 ' + phase.number + ' · ' + dateFormat.format(phase.start)
            + (phase.start === phase.end ? '' : ' — ' + dateFormat.format(phase.end));
    }

    function create(tag, className, text) {
        const node = document.createElement(tag);
        node.className = className;
        if (text !== undefined) {
            node.textContent = text;
        }
        return node;
    }

    function addMetric(grid, label, value) {
        const item = create('div', 'mbe-metric');
        item.append(create('dt', '', label), create('dd', '', value));
        grid.append(item);
    }

    function renderPeriod(title, records) {
        const total = summarize(records);
        const section = create('section', 'mbe-period');
        const net = create('strong', 'mbe-net', coins(total.net, true));
        net.dataset.sign = total.net > 0 ? 'positive' : total.net < 0 ? 'negative' : 'zero';
        section.append(create('h4', '', title), create('div', 'mbe-label', '净收益 · 硬币'), net);
        const metrics = create('dl', 'mbe-metrics');
        addMetric(metrics, '已结算投入', coins(total.stake));
        addMetric(metrics, '返还（含本金）', coins(total.income));
        addMetric(metrics, '收益率', total.stake ? format.format(total.net / total.stake * 100) + '%' : '—');
        addMetric(metrics, '命中 / 已结算', total.wins + ' / ' + total.count);
        section.append(metrics);
        if (!total.count) {
            section.append(create('p', 'mbe-note', '该时段暂无已结算的硬币预测。'));
        }
        section.append(create('p', 'mbe-note', '待结算 ' + total.pending + ' 笔 · 投入 '
            + coins(total.locked) + ' 硬币；已返还 ' + total.refunds + ' 笔。'));
        return section;
    }

    function renderData(state) {
        const event = state.events.find(function (item) { return item.id === state.eventSelect.value; });
        const phase = event && event.phases.find(function (item) { return item.id === state.phaseSelect.value; });
        const byPhase = state.mode.value === 'phase';
        const selected = byPhase ? phase : event;
        const periods = [renderPeriod('所有收益', state.data.records)];
        if (selected) {
            periods.unshift(renderPeriod(byPhase ? phaseLabel(phase) : event.title, selected.records));
        }
        state.content.replaceChildren(...periods);
        state.status.textContent = '已更新 ' + new Date().toLocaleTimeString('zh-CN', { hour12: false });
        state.note.textContent = '净收益 = 返还 − 已结算投入；收益率 = 净收益 / 已结算投入。'
            + '阶段按本人的预测记录推断：同赛事相邻比赛开始时间间隔达到 12 小时即分段，跨日不单独分段；'
            + '漏投比赛可能影响划分，阶段编号不代表官方赛制。时间为北京时间，无比赛时间时采用投币时间。'
            + '赛事和阶段仅显示至少有一笔已结算预测的分组。'
            + '未结算投入和已返还记录不计入收益率。'
            + (state.data.excluded ? '另有 ' + state.data.excluded + ' 笔非硬币预测未合并统计。' : '');
    }

    function updateFilters(state) {
        const selectedEvent = state.eventSelect.value;
        state.filters.hidden = state.events.length === 0;
        state.eventSelect.replaceChildren();
        for (const event of state.events) {
            const option = create('option', '', event.title);
            option.value = event.id;
            state.eventSelect.append(option);
        }
        if (state.events.some(function (event) { return event.id === selectedEvent; })) {
            state.eventSelect.value = selectedEvent;
        }
        updatePhases(state);
    }

    function updatePhases(state) {
        const selectedPhase = state.phaseSelect.value;
        const event = state.events.find(function (item) { return item.id === state.eventSelect.value; });
        state.phaseSelect.replaceChildren();
        const phases = event ? event.phases.slice().reverse() : [];
        for (const phase of phases) {
            const option = create('option', '', phaseLabel(phase));
            option.value = phase.id;
            state.phaseSelect.append(option);
        }
        const previous = phases.find(function (phase) { return phase.id === selectedPhase; });
        const selected = previous || phases[0];
        if (selected) {
            state.phaseSelect.value = selected.id;
        }
        state.phaseSelect.hidden = state.mode.value !== 'phase';
        renderData(state);
    }

    async function refresh(state) {
        if (state.loading) {
            return;
        }
        state.loading = true;
        state.button.disabled = true;
        for (const select of [state.mode, state.eventSelect, state.phaseSelect]) {
            select.disabled = true;
        }
        state.controller = new AbortController();
        state.content.replaceChildren();
        state.note.textContent = '';
        function progress(message) {
            state.status.textContent = message;
        }
        try {
            const pending = await fetchHistory(1, state.controller.signal, progress);
            const ended = await fetchHistory(2, state.controller.signal, progress);
            if (!state.card.isConnected) {
                return;
            }
            state.data = normalize(pending.concat(ended));
            state.events = groupEvents(state.data.records);
            updateFilters(state);
        } catch (error) {
            if (state.card.isConnected) {
                state.status.textContent = error.name === 'TimeoutError'
                    ? '读取超时，请点击刷新重试。' : error.message;
            }
        } finally {
            state.loading = false;
            state.button.disabled = false;
            for (const select of [state.mode, state.eventSelect, state.phaseSelect]) {
                select.disabled = false;
            }
        }
    }

    function mount() {
        const history = document.querySelector('.container-right > .competition-history');
        if (!/^\/v\/game\/match\/competition\/?$/.test(location.pathname) || !history) {
            if (current) {
                current.controller.abort();
                current.card.remove();
                current = null;
            }
            return;
        }
        if (current && current.card.isConnected && current.card.previousElementSibling === history) {
            return;
        }
        if (current) {
            current.controller.abort();
            current.card.remove();
        }
        const card = create('section', '');
        card.id = CARD_ID;
        card.setAttribute('aria-label', '预测收益分析');
        const header = create('div', 'mbe-header');
        const filters = create('div', 'mbe-filters');
        const mode = create('select', '');
        mode.setAttribute('aria-label', '收益分组方式');
        for (const entry of [['phase', '按阶段'], ['event', '按赛事']]) {
            const option = create('option', '', entry[1]);
            option.value = entry[0];
            mode.append(option);
        }
        const eventSelect = create('select', '');
        eventSelect.setAttribute('aria-label', '选择赛事');
        const phaseSelect = create('select', 'mbe-phase-select');
        phaseSelect.setAttribute('aria-label', '选择预测阶段');
        filters.append(mode, eventSelect, phaseSelect);
        const button = create('button', '', '刷新');
        button.type = 'button';
        header.append(create('h3', '', '预测收益分析'), button);
        const status = create('p', 'mbe-status', '正在读取预测记录…');
        status.setAttribute('role', 'status');
        const content = create('div', 'mbe-content');
        const details = create('details', 'mbe-method');
        const note = create('p', 'mbe-note');
        details.append(create('summary', '', '统计口径 · 阶段间隔 12 小时'), note);
        card.append(header, filters, status, content, details);
        history.after(card);
        const state = { card: card, button: button, filters: filters, mode: mode, eventSelect: eventSelect, phaseSelect: phaseSelect,
            status: status, content: content, note: note, data: null, events: [], controller: null, loading: false };
        button.addEventListener('click', function () { refresh(state); });
        mode.addEventListener('change', function () { updatePhases(state); });
        eventSelect.addEventListener('change', function () { updatePhases(state); });
        phaseSelect.addEventListener('change', function () { renderData(state); });
        current = state;
        refresh(state);
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { toUnits, normalize, summarize, groupEvents, fetchHistory };
        return;
    }

    const style = create('style', '');
    style.textContent = `
        #${CARD_ID} { margin-top: 24px; padding: 18px 16px; border: 1px solid var(--line_regular, #e3e5e7);
            border-radius: 8px; background: var(--bg1, #fff); color: var(--text1, #18191c); font-size: 13px; }
        #${CARD_ID} * { box-sizing: border-box; }
        #${CARD_ID} .mbe-header { display: flex; align-items: center; gap: 8px; }
        #${CARD_ID} h3 { margin: 0 auto 0 0; font-size: 18px; font-weight: 400; }
        #${CARD_ID} .mbe-filters { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px; margin-top: 12px; }
        #${CARD_ID} .mbe-filters select { min-width: 0; max-width: 100%; }
        #${CARD_ID} .mbe-phase-select { grid-column: 1 / -1; width: 100%; }
        #${CARD_ID} [hidden] { display: none !important; }
        #${CARD_ID} button, #${CARD_ID} select { padding: 4px 6px; border: 1px solid var(--line_regular, #e3e5e7);
            border-radius: 4px; background: var(--bg1, #fff); color: inherit; font: inherit; cursor: pointer; }
        #${CARD_ID} button:disabled, #${CARD_ID} select:disabled { opacity: .5; cursor: wait; }
        #${CARD_ID} .mbe-status, #${CARD_ID} .mbe-note, #${CARD_ID} .mbe-label, #${CARD_ID} dt {
            color: var(--text3, #9499a0); font-size: 12px; line-height: 1.7; }
        #${CARD_ID} .mbe-status { margin: 8px 0 12px; overflow-wrap: anywhere; }
        #${CARD_ID} .mbe-period + .mbe-period { border-top: 1px solid var(--line_regular, #e3e5e7);
            margin-top: 16px; padding-top: 16px; }
        #${CARD_ID} h4 { margin: 0 0 10px; font-size: 14px; font-weight: 500; }
        #${CARD_ID} .mbe-net { display: block; margin: 2px 0 10px; font-size: 30px; line-height: 1.3;
            font-weight: 600; font-variant-numeric: tabular-nums; }
        #${CARD_ID} [data-sign="positive"] { color: #00a884; }
        #${CARD_ID} [data-sign="negative"] { color: #f25d8e; }
        #${CARD_ID} .mbe-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0; }
        #${CARD_ID} dd { margin: 0; font-size: 16px; font-variant-numeric: tabular-nums; }
        #${CARD_ID} .mbe-note { margin: 12px 0 0; }
        #${CARD_ID} .mbe-method { margin-top: 14px; color: var(--text3, #9499a0); font-size: 12px; }
        #${CARD_ID} summary { cursor: pointer; }
    `;
    document.head.append(style);
    const observer = new MutationObserver(function () {
        clearTimeout(mountTimer);
        mountTimer = setTimeout(mount, 100);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    mount();
})();
