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

test("merges translated object arrays by index instead of replacing whole arrays", () => {
  const localized = localizeContentNode({
    sourceLocale: "ru",
    metrics: [
      { label: "Участники", value: "10+", hint: "Русский hint" },
      { label: "Проекты", value: "20+", hint: "Еще один hint" },
    ],
    translations: {
      en: {
        metrics: [
          { label: "Participants" },
          { label: "Projects", hint: "English hint" },
        ],
      },
    },
  }, "en");

  assert.deepEqual(localized.metrics, [
    { label: "Participants", value: "10+", hint: "Русский hint" },
    { label: "Projects", value: "20+", hint: "English hint" },
  ]);
});

test("still replaces primitive arrays during localization", () => {
  const localized = localizeContentNode({
    sourceLocale: "ru",
    tags: ["один", "два", "три"],
    translations: {
      en: {
        tags: ["one", "two"],
      },
    },
  }, "en");

  assert.deepEqual(localized.tags, ["one", "two"]);
});

test("tracks which top-level fields were localized", () => {
  const localized = localizeContentNode({
    sourceLocale: "ru",
    title: "Русский заголовок",
    detailsHtml: "<p><strong>Жирный</strong> текст</p>",
    translations: {
      en: {
        title: "English title",
        detailsHtml: "<p><strong>Bold</strong> text</p>",
      },
    },
  }, "en");

  assert.equal(localized.__localizedLocale, "en");
  assert.equal(localized.__sourceLocale, "ru");
  assert.deepEqual(localized.__localizedKeys, ["title", "detailsHtml"]);
});
