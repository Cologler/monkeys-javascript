// ==UserScript==
// @name               Hupu: Four-Column LoL Scores
// @namespace          https://github.com/Cologler/monkeys-javascript
// @version            0.1.2
// @description        Browse LoL matches, games, players, and comments in four persistent columns
// @author             Cologler (skyoflw@gmail.com)
// @match              https://bbsactivity.hupu.com/pc-viewer/index.html*
// @match              https://offline-download.hupu.com/online/prod/*/team-schedule-v2.html*
// @match              https://offline-download.hupu.com/online/prod/310016/detail.html*
// @match              https://m.hupu.com/score/detail.html*
// @run-at             document-start
// @inject-into        page
// @sandbox            raw
// @grant              none
// @license            MIT
// ==/UserScript==

(function () {
    'use strict';

    const VIEWER_ORIGIN = 'https://bbsactivity.hupu.com';
    const CHANNEL = 'monkeys.hupu-score-columns.v1';
    // The desktop viewer gives every original mobile page a 414px viewport.
    const COLUMN_WIDTH = 414;

    /**
     * Unwraps the desktop viewer without decoding query values inside its target.
     * @param {string} value An absolute page URL or an encoded viewer target.
     * @returns {URL | null} The underlying page URL, or null for malformed input.
     */
    function unwrapUrl(value) {
        try {
            let url;
            let target = value;
            for (let count = 0; count < 4; count += 1) {
                if (/^https:\/\//.test(target)) {
                    url = new URL(target);
                    if (url.origin !== VIEWER_ORIGIN || url.pathname !== '/pc-viewer/index.html') {
                        return url;
                    }
                    target = url.searchParams.get('t');
                    if (!target) {
                        return null;
                    }
                } else {
                    target = decodeURIComponent(target);
                }
            }
        } catch {
            return null;
        }
        return null;
    }

    /**
     * Classifies only the production LoL pages used by the four-column flow.
     * @param {URL | null} url An unwrapped page URL.
     * @returns {number} The column index, or -1 for an unrelated page.
     */
    function getStage(url) {
        if (!url || url.protocol !== 'https:' || url.username || url.password) {
            return -1;
        }
        if (url.origin === 'https://offline-download.hupu.com'
            && /^\/online\/prod\/\d+\/team-schedule-v2\.html$/.test(url.pathname)
            && url.searchParams.get('businessType') === 'common'
            && url.searchParams.get('businessId') === 'lol') {
            return 0;
        }
        const isDetail = (url.origin === 'https://m.hupu.com' && url.pathname === '/score/detail.html')
            || (url.origin === 'https://offline-download.hupu.com'
                && url.pathname === '/online/prod/310016/detail.html');
        if (!isDetail || !/^\d+$/.test(url.searchParams.get('outBizNo') || '')) {
            return -1;
        }
        const index = ['lol_match', 'lol_bo', 'lol_item'].indexOf(url.searchParams.get('outBizType'));
        return index < 0 ? -1 : index + 1;
    }

    /**
     * Builds a detail URL from the card's own analytics identity.
     * @param {string} exposure The card's data-exposure JSON.
     * @param {number} stage The expected destination column.
     * @param {string} currentUrl The source page URL, including its theme settings.
     * @returns {URL | null} A detail URL, or null when the identity is unsupported.
     */
    function getCardUrl(exposure, stage, currentUrl) {
        try {
            const identity = JSON.parse(exposure).itemid;
            const match = /^score_(lol_bo|lol_item)_(\d+)$/.exec(identity);
            if (!match) {
                return null;
            }
            const url = new URL('https://m.hupu.com/score/detail.html');
            const current = new URL(currentUrl);
            for (const key of ['night', 'dark', 'biz_code']) {
                if (current.searchParams.has(key)) {
                    url.searchParams.set(key, current.searchParams.get(key));
                }
            }
            url.searchParams.set('isCheckInfo', '1');
            url.searchParams.set('env', 'prod');
            url.searchParams.set('outBizType', match[1]);
            url.searchParams.set('outBizNo', match[2]);
            return getStage(url) === stage ? url : null;
        } catch {
            return null;
        }
    }

    function onReady(callback) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback, { once: true });
        } else {
            callback();
        }
    }

    function addStyle(css) {
        const style = document.createElement('style');
        style.textContent = css;
        (document.head || document.documentElement).append(style);
    }

    function startViewer(schedule) {
        const panes = [];
        let generation = 0;

        function configure(pane) {
            if (pane.url) {
                pane.frame.contentWindow.postMessage({
                    channel: CHANNEL,
                    type: 'configure',
                    url: pane.url.href,
                    token: pane.token,
                }, pane.url.origin);
            }
        }

        function setPane(index, url) {
            const pane = panes[index];
            pane.url = url;
            pane.token = String(++generation);
            pane.frame.hidden = !url;
            pane.placeholder.hidden = Boolean(url);
            // Blank descendants immediately so comments can never belong to the previous selection.
            pane.frame.src = url ? url.href : 'about:blank';
        }

        window.addEventListener('message', function (event) {
            const data = event.data;
            if (!data || data.channel !== CHANNEL) {
                return;
            }
            const index = panes.findIndex(function (pane) {
                return pane.url && pane.frame.contentWindow === event.source && pane.url.origin === event.origin;
            });
            if (index < 0) {
                return;
            }
            const pane = panes[index];
            if (data.type === 'ready' && data.url === pane.url.href) {
                configure(pane);
            } else if (data.type === 'navigate' && data.token === pane.token && index < 3) {
                const target = unwrapUrl(data.url);
                if (getStage(target) !== index + 1) {
                    return;
                }
                for (let next = index + 2; next < panes.length; next += 1) {
                    setPane(next, null);
                }
                setPane(index + 1, target);
            }
        });

        onReady(function () {
            const original = document.querySelector('#app > iframe');
            addStyle(`
                html { height: 100%; overflow-x: auto; overflow-y: hidden; }
                body { margin: 0; height: 100%; min-width: ${COLUMN_WIDTH * 4}px; }
                body > :not(#hupu-score-columns):not(script):not(style) { display: none !important; }
                #hupu-score-columns {
                    display: grid; grid-template-columns: repeat(3, ${COLUMN_WIDTH}px) minmax(${COLUMN_WIDTH}px, 1fr);
                    width: 100%; height: 100%; background: #fff; color: #333; font: 14px system-ui, sans-serif;
                }
                #hupu-score-columns section {
                    display: flex; flex-direction: column; width: auto; min-width: 0; min-height: 0;
                    margin: 0; box-shadow: -1px 0 #ddd;
                }
                #hupu-score-columns h2 { margin: 0; padding: 10px 16px; font-size: 14px; border-bottom: 1px solid #ddd; }
                #hupu-score-columns iframe { display: block; width: 100%; flex: 1; min-height: 0; border: 0; }
                #hupu-score-columns p { padding: 16px; color: #777; }
                #hupu-score-columns [hidden] { display: none !important; }
            `);
            const layout = document.createElement('main');
            layout.id = 'hupu-score-columns';
            const labels = ['Matches', 'Games', 'Players', 'Comments'];
            const prompts = ['', 'Select a finished match.', 'Select a game.', 'Select a player.'];
            for (let index = 0; index < labels.length; index += 1) {
                const section = document.createElement('section');
                const heading = document.createElement('h2');
                heading.textContent = labels[index];
                const placeholder = document.createElement('p');
                placeholder.textContent = prompts[index];
                const frame = index === 0 && original ? original : document.createElement('iframe');
                frame.title = `Hupu ${labels[index]}`;
                frame.hidden = true;
                const pane = { frame, placeholder, url: null, token: '' };
                frame.addEventListener('load', function () { configure(pane); });
                panes.push(pane);
                section.append(heading, placeholder, frame);
                layout.append(section);
            }
            document.body.append(layout);
            setPane(0, schedule);
        });
    }

    function startFrame(stage) {
        let token;
        let installed = false;
        let lastMatch;
        let selected;

        function select(card) {
            if (selected) {
                selected.removeAttribute('data-hupu-columns-selected');
            }
            selected = card;
            if (card) {
                card.setAttribute('data-hupu-columns-selected', '');
            }
        }

        function navigate(url) {
            window.parent.postMessage({ channel: CHANNEL, type: 'navigate', token, url: url.href }, VIEWER_ORIGIN);
        }

        window.addEventListener('message', function (event) {
            const data = event.data;
            if (event.source !== window.parent || event.origin !== VIEWER_ORIGIN
                || !data || data.channel !== CHANNEL || data.type !== 'configure'
                || data.url !== location.href || typeof data.token !== 'string') {
                return;
            }
            token = data.token;
            if (installed) {
                return;
            }
            installed = true;
            onReady(function () {
                addStyle('[data-hupu-columns-selected] { outline: 2px solid #c41e3a; outline-offset: -2px; }');
            });

            if (stage === 0) {
                const open = window.open;
                window.open = function (value) {
                    const url = unwrapUrl(String(value));
                    if (getStage(url) === 1) {
                        navigate(url);
                        select(lastMatch);
                        return null;
                    }
                    return open.apply(this, arguments);
                };
            }

            document.addEventListener('click', function (event) {
                if (!(event.target instanceof Element)) {
                    return;
                }
                if (stage === 0) {
                    lastMatch = event.target.closest('[data-match-id]');
                    if (lastMatch && Array.from(lastMatch.classList).some(function (name) {
                        return name.startsWith('match-not-started-');
                    })) {
                        // These cards have no score target; the native App CTA navigates this iframe away.
                        event.preventDefault();
                        event.stopImmediatePropagation();
                    }
                    return;
                }
                if (stage === 3 || event.button !== 0
                    || event.target.closest('a, button, input, textarea, select, [contenteditable="true"], .fufu-rate')) {
                    return;
                }
                const card = event.target.closest('.score-group[data-exposure]');
                if (!card) {
                    return;
                }
                const url = getCardUrl(card.getAttribute('data-exposure'), stage + 1, location.href);
                if (url) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    select(card);
                    navigate(url);
                }
            }, true);
        });
        window.parent.postMessage({ channel: CHANNEL, type: 'ready', url: location.href }, VIEWER_ORIGIN);
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { unwrapUrl, getStage, getCardUrl };
    }
    if (typeof window === 'undefined') {
        return;
    }
    const url = unwrapUrl(location.href);
    const stage = getStage(url);
    if (window === window.top) {
        if (location.origin === VIEWER_ORIGIN && location.pathname === '/pc-viewer/index.html' && stage === 0) {
            startViewer(url);
        }
    } else if (stage >= 0 && location.origin !== VIEWER_ORIGIN) {
        // Standalone detail pages keep native behavior; only an owning viewer can configure a frame.
        startFrame(stage);
    }
})();
