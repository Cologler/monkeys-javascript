// ==UserScript==
// @name               zhihu: auto collapse answers
// @name:zh-CN         知乎: 自动收起回答
// @namespace          https://github.com/Cologler/monkeys-javascript
// @version            0.3.0
// @description        auto collapse answer when you browse all answers
// @description:zh-CN  在查看全部回答时自动收起回答
// @author             Cologler (skyoflw@gmail.com)
// @match              https://www.zhihu.com/question/*
// @grant              none
// @noframes
// @license            MIT
// @require            https://cdn.jsdelivr.net/gh/Cologler/monkey-in-zoo-javascript@0.3.0/dist/dom.js
// ==/UserScript==

(function() {
    'use strict';

    dom.on('.Card .List .List-item', e => {
        for (const btn of e.querySelectorAll('button')) {
            if (btn.textContent.includes('收起')) {
                btn.click();
            }
        }
    });
})();
