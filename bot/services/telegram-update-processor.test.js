import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { FilesystemContentRepository } from "./content-repository.js";
import { FileOffsetStore } from "./offset-store.js";
import { LocalPhotoStore } from "./photo-store.js";
import { PendingFileStore } from "../adapters/storage/pending-file-store.js";
import { PendingMemoryStore } from "../adapters/storage/pending-memory-store.js";
import { PrototypeExtractionClient } from "../adapters/openai/prototype-extraction-client.js";
import { createPendingRecord } from "../core/confirmation-flow.js";
import { extractCommandText, handleTelegramMessage } from "../adapters/telegram/message-handler.js";
import { processTelegramUpdates } from "./telegram-update-processor.js";

function createIntent(overrides = {}) {
  return {
    intent: "update",
    entity: "participant",
    target: {
      mode: "existing",
      ref: null,
    },
    relatedEntities: [],
    requestedLocales: {
      sourceLocale: null,
      targetLocale: null,
      targetLocales: [],
    },
    needsClarification: false,
    clarificationReason: null,
    clarificationQuestion: null,
    confidence: "high",
    ...overrides,
  };
}

function createOperation(overrides = {}) {
  return {
    entity: "participant",
    action: "update",
    targetSlug: "ikotelnikov",
    newObject: null,
    patch: {},
    translation: null,
    assetActions: [],
    warnings: [],
    ...overrides,
  };
}

test("extracts command text from message text or caption", () => {
  assert.equal(extractCommandText({ text: "/participant create" }), "/participant create");
  assert.equal(extractCommandText({ caption: "/participant create" }), "/participant create");
  assert.equal(extractCommandText({ text: "   ", caption: "  " }), null);
});



