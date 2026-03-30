# LLM Extraction Contract

This document defines the contract between the Telegram bot runtime and the OpenAI extraction layer.

The model is allowed to propose structure.
The runtime is responsible for validation, confirmation, and writing.

## Purpose

The extraction layer converts normal Telegram input into a structured proposal that can be:

- previewed to the user
- clarified if incomplete
- confirmed before write

The model output must never be treated as trusted final data without validation.

## Extraction Input

The runtime should provide the model with a normalized input object that includes:

- `messageText`
- `hasPhoto`
- `photoCount`
- `pendingState`
- `knownEntitiesSummary`
- `allowedEntityTypes`
- `allowedActions`

First version guidance:

- `messageText` is the main source of meaning
- `hasPhoto` is a boolean flag for attached media
- `pendingState` is either `null`, `awaiting_clarification`, or `awaiting_confirmation`
- `knownEntitiesSummary` may later contain slugs/titles for matching deletes or updates

## Allowed Entities

The model may only produce one of:

- `announcement`
- `meeting`
- `participant`
- `project`

Internal runtime mapping:

- `announcement` maps to storage type `announce`
- all other entity names are the same in runtime and storage

## Allowed Actions

The model may only produce one of:

- `create`
- `update`
- `delete`

First version restriction:

- only one action per message
- only one entity per message

## Required Output Shape

The model must return JSON only.

Top-level shape:

```json
{
  "intent": "content_operation",
  "entity": "participant",
  "action": "create",
  "slug": "participant-ivan-kotelnikov",
  "confidence": "high",
  "needsConfirmation": true,
  "summary": "Create a participant card for Ivan Kotelnikov.",
  "fields": {},
  "questions": [],
  "warnings": []
}
```

## Top-Level Fields

### `intent`

Required.

Allowed values:

- `content_operation`
- `clarification_response`
- `confirmation_response`
- `non_actionable`

First version focus:

- the main path we implement first is `content_operation`
- `confirmation_response` is also important for the pending confirmation flow

### `entity`

Required for `content_operation`.

Allowed values:

- `announcement`
- `meeting`
- `participant`
- `project`

Must be omitted or `null` for `non_actionable`.

### `action`

Required for `content_operation`.

Allowed values:

- `create`
- `update`
- `delete`

Must be omitted or `null` for `non_actionable`.

### `slug`

Required for:

- `update`
- `delete`

Recommended for:

- `create`

Rules:

- lowercase letters, numbers, hyphens only
- if the model is not confident in the slug, it should still provide the best candidate but add a warning

### `confidence`

Required.

Allowed values:

- `high`
- `medium`
- `low`

Meaning:

- `high`: message is clear enough for preview
- `medium`: likely correct but preview should mention uncertainty
- `low`: clarification required before preview

### `needsConfirmation`

Required.

Rules:

- for any `content_operation`, this must be `true`
- the model must never signal that confirmation can be skipped

### `summary`

Required.

Purpose:

- short human-readable one-line explanation of what the model thinks the user wants

### `fields`

Required for `content_operation`.

Must be an object.

For `delete`, this may be empty.

### `questions`

Required.

Must be an array of strings.

Rules:

- if `confidence` is `low`, at least one question should be present
- each question should be focused and answerable in one reply
- first version runtime should ask only the first question

### `warnings`

Required.

Must be an array of strings.

Use warnings for cases like:

- inferred slug may need review
- date was normalized from natural language
- update target matched from weak context

## Entity Field Contracts

The model must produce fields compatible with the canonical content schemas in `content/SCHEMAS.md`.

### Announcement Fields

Allowed `fields` keys:

- `date`
- `title`
- `place`
- `placeUrl`
- `format`
- `paragraphs`
- `sections`
- `links`
- `photoAlt`

Rules:

- `paragraphs` must be an array of strings
- `sections` must be an array of `{ "title", "items" }`
- `links` must be an array of `{ "label", "href", "external" }`
- `photoAlt` is only relevant if the message contains a photo

### Meeting Fields

Allowed `fields` keys:

- `date`
- `title`
- `place`
- `placeUrl`
- `format`
- `paragraphs`
- `sections`
- `links`
- `photoAlt`

### Participant Fields

Allowed `fields` keys:

- `handle`
- `name`
- `role`
- `bio`
- `points`
- `location`
- `tags`
- `links`
- `photoAlt`

### Project Fields

Allowed `fields` keys:

- `title`
- `status`
- `stack`
- `summary`
- `points`
- `location`
- `tags`
- `ownerSlugs`
- `links`
- `photoAlt`

## Delete Extraction Rules

Delete is dangerous, so the extraction layer must be conservative.

Rules:

- if delete target is not explicit enough, lower confidence
- if the model is unsure between multiple candidates, ask a clarification question
- do not invent a slug when several different items could match

Example acceptable output:

