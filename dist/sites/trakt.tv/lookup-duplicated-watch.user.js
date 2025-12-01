// ==UserScript==
// @name                trakt.tv: lookup duplicated watch
// @namespace           https://github.com/Cologler/monkeys-javascript
// @version             0.1.5
// @description         Created: 2024/09/18 23:20:59
// @description         find duplicated watch and alert them
// @author              Cologler (skyoflw@gmail.com)
// @match               https://trakt.tv/users/*/history
// @match               https://trakt.tv/users/*/history/*
// @grant               GM.registerMenuCommand
// @noframes
// @license             MIT
// ==/UserScript==

// for document, see: https://violentmonkey.github.io/api/gm/

(function() {
    'use strict';

    /**
     * @template T
     * @param {T[]} array
     * @param {(item: T) => any} selector
     * @returns {Array<Array<T>>}
     */
    function groupBy(array, selector) {
        const groups = new Map();
        for (const item of array) {
            const key = selector(item);
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(item);
        }
        return Array.from(groups.values());
    }

    function getRecords() {
        return Array.from(document.querySelectorAll('#history-items .grid-item')).map(x => {
            const url = x.querySelector('meta').content;
            const match = url.match(/seasons\/(?<season>\d+)\/episodes\/(?<episode>\d+)/);

            let season = undefined;
            let episode = undefined;
            if (match && match.groups) {
                season = Number(match.groups.season);
                episode = Number(match.groups.episode);
            }

            return {
                url,
                title: x.querySelector('.titles-link').textContent,
                date: x.querySelector('.format-date').textContent,
                season,
                episode
            }
        });
    }

    function showDuplicated(fromAuto) {
        const records = getRecords();
        console.debug(`Found ${records.length} records:`, records);

        // find duplicated
        const duplicated = groupBy(records, x => x.url).filter(x => x.length > 1);
        if (duplicated.length > 0) {
            let message = `Found ${duplicated.length} duplicated watches from ${records.length} watches.`;
            for (const values of duplicated) {
                message += `\n${values[0].url} have ${values.length} items:`;
                for (const value of values) {
                    message += `\n  @${value.date}`;
                }
            }
            alert(`Found ${duplicated.length} duplicated watch.\n${duplicated.join('\n')}`);
        }
        else if (!fromAuto) {
            alert(`No duplicated watch from ${records.length} watches.`);
        }
    }

    if (typeof GM !== "undefined" && GM.registerMenuCommand) {
        GM.registerMenuCommand('Lookup duplicated watch', () => showDuplicated(false));
    }

    showDuplicated(true);
})();
