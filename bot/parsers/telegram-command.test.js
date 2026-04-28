import test from "node:test";
import assert from "node:assert/strict";

import { CommandParseError } from "../domain/errors.js";
import { parseTelegramCommand } from "./telegram-command.js";

test("parses participant create command with block and list fields", () => {
  const parsed = parseTelegramCommand(`
/participant create
slug: participant-ivan-kotelnikov
handle: @ikotelnikov
name: Ivan Kotelnikov
role: Founder / Product / Engineering
location: Budva / Montenegro
tags: product, engineering, community
bio:
Builds the club and works on product and engineering tasks.
points:
- Can help shape product direction.
- Can review implementation plans.
- Can connect people around club operations.
link: Telegram | https://t.me/ikotelnikov
photoalt: Ivan Kotelnikov at a club meeting
  `);

  assert.equal(parsed.entity, "participant");
  assert.equal(parsed.action, "create");
  assert.equal(parsed.fields.slug, "participant-ivan-kotelnikov");
  assert.equal(parsed.fields.bio, "Builds the club and works on product and engineering tasks.");
  assert.deepEqual(parsed.fields.points, [
    "Can help shape product direction.",
    "Can review implementation plans.",
    "Can connect people around club operations.",
  ]);
  assert.deepEqual(parsed.fields.tags, ["product", "engineering", "community"]);
  assert.deepEqual(parsed.fields.link, [
    {
      label: "Telegram",
      href: "https://t.me/ikotelnikov",
      external: true,
    },
  ]);
});

test("parses meeting create command with repeated sections", () => {
  const parsed = parseTelegramCommand(`
/meeting create
slug: meeting-2026-03-open-circle
date: 2026-03-19
title: Open project circle and introductions
place: Budva
format: offline / introductions
paragraphs:
- We met to introduce new participants and share project updates.
- Several MVPs were discussed together with growth blockers and asks.
section: What we discussed
- New participant introductions
- Product blockers
section: Useful next formats
- More review evenings
photoalt: Participants during the March meeting
  `);

  assert.equal(parsed.entity, "meeting");
  assert.equal(parsed.action, "create");
  assert.deepEqual(parsed.fields.paragraphs, [
    "We met to introduce new participants and share project updates.",
    "Several MVPs were discussed together with growth blockers and asks.",
  ]);
  assert.deepEqual(parsed.fields.section, [
    {
      title: "What we discussed",
      items: ["New participant introductions", "Product blockers"],
    },
    {
      title: "Useful next formats",
      items: ["More review evenings"],
    },
  ]);
});

test("parses participant create command with detailshtml block", () => {
  const parsed = parseTelegramCommand(`
/participant create
slug: participant-ivan-kotelnikov
handle: @ikotelnikov
name: Ivan Kotelnikov
role: Founder / Product / Engineering
bio:
Builds the club.
detailshtml:
<p><strong>Builds</strong> the club.</p>
points:
- Can help shape product direction.
  `);

  assert.equal(parsed.fields.detailsHtml, "<p><strong>Builds</strong> the club.</p>");
});

test("rejects unknown field", () => {
  assert.throws(
    () =>
      parseTelegramCommand(`
/project create
slug: project-club-site-bot
title: Club site content bot
status: prototype in progress
stack: telegram / github actions / static site
points:
- Parses commands
unknown: value
      `),
    (error) =>
      error instanceof CommandParseError &&
      error.message === "Unknown field 'unknown' for project create."
  );
});

test("rejects delete commands with extra fields", () => {
  assert.throws(
    () =>
      parseTelegramCommand(`
/participant delete
slug: participant-ivan-kotelnikov
name: Ivan Kotelnikov
      `),
    (error) =>
      error instanceof CommandParseError &&
      error.message === "Unknown field 'name' for participant delete."
  );
});

test("rejects invalid slug", () => {
  assert.throws(
    () =>
      parseTelegramCommand(`
/announce create
slug: Announce_Invalid
date: 2026-04-03 19:00
title: Review evening
place: Budva
format: offline
paragraphs:
- One paragraph
      `),
    (error) =>
      error instanceof CommandParseError &&
      error.message === "Field 'slug' must use lowercase letters, numbers, and hyphens only."
  );
});
