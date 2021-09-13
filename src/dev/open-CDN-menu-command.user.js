// ==UserScript==
// @name                Open CDN MenuCommand
// @namespace           https://github.com/Cologler/monkeys-javascript
// @version             0.1.0
// @description         register open CDN MenuCommand
// @author              Cologler (skyoflw@gmail.com)
// @match               https://github.com/*
// @grant               GM.registerMenuCommand
// @grant               GM.openInTab
// @noframes
// @license             MIT
// ==/UserScript==

/**
 * @typedef GithubMetadata
 * @property {string} owner
 * @property {string} repo
 * @property {string} branch
 * @property {string} path
 */
(function () {
    'use strict';

    /**
     *
     * @param {Location} location
     * @returns {GithubMetadata}
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
    function getJsDelivrUrlFromGithubMetadata(metadata) {
        // browse packages:
        // https://www.jsdelivr.com/package/gh/Cologler/monkey-in-zoo-javascript
        // direct link:
        // https://cdn.jsdelivr.net/gh/Cologler/dom-builder-typescript@0.1.0/dist/dom-builder.js

        let url = `https://www.jsdelivr.com/package/gh/${metadata.owner}/${metadata.repo}`;
        if (metadata.path) {
            url += `/${metadata.path}`;
        }
        return url;
    }

    function getCDNInfos() {
        const cdns = [];

        if (window.location.hostname === 'github.com') {
            const githubMetadata = parseGithubMetadataFromLocation(window.location);
            if (githubMetadata) {
                const jsDelivrUrl = getJsDelivrUrlFromGithubMetadata(githubMetadata);
                cdns.push({
                    name: 'jsDelivr',
                    url: jsDelivrUrl
                });
            }
        }

        return cdns;
    }

    for (const cdn of getCDNInfos()) {
        GM.registerMenuCommand(cdn.name, () => {
            GM.openInTab(cdn.url);
        });
    }
})();
