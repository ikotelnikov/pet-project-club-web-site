# Pet Project Club Website

Static multi-page website for GitHub Pages.

## Pages

- `Main`
- `Meetings`
- `Projects and Participants`
- `Useful links`

## Content model

Page content lives under `content/` and is loaded in the browser via `fetch()`.

- `content/main/page.json`
- `content/meetings/page.json`
- `content/projects/page.json`
- `content/participants/page.json`
- `content/links/page.json`

This structure is intended to be compatible with a future Telegram bot that will copy selected messages from Telegram into repo files and commit them.

## Local preview

Because the site reads JSON files with `fetch()`, run a local static server instead of opening `index.html` directly.

Example:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080/`.

## Deployment

This repository includes a GitHub Actions workflow to deploy to GitHub Pages.
