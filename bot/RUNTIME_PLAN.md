# Webhook Runtime And Refactor Plan

This document defines how the redesigned bot should be implemented in code and how the current polling prototype should be refactored into the final webhook-based architecture.

It is the bridge between design and implementation.

## Goal

Move from the current local polling prototype to:

- Cloudflare Worker webhook runtime
- OpenAI-based natural-language extraction
- persistent pending confirmation flow
- GitHub API writes after confirmation

while reusing as much of the validated content logic as possible.

## Implementation Principles

- preserve existing validated content/domain logic where still useful
- separate transport logic from business logic
- isolate Cloudflare-specific code from generic core logic
- keep local development possible without deploying first

## Current Prototype Assessment

Useful parts of the current prototype:

- content mapping logic
- content write rules
- slug and schema assumptions
- photo naming conventions
- local env conventions

Parts that are transitional and should not remain central:

- polling-oriented runtime
- strict slash-command parser as the primary input layer
- offset-based processing flow

## Target Code Layers

The refactored bot should be organized into these layers:

### 1. Core Domain Layer

Pure logic, no platform dependencies.

Responsibilities:

- runtime operation shape
- schema-level validation
- preview construction
- confirmation-state transitions
- mapping validated operation into content documents

Should be reusable in:

- local dev
- Cloudflare Worker
- tests

### 2. OpenAI Extraction Layer

Responsibilities:

- build normalized extraction input
- call OpenAI
- validate response against extraction contract
- return structured result or safe failure

Should depend on:

- `OPENAI_API_KEY`
- `OPENAI_MODEL`

Should not depend on:

- Telegram-specific HTTP transport
- GitHub write logic

### 3. Pending State Layer

Responsibilities:

- `getPending(chatId)`
- `setPending(chatId, record)`
- `deletePending(chatId)`

Implementations:

- local file store
- Cloudflare KV store

### 4. GitHub Writer Layer

Responsibilities:

- read current repo file state through GitHub API
- compute item/index updates
- upload confirmed asset files
- commit confirmed changes

Should depend on:

- `GITHUB_REPO_OWNER`
- `GITHUB_REPO_NAME`
- `GITHUB_BRANCH`
- `GITHUB_WRITE_TOKEN`

### 5. Telegram Adapter Layer

Responsibilities:

- accept webhook update payloads
- validate message origin
- extract text/caption/media metadata
- send reply messages to Telegram

Should not contain business rules beyond transport adaptation.

### 6. Worker Entrypoint Layer

Responsibilities:

- expose webhook route
- inject environment/config
- wire together Telegram adapter, OpenAI layer, pending store, and GitHub writer

## Proposed Directory Shape

Recommended target shape:

```text
bot/
  worker/
    index.js
  core/
    operation-validator.js
    preview-builder.js
    confirmation-flow.js
    content-mapper.js
  adapters/
    telegram/
      telegram-client.js
      telegram-webhook.js
    github/
      github-writer.js
    openai/
      extraction-client.js
    storage/
      pending-file-store.js
      pending-kv-store.js
  shared/
    config.js
    errors.js
    constants.js
```

This does not need to be the exact final folder layout, but the separation of concerns should match this model.

## Cloudflare Worker Runtime Shape

First version worker routes:

### `POST /telegram/webhook`

Purpose:

- receive Telegram webhook updates

Responsibilities:

- verify request authenticity if webhook secret is configured
- parse update JSON
- route to Telegram message handler
- return fast success response

### `GET /health`

Purpose:

- basic health check

Response:

- simple text or JSON status

### Optional `POST /admin/set-webhook`

Purpose:

- helper endpoint or local script for webhook registration

First version recommendation:

- prefer a local/admin script instead of public admin route

## Local Development Mode

We still need local testing before full deployment.

Recommended local runtime modes:

### Mode A. Existing polling prototype

Keep temporarily for:

- quick local message testing
- schema/content validation

### Mode B. Local webhook simulation

Add a local script that:

- reads saved Telegram-style update payloads
- invokes the same message handler used by the Worker

This is the more important long-term local mode.

First implementation recommendation:

- keep the existing polling scripts temporarily
- build the new webhook handler separately
- retire polling once webhook flow is stable

## Message Handling Pipeline

The final runtime pipeline should look like this:

1. receive Telegram update
2. ignore unsupported or unauthorized messages
3. handle exact `confirm` / `cancel` locally
4. load pending state if it exists
5. build normalized extraction input
6. call OpenAI extraction layer if needed
7. validate extraction
8. either:
   - ignore
   - ask clarification and store pending clarification
   - preview and store pending confirmation
   - execute confirmed write
9. reply to Telegram

## Reuse Plan For Existing Files

### Keep And Adapt

- current content mapping logic
- current repository/content write logic concepts
- current photo naming logic
- current config/env handling concepts

### Replace Or Demote

- slash-command parser as primary UX
- polling-based update processor
- offset store as primary runtime state

### Transitional Compatibility

The existing prototype can remain during migration as:

- local test harness
- content logic reference
- temporary utility scripts

## Refactor Sequence

Implementation should proceed in this order:

1. extract reusable core logic from current services
2. implement pending-state abstraction
3. implement OpenAI extraction adapter
4. implement Telegram webhook handler
5. implement GitHub API writer
6. connect the full confirmation flow
7. test locally with simulated updates
8. deploy to Cloudflare Workers

## Testing Strategy

We need tests at three levels:

### Unit Tests

For:

- extraction validation
- pending-state transitions
- preview construction
- content mapping

### Integration Tests

For:

- confirmed create/update/delete flows
- pending clarification flow
- pending confirmation flow
- GitHub writer payload generation

### Fixture-Based Webhook Tests

For:

- incoming Telegram update payloads
- text-only messages
- photo-with-caption messages
- `confirm`
- `cancel`

## Deployment Preparation

Before deployment, the implementation must be ready for:

- Cloudflare Worker environment variables/secrets
- webhook URL registration with Telegram
- KV binding for pending state

## First-Version Runtime Decisions Locked Here

- Worker runtime is webhook-first
- existing polling flow remains temporary only
- one handler pipeline is shared between local and hosted environments
- transport-specific code must be isolated from business logic
- pending state abstraction must support both local file and KV backends
- exact `confirm` and `cancel` should bypass OpenAI

## Immediate Next Action

Planning is now sufficient to begin implementation.

Recommended next implementation step:

- start refactoring the current bot code into the new reusable core and adapter structure