test("[C132] confirmation still succeeds when translation stalls", async () => {
  const pendingStore = new PendingMemoryStore();
  const applied = [];
  const repository = {
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: [] },
        nextIndex: { items: [parsedCommand.fields.slug] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/meetings/announcements/index.json",
          itemPath: `content/meetings/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
    async applyCommand(parsedCommand, mapped) {
      applied.push({
        parsedCommand,
        mapped,
      });

      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        commitSha: "abc123",
        commitMessage: "bot: test",
        paths: {
          itemPath: `content/meetings/items/${parsedCommand.fields.slug}.json`,
          indexPath: "content/meetings/announcements/index.json",
          assetPaths: [],
        },
        indexChanged: true,
      };
    },
  };
  const pending = createPendingRecord({
    chatId: 555,
    userId: 123,
    state: "awaiting_confirmation",
    sourceMessageId: 10,
    sourceUpdateId: 20,
    operation: {
      entity: "announce",
      action: "create",
      slug: "presentation-creometrix-0804",
      fields: {
        slug: "presentation-creometrix-0804",
        sourceLocale: "ru",
        title: "Презентация сервиса генеративного маркетинга CreometriX",
      },
      attachments: [],
      preview: {},
    },
  });

  await pendingStore.setPending(555, pending);

  const result = await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      text: "confirm",
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: new PrototypeExtractionClient(),
    translationClient: {
      async translateItem() {
        return new Promise(() => {});
      },
    },
    dryRun: false,
  });

  assert.equal(result.status, "confirmed");
  assert.equal(applied.length, 1);
  assert.equal(applied[0].parsedCommand.fields.slug, "presentation-creometrix-0804");
  assert.equal((await pendingStore.getPending(555)).context.recentEntity.slug, "presentation-creometrix-0804");
});

test("[C179] translation intent without locale defaults to all non-source locales", async () => {
  const pendingStore = new PendingMemoryStore();

  const result = await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      text: "translate the participant profile for ikotelnikov",
    },
    updateId: 21,
    pendingStore,
    repository: {
      async findEntityBySlug() {
        return "participant";
      },
      async listEntityCandidates() {
        return [{ slug: "ikotelnikov", handle: "@ikotelnikov", label: "Ivan Kotelnikov" }];
      },
      async readItem() {
        return {
          sourceLocale: "ru",
          slug: "ikotelnikov",
          translationStatus: {
            de: "edited",
          },
        };
      },
    },
    photoStore: null,
    extractionClient: {
      async analyzeIntent() {
        return createIntent({
          intent: "translate",
          target: {
            mode: "existing",
            ref: "ikotelnikov",
          },
          requestedLocales: {
            sourceLocale: null,
            targetLocale: null,
            targetLocales: [],
          },
          confidence: "medium",
        });
      },
      async generateOperation({ resolved }) {
        return createOperation({
          action: "translate",
          targetSlug: resolved.target.slug,
          patch: null,
          translation: {
            sourceLocale: null,
            targetLocale: null,
            targetLocales: [],
          },
        });
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.state, "awaiting_confirmation");
  assert.deepEqual(result.pendingState.operation.targetLocales, ["en", "me", "es"]);
});

test("[C180] translation intent with locale becomes a normal pending update", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async findEntityBySlug() {
      return "participant";
    },
    async listEntityCandidates() {
      return [{ slug: "ikotelnikov", handle: "@ikotelnikov", label: "Ivan Kotelnikov" }];
    },
    async readItem() {
      return {
        sourceLocale: "ru",
        slug: "ikotelnikov",
        handle: "@ikotelnikov",
        name: "Ivan Kotelnikov",
        role: "Основатель",
        bio: "Строит клуб.",
        translations: {
          en: {
            role: "Founder",
          },
        },
      };
    },
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: ["ikotelnikov"] },
        nextIndex: { items: ["ikotelnikov"] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/participants/index.json",
          itemPath: "content/participants/items/ikotelnikov.json",
          assetPaths: [],
        },
      };
    },
  };

  const result = await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      text: "set the english bio for participant ikotelnikov to Builds the club in English.",
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async analyzeIntent() {
        return createIntent({
          target: {
            mode: "existing",
            ref: "ikotelnikov",
          },
          requestedLocales: {
            sourceLocale: "ru",
            targetLocale: "en",
            targetLocales: ["en"],
          },
        });
      },
      async generateOperation({ resolved }) {
        return createOperation({
          targetSlug: resolved.target.slug,
          patch: {
            locale: "en",
            role: "Founder",
            bio: "Builds the club in English.",
          },
        });
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.state, "awaiting_confirmation");
  assert.equal(result.pendingState.operation.fields.locale, "en");
  assert.equal(result.pendingState.operation.fields.role, "Founder");
  assert.equal(result.pendingState.operation.fields.bio, "Builds the club in English.");
});

test("[C127] missing translation locale becomes a buffered clarification and resumes on reply", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async findEntityBySlug() {
      return "participant";
    },
    async listEntityCandidates() {
      return [{ slug: "ikotelnikov", handle: "@ikotelnikov", label: "Ivan Kotelnikov" }];
    },
    async readItem() {
      return {
        sourceLocale: "ru",
        slug: "ikotelnikov",
        handle: "@ikotelnikov",
        name: "Ivan Kotelnikov",
        role: "Основатель",
        bio: "Строит клуб.",
        translations: {
          es: {
            role: "Fundador",
          },
        },
      };
    },
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: ["ikotelnikov"] },
        nextIndex: { items: ["ikotelnikov"] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/participants/index.json",
          itemPath: "content/participants/items/ikotelnikov.json",
          assetPaths: [],
        },
      };
    },
  };

  const clarification = await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      text: "update translation bio for participant ikotelnikov to Construye el club.",
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async analyzeIntent() {
        return createIntent({
          target: {
            mode: "existing",
            ref: "ikotelnikov",
          },
          needsClarification: true,
          clarificationReason: "locale_missing",
          clarificationQuestion: "Which locale should I update: ru, en, de, me, or es?",
          confidence: "medium",
        });
      },
      async generateOperation() {
        throw new Error("locale clarification should not generate operation yet");
      },
    },
    dryRun: true,
  });

  assert.equal(clarification.status, "clarification");
  assert.match(clarification.question, /Which locale should I update/);
  assert.equal(clarification.pendingState.operation.type, "v2_intent_clarification");

  const resumed = await handleTelegramMessage({
    message: {
      message_id: 12,
      from: { id: 123 },
      chat: { id: 555 },
      text: "es",
    },
    updateId: 22,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async analyzeIntent() {
        return createIntent({
          target: {
            mode: "existing",
            ref: "ikotelnikov",
          },
          requestedLocales: {
            sourceLocale: "ru",
            targetLocale: "es",
            targetLocales: ["es"],
          },
        });
      },
      async generateOperation({ resolved }) {
        return createOperation({
          targetSlug: resolved.target.slug,
          patch: {
            locale: "es",
            bio: "Construye el club.",
          },
        });
      },
    },
    dryRun: true,
  });

  assert.equal(resumed.status, "processed");
  assert.equal(resumed.pendingState.operation.fields.slug, "ikotelnikov");
  assert.equal(resumed.pendingState.operation.fields.locale, "es");
  assert.equal(resumed.pendingState.operation.fields.bio, "Construye el club.");
});




test("[C178] photo-only message continues an active project draft", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async findEntityBySlug() {
      return "project";
    },
    async listEntityCandidates() {
      return [{ slug: "montenegro-jewish-home", title: "Montenegro Jewish Home", label: "Montenegro Jewish Home" }];
    },
    async readItem() {
      return {
        sourceLocale: "ru",
        slug: "montenegro-jewish-home",
        title: "Montenegro Jewish Home",
        status: "active",
        summary: "Community project",
        gallery: [{ src: "assets/projects/montenegro-jewish-home/existing.jpg", alt: "Montenegro Jewish Home" }],
      };
    },
    async stageAttachment({ chatId, messageId, attachment }) {
      return {
        ...attachment,
        stagedPath: `assets/uploads/${chatId}/${messageId}-${attachment.fileName}`,
      };
    },
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: ["montenegro-jewish-home"] },
        nextIndex: { items: ["montenegro-jewish-home"] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/projects/index.json",
          itemPath: "content/projects/items/montenegro-jewish-home.json",
          assetPaths: [],
        },
      };
    },
  };
  const extractionClient = {
    async analyzeIntent() {
      return createIntent({
        entity: "project",
        target: {
          mode: "existing",
          ref: "montenegro-jewish-home",
        },
      });
    },
    async generateOperation({ resolved }) {
      return createOperation({
        entity: "project",
        targetSlug: resolved.target.slug,
        patch: {
          title: "Montenegro Jewish Home",
          summary: "Community project",
        },
      });
    },
  };
  const photoStore = {
    async planStagedPhoto(_entity, _slug, stagedPath) {
      return { stagedPath, srcPath: stagedPath };
    },
  };
  const telegramClient = {
    async downloadFileBytes() {
      return {
        filePath: "photos/incoming.jpg",
        bytes: new Uint8Array([1, 2, 3]),
      };
    },
  };

  await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      text: "update project montenegro-jewish-home",
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore,
    extractionClient,
    telegramClient,
    dryRun: true,
  });

  const followUp = await handleTelegramMessage({
    message: {
      message_id: 12,
      from: { id: 123 },
      chat: { id: 555 },
      photo: [{ file_id: "ph1", file_unique_id: "uniq1", width: 1200, height: 800, file_size: 1024 }],
    },
    updateId: 22,
    pendingStore,
    repository,
    photoStore,
    extractionClient,
    telegramClient,
    dryRun: true,
  });

  assert.equal(followUp.status, "processed");
  assert.equal(followUp.pendingState.operation.fields.photoAction, "append");
  assert.equal(followUp.pendingState.operation.fields.gallery.length, 2);
  assert.match(followUp.pendingState.operation.fields.gallery[1].src, /assets\/uploads\/555\/12-photo-12-uniq1\.jpg/);
});





test("[C128] generic operation clarification buffers attachments and resumes on later target reply", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async listEntityCandidates() {
      return [
        { slug: "tatyana-nirman", label: "Татьяна Нирман", name: "Татьяна Нирман" },
      ];
    },
    async readItem() {
      return {
        sourceLocale: "ru",
        slug: "tatyana-nirman",
        name: "Татьяна Нирман",
        role: "Участник",
        bio: "Био",
      };
    },
    async stageAttachment({ chatId, messageId, attachment }) {
      return {
        ...attachment,
        stagedPath: `assets/uploads/${chatId}/${messageId}-${attachment.fileName}`,
      };
    },
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: [parsedCommand.fields.slug] },
        nextIndex: { items: [parsedCommand.fields.slug] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/participants/index.json",
          itemPath: `content/participants/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
  };
  const telegramClient = {
    async downloadFileBytes() {
      return {
        filePath: "photos/incoming.jpg",
        bytes: new Uint8Array([1, 2, 3]),
      };
    },
  };
  const photoStore = {
    async planStagedPhoto(_entity, _slug, stagedPath) {
      return { stagedPath, srcPath: stagedPath };
    },
  };

  const clarification = await handleTelegramMessage({
    message: {
      message_id: 30,
      from: { id: 123 },
      chat: { id: 555 },
      text: "обнови описание участника",
    },
    updateId: 40,
    pendingStore,
    repository,
    photoStore,
    extractionClient: {
      async analyzeIntent() {
        return createIntent({
          target: {
            mode: "unknown",
            ref: null,
          },
          needsClarification: true,
          clarificationReason: "target_missing",
          clarificationQuestion: "Which participant should I update?",
          confidence: "medium",
        });
      },
      async generateOperation() {
        throw new Error("target clarification should not generate operation yet");
      },
    },
    dryRun: true,
  });

  assert.equal(clarification.status, "clarification");
  assert.equal(clarification.pendingState.operation.type, "v2_intent_clarification");

  const withPhoto = await handleTelegramMessage({
    message: {
      message_id: 31,
      from: { id: 123 },
      chat: { id: 555 },
      photo: [{ file_id: "ph6", file_unique_id: "uniq6", width: 1200, height: 800, file_size: 1024 }],
    },
    updateId: 41,
    pendingStore,
    repository,
    photoStore,
    extractionClient: {
      async analyzeIntent() {
        return createIntent({
          target: {
            mode: "unknown",
            ref: null,
          },
          needsClarification: true,
          clarificationReason: "target_missing",
          clarificationQuestion: "Which participant should I update?",
          confidence: "medium",
        });
      },
      async generateOperation() {
        throw new Error("target clarification should not generate operation yet");
      },
    },
    telegramClient,
    dryRun: true,
  });

  assert.equal(withPhoto.status, "clarification");
  assert.equal(withPhoto.pendingState.operation.turn.messages.length, 2);
  assert.equal(withPhoto.pendingState.operation.turn.messages[1].attachments.length, 1);
  assert.match(withPhoto.pendingState.operation.turn.messages[1].attachments[0].stagedPath, /assets\/uploads\/555\/31-photo-31-uniq6\.jpg/);

  const resumed = await handleTelegramMessage({
    message: {
      message_id: 32,
      from: { id: 123 },
      chat: { id: 555 },
      text: "Татьяна Нирман",
    },
    updateId: 42,
    pendingStore,
    repository,
    photoStore,
    extractionClient: {
      async analyzeIntent() {
        return createIntent({
          target: {
            mode: "existing",
            ref: "Татьяна Нирман",
          },
        });
      },
      async generateOperation({ resolved }) {
        return createOperation({
          targetSlug: resolved.target.slug,
          patch: {
            bio: "Новое описание",
          },
        });
      },
    },
    dryRun: true,
  });

  assert.equal(resumed.status, "processed");
  assert.equal(resumed.pendingState.operation.slug, "tatyana-nirman");
  assert.match(resumed.pendingState.operation.fields.photoStagedPath, /assets\/uploads\/555\/31-photo-31-uniq6\.jpg/);
  assert.match(resumed.pendingState.operation.requestText, /обнови описание участника/);
  assert.match(resumed.pendingState.operation.requestText, /Татьяна Нирман/);
});

