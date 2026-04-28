# Agent Guidelines

## Delivery Rule

For this repository, default to pushing completed changes to the remote branch after implementation and basic verification, unless the user explicitly says not to push.
The user checks changes on production, so "done" should normally include push, not only local edits.

## LLM-First Design Rule

When building or refactoring any user-intent pipeline, default to an LLM-first architecture.

Required order of operations:
1. Collect the full user turn, including nearby messages, attachments, quotes, and formatting.
2. Ask the LLM to determine intent, primary target entity, related entities, and whether clarification is needed.
3. Resolve referenced objects deterministically against the repository.
4. Ask the LLM to generate a structured operation or patch using the resolved targets and schema.
5. Validate and apply with deterministic code.

## Heuristic Restrictions

Do not add regex, substring, keyword, or other heuristic intent-routing logic unless all of the following are true:
- it is strictly syntax-level parsing, not semantic understanding
- it cannot override explicit user intent in message text
- it cannot choose the target entity or target object when more than one entity is mentioned
- it is documented as a bounded fallback
- there is a test proving it does not hijack cross-entity requests

Heuristics are allowed only for:
- slash-command parsing
- confirmation/cancel/undo control messages
- attachment staging
- schema validation
- repository lookup
- ambiguity detection after LLM intent analysis

Heuristics are not allowed for:
- inferring the primary entity from keywords
- deciding whether a message is a continuation of the last object
- auto-linking objects from recent context
- deciding photo actions from wording alone
- choosing between multiple object types in mixed requests

## Context Rule

Recent context is advisory only.
It must never override an explicit entity, slug, title, or relation named by the user.

If the user mentions multiple entities, treat this as a relation-aware request and let the LLM decide:
- the primary target
- the related entities
- the intended operation

## Update Rule

For updates, prefer patch generation over full-object regeneration.
- `create` may return a full object
- `update` must return a patch
- `delete` must return a delete operation
- `translate` must return an explicit translation operation

## Clarification Rule

If target resolution is ambiguous or incomplete:
- do not guess
- do not fall back to recent-entity heuristics
- ask a clarification question from structured state

## Anti-Frankenstein Rule

Before adding any new heuristic branch, ask:
- Why can the LLM intent stage not handle this?
- Is this syntax parsing or semantic guessing?
- Could this override explicit user wording?
- Could this create different behavior for single-entity vs cross-entity requests?
- Is there a failing test that demonstrates the need?

If the answer depends on semantic interpretation, implement it in the LLM intent/operation pipeline, not in regex or keyword routing.

## Test Requirement

Every change to message understanding must include at least one regression test for:
- explicit target beats recent context
- mixed-entity request is routed to the correct primary target
- ambiguous target produces clarification instead of silent guess
