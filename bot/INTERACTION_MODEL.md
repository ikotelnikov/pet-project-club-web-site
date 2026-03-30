# Telegram Interaction Model

This document defines how the redesigned bot should behave in Telegram conversations.

It replaces the rigid command-first interaction style with a natural-language, confirmation-based flow.

## Goals

- allow normal text instead of slash-command syntax
- keep writes safe through explicit confirmation
- handle ambiguity without guessing
- support text and photo messages in a predictable way

## User Model

The bot is owner-only.

That means:

- only the configured `TELEGRAM_ALLOWED_USER_ID` may control it
- messages from all other users are ignored
- the conversation design can optimize for one trusted operator instead of public-bot UX

## Core Conversation Rule

The bot must never write to GitHub immediately after receiving a natural-language message.

The correct flow is:

1. receive message
2. interpret message into a proposed structured operation
3. show preview
4. wait for explicit confirmation
5. write only after confirmation

## Input Types

The bot should support these message types in the first redesigned version:

- plain text messages
- single photo messages with caption

Later support:

- multi-photo messages
- follow-up clarification threads

The bot should ignore:

- stickers
- voice messages
- unsupported media without text or caption
- forwarded content if it does not clearly contain a request

## Message Intent Categories

Every incoming authorized message should be classified into one of these categories:

### 1. Content Operation Request

The user is trying to create, update, or delete:

- meeting
- announcement
- participant
- project

Examples:

- "Add a new participant card for Ivan. He helps with product and engineering."
- "Delete the old April product review announcement."
- "Create a new project card for the Telegram website bot."

### 2. Clarification Response

The user is answering a question the bot previously asked.

Examples:

- "Use Budva as the place."
- "No, this should be a meeting, not an announcement."

### 3. Confirmation Response

The user is explicitly confirming or canceling a pending proposed operation.

Accepted confirmation messages:

- `confirm`
- `cancel`

First version decision:

- use explicit text confirmation only
- do not rely on Telegram inline buttons yet

### 4. Non-Actionable Message

The message does not contain a content request and does not continue a pending interaction.

Examples:

- "hello"
- "thanks"
- random text with no site-edit intention

Bot behavior:

- ignore silently or send a short help hint

First version recommendation:

- ignore silently unless the message looks like an attempted content instruction

## Primary Bot States

The bot should treat each authorized chat as moving through these states:

### Idle

No pending clarification and no pending confirmation.

### Awaiting Clarification

The model could not safely build a complete operation.

Examples:

- entity is unclear
- action is unclear
- title is missing
- delete target is ambiguous

In this state, the bot must ask a focused follow-up question.

### Awaiting Confirmation

The bot has a complete proposed operation and is waiting for `confirm` or `cancel`.

Only one pending operation should exist at a time in the first version.

If the user sends a new unrelated message instead of confirming:

- the bot should treat it as replacing the pending proposal only if clearly intended
- otherwise ask whether to confirm/cancel the pending action first

## Proposed Operation Preview

When the model has a valid structured interpretation, the bot should send a preview message.

The preview should include:

- entity
- action
- slug
- key fields
- photo presence if relevant
- target files summary
- an instruction to reply with `confirm` or `cancel`

Example preview:

```text
Proposed update

Entity: participant
Action: create
Slug: participant-ivan-kotelnikov

Fields:
- name: Ivan Kotelnikov
- role: Founder / Product / Engineering
- points: 3

Files:
- content/participants/items/participant-ivan-kotelnikov.json
- content/participants/index.json

Reply with: confirm
Or reply with: cancel
```

## Clarification Behavior

If the bot cannot safely infer a full operation, it must ask exactly one focused question at a time.

Good clarification questions:

- "Should this be a meeting or an announcement?"
- "What date should I use?"
- "Which existing project should I delete?"

Bad clarification behavior:

- guessing a missing value without asking
- asking many unrelated questions at once
- jumping directly to write

## Confidence Handling

The model output should include a confidence signal.

Behavior:

- high confidence: show preview and wait for confirmation
- medium confidence: show preview but explicitly mention uncertainty
- low confidence: ask a clarification question instead of previewing

The bot should never auto-confirm on confidence alone.

## Delete Requests

Delete is the most dangerous natural-language action.

Rules:

- if the target slug or item identity is ambiguous, ask for clarification
- never infer a delete target from weak similarity alone
- always show the exact target in preview before confirmation

Example:

```text
Proposed delete

Entity: announcement
Slug: announce-2026-04-product-review

Files:
- content/meetings/items/announce-2026-04-product-review.json
- content/meetings/announcements/index.json

Reply with: confirm
Or reply with: cancel
```

## Photo Message Behavior

For a photo with caption:

1. treat the caption as the main instruction
2. treat the attached photo as candidate media for the proposed operation
3. include photo presence in the preview
4. only download/store/write after confirmation

If a photo arrives without useful caption:

- ask what the image should be attached to
- do not guess

## Message Replacement Rule

If a pending clarification or confirmation exists and the user sends a fully new instruction, the bot should not silently mix old and new intent.

Recommended behavior:

- detect that the user is likely starting over
- discard the old pending operation
- start a new interpretation

This replacement should be explicit in the reply.

Example:

```text
I dropped the previous pending action and prepared a new proposal from your latest message.
```

## Minimal Reply Style

The bot should keep replies concise and operational.

Preferred tone:

- direct
- explicit
- preview-first
- low fluff

Avoid:

- overly chatty assistant style
- long explanations unless ambiguity requires it

## Initial First-Version Policy

For the first redesigned release, the bot should use this strict policy:

- one pending operation at a time
- text confirmation only
- no automatic writes
- no batch multi-entity operations in one message
- no automatic merge of multiple consecutive messages into one operation

This keeps behavior predictable and debuggable.

## Message Examples

### Example 1. Clear Create Request

User:

```text
Add a new participant card for Ivan Kotelnikov. He is focused on product, engineering, and community building. Mention that he helps shape direction and implementation plans.
```

Bot:

- extracts a participant create proposal
- generates slug
- previews fields
- waits for `confirm`

### Example 2. Ambiguous Delete Request

User:

```text
Delete the April announcement.
```

Bot:

```text
I found more than one possible April item. Which one should I delete?
```

### Example 3. Photo Plus Request

User:

- sends a photo with caption:

```text
Create a participant card for Ivan and use this photo as the main image.
```

Bot:

- extracts participant create proposal
- notes attached photo
- previews photo usage
- waits for `confirm`

### Example 4. Cancel

User:

```text
cancel
```

Bot:

```text
Cancelled. No files were changed.
```

## Implementation Consequence

This interaction model implies that the runtime must support:

- persistent pending state
- correlation between a chat and its pending operation
- model-driven extraction
- post-extraction validation
- confirmation before invoking the GitHub writer

## Next Step

The next redesign step is to define the LLM extraction contract: exact output schema, confidence behavior, and validation rules.

That contract is documented in `bot/LLM_EXTRACTION.md`.