test("[C129] medium-confidence target resolution asks for explicit clarification instead of auto-selecting", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async listEntityCandidates() {
      return [
        { slug: "tatyana-nirman", label: "Татьяна Нирман", name: "Татьяна Нирман" },
        { slug: "tatyana-shmatko", label: "Татьяна Шматко", name: "Татьяна Шматко" },
      ];
    },
    async readItem() {
      throw new Error("should not read item before clarification");
    },
  };

  const result = await handleTelegramMessage({
    message: {
      message_id: 50,
      from: { id: 123 },
      chat: { id: 555 },
      text: "обнови описание для Татьяны",
    },
    updateId: 60,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async analyzeIntent() {
        return createIntent({
          target: {
            mode: "unknown",
            ref: "Татьяна",
          },
          needsClarification: true,
          clarificationReason: "target_ambiguity",
          clarificationQuestion: "I need to confirm which participant you want to update: 1. Татьяна Нирман (tatyana-nirman), 2. Татьяна Шматко (tatyana-shmatko)",
          confidence: "medium",
        });
      },
      async generateOperation() {
        throw new Error("ambiguous target should not generate operation yet");
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "clarification");
  assert.equal(result.pendingState.operation.type, "v2_intent_clarification");
  assert.match(result.question, /I need to confirm which participant you want to update/);
  assert.match(result.question, /1\. Татьяна Нирман \(tatyana-nirman\)/);
  assert.match(result.question, /2\. Татьяна Шматко \(tatyana-shmatko\)/);
});


