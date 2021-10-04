// ==UserScript==
// @name               rarbg: Attach Image on List
// @namespace          https://github.com/Cologler/monkeys-javascript
// @version            0.1.0
// @description        attach image on list
// @author             Cologler (skyoflw@gmail.com)
// @match              https://rarbg.is/*
// @match              https://rarbgprx.org/*
// @grant              none
// @noframes
// @license            MIT
// ==/UserScript==

(function() {
    'use strict';

    if (location.pathname === '/torrents.php') {
        function getURL(el) {
            // parse image source from el
            const d = el.getAttribute('onmouseover');
            return d.match('\'(http[^\']*)\\\\\'')[1];
        }

        document.querySelectorAll('.lista2t .lista2').forEach(tr => {
            const img = document.createElement('img');
            img.classList.add('make-by-AttachImageOnList');
            img.src = getURL(tr.children[1].children[0]);
            img.style.float = 'right';
            img.style.width = '100px';
            img.style.maxHeight = '200px';
            const td = document.createElement('td');
            td.appendChild(img);
            tr.appendChild(td);
        });
    }
})();