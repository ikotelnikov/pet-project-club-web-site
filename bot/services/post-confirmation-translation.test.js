import test from "node:test";
import assert from "node:assert/strict";

import { resolvePendingTranslationLocales, runPostConfirmationTranslations } from "./post-confirmation-translation.js";

test("resolvePendingTranslationLocales skips manually edited locales", () => {
  const locales = resolvePendingTranslationLocales(
    {
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

test("runPostConfirmationTranslations sends one update per auto locale", async () => {
  const writes = [];
  const messages = [];
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
      de: {
        title: "Manuell",
      },
    },
  };
  const repository = {
    async readItem() {
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
  assert.match(messages[0], /Translation to en updated/);
  assert.match(messages[0], /https:\/\/example\.com\/en\/meetings\/presentation-creometrix-0804\//);
  assert.match(messages[1], /Translation to es updated/);
});
