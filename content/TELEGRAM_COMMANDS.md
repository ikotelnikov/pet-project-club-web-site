# Telegram Command Grammar

This document defines the exact Telegram message format the bot will accept.

The bot should be strict. It should not guess intent from free text when a command is malformed.

The command grammar is designed around these goals:

- predictable parsing
- safe create/update/delete operations
- easy use from Telegram on mobile and desktop
- compatibility with the schemas in `content/SCHEMAS.md`

## General Format

Every command starts with a header line:

```text
/<entity> <action>
```

Supported entities:

- `announce`
- `meeting`
- `participant`
- `project`

Supported actions:

- `create`
- `update`
- `delete`

Examples:

```text
/announce create
/meeting update
/participant delete
/project create
```

## Parsing Rules

### Field Lines

Structured fields are written as:

```text
fieldName: value
```

Rules:

- field names are lowercase
- the first `:` separates key and value
- spaces around the value are allowed and should be trimmed
- unknown fields should cause validation failure

### Block Fields

Multiline text blocks use a field line followed by indented or plain continuation lines until the next recognized field:

```text
bio:
First line of text.
Second line of text.
```

The bot should join these lines with newline separators first, then transform them into the schema shape it needs.

### List Fields

List items use repeated bullet lines after a field header:

```text
points:
- First item
- Second item
- Third item
```

Rules:

- each list item must start with `- `
- empty bullets are invalid

### Section Fields

Meetings and announcements support repeated titled sections:

```text
section: What will happen
- Short demos
- Feedback
- Next steps

section: Who should come
- Founders
- Designers
- Builders
```

Rules:

- each `section:` starts a new section object
- bullet lines after it belong to that section until the next field or next `section:`
- each section must contain at least one bullet

### Link Fields

Links are declared one per line:

```text
link: Write in Telegram | https://t.me/PetProjectClubMNE
```

Rules:

- separator is ` | `
- left side becomes `label`
- right side becomes `href`
- `external` is inferred as `true` for `http://` or `https://` links

### Tags Field

Tags are a comma-separated single line:

```text
tags: automation, bot, content
```

Rules:

- trim whitespace around tags
- discard empty items

## Required Bot Behavior

- reject commands from unauthorized Telegram users
- reject malformed commands with a clear error
- reject `create` if the slug already exists
- reject `update` if the slug does not exist
- reject `delete` if the slug does not exist
- do not infer missing required fields
- ignore unsupported Telegram messages that contain no command

## Entity Commands

## Announcement Commands

### `/announce create`

Required fields:

- `slug`
- `date`
- `title`
- `place`
- `format`
- `paragraphs`

Optional fields:

- `placeurl`
- `photoalt`
- `section`
- `link`
- `projectslugs`
- `type`

Canonical example:

```text
/announce create
slug: announce-2026-04-product-review
date: 2026-04-03 19:00
title: Open review evening for new and launched pet projects
place: MONTECO Coworking, Budva
placeurl: https://maps.google.com/?q=Monteco+Coworking+Budva
format: offline / project review
paragraphs:
- Bring a fresh idea or an already launched project.
- The focus is on clear feedback and the next practical step.
- You can write in Telegram in advance if you want a speaking slot.
section: What will happen
- Short project demos
- Focused feedback
- Clear next actions
section: Who should come
- Founders
- Makers
- People looking for feedback
link: Write in Telegram | https://t.me/PetProjectClubMNE
photoalt: Participants during a project review session
```

Project news or project updates should also be published through `/announce create`.

Rules:

- use `format: news`
- use `projectslugs: slug-one, slug-two` when the post belongs to one or more projects
- keep `type: announce` or omit `type` unless the item should move into the meetings archive

Project news example:

```text
/announce create
slug: doveritelnoe-upravlenie-airbnb-update
title: Airbnb still wins for a careful launch
place: Доверительное управление в Черногории
format: news
projectslugs: doveritelnoe-upravlenie-v-chernogorii
paragraphs:
- Short project update with one key lesson from current operating work.
link: Project Telegram | https://t.me/airbnbtop
```

### `/announce update`

Same format as create.

Rules:

- must include `slug`
- may send all fields again for simplicity
- first implementation should prefer full replacement of item content over partial patching
- set `type: meeting` to move an existing announcement into the meetings archive
- set `type: announce` to move an existing meeting article back into announcements or project news

Canonical example:

