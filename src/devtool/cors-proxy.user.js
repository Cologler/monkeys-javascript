// ==UserScript==
// @name                CORS Proxy
// @namespace           https://github.com/Cologler/monkeys-javascript
// @version             0.1.0
// @description         proxy xhr to GM_xmlhttpRequest to prevent CORS issues.
// @author              Cologler (skyoflw@gmail.com)
// @match               https://github.com/Cologler/monkeys-javascript
// @grant               GM_xmlhttpRequest
// @grant               GM_getValue
// @grant               GM_setValue
// @noframes
// @license             MIT
// ==/UserScript==

/**
 * How To Use:
 *
 * 1. install this script.
 * 2. add url match to the page to enable the script.
 * 3. add `urls` regexs array to config to match urls those you want to proxy.
 * 4. finally, those xhr will be able cross origin access!
 */

(function() {
    'use strict';

    const sOpenArgs = Symbol('open-args');
    const sRequestHeaders = Symbol('request-headers');
    const sResponse = Symbol('response');
    const sGmXhr = Symbol('gm-xhr');

    const rules = [];

    function filterRequest(xhr) {
        const openArgs = xhr[sOpenArgs];
        if (openArgs) {
            const { url, method } = openArgs;
            for (let index = rules.length-1; index >= 0; index--) {
                const fn = rules[index];
                const rv = fn(url, method);
                if (typeof rv === 'boolean') {
                    return rv;
                }
            }
        }
        return false;
    }

    function addRuleInMemory(testFunc) {
        rules.push(testFunc);
    }

    const xhrReadonlyProperties = new Set();

    // make copy for origin functions
    const origin = {};
    for (const [name, desc] of Object.entries(Object.getOwnPropertyDescriptors(XMLHttpRequest.prototype))) {
        if (desc.value && typeof desc.value === 'function') {
            origin[name] = desc.value;
        }
        else if (desc.set === undefined && typeof desc.get === 'function') {
            xhrReadonlyProperties.add(name);
        }
    }

    // override

    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
        this[sOpenArgs] = {
            method, url, async, user, password
        };
        return origin.open.apply(this, arguments);
    }

    XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
        const headers = this[sRequestHeaders] || (this[sRequestHeaders] = []);
        headers.push([header, value]);
        return origin.setRequestHeader.apply(this, arguments);
    }

    XMLHttpRequest.prototype.send = function(data) {
        if (!filterRequest(this)) {
            return origin.send.apply(this, arguments);
        }

        const headers = {};
        for (const [header, value] of (this[sRequestHeaders] || [])) {
            headers[header] = value;
        }

        const details = {
            ...this[sOpenArgs],
            headers,
            data
        };

        if (this.responseType !== undefined) {
            details.responseType = this.responseType;
        }

        if (this.timeout !== undefined) {
            details.timeout = this.timeout;
        }

        for (const callbackName of [
            'onabort', 'onerror',
            'onload', 'onloadend', 'onloadstart',
            'onprogress', 'onreadystatechange', 'ontimeout'
        ]) {
            const callback = this[callbackName];
            if (callback) {
                details[callbackName] = (resp) => {
                    overwriteProperites(this, resp);
                    callback.call(this);
                }
            }
        }

        const control = GM_xmlhttpRequest(details);
        this[sGmXhr] = control;
    }

    XMLHttpRequest.prototype.abort = function() {
        const control = this[sGmXhr];
        if (control) {
            control.abort();
        }
        else {
            return origin.abort.call(this);
        }
    }

    XMLHttpRequest.prototype.getAllResponseHeaders = function() {
        if (!this[sGmXhr]) {
            return origin.getAllResponseHeaders.apply(this, arguments);
        }
        return this[sResponse]?.responseHeaders;
    }

    XMLHttpRequest.prototype.getResponseHeader = function(header) {
        if (!this[sGmXhr]) {
            return origin.getResponseHeader.apply(this, arguments);
        }

        if (typeof header !== 'string') {
            return null;
        }

        const headerKey = header.toLowerCase() + ':';
        /** @type string */
        const headers = this[sResponse]?.responseHeaders;
        if (headers) {
            const headersArray = headers.trim().split(/[\r\n]+/);
            for (const headerStr of headersArray) {
                if (headerStr.toLowerCase().startsWith(headerKey)) {
                    return headerStr.substr(headerKey.length).trim();
                }
            }
        }
        return null;
    }

    function overwriteProperites(xhr, resp) {
        if (resp) {
            xhr[sResponse] = resp;
            for (const name of xhrReadonlyProperties) {
                if (resp[name] !== undefined) {
                    Object.defineProperty(xhr, name, {
                        value: resp[name],
                        writable: true
                    });
                }
            }
        }
    }

    // config
    /** @type string[] */
    const regexs = GM_getValue('urls', []).map(x => RegExp(x));
    addRuleInMemory(url => {
        return regexs.some(r => r.test(url)) ? true : null;
    });

    function addUrlRegex(regex) {
        regexs.push(new RegExp(regex));
        GM_setValue('urls', GM_getValue('urls', []).push(regex));
    }

    // export
    unsafeWindow.corsProxy = {
        addRuleInMemory,
        addUrlRegex
    };
})();
