// ==UserScript==
// @name                GitHub: Raw and CDN Links
// @name:zh-CN          GitHub：Raw 与 CDN 链接
// @namespace           https://github.com/Cologler/monkeys-javascript
// @version             0.2.1
// @description         Open GitHub files through Raw and CDN links for commits and the latest release tag
// @description:zh-CN   提供 GitHub 文件的提交锁定版及最新 Release 标签对应的 Raw 和 CDN 链接
// @author              Cologler (skyoflw@gmail.com)
// @match               https://github.com/*
// @run-at              document-idle
// @grant               none
// @noframes
// @license             MIT
// ==/UserScript==

/**
 * @typedef GithubFileMetadata
 * @property {string} owner
 * @property {string} repo
 * @property {string} branch
 * @property {string} path
 * @property {string | null} commit The last commit affecting the displayed file.
 */
/**
 * @typedef LatestReleaseResult
 * @property {string | null} tag The latest published release tag, if available.
 * @property {string | null} error A lookup failure, distinct from a missing release.
 */
(function() {
    'use strict';

    const MENU_ID = 'monkeys-github-raw-options';
    const RELEASE_CACHE_TTL = 15 * 60 * 1000;
    let current = null;
    let scheduled = false;

    /**
     * Resolves slash-containing refs from GitHub's repository breadcrumb.
     * @param {string} pageHref The displayed file URL.
     * @param {string} refHref The repository breadcrumb URL.
     * @param {string} rawHref The native Raw button URL.
     * @param {string | null} commitHref The displayed file's last-change commit URL.
     * @returns {GithubFileMetadata | null} Metadata, or null while navigation is incomplete.
     */
    function parseFileMetadata(pageHref, refHref, rawHref, commitHref) {
        try {
            const page = new URL(pageHref);
            const ref = new URL(refHref, page);
            const raw = new URL(rawHref, page);
            const pathname = decodeURIComponent(page.pathname);
            const match = pathname.match(/^\/([^/]+)\/([^/]+)\/blob\//);
            if (page.origin !== 'https://github.com' || !match || ref.origin !== page.origin) {
                return null;
            }
            const [, owner, repo] = match;
            const repository = `/${owner}/${repo}`;
            const refPrefix = `${repository}/tree/`;
            const refPath = decodeURIComponent(ref.pathname);
            if (!refPath.startsWith(refPrefix)) {
                return null;
            }
            const branch = refPath.slice(refPrefix.length);
            const filePrefix = `${repository}/blob/${branch}/`;
            if (!branch || !pathname.startsWith(filePrefix)) {
                return null;
            }
            const path = pathname.slice(filePrefix.length);
            const rawPath = decodeURIComponent(raw.pathname);
            if (!path || raw.origin !== page.origin || ![
                `${repository}/raw/${branch}/${path}`,
                `${repository}/raw/refs/heads/${branch}/${path}`,
                `${repository}/raw/refs/tags/${branch}/${path}`,
            ].includes(rawPath)) {
                return null;
            }
            let commit = null;
            // The live last-change link follows SPA navigation; embedded JSON can retain the initial file.
            if (commitHref) {
                const commitUrl = new URL(commitHref, page);
                const commitPrefix = `${repository}/commit/`;
                const commitPath = decodeURIComponent(commitUrl.pathname);
                if (commitUrl.origin === page.origin && commitPath.startsWith(commitPrefix)) {
                    const oid = commitPath.slice(commitPrefix.length);
                    if (/^[a-f0-9]{40}$/i.test(oid)) {
                        commit = oid;
                    }
                }
            }
            return { owner, repo, branch, path, commit };
        } catch {
            return null;
        }
    }

    /**
     * Builds direct links without losing encoded filenames or slash-containing refs.
     * @param {GithubFileMetadata} metadata
     * @returns {{label: string, url: string}[]} Available Raw and CDN links.
     */
    function getFileLinks(metadata) {
        const repository = `${encodeURIComponent(metadata.owner)}/${encodeURIComponent(metadata.repo)}`;
        const path = metadata.path.split('/').map(encodeURIComponent).join('/');
        const branch = encodeURIComponent(metadata.branch);
        const links = [];
        if (metadata.commit) {
            links.push({
                label: 'Raw · pinned',
                url: `https://github.com/${repository}/raw/${metadata.commit}/${path}`,
            });
        }
        links.push({
            label: 'jsDelivr · current ref',
            url: `https://cdn.jsdelivr.net/gh/${repository}@${branch}/${path}`,
        });
        if (metadata.commit) {
            links.push({
                label: 'jsDelivr · pinned',
                url: `https://cdn.jsdelivr.net/gh/${repository}@${metadata.commit}/${path}`,
            });
        }
        links.push({
            label: 'raw.githack · current ref',
            url: `https://raw.githack.com/${repository}/${branch}/${path}`,
        });
        if (metadata.commit) {
            links.push({
                label: 'raw.githack · pinned',
                url: `https://rawcdn.githack.com/${repository}/${metadata.commit}/${path}`,
            });
        }
        return links;
    }

    /**
     * Uses the release's actual tag rather than a moving latest-version alias.
     * @param {GithubFileMetadata} metadata The displayed file.
     * @param {string} tag The release tag returned by GitHub.
     * @returns {{label: string, url: string}[]} Tag-specific Raw and CDN links.
     */
    function getReleaseLinks(metadata, tag) {
        const repository = `${encodeURIComponent(metadata.owner)}/${encodeURIComponent(metadata.repo)}`;
        const path = metadata.path.split('/').map(encodeURIComponent).join('/');
        const ref = encodeURIComponent(tag);
        return [
            { label: 'Raw · latest release', url: `https://github.com/${repository}/raw/refs/tags/${ref}/${path}` },
            { label: 'jsDelivr · latest release', url: `https://cdn.jsdelivr.net/gh/${repository}@${ref}/${path}` },
            { label: 'raw.githack · latest release', url: `https://rawcdn.githack.com/${repository}/${ref}/${path}` },
        ];
    }

    /**
     * Caches repository lookups in memory across file navigation in the same page.
     * @param {typeof fetch} fetcher The HTTP client.
     * @param {function(): number} [now=Date.now] The cache clock in milliseconds.
     * @returns {function(string, string): Promise<LatestReleaseResult>} A deduplicated release lookup.
     */
    function createReleaseLookup(fetcher, now = Date.now) {
        const cache = new Map();
        const pending = new Map();
        return function(owner, repo) {
            const key = `${MENU_ID}:release:${owner.toLowerCase()}/${repo.toLowerCase()}`;
            if (pending.has(key)) {
                return pending.get(key);
            }
            const cached = cache.get(key);
            if (cached && cached.expires > now()) {
                return Promise.resolve({ tag: cached.tag, error: cached.error });
            }

            async function load() {
                let result;
                let ttl = 60 * 1000;
                try {
                    const response = await fetcher(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`, {
                        headers: { Accept: 'application/vnd.github+json' },
                        credentials: 'omit',
                        signal: AbortSignal.timeout(10000),
                    });
                    if (response.status === 403 || response.status === 429) {
                        // Respect GitHub's backoff so reopening the menu cannot exhaust the API quota.
                        const retryAfter = Number(response.headers.get('retry-after')) * 1000;
                        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - now();
                        if (Number.isFinite(retryAfter)) {
                            ttl = Math.max(ttl, retryAfter);
                        }
                        if (response.headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(reset)) {
                            ttl = Math.max(ttl, reset);
                        }
                    }
                    if (response.status === 404) {
                        result = { tag: null, error: null };
                    } else {
                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}`);
                        }
                        const release = await response.json();
                        if (typeof release?.tag_name !== 'string' || !release.tag_name.trim()
                            || release.draft || release.prerelease) {
                            throw new Error('Invalid release response');
                        }
                        result = { tag: release.tag_name, error: null };
                    }
                    ttl = RELEASE_CACHE_TTL;
                } catch (error) {
                    result = { tag: null, error: `Latest release lookup failed: ${error.message}` };
                }
                const entry = { ...result, expires: now() + ttl };
                cache.set(key, entry);
                return result;
            }

            const request = load().finally(function() { pending.delete(key); });
            pending.set(key, request);
            return request;
        };
    }

    function appendLinks(container, entries) {
        for (const entry of entries) {
            const link = document.createElement('a');
            link.href = entry.url;
            link.textContent = entry.label;
            link.title = entry.url;
            link.setAttribute('role', 'menuitem');
            link.tabIndex = -1;
            container.append(link);
        }
    }

    async function updateReleaseLinks(metadata, menu, section) {
        const note = document.createElement('small');
        note.setAttribute('role', 'status');
        note.textContent = 'Loading latest release…';
        section.replaceChildren(note);
        positionMenu();
        const result = await lookupRelease(metadata.owner, metadata.repo);
        // A request belongs to its repository; it must not populate a menu mounted after navigation.
        if (!menu.isConnected || section.firstElementChild !== note) {
            return;
        }
        if (result.error) {
            note.textContent = result.error;
        } else if (!result.tag) {
            note.textContent = 'No public latest release found.';
        } else {
            note.textContent = `Latest release: ${result.tag}`;
            appendLinks(section, getReleaseLinks(metadata, result.tag));
        }
        positionMenu();
    }

    function removeMenu() {
        if (current) {
            current.wrapper.remove();
            current.menu.remove();
            current = null;
        }
    }

    function positionMenu() {
        if (!current || !current.menu.matches(':popover-open')) {
            return;
        }
        const rect = current.button.getBoundingClientRect();
        const menu = current.menu;
        const left = Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8));
        const top = rect.bottom + menu.offsetHeight + 4 <= window.innerHeight
            ? rect.bottom + 4 : Math.max(8, rect.top - menu.offsetHeight - 4);
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
    }

    function mount() {
        const raw = document.querySelector('a[data-testid="raw-button"]');
        const ref = document.querySelector('a[data-testid="breadcrumbs-repo-link"]');
        const commit = document.querySelector('[data-testid="latest-commit"] a[data-hovercard-type="commit"]');
        const metadata = raw && ref && parseFileMetadata(location.href, ref.href, raw.href, commit?.href);
        if (!metadata) {
            removeMenu();
            return;
        }
        const key = JSON.stringify(metadata);
        if (current && current.raw === raw && current.wrapper.isConnected && current.key === key) {
            return;
        }
        removeMenu();

        const wrapper = document.createElement('div');
        wrapper.id = MENU_ID;
        wrapper.className = raw.parentElement.className;
        const button = document.createElement('button');
        const nativeButton = raw.closest('[data-component="ButtonGroup"]')?.querySelector('button');
        button.className = nativeButton?.className || raw.className;
        button.type = 'button';
        button.setAttribute('data-component', 'IconButton');
        button.setAttribute('data-size', 'small');
        button.setAttribute('data-variant', 'default');
        button.setAttribute('data-no-visuals', 'true');
        button.setAttribute('aria-label', 'More Raw and CDN options');
        button.setAttribute('aria-haspopup', 'menu');
        button.setAttribute('aria-expanded', 'false');
        button.title = 'More Raw and CDN options';
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 16 16');
        icon.setAttribute('width', '16');
        icon.setAttribute('height', '16');
        icon.setAttribute('fill', 'currentColor');
        icon.setAttribute('aria-hidden', 'true');
        const triangle = document.createElementNS(icon.namespaceURI, 'path');
        triangle.setAttribute('d', 'M4 6h8l-4 4z');
        icon.append(triangle);
        button.append(icon);
        wrapper.append(button);

        const menu = document.createElement('div');
        menu.id = `${MENU_ID}-menu`;
        menu.setAttribute('popover', 'auto');
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'Raw and CDN links');
        button.setAttribute('popovertarget', menu.id);
        button.setAttribute('aria-controls', menu.id);
        appendLinks(menu, getFileLinks(metadata));
        if (!metadata.commit) {
            const note = document.createElement('small');
            note.textContent = 'Pinned links unavailable until the file commit loads.';
            menu.append(note);
        }
        const releaseSection = document.createElement('div');
        releaseSection.className = 'release-links';
        menu.append(releaseSection);
        menu.addEventListener('toggle', function(event) {
            button.setAttribute('aria-expanded', String(event.newState === 'open'));
            if (event.newState === 'open') {
                positionMenu();
                menu.querySelector('a').focus();
                updateReleaseLinks(metadata, menu, releaseSection);
            }
        });
        menu.addEventListener('keydown', function(event) {
            const links = Array.from(menu.querySelectorAll('a'));
            const index = links.indexOf(document.activeElement);
            let next;
            if (event.key === 'ArrowDown') {
                next = (index + 1) % links.length;
            } else if (event.key === 'ArrowUp') {
                next = (index - 1 + links.length) % links.length;
            } else if (event.key === 'Home') {
                next = 0;
            } else if (event.key === 'End') {
                next = links.length - 1;
            } else if (event.key === 'Escape' || event.key === 'Tab') {
                if (event.key === 'Escape') {
                    event.preventDefault();
                }
                menu.hidePopover();
                button.focus();
            }
            if (next !== undefined) {
                event.preventDefault();
                links[next].focus();
            }
        });
        button.addEventListener('keydown', function(event) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                menu.showPopover();
            }
        });
        raw.parentElement.after(wrapper);
        document.body.append(menu);
        current = { raw, key, wrapper, button, menu };
    }

    function scheduleMount() {
        if (!scheduled) {
            scheduled = true;
            requestAnimationFrame(function() {
                scheduled = false;
                mount();
            });
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { parseFileMetadata, getFileLinks, getReleaseLinks, createReleaseLookup };
        return;
    }

    const lookupRelease = createReleaseLookup(window.fetch.bind(window));
    const style = document.createElement('style');
    style.textContent = `
        #${MENU_ID} button { width: 28px; padding: 0; }
        #${MENU_ID}-menu { position: fixed; inset: auto; margin: 0; padding: 6px;
            width: 248px; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow: auto;
            background: var(--overlay-bgColor, #fff); color: var(--fgColor-default, #1f2328);
            border: 1px solid var(--borderColor-default, #d1d9e0); border-radius: 8px;
            box-shadow: var(--shadow-floating-small, 0 8px 24px #0003); font-size: 14px; }
        #${MENU_ID}-menu a { display: block; padding: 7px 10px; border-radius: 4px;
            color: inherit; text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        #${MENU_ID}-menu a:hover, #${MENU_ID}-menu a:focus-visible {
            background: var(--control-transparent-bgColor-hover, #818b981a); }
        #${MENU_ID}-menu small { display: block; padding: 7px 10px; color: var(--fgColor-muted, #59636e);
            overflow-wrap: anywhere; }
        #${MENU_ID}-menu .release-links { margin-top: 6px; padding-top: 6px;
            border-top: 1px solid var(--borderColor-default, #d1d9e0); }
    `;
    document.head.append(style);
    new MutationObserver(scheduleMount).observe(document.body, { childList: true, subtree: true, attributes: true,
        attributeFilter: ['href'] });
    window.addEventListener('popstate', scheduleMount);
    document.addEventListener('turbo:load', scheduleMount);
    window.addEventListener('resize', positionMenu);
    document.addEventListener('scroll', positionMenu, true);
    mount();
})();
