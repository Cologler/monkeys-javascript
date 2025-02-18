// ==UserScript==
// @name                trakt.tv: lookup duplicated watch
// @namespace           https://github.com/Cologler/monkeys-javascript
// @version             0.1.3
// @description         Created: 2024/09/18 23:20:59
// @description         find duplicated watch and alert them
// @author              Cologler (skyoflw@gmail.com)
// @match               https://trakt.tv/users/*/history
// @grant               GM.registerMenuCommand
// @noframes
// @license             MIT
// ==/UserScript==

// for document, see: https://violentmonkey.github.io/api/gm/

(function() {
    'use strict';

    function showDuplicated() {
        const groups = new Map();

        const records = Array.from(document.querySelectorAll('#history-items .grid-item')).map(x => {
            return {
                url: x.querySelector('meta').content,
                title: x.querySelector('.titles-link').textContent,
                date: x.querySelector('.format-date').textContent
            }
        });

        console.debug(`Found ${records.length} records:`, records);

        records.forEach(x => {
            if (!groups.has(x.url)) {
                groups.set(x.url, []);
            }
            groups.get(x.url).push(`${x.title} @ ${x.date}`);
        });

        const duplicated = Array.from(groups.entries())
            .filter(([key, values]) => {
                if (values.length > 1) {
                    console.info(`${key} have ${values.length} items:`);
                    for (const value of values) {
                        console.info(`  ${value}`);
                    }
                    return true;
                }
                else {
                    console.debug(`${key} only have one item.`);
                    return false;
                }
            })

        if (duplicated.length > 0) {
            let message = `Found ${duplicated.length} duplicated watches from ${records.length} watches.`;
            for (const [key, values] of duplicated) {
                for (const value of values) {
                    message += `\n  ${key} - ${value}`;
                }
            }
            alert(`Found ${duplicated.length} duplicated watch.\n${duplicated.join('\n')}`);
        }
        else {
            alert('No duplicated watch from ${records.length} watches..');
        }
    }

    GM.registerMenuCommand('Lookup duplicated watch', showDuplicated);
})();
