# I18N Architecture

## Goal

Add proper multilingual support without turning the current static JSON-driven site into a fragile set of manual page copies.

The current repo already has two strong building blocks:

- page shells are mostly static
- page content and entity data already live in JSON and are rendered by `script.js`

That makes i18n feasible if we separate three concerns clearly:

1. locale routing and switching
2. shared UI vocabulary
3. localized content storage and bot-driven translation

## 1. Locale Routing And Switching

### Recommended URL shape

Use locale-prefixed routes:

- `/ru/`
- `/en/`
- `/de/`
- `/es/`
- `/me/`

For nested pages:

- `/ru/meetings/`
- `/en/projects/`
- `/de/participants/item/?slug=...`

### Important note about `me`

`me` is fine as a URL segment if that is the product decision, but it is not a proper language tag by itself.

Use two values:

- URL alias: `me`
- HTML/locale tag: `sr-Latn-ME` or `cnr-Latn-ME`

Recommendation for the first implementation:

- keep `/me/` in the URL because it is short and user-friendly
- store a proper locale tag in config for `<html lang>` and browser matching

### Locale config

Create a single config source, for example `content/i18n/config.json`:

```json
{
  "defaultLocale": "ru",
  "locales": {
    "ru": { "label": "Русский", "lang": "ru-RU", "flag": "RU" },
    "en": { "label": "English", "lang": "en", "flag": "EN" },
    "de": { "label": "Deutsch", "lang": "de", "flag": "DE" },
    "es": { "label": "Español", "lang": "es", "flag": "ES" },
    "me": { "label": "Crnogorski", "lang": "sr-Latn-ME", "flag": "ME" }
  }
}
```

### Switching logic

1. If the URL already contains a supported locale prefix, use it and do not auto-override it.
2. If the user lands on `/` without a locale:
   - read saved locale from `localStorage`
   - otherwise detect from `navigator.languages`
   - otherwise fall back to `defaultLocale`
   - redirect to the matching prefixed URL
3. When the user changes locale in the footer:
   - save it to `localStorage`
   - navigate to the same page under the new locale
   - preserve query params such as `?slug=` and `?page=`
4. Do not keep re-detecting the browser locale after the user picked a language manually.

### Browser matching

Use exact tag match first, then base-language match.

Examples:

- `de-AT` -> `de`
- `es-MX` -> `es`
- `ru-UA` -> `ru`
- `sr-Latn-ME` -> `me`

If nothing matches, use `ru`.

### Footer language switcher

Add a language switcher to the footer, not flags only.

Recommendation:

- use short language labels plus optional flag icon
- keep each option as a real link to the localized URL
- highlight the current locale

Example:

- `RU`
- `EN`
- `DE`
- `ES`
- `ME`

Flags alone are ambiguous. They can be decorative, but the visible control should be language-oriented.

### Best fit for current architecture

Do not manually maintain five copies of every HTML page.

Instead:

1. keep one source template per page
2. add a tiny build step that generates locale-prefixed HTML shells
3. inject into each generated page:
   - `data-locale`
   - correct `data-site-root`
   - correct `data-content-root`
   - localized `<html lang>`
   - localized `<title>` and meta description

This is the cleanest way to support `/en`, `/ru`, `/me`, `/de`, `/es` while keeping the current static-site model.

## 2. Shared UI Vocabulary

### What goes into the vocabulary

All strings that are not real editorial content should move into a shared i18n dictionary.

That includes:

- navigation labels
- footer labels
- loading and error messages
- search placeholders
- empty states
- pagination labels
- ARIA labels
- generic section labels used by `script.js`
- page `<title>` and meta description strings

### What should stay out of the vocabulary

Editorial page copy and entity content should not live in the shared vocabulary.

Examples:

- homepage hero text
- meeting descriptions
- participant bios
- project summaries
- news text

Those belong in localized content files, not in the UI dictionary.

### Recommended file shape

Use one file per locale:

- `content/i18n/ui/ru.json`
- `content/i18n/ui/en.json`
- `content/i18n/ui/de.json`
- `content/i18n/ui/es.json`
- `content/i18n/ui/me.json`