```text
/announce update
slug: announce-2026-04-product-review
date: 2026-04-03 19:30
title: Open review evening for new and launched pet projects
place: MONTECO Coworking, Budva
placeurl: https://maps.google.com/?q=Monteco+Coworking+Budva
format: offline / project review
paragraphs:
- Updated time and refined agenda.
- We will keep demos short and feedback concrete.
section: What will happen
- Short demos
- Product review
- Next steps
link: Write in Telegram | https://t.me/PetProjectClubMNE
photoalt: Updated review evening cover photo
```

### `/announce delete`

Required fields:

- `slug`

Canonical example:

```text
/announce delete
slug: announce-2026-04-product-review
```

## Meeting Commands

### `/meeting create`

Required fields:

- `slug`
- `date`
- `title`
- `place`
- `format`
- `paragraphs`

Optional fields:

- `placeurl`
- `photoalt`
- `section`
- `link`

Canonical example:

```text
/meeting create
slug: meeting-2026-03-open-circle
date: 2026-03-19
title: Open project circle and introductions
place: Budva
format: offline / introductions
paragraphs:
- We met to introduce new participants and share project updates.
- Several MVPs were discussed together with growth blockers and asks.
- The group agreed to make open asks more visible between meetings.
section: What we discussed
- New participant introductions
- Product blockers
- Useful next formats
photoalt: Participants during the March meeting
```

### `/meeting update`

Same format as create.

### `/meeting delete`

Required fields:

- `slug`

Canonical example:

```text
/meeting delete
slug: meeting-2026-03-open-circle
```

## Participant Commands

### `/participant create`

Required fields:

- `slug`
- `handle`
- `name`
- `role`
- `bio`
- `points`

Optional fields:

- `photoalt`
- `location`
- `tags`
- `link`

Canonical example:

```text
/participant create
slug: participant-ivan-kotelnikov
handle: @ikotelnikov
name: Ivan Kotelnikov
role: Founder / Product / Engineering
location: Budva / Montenegro
tags: product, engineering, community
bio:
Builds the club and works on product and engineering tasks.
points:
- Can help shape product direction.
- Can review implementation plans.
- Can connect people around club operations.
link: Telegram | https://t.me/ikotelnikov
photoalt: Ivan Kotelnikov at a club meeting
```

### `/participant update`

Same format as create.

### `/participant delete`

Required fields:

- `slug`

Canonical example:

```text
/participant delete
slug: participant-ivan-kotelnikov
```

## Project Commands

### `/project create`

Required fields:

- `slug`
- `title`
- `status`
- `stack`
- `points`

Optional fields:

- `summary`
- `photoalt`
- `location`
- `tags`
- `owners`
- `link`

Rules:

- `owners` is a comma-separated list of participant slugs

Canonical example:

```text
/project create
slug: project-club-site-bot
title: Club site content bot
status: prototype in progress
stack: telegram / github actions / static site
location: Budva / Montenegro
tags: automation, bot, content
owners: participant-ivan-kotelnikov
summary:
Bot that syncs approved Telegram messages into website content files.
points:
- Parses Telegram commands into structured content operations.
- Commits JSON and assets into the repo.
- Publishes updates through GitHub Pages.
link: Repository | https://github.com/example/project
photoalt: Preview of the club bot flow
```

### `/project update`

Same format as create.

### `/project delete`

Required fields:

- `slug`

Canonical example:

```text
/project delete
slug: project-club-site-bot
```

## Photo Handling

Photos should be sent in one of these ways:

1. send a single photo with the command in the photo caption
2. send a media group where the first caption contains the command

Bot behavior:

- if a command has attached photo media, store the first photo as the canonical `photo`
- derive the asset filename from the slug
- require `photoalt` when a photo is attached
- if no photo is attached, omit the `photo` field

First implementation scope:

- support one stored `photo` per entity
- ignore extra photos in a media group or fail clearly

Future extension:

- allow `/... update` with multiple photos mapped into `gallery`

## Operational Simplifications For V1

To keep parsing and safety simple in the first version:

- `create` and `update` should both use full-document payloads
- `update` should replace the whole JSON item, not patch selected fields
- `delete` should require only `slug`
- commands should be processed only from text messages or photo captions
- voice messages, forwarded messages, and arbitrary albums should be ignored

## Validation Checklist

Before writing files, the bot should validate:

- command header is recognized
- user is authorized
- required fields for the entity and action are present
- slug matches slug rules
- list fields are valid arrays
- section blocks are well-formed
- owner slugs reference existing participants when provided
- `photoalt` exists if a photo is attached
- delete commands contain no irrelevant payload beyond `slug`
