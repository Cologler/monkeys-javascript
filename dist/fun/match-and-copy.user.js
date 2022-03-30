// ==UserScript==
// @name                Match and Copy
// @namespace           https://github.com/Cologler/monkeys-javascript
// @version             0.1
// @description         Generate copy command by matching text.
// @author              Cologler (skyoflw@gmail.com)
// @match               http*://*/*
// @grant               GM.getValue
// @grant               GM.registerMenuCommand
// @grant               GM.setClipboard
// @noframes
// @license             MIT
// ==/UserScript==

(async function() {
    'use strict';

    class RuleProxy {
        constructor(rule) {
            if (typeof rule === 'string') {
                this._regex = new RegExp(rule);
                this._name = null;
            } else {
                this._regex = new RegExp(rule.regex);
                this._name = rule.name;
            }
        }

        match(text) {
            const match = text.match(this._regex);
            if (match) {
                const value = match[1] || match[0];
                return {
                    name: this._name || value,
                    value,
                };
            }
        }
    }

    let rules = (await GM.getValue('regexes', []))
        .map(x => new RuleProxy(x));

    let texts = new Set();
    function addCopyCommand(value, name) {
        if (!texts.has(value)) {
            texts.add(value);
            GM.registerMenuCommand(`Copy ${name}`, async () => {
                GM.setClipboard(value);
            });
        }
    }

    function matchWithElement(element) {
        let text = element.textContent;
        if (text) {
            for (const rule of rules) {
                const match = rule.match(text);
                if (match) {
                    addCopyCommand(match.value, match.name);
                }
            }
        }
    }

    matchWithElement(document.body);
})();
