import test from "node:test";
import assert from "node:assert/strict";

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
      sourceLocale: "ru",
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
  assert.equal(result.item.sourceLocale, "ru");
});

test("maps project photoStagedPath when gallery is present but empty", () => {
  const result = mapCommandToContent({
    entity: "project",
    action: "update",
    fields: {
      slug: "systema-works",
      title: "SYSTEMA.WORKS",
      status: "active",
      stack: "Next.js",
      gallery: [],
      photoStagedPath: "assets/uploads/272981189/1002-photo.jpg",
      photoAlt: "SYSTEMA.WORKS",
      photoAction: "append",
    },
  });

  assert.deepEqual(result.item.photo, {
    src: "assets/uploads/272981189/1002-photo.jpg",
    alt: "SYSTEMA.WORKS",
  });
  assert.deepEqual(result.item.gallery, [{
    src: "assets/uploads/272981189/1002-photo.jpg",
    alt: "SYSTEMA.WORKS",
  }]);
});

test("maps locale-specific translation edits into translations block", () => {
  const result = mapCommandToContent({
    entity: "participant",
    action: "update",
    fields: {
      slug: "participant-ivan-kotelnikov",
      locale: "en",
      bio: "Builds the club in English.",
      role: "Founder",
    },
  });

  assert.deepEqual(result.item, {
    slug: "participant-ivan-kotelnikov",
    sourceLocale: "ru",
    translations: {
      en: {
        role: "Founder",
        bio: "Builds the club in English.",
      },
    },
    translationStatus: {
      en: "edited",
    },
  });
});

test("maps participant rich text into detailsHtml while keeping bio summary", () => {
  const result = mapCommandToContent({
    entity: "participant",
    action: "update",
    fields: {
      slug: "participant-ivan-kotelnikov",
      bio: "Builds the club.",
      detailsHtml: "<p><strong>Builds</strong> the club.</p><p><a href=\"https://t.me/ikotelnikov\">Telegram</a></p>",
    },
  });

  assert.deepEqual(result.item, {
    slug: "participant-ivan-kotelnikov",
    sourceLocale: "ru",
    bio: "Builds the club.",
    detailsHtml: "<p><strong>Builds</strong> the club.</p><p><a href=\"https://t.me/ikotelnikov\">Telegram</a></p>",
  });
});

test("promotes multiline participant bio into detailsHtml automatically", () => {
  const result = mapCommandToContent({
    entity: "participant",
    action: "update",
    fields: {
      slug: "participant-ivan-kotelnikov",
      bio: "First paragraph.\n\nSecond paragraph with https://example.com",
    },
  });

  assert.equal(result.item.bio, "First paragraph.\n\nSecond paragraph with https://example.com");
  assert.equal(result.item.detailsHtml, "<p>First paragraph.</p><p>Second paragraph with https://example.com</p>");
});

test("defaults project-linked announcement visibility out of meetings list", () => {
  const result = mapCommandToContent({
    entity: "announce",
    action: "create",
    fields: {
      slug: "airbnb-moja-ljubov-skozi-goda",
      date: "2026-04-17",
      title: "Airbnb: moja ljubov skvozi goda",
      place: "Online",
      format: "news",
      paragraphs: ["Update text"],
      projectSlugs: ["doveritelnoe-upravlenie-v-chernogorii"],
    },
  });

  assert.equal(result.item.showInMeetingsList, false);
});

test("keeps explicit meetings list visibility when provided", () => {
  const result = mapCommandToContent({
    entity: "announce",
    action: "update",
    fields: {
      slug: "airbnb-moja-ljubov-skozi-goda",
      projectSlugs: ["doveritelnoe-upravlenie-v-chernogorii"],
      showInMeetingsList: true,
    },
  });

  assert.equal(result.item.showInMeetingsList, true);
});
