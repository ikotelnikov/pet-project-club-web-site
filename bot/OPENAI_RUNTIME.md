# OpenAI Runtime Contract

This document defines how the redesigned bot runtime should call OpenAI and how the model output should be validated and handled.

It sits on top of `bot/LLM_EXTRACTION.md`, which defines the extraction schema itself.

## Purpose

The OpenAI runtime layer is responsible for:

- building the model input
- choosing the model
- sending the request
- validating the response
- retrying safe failures
- returning either a valid structured extraction or a safe fallback outcome

The model is an interpreter, not an autonomous actor.

## Required Environment Variables

The runtime uses:

- `OPENAI_API_KEY`
- optional `OPENAI_MODEL`

These are defined in `bot/ENVIRONMENT.md`.

## Model Choice

The runtime should not hardcode a model name directly into business logic.

Rules:

- if `OPENAI_MODEL` is set, use it
- otherwise use a code-level default chosen during implementation

First-version requirement:

- choose one model optimized for structured extraction and instruction following
- keep the choice configurable through `OPENAI_MODEL`

## Request Role

The OpenAI call is for structured extraction only.

It is not for:

- free-form chat
- final user-facing prose generation
- direct file generation
- direct GitHub write planning beyond the extraction schema

## Input Assembly

Before calling OpenAI, the runtime should build a normalized request object containing:

- current message text
- whether a photo is attached
- current pending state summary
- allowed entities
- allowed actions
- current known write constraints

Recommended normalized input shape:

```json
{
  "messageText": "Add a participant card for Ivan.",
  "hasPhoto": false,
  "photoCount": 0,
  "pendingState": null,
  "allowedEntityTypes": [
    "announcement",
    "meeting",
    "participant",
    "project"
  ],
  "allowedActions": [
    "create",
    "update",
    "delete"
  ]
}
```

## System Prompt Contract

The system prompt must enforce these rules:

- return JSON only
- follow the extraction schema exactly
- never output extra prose
- never invent unsupported entity types
- never invent unsupported actions
- prefer one focused clarification question over guessing
- never indicate that confirmation can be skipped
- do not propose multiple operations for one message
- keep warnings concise and factual

The system prompt should explicitly explain:

- the bot is owner-only
- the response is consumed by software, not shown raw to the user
- invalid JSON is a failure

## Response Format Requirement

The runtime must require structured JSON output.

The model response should be parsed as JSON and validated against the extraction contract in `bot/LLM_EXTRACTION.md`.

If the response is not valid JSON:

- treat it as extraction failure

## Validation Pipeline

After receiving a model response, the runtime should validate in this order:

1. response exists
2. response is valid JSON
3. top-level required fields exist
4. enum values are allowed
5. `fields`, `questions`, and `warnings` have correct shapes
6. entity-specific field keys are allowed
7. `slug` matches slug rules if present
8. `content_operation` has `needsConfirmation = true`
9. low-confidence outputs include at least one question

Only after validation succeeds may the runtime continue into preview or clarification flow.

## Retry Policy

The runtime should retry only when retry is safe and likely to help.

Retry once for:

- non-JSON response
- malformed JSON
- schema-shape mismatch caused by formatting drift

Do not retry for:

- clearly low-confidence extraction
- valid extraction that asks for clarification
- explicit non-actionable result

First-version recommendation:

- maximum 1 retry per incoming message

## Retry Strategy

If retry is needed:

- reuse the same normalized input
- strengthen the instruction that the response must be JSON only
- mention that the previous response failed schema validation

If the second attempt still fails:

- stop
- return a safe fallback response to the user

## Safe Fallback Behavior

If extraction fails after retry:

- do not write
- do not preview a fake operation
- respond with a short operational error

Recommended fallback reply:

```text
I could not safely interpret that message into a content action. Please rephrase it more explicitly.
```

If a pending clarification or confirmation existed:

- do not silently destroy it unless the new message clearly replaces it

## Clarification Handling

If the validated model output has:

- `intent = content_operation`
- `confidence = low`
- at least one question

Then the runtime should:

- store `awaiting_clarification`
- ask only the first question

The runtime should not ask multiple questions at once in version one.

## Confirmation Handling

If the validated model output has:

- `intent = content_operation`
- `confidence = high` or `medium`

Then the runtime should:

- normalize the proposal into runtime operation shape
- compute preview file targets
- persist `awaiting_confirmation`
- send the preview

## Confirmation Response Shortcut

The runtime does not need to use OpenAI for trivial `confirm` and `cancel` detection if direct exact-match logic is simpler.

First-version recommendation:

- handle exact `confirm` and `cancel` locally before calling OpenAI

This reduces cost and ambiguity.

Similarly, exact no-op small messages like empty text can be handled before model invocation.

## Clarification Response Shortcut

The runtime may later decide to merge clarification replies with pending state without another full OpenAI call in some cases.

First-version recommendation:

- allow clarification replies to go through OpenAI for consistency
- keep the option to optimize later

## Logging Policy

The runtime should log:

- that an extraction attempt happened
- model name used
- whether validation passed
- whether retry happened
- final intent outcome

The runtime must not log:

- secrets
- raw API keys
- full unnecessary personal data beyond operational need

## Cost Control

The runtime should avoid unnecessary model calls.

First-version rules:

- skip model call for exact `confirm`
- skip model call for exact `cancel`
- skip model call for obviously empty messages
- use a single extraction call plus at most one retry

## Suggested Runtime Interface

The OpenAI runtime layer should expose something like:

```text
extractIntent(input) -> {
  ok: true,
  extraction: ...
}
```

or

```text
extractIntent(input) -> {
  ok: false,
  reason: "validation_failed"
}
```

Suggested richer result shape:

```json
{
  "ok": true,
  "usedModel": "configured-model-name",
  "attempts": 1,
  "extraction": {}
}
```

Failure shape:

```json
{
  "ok": false,
  "usedModel": "configured-model-name",
  "attempts": 2,
  "reason": "validation_failed"
}
```

## First-Version Implementation Choice

For the first redesign implementation:

- one configured extraction model
- JSON-only response contract
- runtime validation against `bot/LLM_EXTRACTION.md`
- one retry on malformed/invalid structured output
- direct local handling for exact `confirm` and `cancel`
- safe fallback instead of guessing

## Next Step

The next redesign step is to define the webhook/runtime implementation plan itself: Cloudflare Worker entrypoints, Telegram webhook verification, local dev mode, and how the runtime layers will be separated in code.

That implementation plan is documented in `bot/RUNTIME_PLAN.md`.