Recommended structure:

```json
{
  "shell": {
    "brandTitle": "Pet Project Club",
    "brandSubtitle": "Budva / Montenegro",
    "nav": {
      "main": "Main",
      "meetings": "Meetings",
      "projects": "Projects",
      "participants": "Participants",
      "news": "News"
    },
    "telegram": "Telegram",
    "updatedAt": "Updated",
    "languageSwitcherLabel": "Language"
  },
  "common": {
    "loadingContent": "Loading content from repository...",
    "loadError": "Failed to load content from content/. Check JSON files and run the site through a static server."
  },
  "projects": {
    "searchPlaceholder": "Find a project, stack, owner, or request",
    "resultsLabel": "Projects found",
    "emptyTitle": "Nothing found"
  },
  "pagination": {
    "prev": "Previous",
    "next": "Next",
    "page": "Page"
  },
  "aria": {
    "openNavigation": "Open navigation",
    "mainNavigation": "Main navigation",
    "previousPhoto": "Previous photo",
    "nextPhoto": "Next photo"
  },
  "meta": {
    "main": {
      "title": "Pet Project Club Budva",
      "description": "Community for people who build pet projects in Montenegro."
    }
  }
}
```

### Vocabulary logic in code

Add a small translation helper:

- `loadUiMessages(locale)`
- `t(key, fallback)`

Rules:

1. `script.js` should never hardcode user-facing fallback strings except as a last safety net.
2. Static HTML labels should be filled from generated localized templates or `ui.json`.
3. Page JSON can still override page-specific labels when that text is editorial rather than generic UI.

### Initial key inventory

At minimum, extract keys for:

- topbar brand/nav/telegram
- footer mark, address label, contact label, updated-at label, language switcher label
- loading state and content load error
- missing slug errors on detail pages
- projects search, result count, empty results, pagination
- news search, result count, empty results, pagination
- meetings archive empty state and pagination
- participant detail empty related-projects state
- project detail empty related-meetings state
- gallery button ARIA labels
- menu button ARIA label
- all page titles and meta descriptions currently hardcoded in HTML

That is the smallest complete vocabulary for the current site.

## 3. Localized Content Storage

### Split UI copy from editorial content

Use this rule:

- `content/i18n/ui/*.json` for shared UI
- localized page and item content for everything editorial

### Recommended storage model

For this repo, the cleanest medium-term model is:

1. keep one canonical item identity per slug
2. keep locale-neutral fields once
3. keep localized text per locale

Recommended item shape for bot-managed entities:

```json
{
  "slug": "project-club-site-bot",
  "entity": "project",
  "sourceLocale": "ru",
  "shared": {
    "photo": {
      "src": "assets/projects/project-club-site-bot-01.jpg"
    },
    "ownerSlugs": ["ikotelnikov"],
    "tags": ["bot", "community"],
    "links": [
      {
        "label": "GitHub",
        "href": "https://github.com/example/repo",
        "external": true
      }
    ]
  },
  "localized": {
    "ru": {
      "title": "Бот сайта клуба",
      "summary": "Публикует контент клуба из Telegram в репозиторий."
    },
    "en": {
      "title": "Club site bot",
      "summary": "Publishes club content from Telegram into the repository."
    }
  }
}
```

Use `shared` only for data that truly does not depend on language.

Use `localized.<locale>` for:

- titles
- subtitles
- summaries
- paragraphs
- section titles
- bullets
- alt text
- captions
- labels shown to end users

### Page-level content

For large page documents such as the homepage, do not embed all locales into one huge file.

Use locale-specific page files:

- `content/locales/ru/main/page.json`
- `content/locales/en/main/page.json`
- `content/locales/de/main/page.json`
- `content/locales/es/main/page.json`
- `content/locales/me/main/page.json`

Why this split is better:

- page-level copy is large
- only one locale is needed at runtime
- it keeps fetch size small
- editors can work on one locale at a time

### Runtime read logic

Frontend should load content by locale first:

