# Content Structure

This folder is the content source for the static site.

## Files

- `main/page.json`: homepage content
- `meetings/page.json`: meetings page layout copy and section settings
- `meetings/announcements/index.json`: current announcement order
- `meetings/archive/index.json`: archived meeting order and paging
- `meetings/items/*.json`: one file per meeting or announcement
- `projects/page.json`: projects page content
- `participants/page.json`: participants block for the projects page
- `links/page.json`: useful links page content

## Why JSON

The site loads these files directly in the browser, so HTML templates do not need to change when content changes.

That also makes the structure suitable for a Telegram bot later:

1. receive selected messages from Telegram
2. transform them into JSON entries
3. write or update the relevant file under `content/meetings/items/`
4. update the matching index file under `content/meetings/`
5. commit and push

## Local preview

Because the site uses `fetch()` to read JSON, open it through a static server instead of double-clicking `index.html`.
