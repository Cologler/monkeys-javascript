# AGENTS.md

- Never edit files under `dist/` directly.
- Add JSDoc to public APIs, including parameter and return types.
- Use function declarations for named functions (for example, `function foo() {}`), rather than variable-bound arrow functions such as `const foo = () => {}`. Prefer arrow functions for callbacks passed as arguments.
- Before an agent creates a commit, automatically bump the version of each userscript included in that commit.

## Userscript metadata localization

1. Every userscript must include English `@name` and `@description` defaults plus meaningful Simplified Chinese translations in `@name:zh-CN` and `@description:zh-CN`. Both Violentmonkey and Tampermonkey support these localized fields; use `zh-CN` consistently in this repository.
2. Keep the English defaults and Chinese translations in sync when editing metadata. Preserve the default `@name` and `@namespace` when adding translations, because they identify the installed script.
3. When a script uses `@antifeature`, retain an English default declaration for each type and add a corresponding `@antifeature:zh-CN` declaration with a Simplified Chinese explanation. Translate only the explanation, keeping type identifiers such as `ads`, `tracking`, and `miner` unchanged. Tampermonkey supports these localized explanations; Violentmonkey's current installer reads the default `@antifeature` declarations, so retain them for compatibility.
4. Do not assume other metadata fields support localization merely because a parser accepts a `:locale` suffix. Require explicit support from the target manager before adding other localized metadata keys.

References: [Violentmonkey metadata](https://violentmonkey.github.io/api/metadata-block/), [Violentmonkey installer](https://github.com/violentmonkey/violentmonkey/blob/master/src/confirm/views/app.vue), [Tampermonkey name](https://www.tampermonkey.net/documentation.php?locale=en&q=name), [Tampermonkey description](https://www.tampermonkey.net/documentation.php?locale=en&q=description), [Tampermonkey antifeature](https://www.tampermonkey.net/documentation.php?locale=en&q=antifeature).