test("[C135] recent entity ranking prefers explicit text match over plain recency", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async listEntityCandidates() {
      return [
        { slug: "aleksey-popov", label: "Алексей Попов", name: "Алексей Попов" },
        { slug: "tatyana-nirman", label: "Татьяна Нирман", name: "Татьяна Нирман" },
      ];
    },
    async readItem(_entity, slug) {
      return {
        sourceLocale: "ru",
        slug,
        name: slug === "tatyana-nirman" ? "Татьяна Нирман" : "Алексей Попов",
        role: "Участник",
        bio: "Bio",
        links: [],
      };
    },
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: [parsedCommand.fields.slug] },
        nextIndex: { items: [parsedCommand.fields.slug] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/participants/index.json",
          itemPath: `content/participants/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
  };

  await pendingStore.setPending(555, createPendingRecord({
    chatId: 555,
    userId: 123,
    state: "idle",
    sourceMessageId: 10,
    sourceUpdateId: 20,
    operation: null,
    context: {
      recentEntity: {
        entity: "participant",
        slug: "aleksey-popov",
        action: "update",
        fields: {
          slug: "aleksey-popov",
          name: "Алексей Попов",
        },
        lastTouchedAt: "2026-04-16T10:05:00.000Z",
      },
      recentEntities: [
        {
          entity: "participant",
          slug: "aleksey-popov",
          action: "update",
          fields: {
            slug: "aleksey-popov",
            name: "Алексей Попов",
          },
          lastTouchedAt: "2026-04-16T10:05:00.000Z",
        },
        {
          entity: "participant",
          slug: "tatyana-nirman",
          action: "update",
          fields: {
            slug: "tatyana-nirman",
            name: "Татьяна Нирман",
          },
          lastTouchedAt: "2026-04-16T10:00:00.000Z",
        },
      ],
    },
  }));

  const result = await handleTelegramMessage({
    message: {
      message_id: 70,
      from: { id: 123 },
      chat: { id: 555 },
      text: "добавь ссылку для Татьяны",
    },
    updateId: 80,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async analyzeIntent() {
        return createIntent({
          target: {
            mode: "existing",
            ref: "Татьяна Нирман",
          },
        });
      },
      async generateOperation({ resolved }) {
        return createOperation({
          targetSlug: resolved.target.slug,
          patch: {
            links: [
              { label: "Telegram", href: "https://t.me/tatyana", external: true },
            ],
          },
        });
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.slug, "tatyana-nirman");
});


test("[C136] continuation lookup resolves a precise recent context entity by name via LLM", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async listEntityCandidates() {
      return [
        { slug: "tatyana-nirman", label: "Татьяна Нирман", name: "Татьяна Нирман" },
        { slug: "aleksey-popov", label: "Алексей Попов", name: "Алексей Попов" },
      ];
    },
    async readItem(_entity, slug) {
      return {
        sourceLocale: "ru",
        slug,
        name: slug === "tatyana-nirman" ? "Татьяна Нирман" : "Алексей Попов",
        role: "Участник",
        bio: "Bio",
      };
    },
    async stageAttachment({ chatId, messageId, attachment }) {
      return {
        ...attachment,
        stagedPath: `assets/uploads/${chatId}/${messageId}-${attachment.fileName}`,
      };
    },
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: [parsedCommand.fields.slug] },
        nextIndex: { items: [parsedCommand.fields.slug] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/participants/index.json",
          itemPath: `content/participants/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
  };
  const photoStore = {
    async planStagedPhoto(_entity, _slug, stagedPath) {
      return { stagedPath, srcPath: stagedPath };
    },
  };
  const telegramClient = {
    async downloadFileBytes() {
      return {
        filePath: "photos/incoming.jpg",
        bytes: new Uint8Array([1, 2, 3]),
      };
    },
  };

  await pendingStore.setPending(555, createPendingRecord({
    chatId: 555,
    userId: 123,
    state: "idle",
    sourceMessageId: 10,
    sourceUpdateId: 20,
    operation: null,
    context: {
      recentEntity: {
        entity: "participant",
        slug: "tatyana-nirman",
        action: "create",
        fields: {
          slug: "tatyana-nirman",
          name: "Татьяна Нирман",
        },
      },
      recentEntities: [
        {
          entity: "participant",
          slug: "tatyana-nirman",
          action: "create",
          fields: {
            slug: "tatyana-nirman",
            name: "Татьяна Нирман",
          },
        },
        {
          entity: "participant",
          slug: "aleksey-popov",
          action: "create",
          fields: {
            slug: "aleksey-popov",
            name: "Алексей Попов",
          },
        },
      ],
    },
  }));

  const result = await handleTelegramMessage({
    message: {
      message_id: 16,
      from: { id: 123 },
      chat: { id: 555 },
      caption: "Добавь это фото для Татьяны",
      photo: [{ file_id: "ph4", file_unique_id: "uniq4", width: 1200, height: 800, file_size: 1024 }],
    },
    updateId: 26,
    pendingStore,
    repository,
    photoStore,
    extractionClient: {
      async analyzeIntent() {
        return createIntent({
          target: {
            mode: "existing",
            ref: "Татьяна Нирман",
          },
        });
      },
      async generateOperation({ resolved }) {
        return createOperation({
          targetSlug: resolved.target.slug,
          patch: {},
        });
      },
    },
    telegramClient,
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.entity, "participant");
  assert.equal(result.pendingState.operation.slug, "tatyana-nirman");
  assert.match(result.pendingState.operation.fields.photoStagedPath, /assets\/uploads\/555\/16-photo-16-uniq4\.jpg/);
});

