# Bot Schemas

This folder contains machine-oriented schema contracts for the staged LLM bot flow.

Purpose:

- define canonical entity field sets in one place
- define staged LLM outputs separately from content item shapes
- keep prompt inputs aligned with runtime validation

The files here are intentionally compact and JSON-shaped so they can be:

- inspected in GitHub
- reused in prompts
- mirrored by runtime validators

Current groups:

- entity schemas:
  - `participant.json`
  - `project.json`
  - `meeting.json`
  - `announcement.json`
- staged operation schemas:
  - `intent-stage.json`
  - `target-resolution-stage.json`
  - `field-normalization-stage.json`
  - `final-operation-stage.json`

The human-readable content contract still lives in [content/SCHEMAS.md](/C:/Users/ikotelnikov/Documents/GitHub/pet-project-club-web-site/content/SCHEMAS.md).
