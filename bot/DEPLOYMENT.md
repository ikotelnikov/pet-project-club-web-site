# Bot Deployment

This document describes the first production deployment path for the Telegram bot on Cloudflare Workers.

## Prerequisites

- a Cloudflare account
- your existing Telegram bot token
- your Telegram user ID
- an OpenAI API key
- a GitHub fine-grained token with `Contents: Read and write` for this repository
- local `bot/local-env.ps1` already populated for reuse in helper scripts

## Worker Setup

1. Copy [wrangler.example.toml](/C:/Users/ikotelnikov/Documents/GitHub/pet-project-club-web-site/wrangler.example.toml) to `wrangler.toml`.
2. Install Wrangler locally if needed:

```powershell
npm install --save-dev wrangler
```

3. Log in to Cloudflare:

```powershell
npx wrangler login
```

4. Create the KV namespace for pending confirmations:

```powershell
npx wrangler kv namespace create PENDING_STATE_KV
```

5. Copy the returned namespace ID into `wrangler.toml`.

## Worker Secrets

Set these with Wrangler secrets:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put GITHUB_WRITE_TOKEN
```

Recommended:

- use a long random value for `TELEGRAM_WEBHOOK_SECRET`
- keep `TELEGRAM_ALLOWED_USER_ID`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME`, `GITHUB_BRANCH`, and `EXTRACTION_BACKEND` in `[vars]`

## First Deploy

Deploy the Worker:

```powershell
npx wrangler deploy
```

Cloudflare will return the Worker URL, typically something like:

```text
https://pet-project-club-bot.<subdomain>.workers.dev
```

## Telegram Webhook Registration

Register the webhook against the deployed Worker:

```powershell
.\bot\run-with-env.ps1 node .\bot\cli\register-webhook.js --base-url https://pet-project-club-bot.<subdomain>.workers.dev
```

If you want Telegram to discard older queued messages:

```powershell
.\bot\run-with-env.ps1 node .\bot\cli\register-webhook.js --base-url https://pet-project-club-bot.<subdomain>.workers.dev --drop-pending
```

## Webhook Inspection

Check Telegram's current webhook status:

```powershell
.\bot\run-with-env.ps1 node .\bot\cli\get-webhook-info.js
```

Expected signals:

- `ok: true`
- `url` points to `/telegram/webhook`
- `pending_update_count` is not growing unexpectedly
- `last_error_message` is absent

## Production Smoke Test

1. Open your bot chat in Telegram.
2. Send a natural-language request that should become a preview.
3. Confirm that the bot replies with a preview message.
4. Reply with `confirm`.
5. Confirm that:
   - the bot replies with success
   - the GitHub repo receives a new commit
   - GitHub Pages republishes

## Current Known Limitations

- pending confirmation state is durable only if `PENDING_STATE_KV` is configured
- Telegram photo download is not implemented yet
- Worker writes JSON content to GitHub, but hosted asset upload is still pending
- extraction quality depends on the configured OpenAI model and prompt contract

## Rollback

If deployment is live but misbehaving:

1. remove the Telegram webhook or point it elsewhere
2. redeploy a fixed Worker
3. re-register the webhook

To inspect the current webhook before changing it:

```powershell
.\bot\run-with-env.ps1 node .\bot\cli\get-webhook-info.js
```