test("[C137] continuation lookup falls back to repository candidates via LLM", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async listEntityCandidates(entity) {
      if (entity !== "participant") {
        return [];
      }

      return [
        { slug: "tatyana-nirman", label: "Татьяна Нирман", name: "Татьяна Нирман" },
        { slug: "aleksey-popov", label: "Алексей Попов", name: "Алексей Попов" },
      ];
    },
    async readItem(_entity, slug) {
      return {
        sourceLocale: "ru",
        slug,
        name: slug === "tatyana-nirman" ? "Татьяна Нирман" : "Алексей Попов",
        role: "Участник",
        bio: "Bio",
      };
    },
    async stageAttachment({ chatId, messageId, attachment }) {
      return {
        ...attachment,
        stagedPath: `assets/uploads/${chatId}/${messageId}-${attachment.fileName}`,
      };
    },
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: [parsedCommand.fields.slug] },
        nextIndex: { items: [parsedCommand.fields.slug] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/participants/index.json",
          itemPath: `content/participants/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
  };
  const photoStore = {
    async planStagedPhoto(_entity, _slug, stagedPath) {
      return { stagedPath, srcPath: stagedPath };
    },
  };
  const telegramClient = {
    async downloadFileBytes() {
      return {
        filePath: "photos/incoming.jpg",
        bytes: new Uint8Array([1, 2, 3]),
      };
    },
  };

  const result = await handleTelegramMessage({
    message: {
      message_id: 17,
      from: { id: 123 },
      chat: { id: 555 },
      caption: "Добавь это фото для Татьяны",
      photo: [{ file_id: "ph5", file_unique_id: "uniq5", width: 1200, height: 800, file_size: 1024 }],
    },
    updateId: 27,
    pendingStore,
    repository,
    photoStore,
    extractionClient: {
      async analyzeIntent() {
        return createIntent({
          target: {
            mode: "existing",
            ref: "Татьяна Нирман",
          },
        });
      },
      async generateOperation({ resolved }) {
        return createOperation({
          targetSlug: resolved.target.slug,
          patch: {},
        });
      },
    },
    telegramClient,
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.entity, "participant");
  assert.equal(result.pendingState.operation.slug, "tatyana-nirman");
  assert.match(result.pendingState.operation.fields.photoStagedPath, /assets\/uploads\/555\/17-photo-17-uniq5\.jpg/);
});

test("[C138] text-only uncertain continuation resolves target via recent context and repository lookup", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async listEntityCandidates(entity) {
      if (entity !== "participant") {
        return [];
      }

      return [
        { slug: "tatyana-nirman", label: "Татьяна Нирман", name: "Татьяна Нирман" },
        { slug: "aleksey-popov", label: "Алексей Попов", name: "Алексей Попов" },
      ];
    },
    async readItem(_entity, slug) {
      return {
        sourceLocale: "ru",
        slug,
        name: slug === "tatyana-nirman" ? "Татьяна Нирман" : "Алексей Попов",
        role: "Участник",
        bio: "Bio",
        links: [],
      };
    },
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: [parsedCommand.fields.slug] },
        nextIndex: { items: [parsedCommand.fields.slug] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/participants/index.json",
          itemPath: `content/participants/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
  };

  await pendingStore.setPending(555, createPendingRecord({
    chatId: 555,
    userId: 123,
    state: "idle",
    sourceMessageId: 10,
    sourceUpdateId: 20,
    operation: null,
    context: {
      recentEntity: {
        entity: "participant",
        slug: "aleksey-popov",
        action: "create",
        fields: {
          slug: "aleksey-popov",
          name: "Алексей Попов",
        },
      },
      recentEntities: [
        {
          entity: "participant",
          slug: "aleksey-popov",
          action: "create",
          fields: {
            slug: "aleksey-popov",
            name: "Алексей Попов",
          },
        },
      ],
    },
  }));

  const result = await handleTelegramMessage({
    message: {
      message_id: 18,
      from: { id: 123 },
      chat: { id: 555 },
      text: "добавь ссылку для Татьяны",
    },
    updateId: 28,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async analyzeIntent() {
        return createIntent({
          target: {
            mode: "existing",
            ref: "Татьяна Нирман",
          },
        });
      },
      async generateOperation({ resolved }) {
        return createOperation({
          targetSlug: resolved.target.slug,
          patch: {
            links: [
              { label: "Telegram", href: "https://t.me/tatyana", external: true },
            ],
          },
        });
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.entity, "participant");
  assert.equal(result.pendingState.operation.slug, "tatyana-nirman");
});

