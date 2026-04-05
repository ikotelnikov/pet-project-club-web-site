# Content Schemas

This document defines the canonical JSON contracts for bot-managed content.

The goal is to keep all editable entities aligned around the same pattern:

- section metadata in `content/<entity>/page.json`
- item order in `content/<entity>/index.json`
- one item per file in `content/<entity>/items/<slug>.json`

These schemas are the source of truth for future Telegram bot parsing and validation.

## Shared Rules

### Slug

Every bot-managed item must have a unique `slug`.

Rules:

- lowercase Latin letters, numbers, and hyphens only
- no spaces
- no underscores
- stable after creation unless there is a deliberate migration
- filename must match slug exactly: `<slug>.json`

Examples:

- `announce-2026-04-product-review`
- `meeting-2026-03-open-circle`
- `participant-ivan-kotelnikov`
- `project-club-site-bot`

### Asset Paths

If an item references local media, the path must be repo-relative.

Preferred locations:

- meetings and announcements: `assets/meetings/`
- participants: `assets/participants/`
- projects: `assets/projects/`

The bot should write normalized filenames derived from the slug.

Examples:

- `assets/meetings/meeting-2026-03-open-circle-01.jpg`
- `assets/participants/participant-ivan-kotelnikov-01.jpg`
- `assets/projects/project-club-site-bot-01.jpg`

### Text Fields

- store plain text, not HTML
- preserve paragraph boundaries as arrays where the schema expects arrays
- keep list items as arrays of strings

### Localized Content Extension

Bot-managed items may additionally contain translation metadata without breaking the current flat source-locale shape.

Incremental localized item shape:

```json
{
  "slug": "meeting-2026-03-open-circle",
  "sourceLocale": "ru",
  "title": "Открытый круг проектов и знакомство с новыми участниками",
  "paragraphs": [
    "Русский исходный текст."
  ],
  "translations": {
    "en": {
      "title": "Open project circle and introductions for new members",
      "paragraphs": [
        "English translated text."
      ]
    }
  },
  "translationStatus": {
    "en": "machine",
    "de": "stale",
    "me": "edited",
    "es": "missing"
  }
}
```

Rules:

- source text remains in the existing flat fields for backward compatibility
- translated locale variants live in `translations.<locale>`
- translated objects may include only localizable fields, not the whole item
- frontend should overlay `translations.<locale>` onto the flat source item at read time
- manual edits should set `translationStatus.<locale>` to `edited`
- if source text changes, non-manual translations may become `stale`

Supported locale keys:

- `ru`
- `en`
- `de`
- `me`
- `es`

### Links

When present, links use this shape:

```json
{
  "label": "Open Telegram",
  "href": "https://t.me/PetProjectClubMNE",
  "external": true
}
```

Fields:

- `label`: required
- `href`: required
- `external`: optional, boolean

### Photo

Single-photo fields use this shape:

```json
{
  "src": "assets/meetings/example.jpg",
  "alt": "Descriptive alt text"
}
```

Fields:

- `src`: required
- `alt`: required

### Gallery

If an entity later supports multiple photos, use:

```json
[
  {
    "src": "assets/projects/example-01.jpg",
    "alt": "Main project screenshot",
    "caption": "Optional visible caption"
  }
]
```

Fields:

- `src`: required
- `alt`: required
- `caption`: optional

This is reserved for later bot support. Current frontend rendering only uses `photo`.

## Announcement Schema

Path:

- `content/meetings/items/<slug>.json`
- slug must also appear in `content/meetings/announcements/index.json`

Required fields:

- `slug`
- `type`
- `date`
- `title`
- `place`
- `format`
- `paragraphs`

Optional fields:

- `placeUrl`
- `photo`
- `sections`
- `links`

Rules:

- `type` must be `"announce"`
- `paragraphs` must be a non-empty array of strings
- `sections`, if present, must be an array of titled bullet groups
- `links` may contain multiple public URLs such as registration, Telegram chat, related materials, project pages, or organizer contacts

Canonical example:

```json
{
  "slug": "announce-2026-04-product-review",
  "type": "announce",
  "date": "3 April 2026, 19:00",
  "title": "Open review evening for new and launched pet projects",
  "place": "MONTECO Coworking, Budva",
  "placeUrl": "https://maps.google.com/?q=Monteco+Coworking+Budva",
  "format": "offline / project review",
  "photo": {
    "src": "assets/meetings/announce-2026-04-product-review-01.jpg",
    "alt": "Participants during a project review session"
  },
  "paragraphs": [
    "Lead paragraph.",
    "Supporting paragraph."
  ],
  "sections": [
    {
      "title": "What will happen",
      "items": [
        "Short demos",
        "Feedback",
        "Clear next steps"
      ]
    }
  ],
  "links": [
    {
      "label": "Write in Telegram",
      "href": "https://t.me/PetProjectClubMNE",
      "external": true
    }
  ]
}
```

## Meeting Schema

Path:

- `content/meetings/items/<slug>.json`
- slug must also appear in `content/meetings/archive/index.json`

