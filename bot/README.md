# Bot Workspace

This folder contains the local bot implementation scaffold.

The target production architecture is documented in `bot/ARCHITECTURE.md`.
The shared env contract is documented in `bot/ENVIRONMENT.md`.
The Telegram conversation model is documented in `bot/INTERACTION_MODEL.md`.
The OpenAI extraction contract is documented in `bot/LLM_EXTRACTION.md`.
The pending state model is documented in `bot/PENDING_STATE.md`.
The GitHub write policy is documented in `bot/GITHUB_WRITE_STRATEGY.md`.
The OpenAI runtime contract is documented in `bot/OPENAI_RUNTIME.md`.
The webhook/runtime implementation plan is documented in `bot/RUNTIME_PLAN.md`.
The deployment path is documented in `bot/DEPLOYMENT.md`.
The machine-oriented staged schemas are documented in `bot/schemas/`.

Current scope:

- environment-based config loading
- strict Telegram command parsing
- content repository service interfaces
- local photo staging into canonical asset folders
- Telegram polling via `getUpdates`
- authorized-user filtering
- offset persistence between runs
- pending state persistence scaffolding
- transitional extraction adapter scaffolding
- Worker-safe webhook runtime scaffold
- GitHub API-backed content repository scaffold
- attachment metadata capture from Telegram messages
- local CLI for parsing commands

Not implemented yet:

- Telegram photo downloads
- durable hosted media storage
- production deployment config

## Files

- `config.js`: runtime config loading and validation
- `domain/`: shared bot constants and errors
- `parsers/telegram-command.js`: strict command parser
- `services/content-repository.js`: filesystem-backed content repository scaffold
- `services/content-mapper.js`: maps parsed Telegram commands to canonical JSON documents
- `services/photo-store.js`: stages local photo files into canonical asset locations
- `services/telegram-client.js`: Telegram Bot API client
- `services/offset-store.js`: persisted `getUpdates` offset storage
- `services/telegram-update-processor.js`: authorization and update processing
- `core/`: reusable runtime/domain logic for the redesign
- `adapters/`: transport, storage, and provider adapters for the redesign
- `schemas/`: machine-oriented entity and staged LLM contracts
- `adapters/telegram/attachments.js`: extracts Telegram attachment metadata for prompt input and preview
- `adapters/openai/prototype-extraction-client.js`: temporary extraction bridge during migration
- `adapters/github/repository.js`: GitHub API-backed repository for hosted writes
- `adapters/storage/pending-kv-store.js`: Cloudflare KV-style pending state store
- `worker/index.js`: Cloudflare Worker entrypoint
- `runtime/`: runtime composition utilities for local and hosted execution
- `cli/register-webhook.js`: registers Telegram webhook against the deployed Worker URL
- `cli/get-webhook-info.js`: inspects Telegram's currently configured webhook
- `cli/get-worker-logs.js`: fetches recent structured Worker logs through the admin endpoint
- `cli/parse-command.js`: local parser CLI
- `cli/apply-command.js`: local content operation CLI
- `cli/poll-updates.js`: one-shot Telegram polling CLI
- `cli/simulate-webhook.js`: local webhook payload simulator

## Local Usage

Recommended local secret flow:

1. Copy `bot/local-env.example.ps1` to `bot/local-env.ps1`
2. Put your real values into `bot/local-env.ps1`
3. Run bot commands through `bot/run-with-env.ps1`

Example:

```powershell
Copy-Item .\bot\local-env.example.ps1 .\bot\local-env.ps1
.\bot\run-with-env.ps1 node .\bot\cli\poll-updates.js
```

`bot/local-env.ps1` is ignored by git and is intended for your real local secrets.
`bot/run-with-env.ps1` is the standardized entry point for local runs and CI runs.

During the redesign migration, you can switch extraction mode with:

```powershell
$env:EXTRACTION_BACKEND='prototype'
```

or

```powershell
$env:EXTRACTION_BACKEND='openai'
```

Parse a command from stdin:

```powershell
@'
/participant create
slug: participant-ivan-kotelnikov
handle: @ikotelnikov
name: Ivan Kotelnikov
role: Founder / Product / Engineering
bio:
Builds the club and works on product and engineering tasks.
points:
- Can help shape product direction.
- Can review implementation plans.
- Can connect people around club operations.
'@ | npm run bot:parse
```

Run tests:

```powershell
npm run bot:test
```

Poll Telegram once in dry-run mode:

```powershell
.\bot\run-with-env.ps1 node .\bot\cli\poll-updates.js
```

Apply authorized Telegram commands to repo files:

```powershell
.\bot\run-with-env.ps1 node .\bot\cli\poll-updates.js --apply
```

Preview a content operation without writing files:

```powershell
@'
/project create
slug: project-club-site-bot
title: Club site content bot
status: prototype in progress
stack: telegram / github actions / static site
points:
- Parses Telegram commands
'@ | npm run bot:apply -- --dry-run
```

Preview a content operation with a local photo:

```powershell
@'
/participant create
slug: participant-ivan-kotelnikov
handle: @ikotelnikov
name: Ivan Kotelnikov
role: Founder / Product / Engineering
bio:
Builds the club and works on product and engineering tasks.
points:
- Can help shape product direction.
- Can review implementation plans.
- Can connect people around club operations.
photoalt: Ivan Kotelnikov at a club meeting
'@ | node bot/cli/apply-command.js --dry-run --photo .\\some-photo.jpg
```

If you prefer npm for polling:

```powershell
npm run bot:poll:env
```

Simulate the webhook runtime locally from a saved Telegram update payload:

```powershell
node bot/cli/simulate-webhook.js --update .\bot\fixtures\sample-update.json
```

The Cloudflare Worker runtime expects the same Telegram/OpenAI/GitHub env names as local development, plus a `PENDING_STATE_KV` binding for durable confirmation state between webhook requests.

To fetch recent hosted Worker logs from your local shell:

```powershell
.\bot\run-with-env.ps1 node .\bot\cli\get-worker-logs.js --base-url https://your-worker-domain.example --limit 20
```

After deployment, register the Telegram webhook with:

```powershell
.\bot\run-with-env.ps1 node .\bot\cli\register-webhook.js --base-url https://your-worker-domain.example
```

Inspect the current webhook with:

```powershell
.\bot\run-with-env.ps1 node .\bot\cli\get-webhook-info.js
```

## GitHub Actions Usage

Use the same `bot/run-with-env.ps1` entry point in Actions, but provide secrets through workflow `env:`.

Example step:

```yaml
- name: Poll Telegram bot
  shell: pwsh
  env:
    TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
    TELEGRAM_ALLOWED_USER_ID: ${{ secrets.TELEGRAM_ALLOWED_USER_ID }}
  run: .\bot\run-with-env.ps1 node .\bot\cli\poll-updates.js --apply
```

The standardization rule is:

- local: `bot/local-env.ps1` provides secrets
- GitHub Actions: workflow `env:` provides secrets
- both paths run the same command through `bot/run-with-env.ps1`