test("[C177] project photo update can append an additional gallery image", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async findEntityBySlug() {
      return "project";
    },
    async listEntityCandidates() {
      return [{ slug: "project-existing", label: "Project Existing", title: "active" }];
    },
    async readItem() {
      return {
        sourceLocale: "ru",
        slug: "project-existing",
        title: "Project Existing",
        status: "active",
        stack: "node",
        summary: "Summary",
        photo: {
          src: "assets/projects/project-existing-cover.jpg",
          alt: "Cover image",
        },
      };
    },
    async stageAttachment({ chatId, messageId, attachment }) {
      return {
        ...attachment,
        stagedPath: `assets/uploads/${chatId}/${messageId}-${attachment.fileName}`,
      };
    },
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: ["project-existing"] },
        nextIndex: { items: ["project-existing"] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/projects/index.json",
          itemPath: "content/projects/items/project-existing.json",
          assetPaths: [],
        },
      };
    },
  };

  const result = await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      caption: "add another photo to project-existing",
      photo: [{ file_id: "ph1", file_unique_id: "uniq1", width: 1200, height: 800, file_size: 1024 }],
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore: {
      async planStagedPhoto(_entity, _slug, stagedPath) {
        return { stagedPath, srcPath: stagedPath };
      },
    },
    telegramClient: {
      async downloadFileBytes() {
        return {
          filePath: "photos/incoming.jpg",
          bytes: new Uint8Array([1, 2, 3]),
        };
      },
    },
    extractionClient: {
      async analyzeIntent() {
        return createIntent({
          entity: "project",
          target: {
            mode: "existing",
            ref: "project-existing",
          },
        });
      },
      async generateOperation({ resolved }) {
        return createOperation({
          entity: "project",
          targetSlug: resolved.target.slug,
          patch: {
            photoAlt: "Second screenshot",
          },
        });
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.fields.photoAction, "append");
  assert.equal(result.pendingState.operation.fields.gallery.length, 2);
  assert.equal(result.operation.nextItem.gallery.length, 2);
  assert.equal(result.operation.nextItem.gallery[1].alt, "Second screenshot");
});









