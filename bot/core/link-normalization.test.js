import test from "node:test";
import assert from "node:assert/strict";

import { dedupeLinks } from "./link-normalization.js";
import { mapOperationToContent } from "./content-mapper.js";
import { applyTranslationToItem } from "./content-localization.js";

test("dedupeLinks keeps one canonical entry per URL and prefers a better label", () => {
  const deduped = dedupeLinks([
    { label: "instagram.com", href: "https://www.instagram.com/tatyana_nirman/", external: true },
    { label: "Instagram", href: "https://instagram.com/tatyana_nirman", external: true },
    { label: "Telegram", href: "https://t.me/airbnbtop", external: true },
    { label: "Telegram", href: "https://t.me/airbnbtop/", external: true },
  ]);

  assert.equal(deduped.length, 2);
  assert.deepEqual(deduped[0], {
    label: "Instagram",
    href: "https://instagram.com/tatyana_nirman",
    external: true,
  });
  assert.deepEqual(deduped[1], {
    label: "Telegram",
    href: "https://t.me/airbnbtop",
    external: true,
  });
});

test("mapOperationToContent dedupes equivalent links before saving", () => {
  const mapped = mapOperationToContent({
    entity: "project",
    action: "update",
    fields: {
      slug: "doveritelnoe-upravlenie-v-chernogorii",
      title: "Доверительное управление в Черногории",
      links: [
        { label: "Telegram", href: "https://t.me/airbnbtop", external: true },
        { label: "Telegram", href: "https://t.me/airbnbtop/", external: true },
        { label: "instagram.com", href: "https://www.instagram.com/tatyana_nirman/", external: true },
        { label: "Instagram", href: "https://instagram.com/tatyana_nirman", external: true },
      ],
    },
  });

  assert.equal(mapped.item.links.length, 2);
  assert.deepEqual(mapped.item.links, [
    { label: "Telegram", href: "https://t.me/airbnbtop", external: true },
    { label: "Instagram", href: "https://instagram.com/tatyana_nirman", external: true },
  ]);
});

test("applyTranslationToItem dedupes translated links", () => {
  const nextItem = applyTranslationToItem(
    "project",
    {
      slug: "doveritelnoe-upravlenie-v-chernogorii",
      sourceLocale: "ru",
      title: "Доверительное управление в Черногории",
      links: [
        { label: "Telegram", href: "https://t.me/airbnbtop", external: true },
      ],
      translations: {},
      translationStatus: {},
    },
    "en",
    {
      title: "Trust Management in Montenegro",
      links: [
        { label: "Telegram", href: "https://t.me/airbnbtop", external: true },
        { label: "Telegram", href: "https://t.me/airbnbtop/", external: true },
        { label: "instagram.com", href: "https://www.instagram.com/tatyana_nirman/", external: true },
        { label: "Instagram", href: "https://instagram.com/tatyana_nirman", external: true },
      ],
    },
    "machine"
  );

  assert.equal(nextItem.translations.en.links.length, 2);
  assert.deepEqual(nextItem.translations.en.links, [
    { label: "Telegram", href: "https://t.me/airbnbtop", external: true },
    { label: "Instagram", href: "https://instagram.com/tatyana_nirman", external: true },
  ]);
});
