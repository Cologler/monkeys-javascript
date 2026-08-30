// ==UserScript==
// @name               Amazon: Manage Content Docs API
// @name:zh-CN         Amazon: 内容管理 Docs API
// @namespace          https://github.com/Cologler/monkeys-javascript
// @version            0.1.0
// @description        Expose console APIs for selecting documents on Amazon's Manage Your Content page
// @description:zh-CN  在 Amazon 内容管理页面提供用于选择文档的控制台 API
// @author             Cologler (skyoflw@gmail.com)
// @match              https://www.amazon.com/hz/mycd/digital-console/contentlist/allcontent/dateDsc*
// @match              https://www.amazon.com/hz/mycd/digital-console/contentlist/pdocs/dateDsc*
// @grant              none
// @noframes
// @license            MIT
// ==/UserScript==

(function() {
    'use strict';

    /** A document shown on the current Amazon content page. */
    class Doc {
        #checkbox;
        #checkmark;

        /**
         * @param {HTMLInputElement} checkbox The document's selection input.
         */
        constructor(checkbox) {
            this.#checkbox = checkbox;
            this.#checkmark = document.getElementById(`${checkbox.id}_checkmark`);
            /** @type {string} */
            this.title = checkbox.closest('tr').querySelector('.digital_entity_title_no_link').textContent.trim();
        }

        /** Selects the document. */
        select() {
            if (!this.isSelected()) {
                this.#checkmark.click();
            }
        }

        /** Unselects the document. */
        unselect() {
            if (this.isSelected()) {
                this.#checkmark.click();
            }
        }

        /**
         * @returns {boolean} Whether the document is selected.
         */
        isSelected() {
            return this.#checkbox.checked;
        }
    }

    /**
     * Gets documents from the current page, optionally filtering by title.
     * @param {string} [title] Text that the document title must contain.
     * @returns {Doc[]} The matching documents.
     */
    window.getDocs = title => Array.from(
        document.querySelectorAll('input[id$=":KindlePDoc"]'),
        checkbox => new Doc(checkbox),
    ).filter(doc => title === undefined || doc.title.includes(title));

    window.devtoolsFormatters = [
        ...(window.devtoolsFormatters || []),
        {
            header(value, config) {
                return value instanceof Doc && !config?.raw
                    ? ['span', {}, `${value.title} select: ${value.isSelected()}`]
                    : null;
            },
            hasBody() {
                return true;
            },
            body(value) {
                return ['object', { object: value, config: { raw: true } }];
            },
        },
    ];
})();
