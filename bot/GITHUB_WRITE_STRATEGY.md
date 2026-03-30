# GitHub Write Strategy

This document defines how the redesigned bot writes confirmed changes into the repository.

The goal is to make confirmed writes predictable, auditable, and simple enough for the first production release.

## First-Version Decision

The bot will write directly to the configured target branch.

Initial branch:

- `main`

This decision is acceptable because:

- the bot is owner-only
- every write requires explicit confirmation
- the repo is already the content source of truth

Possible later upgrade:

- create a branch and open a PR instead of direct commit

## Write Trigger

A GitHub write is allowed only when all of these are true:

- the message came from the authorized Telegram user
- the message or clarification flow produced a valid structured proposal
- the bot showed a preview
- the user explicitly replied with `confirm`
- a matching pending confirmation state still exists

If any of these fail:

- no GitHub write must happen

## Write Scope

The bot may only write files related to content and assets.

Allowed content targets:

- `content/meetings/items/*.json`
- `content/meetings/announcements/index.json`
- `content/meetings/archive/index.json`
- `content/participants/items/*.json`
- `content/participants/index.json`
- `content/projects/items/*.json`
- `content/projects/index.json`

Allowed asset targets:

- `assets/meetings/*`
- `assets/participants/*`
- `assets/projects/*`

The bot must not modify:

- layout HTML
- frontend JS/CSS
- workflows
- documentation
- unrelated repo files

## Repository Target Parameters

The runtime uses:

- `GITHUB_REPO_OWNER`
- `GITHUB_REPO_NAME`
- `GITHUB_BRANCH`
- `GITHUB_WRITE_TOKEN`

These are defined in `bot/ENVIRONMENT.md`.

## Runtime Write Model

After confirmation, the runtime should:

1. load the current target branch tip
2. read any files that need to be changed
3. compute the exact new file contents
4. upload any confirmed media assets
5. commit all related file changes together
6. report success or failure back to Telegram

The write should be atomic from the bot user's perspective:

- either all related files are committed together
- or no partial repo state should be left behind

## Supported Operations

The GitHub writer must support:

- create item
- update item
- delete item
- insert/remove slug from index
- create/update asset file for confirmed photos

## Create Behavior

On create:

- the target item file must not already exist
- the slug must be inserted into the correct index
- first-version ordering rule: prepend new items to the relevant index

Examples:

- new participant goes to the top of `content/participants/index.json`
- new project goes to the top of `content/projects/index.json`
- new announcement goes to the top of `content/meetings/announcements/index.json`
- new archived meeting goes to the top of `content/meetings/archive/index.json`

## Update Behavior

On update:

- the target item file must already exist
- the item file is replaced with the new validated document
- if the slug is missing from the index, reinsert it at the top

First version simplification:

- update is full-document replacement, not field patching

## Delete Behavior

On delete:

- the target item file must already exist
- the slug must be removed from the relevant index
- the item file must be deleted

First version media policy:

- do not automatically delete old asset files on delete

Reason:

- safer than trying to infer asset reuse
- avoids accidental deletion of shared or manually referenced media

Possible later upgrade:

- garbage-collect unreferenced bot-managed assets

## Asset Write Behavior

Confirmed photo writes should follow this flow:

1. fetch the Telegram file after confirmation
2. derive canonical asset filename from slug
3. write asset into the correct `assets/` folder
4. reference the asset path from the JSON item

Rules:

- no permanent asset write before confirmation
- first version supports one primary photo per operation
- filename should remain deterministic for the same slug

Examples:

- `assets/participants/participant-ivan-kotelnikov-01.jpg`
- `assets/projects/project-club-site-bot-01.jpg`
- `assets/meetings/meeting-2026-04-builder-circle-01.jpg`

## Commit Strategy

Each confirmed operation should create one Git commit.

Reason:

- easy audit trail
- easy rollback if needed
- direct mapping from Telegram action to repository history

## Commit Message Format

First-version commit message format:

```text
bot: <action> <entity> <slug>
```

Examples:

- `bot: create participant participant-ivan-kotelnikov`
- `bot: update project project-club-site-bot`
- `bot: delete announcement announce-2026-04-product-review`

Optional body lines may include:

- Telegram chat ID
- Telegram message ID
- note that the change was user-confirmed

Example:

```text
bot: create participant participant-ivan-kotelnikov

confirmed via Telegram
chat: 272981189
message: 143
```

## Commit Identity

The bot should use a distinct git identity through the GitHub API commit metadata.

Recommended values:

- name: `Pet Project Club Bot`
- email: `bot@petproject.club`

If the chosen GitHub API path does not expose custom commit identity easily, use a consistent machine identity.

## Failure Handling

If a GitHub write fails:

- keep the pending state only if retry is still safe
- otherwise delete pending state and report failure clearly

The bot reply should include:

- that no website content was changed
- the high-level reason
- whether the user should retry

Example:

```text
Write failed. No repository changes were applied.
Reason: GitHub API rejected the commit.
You can retry after fixing the issue.
```

## Conflict Handling

The runtime must assume the repository can change between preview and confirmation.

Examples:

- someone manually edited the same item
- branch tip moved after preview

First-version conflict policy:

- re-read repository state at confirmation time
- recompute write payload against latest branch state
- if the confirmed target is no longer safe, abort and ask the user to retry

The bot must not blindly overwrite conflicting content without revalidation.

## Idempotency Considerations

The runtime should avoid duplicate writes caused by repeated confirmations or webhook retries.

Minimum rule:

- once a pending confirmation is successfully written, delete the pending state immediately

Optional later improvement:

- persist the last successful operation ID and ignore duplicate confirms

## Success Reply

After a successful write, the bot should reply with a concise summary:

- entity
- action
- slug
- files changed
- commit reference if available

Example:

```text
Done.

Action: create participant
Slug: participant-ivan-kotelnikov
Files changed: 2
Commit: abc1234
```

## Preview Consistency Rule

The preview shown before confirmation should be based on the same operation structure that will later be written.

If the runtime has to materially change the operation before writing:

- it must generate a new preview
- it must require confirmation again

## GitHub API Approach

The runtime should use GitHub API rather than shelling out to git in production.

Reason:

- better fit for serverless runtime
- no local repository checkout required
- easier secret scoping through API token

Expected capabilities:

- read file contents by path and branch
- create/update/delete files
- create commit with message

## First-Version Implementation Choice

For the first redesign implementation:

- direct commit to `main`
- one commit per confirmed operation
- full-document item replacement on update
- prepend new slugs to indexes
- no automatic asset deletion on item delete
- abort on detected conflicts rather than force overwrite

## Next Step

The next redesign step is to define the concrete OpenAI prompt/runtime contract: how the worker will call the API, how the system prompt is structured, and how validation and retries are handled around the model call.

That runtime contract is documented in `bot/OPENAI_RUNTIME.md`.
