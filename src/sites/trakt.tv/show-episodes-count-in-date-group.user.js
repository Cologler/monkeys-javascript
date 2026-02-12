// ==UserScript==
// @name                trakt.tv: show episodes count in date group
// @name:zh-CN          trakt.tv: 在日期组显示剧集数量
// @namespace           https://github.com/Cologler/monkeys-javascript
// @version             0.1.2
// @description         Show episodes count in date group of trakt.tv history page
// @author              Cologler (skyoflw@gmail.com)
// @match               https://trakt.tv/users/*/history
// @match               https://trakt.tv/users/*/history/*
// @noframes
// @license             MIT
// ==/UserScript==

(function() {
    'use strict';

    const showStateMarker = Symbol('showStateMarker');

    function updateTitle() {
        /** @type {HTMLDivElement} */
        const root = document.querySelector('#history-items div.posters');

        /** @type {HTMLDivElement | null} */
        let groupTitle = null;

        /** @type {HTMLDivElement[]} */
        const groupRecords = [];

        function updateCurrentGroup() {
            if (groupTitle && !groupTitle[showStateMarker]) {
                const count = groupRecords.length;
                groupTitle.querySelector('h2.with-line').appendChild(document.createTextNode(` (${count} episodes)`));
                groupTitle[showStateMarker] = true;
            }
        }

        for (const element of root.children) {
            if (element.classList.contains('dividers')) { // is title
                updateCurrentGroup();
                groupTitle = element;
                groupRecords.length = 0;
            }
            else if (element.classList.contains('grid-item')) { // is record
                groupRecords.push(element);
            }
        }
        updateCurrentGroup(); // the last group
    }

    setTimeout(() => {
        // date groups are dynamic create after a while
        updateTitle();
    }, 200);
})();
