import test from "node:test";
import assert from "node:assert/strict";

import {
  localizeContentNode,
  mergeContentItems,
} from "./content-localization.js";

test("overlays translated locale fields onto source content", () => {
  const localized = localizeContentNode({
    slug: "meeting-1",
    sourceLocale: "ru",
    title: "Русский заголовок",
    photo: {
      src: "assets/meetings/example.jpg",
      alt: "Русский alt",
    },
    translations: {
      en: {
        title: "English title",
        photo: {
          alt: "English alt",
        },
      },
    },
  }, "en");

  assert.equal(localized.title, "English title");
  assert.equal(localized.photo.src, "assets/meetings/example.jpg");
  assert.equal(localized.photo.alt, "English alt");
  assert.equal(localized.sourceLocale, "ru");
});

test("marks machine translations stale when source text changes", () => {
  const merged = mergeContentItems(
    {
      slug: "project-1",
      sourceLocale: "ru",
      title: "Старый текст",
      translations: {
        en: {
          title: "Old text",
        },
        de: {
          title: "Alter Text",
        },
      },
      translationStatus: {
        en: "machine",
        de: "edited",
      },
    },
    {
      slug: "project-1",
      sourceLocale: "ru",
      title: "Новый текст",
    },
    { entity: "project" }
  );

  assert.equal(merged.translationStatus.en, "stale");
  assert.equal(merged.translationStatus.de, "edited");
});
