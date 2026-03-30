# Content Structure

This folder is the content source for the static site.

Canonical schemas for bot-managed entities are documented in `content/SCHEMAS.md`.
Telegram command grammar for the future bot is documented in `content/TELEGRAM_COMMANDS.md`.

## Files

- `main/page.json`: homepage content
- `meetings/page.json`: meetings page layout copy and section settings
- `meetings/announcements/index.json`: current announcement order
- `meetings/archive/index.json`: archived meeting order and paging
- `meetings/items/*.json`: one file per meeting or announcement
- `projects/page.json`: projects page shell and section copy
- `projects/index.json`: project order for the projects page
- `projects/items/*.json`: one file per project
- `participants/page.json`: participants section copy
- `participants/index.json`: participant order for the projects page
- `participants/items/*.json`: one file per participant
- `links/page.json`: useful links page content

## Why JSON

The site loads these files directly in the browser, so HTML templates do not need to change when content changes.

That also makes the structure suitable for a Telegram bot later:

1. receive selected messages from Telegram
2. transform them into JSON entries
3. write or update the relevant file under `content/.../items/`
4. update the matching index file under `content/.../index.json`
5. commit and push

## Local preview

Because the site uses `fetch()` to read JSON, open it through a static server instead of double-clicking `index.html`.
