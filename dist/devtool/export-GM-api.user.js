// ==UserScript==
// @name               devtool: export GM Api to global
// @name:zh-CN         devtool: 在控制台启用 GM API
// @namespace          https://github.com/Cologler/monkeys-javascript
// @version            1.0
// @description        export GM Api to global (window)
// @author             cologler
// @match              http://*/*
// @match              https://*/*
// @grant              unsafeWindow
// @grant              GM_addStyle
// @grant              GM_deleteValue
// @grant              GM_listValues
// @grant              GM_addValueChangeListener
// @grant              GM_removeValueChangeListener
// @grant              GM_setValue
// @grant              GM_getValue
// @grant              GM_log
// @grant              GM_getResourceText
// @grant              GM_getResourceURL
// @grant              GM_registerMenuCommand
// @grant              GM_unregisterMenuCommand
// @grant              GM_openInTab
// @grant              GM_xmlhttpRequest
// @grant              GM_download
// @grant              GM_getTab
// @grant              GM_saveTab
// @grant              GM_getTabs
// @grant              GM_notification
// @grant              GM_setClipboard
// @grant              GM_info
// @grant              GM.addStyle
// @grant              GM.deleteValue
// @grant              GM.listValues
// @grant              GM.addValueChangeListener
// @grant              GM.removeValueChangeListener
// @grant              GM.setValue
// @grant              GM.getValue
// @grant              GM.log
// @grant              GM.getResourceText
// @grant              GM.getResourceURL
// @grant              GM.registerMenuCommand
// @grant              GM.unregisterMenuCommand
// @grant              GM.openInTab
// @grant              GM.xmlhttpRequest
// @grant              GM.download
// @grant              GM.getTab
// @grant              GM.saveTab
// @grant              GM.getTabs
// @grant              GM.notification
// @grant              GM.setClipboard
// @grant              GM.info
// @noframes
// ==/UserScript==

(function() {
    'use strict';

    const GMAPI = {};

    // sync api
    for (const propertyName of Object.getOwnPropertyNames(window)) {
        if (propertyName.startsWith('GM_')) {
            GMAPI[propertyName] = window[propertyName];
        }
    }

    // async api
    GMAPI.GM = GM;

    // other
    GMAPI.context_Window = window;

    // export
    const global = unsafeWindow;
    for (const exportName of ['GMAPI', 'GM_API', 'GM_API_' + crypto.getRandomValues(new Uint32Array(1))[0].toString()]) {
        if (global[exportName] === undefined) {
            global[exportName] = GMAPI;
            console.info(`exported GM Api (with name: '${exportName}') to global.`);
            return;
        }
    }
})();
