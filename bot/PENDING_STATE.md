# Pending State And Storage

This document defines what the bot must persist between Telegram messages in order to support clarification and confirmation safely.

The redesigned bot is multi-step by design, so pending state is required.

## Purpose

Pending state exists to support these flows:

- the bot asks a clarification question and waits for the answer
- the bot shows a proposed operation and waits for `confirm` or `cancel`
- the bot discards stale or replaced pending operations safely

## First-Version Decision

The first redesigned release will persist exactly one pending interaction per authorized chat.

That means:

- one chat
- one pending operation
- one active step at a time

This matches the owner-only operating model and keeps the implementation simple.

## Storage Decision

Production target:

- persist pending state outside process memory

Reason:

- webhook runtimes are stateless
- Cloudflare Workers should not rely on memory between requests
- confirmation must survive cold starts and separate webhook invocations

First production storage recommendation:

- Cloudflare KV or equivalent lightweight key-value storage

Local development:

- file-backed storage is acceptable

## Pending State Key

Pending state should be keyed by:

- Telegram chat ID

First version assumption:

- the same authorized user interacts in a single private bot chat

So the key can be conceptually:

- `pending:<chatId>`

## Pending State Types

The runtime should support these pending state types:

### `awaiting_clarification`

The bot asked a focused question and is waiting for an answer.

### `awaiting_confirmation`

The bot has a validated proposed operation and is waiting for `confirm` or `cancel`.

## Required Persisted Shape

Every pending record should use a strict shape similar to this:

```json
{
  "version": 1,
  "chatId": 123456789,
  "userId": 272981189,
  "state": "awaiting_confirmation",
  "createdAt": "2026-03-30T12:00:00.000Z",
  "expiresAt": "2026-03-30T18:00:00.000Z",
  "sourceMessageId": 100,
  "sourceUpdateId": 200,
  "operation": {},
  "question": null,
  "context": {}
}
```

## Top-Level Fields

### `version`

Required.

Purpose:

- allows future storage migrations

Initial value:

- `1`

### `chatId`

Required.

Purpose:

- identifies the Telegram chat where the pending interaction lives

### `userId`

Required.

Purpose:

- confirms the pending record belongs to the authorized operator

### `state`

Required.

Allowed values:

- `awaiting_clarification`
- `awaiting_confirmation`

### `createdAt`

Required.

Purpose:

- auditability
- expiration logic

### `expiresAt`

Required.

Purpose:

- expire stale pending interactions

### `sourceMessageId`

Required.

Purpose:

- reference the Telegram message that created the pending state

### `sourceUpdateId`

Required.

Purpose:

- reference the triggering update

### `operation`

Required for both pending state types.

Purpose:

- stores the current proposed structured operation

This should use the validated runtime shape, not raw unvalidated model output.

### `question`

Required for `awaiting_clarification`.

Purpose:

- the exact question currently being asked

Should be `null` for `awaiting_confirmation`.

### `context`

Required.

Purpose:

- optional auxiliary state that helps continue the interaction

Examples:

- extraction warnings
- clarification history
- photo metadata
- file preview summary

## Operation Shape Inside Pending State

The persisted `operation` object should contain the runtime-normalized proposal, not just the raw LLM response.

Recommended shape:

```json
{
  "entity": "participant",
  "action": "create",
  "slug": "participant-ivan-kotelnikov",
  "summary": "Create a participant card for Ivan Kotelnikov.",
  "confidence": "high",
  "fields": {
    "name": "Ivan Kotelnikov",
    "role": "Founder / Product / Engineering"
  },
  "warnings": [],
  "photo": {
    "hasPhoto": false,
    "telegramFileIds": []
  },
  "preview": {
    "files": [
      "content/participants/items/participant-ivan-kotelnikov.json",
      "content/participants/index.json"
    ]
  }
}
```

## Clarification State Rules

When state is `awaiting_clarification`:

- `question` must be present
- `operation` may be partial
- confirmation is not allowed yet

Expected behavior:

- the next user reply is interpreted as an answer to the stored question
- if the answer resolves the gap, the runtime upgrades the state to `awaiting_confirmation`
- if the answer is still insufficient, ask one more focused question

## Confirmation State Rules

When state is `awaiting_confirmation`:

- `question` must be `null`
- `operation` must already be fully validated for write preview
- the next valid control messages are `confirm` or `cancel`

Expected behavior:

- `confirm` executes the GitHub write
- `cancel` deletes the pending state and performs no write

## Expiration Policy

The bot should not keep pending interactions forever.

First-version recommendation:

- expire pending state after 6 hours

Reason:

- long enough for normal usage
- short enough to avoid accidental stale confirmations

Behavior on expired state:

- treat the next reply as a fresh message
- optionally inform the user that the old pending action expired

Example reply:

```text
The previous pending action expired. I treated your latest message as a new request.
```

## Replacement Policy

If a pending state exists and the user sends a clearly new instruction, the old state should be replaced.

Rules:

- do not silently merge old and new operations
- discard the old pending record
- create a new pending record from the new message
- inform the user that the previous pending action was replaced

Example:

```text
I dropped the previous pending action and prepared a new proposal from your latest message.
```

## Confirmation Safety Rules

The runtime must enforce:

- only a matching pending confirmation can be confirmed
- `confirm` without pending confirmation must do nothing
- `cancel` without pending confirmation should return a short no-op response

Example no-op replies:

```text
There is no pending action to confirm.
```

```text
There is no pending action to cancel.
```

## Photo Metadata In Pending State

If the source Telegram message contains photo media, the pending state should keep enough metadata to fetch it later after confirmation.

Recommended fields:

```json
{
  "hasPhoto": true,
  "telegramFileIds": [
    "ABC123"
  ],
  "photoAlt": "Proposed alt text"
}
```

Important:

- do not download and store the photo permanently before confirmation
- keep only the metadata needed to fetch it after confirmation

## Minimal Storage Operations

The runtime needs only these storage operations:

- `getPending(chatId)`
- `setPending(chatId, record)`
- `deletePending(chatId)`
- optional `deleteExpired()`

## Runtime Flow Summary

### On new actionable message

1. interpret with OpenAI
2. validate extraction
3. if clarification needed, write `awaiting_clarification`
4. if ready for preview, write `awaiting_confirmation`

### On clarification reply

1. load pending state
2. merge answer into interpretation context
3. re-run extraction or completion logic
4. either ask another question or move to confirmation

### On `confirm`

1. load pending confirmation state
2. execute GitHub write
3. delete pending state
4. reply with success or failure

### On `cancel`

1. load pending state
2. delete pending state
3. reply that nothing was changed

## What Is Not Stored

Do not persist:

- raw secrets
- unnecessary full Telegram payloads
- large binary media blobs before confirmation

Persist only what is necessary for the flow.

## First-Version Implementation Choice

For the first redesign implementation:

- one pending record per chat
- six-hour expiration
- replacement allowed on clear new instruction
- text confirmation only
- file-backed local storage
- Cloudflare KV or equivalent in production

## Next Step

The next redesign step is to define the GitHub write strategy in more concrete runtime terms: direct commit behavior, commit message policy, branch handling, and failure behavior.

That strategy is documented in `bot/GITHUB_WRITE_STRATEGY.md`.