```json
{
  "intent": "content_operation",
  "entity": "announcement",
  "action": "delete",
  "slug": "announce-2026-04-product-review",
  "confidence": "medium",
  "needsConfirmation": true,
  "summary": "Delete the April product review announcement.",
  "fields": {},
  "questions": [],
  "warnings": [
    "Slug was inferred from title reference rather than stated explicitly."
  ]
}
```

Example low-confidence output:

```json
{
  "intent": "content_operation",
  "entity": "announcement",
  "action": "delete",
  "slug": null,
  "confidence": "low",
  "needsConfirmation": true,
  "summary": "The user wants to delete an April announcement, but the target is ambiguous.",
  "fields": {},
  "questions": [
    "Which announcement should I delete?"
  ],
  "warnings": []
}
```

## Clarification Response Extraction

If the runtime is in `awaiting_clarification`, the model may return:

```json
{
  "intent": "clarification_response",
  "entity": null,
  "action": null,
  "slug": null,
  "confidence": "high",
  "needsConfirmation": true,
  "summary": "The user answered the bot's clarification question.",
  "fields": {
    "answer": "Use Budva as the place."
  },
  "questions": [],
  "warnings": []
}
```

First version note:

- we may choose to handle clarification replies mostly outside the model later
- but the schema should allow this path

## Confirmation Response Extraction

If the user sends a short message like `confirm` or `cancel`, the model may return:

```json
{
  "intent": "confirmation_response",
  "entity": null,
  "action": null,
  "slug": null,
  "confidence": "high",
  "needsConfirmation": false,
  "summary": "The user confirmed the pending operation.",
  "fields": {
    "decision": "confirm"
  },
  "questions": [],
  "warnings": []
}
```

Allowed `decision` values:

- `confirm`
- `cancel`

## Non-Actionable Output

If the message should not trigger a content workflow:

```json
{
  "intent": "non_actionable",
  "entity": null,
  "action": null,
  "slug": null,
  "confidence": "high",
  "needsConfirmation": false,
  "summary": "The message does not request a content change.",
  "fields": {},
  "questions": [],
  "warnings": []
}
```

## Runtime Validation Rules

The runtime must validate model output before using it.

Required runtime checks:

- output is valid JSON
- top-level fields exist
- `intent`, `entity`, `action`, and `confidence` are in allowed enums
- `fields`, `questions`, and `warnings` have the correct shapes
- `slug` matches slug rules when present
- entity-specific fields match allowed keys
- arrays contain the expected primitive/object shapes
- `content_operation` always has `needsConfirmation = true`

If validation fails:

- do not write
- do not preview
- return a safe fallback message or retry extraction

## Prompting Rules

The model prompt should explicitly instruct:

- do not return prose outside JSON
- do not invent missing required details when confidence is low
- prefer asking one focused question over hallucinating values
- do not emit unsupported entity types or actions
- do not ever imply auto-write without confirmation

## First-Version Runtime Policy

The runtime should interpret extraction results like this:

- `intent = non_actionable`: ignore or send a short help message
- `intent = confirmation_response`: apply to pending proposal only
- `intent = clarification_response`: use to continue pending question flow
- `intent = content_operation` with `confidence = low`: ask first question
- `intent = content_operation` with `confidence = medium/high`: build preview and wait for confirmation

## Example High-Confidence Participant Create

```json
{
  "intent": "content_operation",
  "entity": "participant",
  "action": "create",
  "slug": "participant-ivan-kotelnikov",
  "confidence": "high",
  "needsConfirmation": true,
  "summary": "Create a participant card for Ivan Kotelnikov.",
  "fields": {
    "handle": "@ikotelnikov",
    "name": "Ivan Kotelnikov",
    "role": "Founder / Product / Engineering",
    "bio": "Builds the club and works on product and engineering tasks.",
    "points": [
      "Can help shape direction.",
      "Can review implementation plans.",
      "Can connect people around club operations."
    ],
    "location": "Budva / Montenegro",
    "tags": [
      "product",
      "engineering",
      "community"
    ]
  },
  "questions": [],
  "warnings": []
}
```

## Example Medium-Confidence Project Update With Photo

```json
{
  "intent": "content_operation",
  "entity": "project",
  "action": "update",
  "slug": "project-club-site-bot",
  "confidence": "medium",
  "needsConfirmation": true,
  "summary": "Update the club site bot project and attach the provided photo.",
  "fields": {
    "title": "Club site content bot",
    "status": "webhook redesign in progress",
    "stack": "telegram / cloudflare workers / openai / github pages",
    "summary": "Bot redesign now targets webhook delivery and AI-assisted confirmation.",
    "points": [
      "Switch from polling to webhook runtime.",
      "Use OpenAI to interpret normal text.",
      "Confirm every write before GitHub update."
    ],
    "photoAlt": "Architecture notes for the club bot redesign"
  },
  "questions": [],
  "warnings": [
    "Project slug was inferred from project name reference."
  ]
}
```

## Next Step

The next redesign step is to define pending confirmation state and storage: what exactly gets persisted between Telegram messages and how long those pending operations live.

That state model is documented in `bot/PENDING_STATE.md`.
