import test from "node:test";
import assert from "node:assert/strict";

import { ContentValidationError } from "../domain/errors.js";
import { mapCommandToContent } from "./content-mapper.js";

test("maps participant command to canonical participant JSON", () => {
  const result = mapCommandToContent({
    entity: "participant",
    action: "create",
    fields: {
      slug: "participant-ivan-kotelnikov",
      handle: "@ikotelnikov",
      name: "Ivan Kotelnikov",
      role: "Founder / Product / Engineering",
      bio: "Builds the club.",
      points: ["One", "Two"],
      location: "Budva / Montenegro",
      tags: ["product", "community"],
      link: [{ label: "Telegram", href: "https://t.me/ikotelnikov", external: true }],
    },
  });

  assert.deepEqual(result, {
    slug: "participant-ivan-kotelnikov",
    item: {
      slug: "participant-ivan-kotelnikov",
      handle: "@ikotelnikov",
      name: "Ivan Kotelnikov",
      role: "Founder / Product / Engineering",
      bio: "Builds the club.",
      points: ["One", "Two"],
      links: [{ label: "Telegram", href: "https://t.me/ikotelnikov", external: true }],
      location: "Budva / Montenegro",
      tags: ["product", "community"],
    },
  });
});

test("maps project owners to ownerSlugs", () => {
  const result = mapCommandToContent({
    entity: "project",
    action: "create",
    fields: {
      slug: "project-club-site-bot",
      title: "Club site bot",
      status: "prototype",
      stack: "telegram / github actions",
      points: ["One"],
      owners: ["participant-ivan-kotelnikov"],
    },
  });

  assert.deepEqual(result.item.ownerSlugs, ["participant-ivan-kotelnikov"]);
});

test("rejects photo alt without photo file", () => {
  assert.throws(
    () =>
      mapCommandToContent({
        entity: "meeting",
        action: "create",
        fields: {
          slug: "meeting-2026-03-open-circle",
          date: "2026-03-19",
          title: "Open circle",
          place: "Budva",
          format: "offline",
          paragraphs: ["One"],
          photoalt: "Alt text",
        },
      }),
    (error) =>
      error instanceof ContentValidationError &&
      error.message === "Photo alt text is present, but no photo file has been provided."
  );
});
