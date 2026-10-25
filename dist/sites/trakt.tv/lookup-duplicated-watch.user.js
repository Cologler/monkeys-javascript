// ==UserScript==
// @name                trakt.tv: lookup duplicated watch
// @name:zh-CN          trakt.tv：查找重复观看记录
// @namespace           https://github.com/Cologler/monkeys-javascript
// @version             0.1.10
// @description         Created: 2024/09/18 23:20:59
// @description         find duplicated watch and alert them
// @description:zh-CN   查找重复的观看记录并发出提醒
// @author              Cologler (skyoflw@gmail.com)
// @match               https://trakt.tv/users/*/history
// @match               https://trakt.tv/users/*/history/*
// @match               https://app.trakt.tv/*
// @grant               GM.registerMenuCommand
// @noframes
// @license             MIT
// ==/UserScript==

// for document, see: https://violentmonkey.github.io/api/gm/

(function() {
    'use strict';

    /**
     * @typedef {Object} WatchRecord
     * @property {string} url
     * @property {string} title
     * @property {string} date
     * @property {string | undefined} show
     * @property {number | undefined} season
     * @property {number | undefined} episode
     * @property {number} segment Contiguous rendered cards, separated by unloaded placeholders.
     */

    const reportedProblems = new Set();
    let checkTimer;

    /**
     * @template T
     * @param {T[]} array
     * @param {(item: T) => any} selector
     * @returns {Array<Array<T>>}
     */
    function groupBy(array, selector) {
        const groupKeys = [];
        const groups = new Map();
        for (const item of array) {
            const key = selector(item);
            if (!groups.has(key)) {
                groupKeys.push(key);
                groups.set(key, []);
            }
            groups.get(key).push(item);
        }
        return groupKeys.map(key => groups.get(key));
    }

    /**
     * @returns {boolean}
     */
    function isHistoryPage() {
        return location.hostname === 'app.trakt.tv'
            ? /^\/history\/?$/.test(location.pathname)
            : /^\/users\/[^/]+\/history(?:\/|$)/.test(location.pathname);
    }

    /**
     * @returns {WatchRecord[]}
     */
    function getRecords() {
        const records = [];
        let segment = 0;
        const isApp = location.hostname === 'app.trakt.tv';
        const cards = document.querySelectorAll(isApp
            ? '.calendar-day-anchor .trakt-summary-card'
            : '#history-items .grid-item');

        for (const card of cards) {
            const href = isApp
                ? card.querySelector('.trakt-card-content > a[href]')?.getAttribute('href')
                : card.querySelector('meta')?.getAttribute('content');
            const title = card.querySelector(isApp ? '.trakt-card-title' : '.titles-link')?.textContent.trim();
            const dateElement = card.querySelector(isApp ? '.trakt-card-subtitle[title]' : '.format-date');

            // Off-screen cards are empty shells; never load or retain their watch data.
            if (!href || !title || !dateElement) {
                segment++;
                continue;
            }

            let url;
            try {
                url = new URL(href, location.href);
            }
            catch {
                segment++;
                continue;
            }

            const match = url.pathname.match(/^\/shows\/([^/]+)\/seasons\/(\d+)\/episodes\/(\d+)\/?$/);
            const appShow = url.pathname.match(/^\/shows\/([^/]+)\/?$/);
            const season = match ? match[2] : url.searchParams.get('season');
            const episode = match ? match[3] : url.searchParams.get('episode');
            const isEpisode = Boolean(match || (appShow && url.searchParams.get('view') === 'episode'))
                && /^\d+$/.test(season ?? '') && /^\d+$/.test(episode ?? '');

            if (!isEpisode && !/^\/movies\/[^/]+\/?$/.test(url.pathname)) {
                segment++;
                continue;
            }

            // Display mode and other navigation parameters must not split the same watch identity.
            url.search = '';
            url.hash = '';
            url.pathname = url.pathname.replace(/\/$/, '');
            if (isEpisode && appShow) {
                url.searchParams.set('view', 'episode');
                url.searchParams.set('season', String(Number(season)));
                url.searchParams.set('episode', String(Number(episode)));
            }

            const day = card.closest('.calendar-day-anchor');
            const subtitles = card.querySelectorAll('.trakt-card-subtitle');
            const date = isApp && day && subtitles.length > 1
                ? `${day.id.slice(4)} ${subtitles[subtitles.length - 1].textContent.trim()}`
                : dateElement.getAttribute('title') || dateElement.textContent.trim();

            records.push({
                url: url.href,
                title,
                date,
                show: isEpisode ? (match || appShow)[1] : undefined,
                season: isEpisode ? Number(season) : undefined,
                episode: isEpisode ? Number(episode) : undefined,
                segment,
            });
        }
        return records;
    }

    /**
     * @param {boolean} fromAuto
     * @returns {void}
     */
    function showDuplicated(fromAuto) {
        if (!isHistoryPage()) {
            reportedProblems.clear();
            return;
        }

        const records = getRecords();
        console.debug(`Found ${records.length} records:`, records);

        const errorMessages = [];

        // find wrong order
        groupBy(records.filter(x => x.show), x => x.show)
            .filter(x => x.length > 1)
            .forEach(originalArray => {
                const showName = originalArray[0].show;
                const sortedArray = originalArray.toSorted((a, b) => {
                    if (a.season !== b.season) {
                        return a.season - b.season;
                    }
                    return a.episode - b.episode;
                }).toReversed(); // from newest to oldest

                console.debug(`[${showName}] Original watch:`,
                    originalArray.map(x => `S${x.season}E${x.episode}`));
                console.debug(`[${showName}] Sorted watch:`,
                    sortedArray.map(x => `S${x.season}E${x.episode}`));

                // compare two array:
                for (let i = 0; i < originalArray.length; i++) {
                    if (originalArray[i].season !== sortedArray[i].season
                        || originalArray[i].episode !== sortedArray[i].episode) {
                        const ep = originalArray[i];
                        errorMessages.push(`Found unsorted watch for show "${showName}": ${ep.season}x${ep.episode}`);
                        return;
                    }
                }

                // find missing episodes
                for (let i = 0; i < sortedArray.length - 1; i++) {
                    const current = sortedArray[i];
                    const next = sortedArray[i + 1];
                    if (next &&
                        current.segment === next.segment &&
                        current.season === next.season &&
                        current.episode !== next.episode &&
                        (current.episode - next.episode !== 1)) {
                        errorMessages.push(
                            `Found missing episode for show "${showName}": ${next.season}x${next.episode} -> ${current.season}x${current.episode}`);
                    }
                }
            });

        // find duplicated
        const duplicated = groupBy(records, x => x.url)
            .filter(x => x.length > 1);
        if (duplicated.length > 0) {
            for (const values of duplicated) {
                errorMessages.push(`Possible duplicate submissions (or intentional rewatches): ${values[0].url}\n`
                    + values.map(value => `  @${value.date}`).join('\n'));
            }
        }

        if (errorMessages.length > 0) {
            // Re-rendering the same cards must not repeatedly interrupt the user.
            if (!fromAuto || errorMessages.some(message => !reportedProblems.has(message))) {
                errorMessages.forEach(message => reportedProblems.add(message));
                alert(`Checked ${records.length} currently rendered watches only.\n` + errorMessages.join('\n'));
            }
        }
        else if (!fromAuto) {
            alert(records.length > 0
                ? `No problems found in ${records.length} currently rendered watches.`
                : 'No rendered history records found on this page.');
        }
    }

    if (typeof GM !== "undefined" && GM.registerMenuCommand) {
        GM.registerMenuCommand('Lookup duplicated watch', () => showDuplicated(false));
    }

    /**
     * @returns {void}
     */
    function scheduleCheck() {
        clearTimeout(checkTimer);
        checkTimer = setTimeout(() => showDuplicated(true), 300);
    }

    // The app renders history after page load and also navigates without reloading scripts.
    new MutationObserver(scheduleCheck).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['href', 'content', 'title', 'id'],
    });
    scheduleCheck();
})();
