// ==UserScript==
// @name                Jumper: github.com
// @namespace           https://github.com/Cologler/monkeys-javascript
// @version             0.1
// @description         Created: 2024/09/18 19:00:27
// @description         Jump to jsDelivr CDN
// @author              Cologler (skyoflw@gmail.com)
// @match               https://github.com/*
// @grant               GM.registerMenuCommand
// @grant               GM.openInTab
// @noframes
// @license             MIT
// ==/UserScript==

// for document, see: https://violentmonkey.github.io/api/gm/

/**
 * @typedef GithubMetadata
 * @property {string} owner
 * @property {string} repo
 * @property {string} branch
 * @property {string} path
 */
(function() {
    'use strict';

    /**
     *
     * @param {Location} location
     * @returns {GithubMetadata | null}
     */
    function parseGithubMetadataFromLocation(location) {
        const match = location.pathname.match(
            /^\/(?<owner>[^/]+)\/(?<repo>[^/]+)(?:\/(?<type>tree|blob)\/(?<branch>[^/]+)(?:\/(?<path>.+))?)?$/
        );

        if (!match) {
            return null;
        }

        return {
            owner: match.groups.owner,
            repo: match.groups.repo,
            branch: match.groups.branch,
            path: match.groups.path,
        };
    }

    /**
     * @param {GithubMetadata} metadata
     */
    function getJsDelivrUrl(metadata) {
        // browse packages:
        // https://www.jsdelivr.com/package/gh/Cologler/monkey-in-zoo-javascript
        // direct link:
        // https://cdn.jsdelivr.net/gh/Cologler/dom-builder-typescript@0.1.0/dist/dom-builder.js

        //let url = `https://www.jsdelivr.com/package/gh/${metadata.owner}/${metadata.repo}`;
        const url = new URL(`https://www.jsdelivr.com/package/gh/${metadata.owner}/${metadata.repo}`);
        url.searchParams.set('tab', 'files');
        if (metadata.path) {
            url.searchParams.set('path', metadata.path);
        }
        return url.toString();
    }

    GM.registerMenuCommand('jsDelivr', () => {
        const metadata = parseGithubMetadataFromLocation(window.location);
        if (metadata) {
            GM.openInTab(getJsDelivrUrl(metadata));
        }
    });
})();
