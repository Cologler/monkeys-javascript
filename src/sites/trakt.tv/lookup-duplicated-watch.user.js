// ==UserScript==
// @name                trakt.tv: lookup duplicated watch
// @namespace           https://github.com/Cologler/monkeys-javascript
// @version             0.1.8
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
            const match = url.match(
                /^https:\/\/trakt.tv\/shows\/(?<show>[^\/]+)\/seasons\/(?<season>\d+)\/episodes\/(?<episode>\d+)\/?/);

            let show = undefined;
            let season = undefined;
            let episode = undefined;
            if (match && match.groups) {
                show = match.groups.show;
                season = Number(match.groups.season);
                episode = Number(match.groups.episode);
            }

            return {
                url,
                title: x.querySelector('.titles-link').textContent,
                date: x.querySelector('.format-date').textContent,
                show,
                season,
                episode
            }
        });
    }

    function showDuplicated(fromAuto) {
        const records = getRecords();
        console.debug(`Found ${records.length} records:`, records);

        const errorMessages = [];

        // find wrong order
        groupBy(records.filter(x => x.show), x => x.show).filter(x => x.length > 1)
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
                    if (originalArray[i] !== sortedArray[i]) {
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
                        current.season === next.season &&
                        current.episode !== next.episode &&
                        (current.episode - next.episode !== 1)) {
                        errorMessages.push(
                            `Found missing episode for show "${showName}": ${next.season}x${next.episode} -> ${current.season}x${current.episode}`);
                    }
                }
            });

        // find duplicated
        const duplicated = groupBy(records, x => x.url).filter(x => x.length > 1);
        if (duplicated.length > 0) {
            errorMessages.push(`Found ${duplicated.length} duplicated watches from ${records.length} watches.`);
            for (const values of duplicated) {
                errorMessages.push(`${values[0].url} have ${values.length} items:`);
                for (const value of values) {
                    errorMessages.push(`  @${value.date}`);
                }
            }
        }

        if (errorMessages.length > 0) {
            alert(errorMessages.join('\n'));
        }
        else if (!fromAuto) {
            alert(`No wrong watch from ${records.length} watches.`);
        }
    }

    if (typeof GM !== "undefined" && GM.registerMenuCommand) {
        GM.registerMenuCommand('Lookup duplicated watch', () => showDuplicated(false));
    }

    showDuplicated(true);
})();
