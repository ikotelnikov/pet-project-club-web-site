import test from "node:test";
import assert from "node:assert/strict";

import { resolvePendingTranslationLocales, runPostConfirmationTranslations } from "./post-confirmation-translation.js";

test("resolvePendingTranslationLocales skips manually edited locales", () => {
  const locales = resolvePendingTranslationLocales(
    {
      translations: {
        en: {
          title: "Translated",
        },
      },
      translationStatus: {
        en: "machine",
        de: "edited",
        me: "stale",
      },
    },
    "ru"
  );

  assert.deepEqual(locales, ["me", "es"]);
});

test("resolvePendingTranslationLocales requeues locales with missing machine payloads", () => {
  const locales = resolvePendingTranslationLocales(
    {
      translationStatus: {
        en: "machine",
        me: "machine",
        es: "edited",
      },
      translations: {
        en: {
          title: "Translated",
        },
      },
    },
    "ru"
  );

  assert.deepEqual(locales, ["de", "me"]);
});

test("runPostConfirmationTranslations sends one summary for all auto locales and reads item once", async () => {
  const writes = [];
  const messages = [];
  let reads = 0;
  const item = {
    slug: "presentation-creometrix-0804",
    sourceLocale: "ru",
    title: "Исходный текст",
    paragraphs: ["Абзац 1"],
    translationStatus: {
      en: "stale",
      de: "edited",
      me: "machine",
    },
    translations: {
      me: {
        title: "Vec postoji",
      },
      de: {
        title: "Manuell",
      },
    },
  };
  const repository = {
    async readItem() {
      reads += 1;
      return structuredClone(item);
    },
    async applyCommand(parsedCommand, payload) {
      item.translations = payload.item.translations;
      item.translationStatus = payload.item.translationStatus;
      writes.push({
        locale: Object.keys(payload.item.translations || {}).slice(-1)[0] || null,
        parsedCommand,
      });

      return {
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        commitSha: `commit-${writes.length}`,
      };
    },
  };
  const translationClient = {
    async translateFields({ targetLocale }) {
      return {
        title: `translated-${targetLocale}`,
      };
    },
  };
  const telegramClient = {
    async sendMessage({ text }) {
      messages.push(text);
    },
  };

  await runPostConfirmationTranslations({
    repository,
    translationClient,
    telegramClient,
    chatId: 1,
    entity: "announce",
    slug: "presentation-creometrix-0804",
    sourceLocale: "ru",
    siteBaseUrl: "https://example.com",
  });

  assert.equal(writes.length, 2);
  assert.equal(reads, 1);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Translations updated:/);
  assert.match(messages[0], /- en: https:\/\/example\.com\/en\/meetings\/presentation-creometrix-0804\//);
  assert.match(messages[0], /- es: https:\/\/example\.com\/es\/meetings\/presentation-creometrix-0804\//);
});

test("runPostConfirmationTranslations sends one combined failure summary", async () => {
  const writes = [];
  const messages = [];
  const item = {
    slug: "presentation-creometrix-0804",
    sourceLocale: "ru",
    title: "Исходный текст",
    paragraphs: ["Абзац 1"],
    translationStatus: {
      en: "stale",
      me: "stale",
    },
    translations: {},
  };
  const repository = {
    async readItem() {
      return structuredClone(item);
    },
    async applyCommand(parsedCommand, payload) {
      item.translations = payload.item.translations;
      item.translationStatus = payload.item.translationStatus;
      writes.push(Object.keys(payload.item.translations || {}).slice(-1)[0] || null);

      return {
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        commitSha: `commit-${writes.length}`,
      };
    },
  };
  const translationClient = {
    async translateFields({ targetLocale }) {
      return {
        title: `translated-${targetLocale}`,
      };
    },
  };
  const telegramClient = {
    async sendMessage({ text }) {
      messages.push(text);
    },
  };

  await runPostConfirmationTranslations({
    repository,
    translationClient,
    telegramClient,
    chatId: 1,
    entity: "announce",
    slug: "presentation-creometrix-0804",
    sourceLocale: "ru",
    targetLocales: ["en", "me"],
    siteBaseUrl: "https://example.com",
  });

  assert.deepEqual(writes, ["en", "me"]);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Translations updated:/);
  assert.match(messages[0], /- en:/);
  assert.match(messages[0], /- me:/);
  assert.equal(item.translationStatus.en, "machine");
  assert.equal(item.translationStatus.me, "machine");
});

test("runPostConfirmationTranslations reports failures in one summary message", async () => {
  const messages = [];
  const item = {
    slug: "presentation-creometrix-0804",
    sourceLocale: "ru",
    title: "Исходный текст",
    paragraphs: ["Абзац 1"],
    translationStatus: {
      en: "stale",
      me: "stale",
    },
    translations: {},
  };
  const repository = {
    async readItem() {
      return structuredClone(item);
    },
    async applyCommand(parsedCommand, payload) {
      const locale = Object.keys(payload.item.translations || {}).slice(-1)[0] || null;
      if (locale === "me") {
        throw new Error("github 500");
      }

      item.translations = payload.item.translations;
      item.translationStatus = payload.item.translationStatus;
      return {
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        commitSha: `commit-${locale}`,
      };
    },
  };
  const translationClient = {
    async translateFields({ targetLocale }) {
      return {
        title: `translated-${targetLocale}`,
      };
    },
  };
  const telegramClient = {
    async sendMessage({ text }) {
      messages.push(text);
    },
  };

  await runPostConfirmationTranslations({
    repository,
    translationClient,
    telegramClient,
    chatId: 1,
    entity: "announce",
    slug: "presentation-creometrix-0804",
    sourceLocale: "ru",
    targetLocales: ["en", "me"],
    siteBaseUrl: "https://example.com",
  });

  assert.equal(messages.length, 1);
  assert.match(messages[0], /Translations updated:/);
  assert.match(messages[0], /- en:/);
  assert.match(messages[0], /Some translations failed to update:/);
  assert.match(messages[0], /- me: github 500/);
});