Required fields:

- `slug`
- `type`
- `date`
- `title`
- `place`
- `format`
- `paragraphs`

Optional fields:

- `placeUrl`
- `photo`
- `sections`
- `links`

Rules:

- `type` must be `"meeting"`
- structure is intentionally the same as announcements
- current site detail pages already support all optional fields above
- `links` may contain multiple public URLs such as registration, Telegram chat, related materials, project pages, or organizer contacts

Canonical example:

```json
{
  "slug": "meeting-2026-03-open-circle",
  "type": "meeting",
  "date": "19 March 2026",
  "title": "Open project circle and introductions",
  "place": "Budva",
  "format": "offline / introductions",
  "photo": {
    "src": "assets/meetings/meeting-2026-03-open-circle-01.jpg",
    "alt": "Participants during the March meeting"
  },
  "paragraphs": [
    "Meeting summary paragraph one.",
    "Meeting summary paragraph two."
  ],
  "sections": [
    {
      "title": "What we discussed",
      "items": [
        "New projects",
        "Community asks",
        "Next meeting ideas"
      ]
    }
  ]
}
```

## Participant Schema

Path:

- `content/participants/items/<slug>.json`
- slug must also appear in `content/participants/index.json`

Required fields:

- `slug`
- `handle`
- `name`
- `role`
- `bio`
- `points`

Optional fields:

- `photo`
- `links`
- `location`
- `tags`

Rules:

- `handle` should be a Telegram-style handle when available, including `@`
- `points` should contain 2 to 5 short bullets
- `photo` is part of the canonical schema even though the current frontend does not render it yet
- `links` may contain multiple public contact tags such as Telegram, LinkedIn, X/Twitter, GitHub, personal site, or other relevant URLs
- if both `handle` and a Telegram link are present, the frontend may render only one visible Telegram contact tag to avoid duplication

Canonical example:

```json
{
  "slug": "participant-ivan-kotelnikov",
  "handle": "@ikotelnikov",
  "name": "Ivan Kotelnikov",
  "role": "Founder / Product / Engineering",
  "bio": "Builds the club and works on product and engineering tasks.",
  "points": [
    "Can help shape the product direction.",
    "Can review implementation plans.",
    "Can connect people around club operations."
  ],
  "photo": {
    "src": "assets/participants/participant-ivan-kotelnikov-01.jpg",
    "alt": "Ivan Kotelnikov at a club meeting"
  },
  "links": [
    {
      "label": "Telegram",
      "href": "https://t.me/ikotelnikov",
      "external": true
    }
  ],
  "location": "Budva / Montenegro",
  "tags": [
    "product",
    "engineering",
    "community"
  ]
}
```

## Project Schema

Path:

- `content/projects/items/<slug>.json`
- slug must also appear in `content/projects/index.json`

Required fields:

- `slug`
- `title`
- `status`
- `stack`
- `points`

Optional fields:

- `summary`
- `detailsHtml`
- `photo`
- `links`
- `ownerSlugs`
- `location`
- `tags`

Rules:

- `status` should be a short current-state label, not a long description
- `summary` should stay short and work as a 1 to 3 sentence intro, not as the full body text
- `detailsHtml`, when present, is the main rich details block for the project page and may contain paragraphs, links, emphasis, and lists
- `points` should contain 2 to 5 short bullets
- `ownerSlugs`, if present, should reference participant slugs
- `photo` is part of the canonical schema even though the current frontend does not render it yet
- `links` may contain multiple public URLs related to the project, including website, repository, demo, or founder contact pages

Canonical example:

```json
{
  "slug": "project-club-site-bot",
  "title": "Club site content bot",
  "status": "prototype in progress",
  "stack": "telegram / github actions / static site",
  "summary": "Bot that syncs approved Telegram messages into website content files.",
  "detailsHtml": "<p>Longer story about how the bot works, what changed recently, and what help it needs next.</p>",
  "points": [
    "Parses Telegram commands into structured content operations.",
    "Commits JSON and assets into the repo.",
    "Publishes updates through GitHub Pages."
  ],
  "photo": {
    "src": "assets/projects/project-club-site-bot-01.jpg",
    "alt": "Preview of the club bot flow"
  },
  "links": [
    {
      "label": "Repository",
      "href": "https://github.com/example/project",
      "external": true
    }
  ],
  "ownerSlugs": [
    "participant-ivan-kotelnikov"
  ],
  "location": "Budva / Montenegro",
  "tags": [
    "automation",
    "bot",
    "content"
  ]
}
```

## Index Files

Index files define display order only.

Canonical shape:

```json
{
  "items": [
    "slug-one",
    "slug-two"
  ]
}
```

Additional rules:

- slugs must be unique
- every listed slug must have a matching item file
- item files should not be considered published unless they are listed in the corresponding index

Meeting archive uses one extended form:

```json
{
  "pageSize": 10,
  "items": [
    "meeting-2026-03-open-circle"
  ]
}
```
