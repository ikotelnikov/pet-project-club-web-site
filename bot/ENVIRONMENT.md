# Bot Environment Contract

This document defines the shared environment variable contract for the redesigned bot.

The same variable names must be used:

- locally in `bot/local-env.ps1`
- in Cloudflare Workers secrets and vars
- in any local helper scripts

The goal is to avoid one naming scheme for local development and another one for hosting.

## Principles

- one variable name per concern
- no secrets committed to git
- same names locally and on the server
- server-specific configuration should be minimal

## Variable Categories

## Telegram

### `TELEGRAM_BOT_TOKEN`

Required.

Purpose:

- authenticates requests to Telegram Bot API
- used for webhook setup and bot replies

Local:

- stored in `bot/local-env.ps1`

Cloudflare:

- store as a Worker secret

### `TELEGRAM_ALLOWED_USER_ID`

Required.

Purpose:

- restricts bot control to your numeric Telegram user ID

Local:

- stored in `bot/local-env.ps1`

Cloudflare:

- can be stored as a secret or a normal variable
- secret is acceptable for simplicity

Expected format:

- numeric string, for example `272981189`

### `TELEGRAM_WEBHOOK_SECRET`

Optional but recommended for production.

Purpose:

- shared secret used to validate webhook requests from Telegram

Local:

- optional

Cloudflare:

- store as a Worker secret

## OpenAI

### `OPENAI_API_KEY`

Required for the redesigned natural-language bot.

Purpose:

- authenticates requests to OpenAI API for extraction and clarification

Local:

- stored in `bot/local-env.ps1`

Cloudflare:

- store as a Worker secret

### `OPENAI_MODEL`

Optional.

Purpose:

- allows changing the extraction model without code changes

Recommended initial value:

- choose later when the extraction step is implemented

Local:

- optional in `bot/local-env.ps1`

Cloudflare:

- Worker variable or secret

### `OPENAI_TRANSLATION_MODEL`

Optional.

Purpose:

- allows using a separate model for automatic content translation

Default behavior:

- if unset, translation uses `OPENAI_MODEL`

Local:

- optional in `bot/local-env.ps1`

Cloudflare:

- Worker variable or secret

## GitHub

### `GITHUB_REPO_OWNER`

Required.

Purpose:

- repository owner used by the bot when writing content

Example:

- `ikotelnikov`

Local:

- stored in `bot/local-env.ps1`

Cloudflare:

- Worker variable

### `GITHUB_REPO_NAME`

Required.

Purpose:

- repository name used by the bot when writing content

Example:

- `pet-project-club-web-site`

Local:

- stored in `bot/local-env.ps1`

Cloudflare:

- Worker variable

### `GITHUB_BRANCH`

Required.

Purpose:

- target branch for direct commits

Initial value:

- `main`

Local:

- stored in `bot/local-env.ps1`

Cloudflare:

- Worker variable

### `GITHUB_WRITE_TOKEN`

Required.

Purpose:

- token used by the bot to create commits and update files through GitHub API

Recommended type:

- fine-grained GitHub personal access token
- scoped only to this repository
- minimum repo write permissions needed for contents

Local:

- stored in `bot/local-env.ps1`

Cloudflare:

- Worker secret

## Optional Local Paths

These variables are mainly useful for local tooling and transitional scripts.

### `BOT_REPO_ROOT`

Optional locally.

Purpose:

- override repository root path if needed

Default:

- inferred by local runner scripts

### `BOT_CONTENT_ROOT`

Optional locally.

Purpose:

- override content root path

Default:

- `<repo>/content`

### `BOT_ASSETS_ROOT`

Optional locally.

Purpose:

- override assets root path

Default:

- `<repo>/assets`

### `TELEGRAM_OFFSET_STATE_PATH`

Optional locally.

Purpose:

- stores the polling offset for the transitional prototype

Important:

- this is not part of the target webhook production flow
- keep only while the polling prototype still exists

Default:

- `<repo>/bot/state/telegram-offset.json`

## Local File Contract

Local secrets should be stored in:

- `bot/local-env.ps1`

This file is gitignored.

The checked-in template is:

- `bot/local-env.example.ps1`

## Recommended Local Template

```powershell
$env:TELEGRAM_BOT_TOKEN='PASTE_YOUR_TELEGRAM_BOT_TOKEN_HERE'
$env:TELEGRAM_ALLOWED_USER_ID='272981189'
$env:OPENAI_API_KEY='PASTE_YOUR_OPENAI_API_KEY_HERE'
$env:GITHUB_REPO_OWNER='ikotelnikov'
$env:GITHUB_REPO_NAME='pet-project-club-web-site'
$env:GITHUB_BRANCH='main'
$env:GITHUB_WRITE_TOKEN='PASTE_YOUR_GITHUB_WRITE_TOKEN_HERE'

# Optional:
# $env:OPENAI_MODEL='...'
# $env:TELEGRAM_WEBHOOK_SECRET='...'
# $env:TELEGRAM_OFFSET_STATE_PATH="$PWD\\bot\\state\\telegram-offset.json"
# $env:BOT_REPO_ROOT="$PWD"
# $env:BOT_CONTENT_ROOT="$PWD\\content"
# $env:BOT_ASSETS_ROOT="$PWD\\assets"
```

## Cloudflare Mapping

When we reach deployment, these variables should be mapped like this:

Secrets:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `OPENAI_API_KEY`
- `GITHUB_WRITE_TOKEN`
- optionally `TELEGRAM_ALLOWED_USER_ID`

Non-secret vars:

- `TELEGRAM_ALLOWED_USER_ID`
- `OPENAI_MODEL`
- `GITHUB_REPO_OWNER`
- `GITHUB_REPO_NAME`
- `GITHUB_BRANCH`

Cloudflare binding:

- `PENDING_STATE_KV`
  - a KV namespace binding for durable pending confirmations between webhook requests
  - this is a Worker binding, not a string env var

If you prefer simplicity over separation, all of them can be stored as secrets except the path-related local-only variables.

## What Must Never Be Committed

Never commit:

- `bot/local-env.ps1`
- any real token value
- any exported secret JSON or backup file

## Current Transitional Note

The repository still contains a polling prototype.

That means some local variables exist today that will not survive into the final webhook implementation.

Expected to remain in the final design:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_ID`
- `OPENAI_API_KEY`
- `GITHUB_REPO_OWNER`
- `GITHUB_REPO_NAME`
- `GITHUB_BRANCH`
- `GITHUB_WRITE_TOKEN`
- optional `OPENAI_MODEL`
- optional `TELEGRAM_WEBHOOK_SECRET`

Expected to be local-only or transitional:

- `BOT_REPO_ROOT`
- `BOT_CONTENT_ROOT`
- `BOT_ASSETS_ROOT`
- `TELEGRAM_OFFSET_STATE_PATH`

## Next Step

The next redesign step is to define the new Telegram interaction model for natural-language messages, confirmation, and clarification.
