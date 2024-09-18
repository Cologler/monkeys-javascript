// ==UserScript==
// @name                trakt.tv: lookup duplicated watch
// @namespace           https://github.com/Cologler/monkeys-javascript
// @version             0.1
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

        document.querySelectorAll('#history-items .grid-item').forEach(x => {
            const meta = x.querySelector('meta');
            const key = meta.content;
            const title = x.querySelector('.titles-link').textContent;
            const date = x.querySelector('.format-date').textContent;
            const record = `${title} @ ${date}`;
            // get or set
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(record);
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
            let message = `Found ${duplicated.length} duplicated watch.`;
            for (const [key, values] of duplicated) {
                for (const value of values) {
                    message += `\n  ${key} - ${value}`;
                }
            }
            alert(`Found ${duplicated.length} duplicated watch.\n${duplicated.join('\n')}`);
        }
        else {
            alert('No duplicated watch.');
        }
    }

    GM.registerMenuCommand('Lookup duplicated watch', showDuplicated);
})();
