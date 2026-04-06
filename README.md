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
- `content/meetings/announcements/index.json`
- `content/meetings/archive/index.json`
- `content/meetings/items/*.json`
- `content/projects/page.json`
- `content/projects/index.json`
- `content/projects/items/*.json`
- `content/participants/page.json`
- `content/participants/index.json`
- `content/participants/items/*.json`
- `content/links/page.json`

This structure is intended to be compatible with a future Telegram bot that will copy selected messages from Telegram into repo files and commit them.

The canonical item schemas are documented in `content/SCHEMAS.md`.
The planned Telegram command grammar is documented in `content/TELEGRAM_COMMANDS.md`.

## Local preview

Because the site reads JSON files with `fetch()`, run a local static server instead of opening `index.html` directly.

Example:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080/`.

## Deployment

This repository includes a GitHub Actions workflow to deploy to GitHub Pages.

For the production custom-domain setup for `petprojectclub.me`, use [DOMAIN_SETUP.md](/C:/Users/ikotelnikov/Documents/GitHub/pet-project-club-web-site/DOMAIN_SETUP.md).

## Bot workspace

The future Telegram bot lives under `bot/`.
The redesign target architecture is documented in `bot/ARCHITECTURE.md`.
The shared env contract is documented in `bot/ENVIRONMENT.md`.
The Telegram conversation model is documented in `bot/INTERACTION_MODEL.md`.
The OpenAI extraction contract is documented in `bot/LLM_EXTRACTION.md`.
The pending state model is documented in `bot/PENDING_STATE.md`.
The GitHub write policy is documented in `bot/GITHUB_WRITE_STRATEGY.md`.
The OpenAI runtime contract is documented in `bot/OPENAI_RUNTIME.md`.
The webhook/runtime implementation plan is documented in `bot/RUNTIME_PLAN.md`.
The deployment path is documented in `bot/DEPLOYMENT.md`.
The staged machine-oriented bot schemas live in `bot/schemas/`.

Current local scripts:

- `npm run bot:apply -- --dry-run`
- `npm run bot:parse`
- `npm run bot:poll`
- `npm run bot:poll:env`
- `npm run bot:test`

`bot:apply` also supports `--photo <path>` for local photo staging tests.
For photo tests on Windows, prefer `node bot/cli/apply-command.js --dry-run --photo <path>`.

For local bot secrets, use `bot/local-env.example.ps1` as a template and keep the real `bot/local-env.ps1` untracked.
Use `bot/run-with-env.ps1` as the standardized startup entry point for both local runs and GitHub Actions.