- page shell UI from `content/i18n/ui/<locale>.json`
- page content from `content/locales/<locale>/...`
- entity items from the canonical item file and select `localized[currentLocale]`

If a translation is missing:

1. fall back to the source locale content
2. mark the item internally as missing translation
3. never render blank text if source text exists

### Why not duplicate full item trees per locale

Avoid separate independent item trees such as:

- `content/ru/projects/items/*.json`
- `content/en/projects/items/*.json`

That duplicates slug ownership, index ordering, and bot update logic. It becomes harder to keep translations aligned after updates.

## 4. Automatic Translation Through The Bot

### Source-of-truth flow

The bot should still create content in one source locale first.

Recommended flow:

1. parse the owner message into the canonical entity
2. write source-locale content
3. queue translation jobs for other supported locales
4. write localized variants into `localized.<locale>`
5. mark translation status per locale

### Translation status

Store status explicitly, for example:

```json
{
  "translationStatus": {
    "ru": "source",
    "en": "machine",
    "de": "machine",
    "es": "machine",
    "me": "missing"
  }
}
```

Suggested statuses:

- `source`
- `machine`
- `reviewed`
- `edited`
- `missing`
- `stale`

`stale` is important when the source locale changes after translations already exist.

### Translation prompt rules

Use a separate translation stage, not the current extraction prompt.

The translation prompt should:

- preserve JSON structure exactly
- translate only localizable fields
- preserve links, slugs, ids, handles, filenames, URLs
- preserve brand names unless explicitly requested
- preserve paragraph and array boundaries
- return JSON only

The extraction model and the translation model are different responsibilities and should remain separate in code.

### When to translate automatically

Translate automatically after:

- create
- update of any localizable field

Do not retranslate when only shared non-text fields changed, such as:

- photo source path
- owner slugs
- sort order

### Staleness logic

When the source text changes:

- update source locale immediately
- mark other locales as `stale`
- optionally auto-refresh them
- keep previous translations until the refresh succeeds

That avoids empty content on the site.

## 5. Manual Editing Of Localized Text

### Requirement

Users must be able to improve machine translations without fighting the bot.

### Recommended model

Each locale should be editable independently.

Example:

- source text in `localized.ru`
- machine output in `localized.en`
- manual corrections overwrite `localized.en`
- status becomes `edited` or `reviewed`

### Edit policy

When a human edits a localized variant:

- do not overwrite it blindly on the next automatic translation pass
- either:
  - skip auto-overwrite for manually edited locales
  - or write machine output into a draft field and require approval

Recommendation:

- keep `localized.<locale>` as the published version
- keep optional `machineSuggestions.<locale>` for fresh machine output when a human-owned translation already exists

### User-facing editing paths

Support two edit paths:

1. direct Git-based JSON editing for maintainers
2. bot command for locale-specific edits later

Future bot command examples:

- `update project project-club-site-bot locale en summary: ...`
- `update participant ikotelnikov locale de bio: ...`

That keeps translation editing aligned with the current bot-managed workflow.

## 6. Rollout Plan

### Phase 1

- add locale config
- add locale-prefixed route generation
- add browser locale detection and footer switcher
- move all hardcoded UI strings into `content/i18n/ui/*.json`

### Phase 2

- move page-level editorial content into `content/locales/<locale>/...`
- update frontend loaders to read by locale
- localize HTML metadata and `<html lang>`

### Phase 3

- extend item schemas with `sourceLocale`, `shared`, `localized`, `translationStatus`
- update frontend item rendering to pick `localized[currentLocale]`
- preserve fallback to source locale

### Phase 4

- add translation service in the bot pipeline
- mark stale translations on source edits
- support manual locale-specific edits

## Final Recommendation

For this repo, the best architecture is:

- locale-prefixed URLs with a root redirect
- a small generated HTML layer instead of manual page duplication
- one shared UI vocabulary file per locale
- locale-specific page content files
- one canonical entity per slug with embedded localized variants and explicit translation status

That fits the current static frontend, keeps the bot as the source of truth, and leaves room for human review instead of treating machine translation as final.