test("explicit news update does not get forced into recent project context", async () => {
  const pendingStore = new PendingMemoryStore();
  const analyzeInputs = [];
  const repository = {
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: ["airbnb-moja-ljubov-skozi-goda"] },
        nextIndex: { items: ["airbnb-moja-ljubov-skozi-goda"] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/meetings/announcements/index.json",
          itemPath: "content/meetings/items/airbnb-moja-ljubov-skozi-goda.json",
          assetPaths: [],
        },
      };
    },
    async findEntityBySlug(slug) {
      if (slug === "airbnb-moja-ljubov-skozi-goda") {
        return "announce";
      }
      if (slug === "doveritelnoe-upravlenie-v-chernogorii") {
        return "project";
      }
      return null;
    },
    async listEntityCandidates(entity) {
      if (entity === "announce") {
        return [{
          entity: "announce",
          slug: "airbnb-moja-ljubov-skozi-goda",
          title: "Airbnb: moja ljubov skvozi goda",
          label: "Airbnb: moja ljubov skvozi goda",
          summary: "airbnb-moja-ljubov-skozi-goda",
        }];
      }
      if (entity === "project") {
        return [{
          entity: "project",
          slug: "doveritelnoe-upravlenie-v-chernogorii",
          fields: { title: "Доверительное управление в Черногории" },
          summary: "doveritelnoe-upravlenie-v-chernogorii",
        }];
      }
      return [];
    },
    async readItem(entity, slug) {
      if (entity === "announce" && slug === "airbnb-moja-ljubov-skozi-goda") {
        return {
          sourceLocale: "ru",
          slug,
          date: "2026-04-17",
          title: "Airbnb: moja ljubov skvozi goda",
          place: "Online",
          format: "news",
          paragraphs: ["Update text"],
          projectSlugs: [],
        };
      }

      throw new Error(`Unexpected readItem(${entity}, ${slug})`);
    },
  };

  await pendingStore.setPending(555, createPendingRecord({
    chatId: 555,
    userId: 123,
    state: "idle",
    sourceMessageId: 10,
    sourceUpdateId: 20,
    operation: null,
    context: {
      recentEntity: {
        entity: "project",
        slug: "doveritelnoe-upravlenie-v-chernogorii",
        action: "update",
        fields: {
          slug: "doveritelnoe-upravlenie-v-chernogorii",
          title: "Доверительное управление в Черногории",
        },
      },
    },
  }));

  const result = await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      text: "обнови новость airbnb-moja-ljubov-skozi-goda: projectSlugs = doveritelnoe-upravlenie-v-chernogorii",
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async analyzeIntent(input) {
        analyzeInputs.push(input);
        return createIntent({
          intent: "update",
          entity: "announcement",
          target: {
            mode: "existing",
            ref: "airbnb-moja-ljubov-skozi-goda",
          },
        });
      },
      async generateOperation({ resolved }) {
        return createOperation({
          entity: "announcement",
          targetSlug: resolved.target.slug,
          patch: {
            projectSlugs: ["doveritelnoe-upravlenie-v-chernogorii"],
          },
        });
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(analyzeInputs.length, 1);
  assert.equal(result.pendingState.operation.entity, "announce");
  assert.equal(result.pendingState.operation.slug, "airbnb-moja-ljubov-skozi-goda");
  assert.deepEqual(result.pendingState.operation.fields.projectSlugs, ["doveritelnoe-upravlenie-v-chernogorii"]);
});



async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ppc-telegram-"));
  const contentRoot = path.join(root, "content");
  const assetsRoot = path.join(root, "assets");

  await fs.mkdir(path.join(contentRoot, "participants", "items"), { recursive: true });
  await fs.mkdir(path.join(contentRoot, "projects", "items"), { recursive: true });
  await fs.mkdir(path.join(contentRoot, "meetings", "items"), { recursive: true });
  await fs.mkdir(path.join(contentRoot, "meetings", "announcements"), { recursive: true });
  await fs.mkdir(path.join(contentRoot, "meetings", "archive"), { recursive: true });
  await fs.mkdir(assetsRoot, { recursive: true });

  await fs.writeFile(path.join(contentRoot, "participants", "index.json"), '{\n  "items": []\n}\n');
  await fs.writeFile(path.join(contentRoot, "projects", "index.json"), '{\n  "items": []\n}\n');
  await fs.writeFile(path.join(contentRoot, "meetings", "announcements", "index.json"), '{\n  "items": []\n}\n');
  await fs.writeFile(
    path.join(contentRoot, "meetings", "archive", "index.json"),
    '{\n  "pageSize": 10,\n  "items": []\n}\n'
  );

  return {
    root,
    contentRoot,
    assetsRoot,
  };
}
