// ==UserScript==
// @name               getpocket.com: open on new tab
// @namespace          https://github.com/Cologler/monkeys-javascript
// @version            0.1.0
// @description        try to take over the world!
// @author             Cologler (skyoflw@gmail.com)
// @match              https://getpocket.com/*/my-list
// @grant              none
// @noframes
// @license            MIT
// @require            https://cdn.jsdelivr.net/gh/Cologler/monkey-in-zoo-javascript@0.4.0/dist/dom.js
// ==/UserScript==

(function() {
    'use strict';

    Dom.on('.main a', a => {
        if (!(a.href || '').startsWith('https://getpocket.com')) {
            a.setAttribute('target', '_blank');
        }
    });
})();
