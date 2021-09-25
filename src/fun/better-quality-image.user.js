// ==UserScript==
// @name                Better Quality Image
// @namespace           https://github.com/Cologler/monkeys-javascript
// @version             0.1
// @description         switch image src to high quality version.
// @author              Cologler (skyoflw@gmail.com)
// @match               https://tieba.baidu.com/p/*
// @grant               none
// @license             MIT
// @require             https://cdn.jsdelivr.net/gh/Cologler/monkey-in-zoo-javascript@0.3.2/dist/dom.js
// ==/UserScript==

(function() {
    'use strict';

    const RAW_URL = Symbol('raw-url');

    function setSrc(img, src) {
        img[RAW_URL] = img.src;
        console.debug(`rewrite src: '${img.src}' -> '${src}'`);
        img.src = src;
    }

    dom.on('img', img => {
        if (img.src) {
            let url = new URL(img.src);
            if (url) {
                switch (url.hostname) {
                    case 'tiebapic.baidu.com':
                        // http://tiebapic.baidu.com/forum/.../sign=.../....jpg
                        let match = img.src.match(/\/[^\/]+$/);
                        if (match) {
                            setSrc(img, 'https://tiebapic.baidu.com/forum/pic/item' + match[0]);
                        }
                        break;
                }
            }
        }
    });
})();
