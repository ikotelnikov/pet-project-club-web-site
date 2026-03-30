# Bot Architecture

This document defines the target architecture for the Telegram bot redesign.

It supersedes the earlier polling-first prototype under `bot/` as the intended production direction.

## Status

Current prototype:

- Telegram polling via `getUpdates`
- strict command grammar
- local content write pipeline

Target production design:

- Telegram webhook
- natural-language input
- OpenAI extraction
- mandatory confirmation before write
- GitHub-backed content publishing

## Final Decision

The production bot will use:

- Telegram Bot API with webhook delivery
- Cloudflare Workers as the bot runtime
- OpenAI API for message understanding and structured extraction
- GitHub repository as the source of truth for website content and assets
- GitHub Pages as the public website deployment target

## Why This Architecture

### Why Not GitHub Actions As The Main Bot Runtime

GitHub Actions is suitable for scheduled polling and repo automation, but not for a conversational Telegram bot.

Problems:

- polling is delayed
- no real-time user experience
- awkward for multi-step chat confirmation
- poor fit for natural-language interaction

Actions can still be used later for auxiliary tasks, but not as the primary Telegram runtime.

### Why Cloudflare Workers

Cloudflare Workers fits the target bot shape well:

- webhook-friendly request model
- good free tier for a small bot
- fast startup for short request-response workloads
- easy secret management in hosted environments

### Why GitHub Remains The Content Store

The website is already static and content-driven from JSON files inside this repository.

Keeping GitHub as the source of truth preserves:

- version history
- easy manual review
- compatibility with GitHub Pages
- direct connection between content and deployment

## High-Level Flow

1. Telegram sends a webhook update to the bot endpoint.
2. The bot validates that the sender is the authorized user.
3. The bot extracts intent and fields from the message using OpenAI.
4. The bot builds a structured proposed operation.
5. The bot sends a preview back to Telegram.
6. The user confirms or cancels.
7. After confirmation, the bot writes content and assets into GitHub.
8. GitHub Pages republishes the updated site.

## Message Model

The bot must accept:

- normal text
- photo messages with captions
- later, multiple photos if needed

The bot must not require rigid slash commands for normal operation.

However, the internal write model still remains structured:

- `entity`
- `action`
- `slug`
- `fields`

Natural-language understanding is an input layer, not the storage format.

## Safety Model

Natural-language input increases ambiguity, so write safety must be stricter than in the polling prototype.

Mandatory rules:

- only the authorized Telegram user may control the bot
- every proposed write must be previewed before execution
- every create/update/delete must require explicit confirmation
- low-confidence interpretations must not auto-write
- unclear messages should trigger clarification questions instead of guesses

## Confirmation Model

The bot will use a two-step write flow:

1. propose operation
2. confirm or cancel

A proposed operation should include:

- inferred entity
- inferred action
- target slug
- preview of important fields
- summary of files to be touched

The confirmation response from the user should be short and explicit, for example:

- `confirm`
- `cancel`

Button-based confirmation can be added later, but text confirmation is sufficient for the first implementation.

## OpenAI Extraction Role

OpenAI is used to transform normal Telegram messages into a structured proposal.

The model should not write directly to GitHub.

The model output must be validated against a strict schema before any write is allowed.

Expected output shape:

- `entity`
- `action`
- `slug`
- `fields`
- `confidence`
- `needsConfirmation`
- optional `questions`

If the result is incomplete or ambiguous:

- the bot must ask a follow-up question
- the bot must not write

## GitHub Write Strategy

The bot runtime writes to GitHub after confirmation.

First implementation decision:

- write directly to the repository default branch

Reason:

- simpler implementation
- faster iteration while the bot is still owner-only

Possible later upgrade:

- create a branch and open a PR instead of direct commit

## Asset Handling

Photos sent through Telegram should eventually be:

1. downloaded from Telegram
2. normalized to canonical asset filenames
3. uploaded into the repo under the correct `assets/` folder
4. referenced from the written JSON content

The existing canonical asset conventions remain valid:

- `assets/meetings/`
- `assets/participants/`
- `assets/projects/`

## Shared Environment Contract

The same environment variable names must be used:

- locally
- in Cloudflare Workers
- in GitHub-related tooling when needed

Required variables:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ALLOWED_USER_ID`
- `OPENAI_API_KEY`
- `GITHUB_REPO_OWNER`
- `GITHUB_REPO_NAME`
- `GITHUB_BRANCH`
- `GITHUB_WRITE_TOKEN`

Optional variables:

- `OPENAI_MODEL`
- `TELEGRAM_WEBHOOK_SECRET`

Local development may continue using `bot/local-env.ps1`.

Hosted environments must provide the same variable names through platform secret storage.

## Local And Hosted Standardization

The bot should have one standardized startup contract:

- local runs load `bot/local-env.ps1` if present
- hosted runs rely on environment variables provided by the platform
- both paths should execute the same application logic

The current `bot/run-with-env.ps1` remains valid for local standardization.

For Cloudflare deployment, the equivalent variable names must be configured as Worker secrets.

## Transitional Note

The current polling-based implementation under `bot/` is not wasted.

It remains useful as a transitional prototype for:

- content schemas
- write safety rules
- local validation
- repo write logic

But the production runtime should be refactored around webhook delivery and LLM-assisted extraction.

## Scope Locked By This Decision

This architecture step locks the following decisions:

- Cloudflare Workers is the target production host
- GitHub Pages remains the website deployment target
- GitHub repository remains the content source of truth
- the existing Telegram bot token will be reused
- OpenAI API is the extraction layer
- normal text input replaces rigid slash-command-first UX
- confirmation before write is mandatory
- the same env variable names are used locally and on the server

## Next Step

The next redesign step is to define the shared secret contract and deployment configuration in more detail, based on the environment variables listed above.

That contract is documented in `bot/ENVIRONMENT.md`.
The Telegram conversation behavior is documented in `bot/INTERACTION_MODEL.md`.
The OpenAI extraction contract is documented in `bot/LLM_EXTRACTION.md`.
The pending confirmation state model is documented in `bot/PENDING_STATE.md`.
The GitHub write policy is documented in `bot/GITHUB_WRITE_STRATEGY.md`.
The OpenAI runtime contract is documented in `bot/OPENAI_RUNTIME.md`.
The webhook/runtime implementation plan is documented in `bot/RUNTIME_PLAN.md`.
