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

test("extracts command text from message text or caption", () => {
  assert.equal(extractCommandText({ text: "/participant create" }), "/participant create");
  assert.equal(extractCommandText({ caption: "/participant create" }), "/participant create");
  assert.equal(extractCommandText({ text: "   ", caption: "  " }), null);
});

test("processes only authorized command messages and advances offset", async () => {
  const fixture = await createFixture();
  const repository = new FilesystemContentRepository(fixture);
  const photoStore = new LocalPhotoStore(repository);
  const pendingStore = new PendingFileStore({
    storageRoot: path.join(fixture.root, "state", "pending"),
  });
  const extractionClient = new PrototypeExtractionClient();
  const offsetStore = new FileOffsetStore({
    stateFilePath: path.join(fixture.root, "state", "telegram-offset.json"),
  });

  const result = await processTelegramUpdates({
    updates: [
      {
        update_id: 101,
        message: {
          from: { id: 999 },
          text: "/participant create\nslug: participant-blocked\nhandle: @blocked\nname: Blocked User\nrole: Role\nbio:\nBio\npoints:\n- One",
        },
      },
      {
        update_id: 102,
        message: {
          from: { id: 123 },
          text: "/participant create\nslug: participant-allowed\nhandle: @allowed\nname: Allowed User\nrole: Role\nbio:\nBio\npoints:\n- One",
        },
      },
      {
        update_id: 103,
        message: {
          from: { id: 123 },
          text: "hello there",
        },
      },
    ],
    allowedUserId: 123,
    repository,
    photoStore,
    offsetStore,
    pendingStore,
    extractionClient,
    dryRun: false,
  });

  const item = JSON.parse(
    await fs.readFile(
      path.join(fixture.contentRoot, "participants", "items", "participant-allowed.json"),
      "utf8"
    )
  );
  const offsetRaw = JSON.parse(
    await fs.readFile(path.join(fixture.root, "state", "telegram-offset.json"), "utf8")
  );

  assert.equal(item.name, "Allowed User");
  assert.equal(result.processedCount, 1);
  assert.equal(result.ignoredCount, 2);
  assert.equal(result.failedCount, 0);
  assert.equal(result.nextOffset, 104);
  assert.equal(offsetRaw.updateOffset, 104);
});

test("marks malformed authorized commands as failed and advances offset", async () => {
  const fixture = await createFixture();
  const repository = new FilesystemContentRepository(fixture);
  const photoStore = new LocalPhotoStore(repository);
  const pendingStore = new PendingFileStore({
    storageRoot: path.join(fixture.root, "state", "pending"),
  });
  const extractionClient = new PrototypeExtractionClient();
  const offsetStore = new FileOffsetStore({
    stateFilePath: path.join(fixture.root, "state", "telegram-offset.json"),
  });

  const result = await processTelegramUpdates({
    updates: [
      {
        update_id: 201,
        message: {
          from: { id: 123 },
          text: "/participant create\nslug: bad slug\nhandle: @broken\nname: Broken\nrole: Role\nbio:\nBio\npoints:\n- One",
        },
      },
    ],
    allowedUserId: 123,
    repository,
    photoStore,
    offsetStore,
    pendingStore,
    extractionClient,
    dryRun: true,
  });

  assert.equal(result.processedCount, 0);
  assert.equal(result.failedCount, 1);
  assert.equal(result.nextOffset, 202);
  assert.match(result.results[0].error, /Field 'slug'/);
});

test("confirmation still succeeds when translation stalls", async () => {
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

test("translation intent without locale defaults to all non-source locales", async () => {
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
      async extractIntent() {
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "translation_operation",
            entity: "participant",
            action: "update",
            slug: null,
            targetRef: "ikotelnikov",
            confidence: "medium",
            needsConfirmation: true,
            summary: "update translation for ikotelnikov",
            fields: {},
            questions: ["Which locale should I update: ru, en, de, me, or es?"],
            warnings: [],
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.state, "awaiting_confirmation");
  assert.deepEqual(result.pendingState.operation.targetLocales, ["en", "me", "es"]);
});

test("translation intent with locale becomes a normal pending update", async () => {
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
      async extractIntent() {
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "translation_operation",
            entity: "participant",
            action: "update",
            slug: null,
            targetRef: "ikotelnikov",
            confidence: "high",
            needsConfirmation: true,
            summary: "update en translation for ikotelnikov",
            fields: {
              locale: "en",
              bio: "Builds the club in English.",
            },
            questions: [],
            warnings: [],
          },
        };
      },
      async resolveTarget() {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: "ikotelnikov",
            confidence: "high",
            question: null,
          },
        };
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

test("missing translation locale becomes a buffered clarification and resumes on reply", async () => {
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
      async extractIntent() {
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "translation_operation",
            entity: "participant",
            action: "update",
            slug: null,
            targetRef: "ikotelnikov",
            confidence: "medium",
            needsConfirmation: true,
            summary: "update translation bio",
            fields: {
              bio: "Construye el club.",
            },
            questions: ["Which locale should I update: ru, en, de, me, or es?"],
            warnings: [],
          },
        };
      },
      async resolveTarget() {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: "ikotelnikov",
            confidence: "high",
            question: null,
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(clarification.status, "clarification");
  assert.match(clarification.question, /Which locale should I update/);
  assert.equal(clarification.pendingState.operation.type, "translation_locale");

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
      async extractIntent() {
        throw new Error("locale clarification reply should not call extraction");
      },
      async resolveTarget() {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: "ikotelnikov",
            confidence: "high",
            question: null,
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(resumed.status, "processed");
  assert.equal(resumed.pendingState.operation.fields.slug, "ikotelnikov");
  assert.equal(resumed.pendingState.operation.fields.locale, "es");
  assert.equal(resumed.pendingState.operation.fields.bio, "Construye el club.");
});

test("create participant from Cyrillic name derives transliterated slug", async () => {
  const pendingStore = new PendingMemoryStore();
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
          indexPath: "content/participants/index.json",
          itemPath: `content/participants/items/${parsedCommand.fields.slug}.json`,
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
      text: "создай нового пользователя Татьяна Нирман",
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async extractIntent() {
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "participant",
            action: "create",
            slug: null,
            targetRef: "Татьяна Нирман",
            confidence: "high",
            needsConfirmation: true,
            summary: "create participant",
            fields: {
              name: "Татьяна Нирман",
              role: "Предприниматель",
            },
            questions: [],
            warnings: [],
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.slug, "tatyana-nirman");
  assert.equal(result.pendingState.operation.fields.slug, "tatyana-nirman");
});

test("draft accepts additive follow-up messages before confirmation", async () => {
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
        links: [],
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
  const extractionClient = {
    async extractIntent(input) {
      if (input.pendingOperation) {
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "participant",
            action: "update",
            slug: "ikotelnikov",
            targetRef: "ikotelnikov",
            confidence: "high",
            needsConfirmation: true,
            summary: "add github link",
            fields: {
              links: [
                {
                  label: "GitHub",
                  href: "https://github.com/ikotelnikov",
                  external: true,
                },
              ],
            },
            questions: [],
            warnings: [],
          },
        };
      }

      return {
        ok: true,
        usedModel: "test",
        attempts: 1,
        extraction: {
          intent: "content_operation",
          entity: "participant",
          action: "update",
          slug: null,
          targetRef: "ikotelnikov",
          confidence: "high",
          needsConfirmation: true,
          summary: "update participant bio",
          fields: {
            bio: "Builds the club in English.",
          },
          questions: [],
          warnings: [],
        },
      };
    },
    async resolveTarget() {
      return {
        ok: true,
        usedModel: "test",
        resolution: {
          matchedSlug: "ikotelnikov",
          confidence: "high",
          question: null,
        },
      };
    },
  };

  const first = await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      text: "update participant ikotelnikov bio to Builds the club in English.",
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
  });

  const second = await handleTelegramMessage({
    message: {
      message_id: 12,
      from: { id: 123 },
      chat: { id: 555 },
      text: "add github https://github.com/ikotelnikov",
    },
    updateId: 22,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
  });

  assert.equal(first.status, "processed");
  assert.equal(second.status, "processed");
  assert.equal(second.pendingState.operation.fields.slug, "ikotelnikov");
  assert.equal(second.pendingState.operation.fields.bio, "Builds the club in English.");
  assert.equal(second.pendingState.operation.fields.links.length, 1);
  assert.equal(second.pendingState.operation.fields.links[0].href, "https://github.com/ikotelnikov");
});

test("active draft follow-up sends rich delta context to extraction", async () => {
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
        links: [],
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

  let followUpInput = null;
  const extractionClient = {
    async extractIntent(input) {
      if (input.pendingOperation) {
        followUpInput = input;
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "participant",
            action: "update",
            slug: "ikotelnikov",
            targetRef: "ikotelnikov",
            confidence: "high",
            needsConfirmation: true,
            summary: "add github link",
            fields: {
              links: [
                {
                  label: "GitHub",
                  href: "https://github.com/ikotelnikov",
                  external: true,
                },
              ],
            },
            questions: [],
            warnings: [],
          },
        };
      }

      return {
        ok: true,
        usedModel: "test",
        attempts: 1,
        extraction: {
          intent: "content_operation",
          entity: "participant",
          action: "update",
          slug: null,
          targetRef: "ikotelnikov",
          confidence: "high",
          needsConfirmation: true,
          summary: "update participant bio",
          fields: {
            bio: "Builds the club in English.",
          },
          questions: [],
          warnings: [],
        },
      };
    },
    async resolveTarget() {
      return {
        ok: true,
        usedModel: "test",
        resolution: {
          matchedSlug: "ikotelnikov",
          confidence: "high",
          question: null,
        },
      };
    },
  };

  await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      text: "update participant ikotelnikov bio to Builds the club in English.",
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
  });

  await handleTelegramMessage({
    message: {
      message_id: 12,
      from: { id: 123 },
      chat: { id: 555 },
      text: "also add github https://github.com/ikotelnikov",
    },
    updateId: 22,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
  });

  assert.ok(followUpInput);
  assert.equal(followUpInput.pendingState, "awaiting_confirmation");
  assert.equal(followUpInput.pendingOperation.mode, "active_draft");
  assert.equal(followUpInput.pendingOperation.entity, "participant");
  assert.equal(followUpInput.pendingOperation.slug, "ikotelnikov");
  assert.equal(followUpInput.pendingOperation.requestText, "update participant ikotelnikov bio to Builds the club in English.");
  assert.equal(followUpInput.pendingOperation.fields.bio, "Builds the club in English.");
  assert.equal(followUpInput.pendingOperation.currentAttachments.length, 0);
  assert.equal(followUpInput.recentEntities.length, 0);
});

test("active draft follow-up can object-edit the current draft to remove one link", async () => {
  const pendingStore = new PendingMemoryStore();
  let objectEditInput = null;
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
        role: "Founder",
        bio: "Builds the club.",
        links: [],
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

  const extractionClient = {
    async extractIntent(input) {
      if (input.pendingOperation) {
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "participant",
            action: "update",
            slug: "ikotelnikov",
            targetRef: "ikotelnikov",
            confidence: "high",
            needsConfirmation: true,
            summary: "remove github link",
            fields: {},
            questions: [],
            warnings: [],
          },
        };
      }

      return {
        ok: true,
        usedModel: "test",
        attempts: 1,
        extraction: {
          intent: "content_operation",
          entity: "participant",
          action: "update",
          slug: null,
          targetRef: "ikotelnikov",
          confidence: "high",
          needsConfirmation: true,
          summary: "update participant bio and links",
          fields: {
            bio: "Builds the club in English.",
            links: [
              { label: "GitHub", href: "https://github.com/ikotelnikov", external: true },
              { label: "Telegram", href: "https://t.me/ikotelnikov", external: true },
            ],
          },
          questions: [],
          warnings: [],
        },
      };
    },
    async resolveTarget() {
      return {
        ok: true,
        usedModel: "test",
        resolution: {
          matchedSlug: "ikotelnikov",
          confidence: "high",
          question: null,
        },
      };
    },
    async editEntityObject(input) {
      if (!/remove the github link/i.test(input.messageText || "")) {
        return {
          ok: true,
          usedModel: "test",
          result: {
            fields: {
              ...input.currentFields,
              ...input.requestedChanges,
            },
            summary: "applied initial edit",
            warnings: [],
          },
        };
      }

      objectEditInput = input;
      return {
        ok: true,
        usedModel: "test",
        result: {
          fields: {
            ...input.currentFields,
            links: [
              { label: "Telegram", href: "https://t.me/ikotelnikov", external: true },
            ],
          },
          summary: "removed github link",
          warnings: [],
        },
      };
    },
  };

  const first = await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      text: "update participant ikotelnikov bio and add GitHub and Telegram",
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
  });

  const second = await handleTelegramMessage({
    message: {
      message_id: 12,
      from: { id: 123 },
      chat: { id: 555 },
      text: "remove the github link",
    },
    updateId: 22,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
  });

  assert.equal(first.status, "processed");
  assert.equal(second.status, "processed");
  assert.ok(objectEditInput);
  assert.equal(objectEditInput.entity, "participant");
  assert.equal(objectEditInput.currentFields.links.length, 2);
  assert.equal(second.pendingState.operation.fields.links.length, 1);
  assert.equal(second.pendingState.operation.fields.links[0].label, "Telegram");
});

test("photo-only message continues an active project draft", async () => {
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
        gallery: [],
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
    async extractIntent(input) {
      if (input.pendingOperation) {
        return {
          ok: false,
          usedModel: "test",
          attempts: 1,
          reason: "validation_failed",
          error: "simulated vague photo follow-up",
          rawText: null,
        };
      }

      return {
        ok: true,
        usedModel: "test",
        attempts: 1,
        extraction: {
          intent: "content_operation",
          entity: "project",
          action: "update",
          slug: "montenegro-jewish-home",
          targetRef: "montenegro-jewish-home",
          confidence: "high",
          needsConfirmation: true,
          summary: "update project",
          fields: {
            title: "Montenegro Jewish Home",
            summary: "Community project",
          },
          questions: [],
          warnings: [],
        },
      };
    },
    async resolveTarget() {
      return {
        ok: true,
        usedModel: "test",
        resolution: {
          matchedSlug: "montenegro-jewish-home",
          confidence: "high",
          question: null,
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
  assert.equal(followUp.pendingState.operation.fields.gallery.length, 1);
  assert.match(followUp.pendingState.operation.fields.gallery[0].src, /assets\/uploads\/555\/12-photo-12-uniq1\.jpg/);
});

test("confirmed entity stays in session and can seed a new follow-up draft", async () => {
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
        links: [],
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
    async applyCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        nextItem: mapped.item,
        commitSha: "abc123",
        paths: {
          itemPath: "content/participants/items/ikotelnikov.json",
          indexPath: "content/participants/index.json",
          assetPaths: [],
        },
      };
    },
  };
  const extractionClient = {
    async extractIntent(input) {
      if (input.pendingOperation && /github/i.test(input.messageText)) {
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "participant",
            action: "update",
            slug: "ikotelnikov",
            targetRef: "ikotelnikov",
            confidence: "high",
            needsConfirmation: true,
            summary: "add github link",
            fields: {
              links: [
                {
                  label: "GitHub",
                  href: "https://github.com/ikotelnikov",
                  external: true,
                },
              ],
            },
            questions: [],
            warnings: [],
          },
        };
      }

      return {
        ok: true,
        usedModel: "test",
        attempts: 1,
        extraction: {
          intent: "content_operation",
          entity: "participant",
          action: "update",
          slug: null,
          targetRef: "ikotelnikov",
          confidence: "high",
          needsConfirmation: true,
          summary: "update participant bio",
          fields: {
            bio: "Builds the club in English.",
          },
          questions: [],
          warnings: [],
        },
      };
    },
    async resolveTarget() {
      return {
        ok: true,
        usedModel: "test",
        resolution: {
          matchedSlug: "ikotelnikov",
          confidence: "high",
          question: null,
        },
      };
    },
  };

  await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      text: "update participant ikotelnikov bio to Builds the club in English.",
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: false,
  });

  const confirmed = await handleTelegramMessage({
    message: {
      message_id: 12,
      from: { id: 123 },
      chat: { id: 555 },
      text: "confirm",
    },
    updateId: 22,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: false,
  });

  const storedAfterConfirm = await pendingStore.getPending(555);
  const ttlHours = (new Date(storedAfterConfirm.expiresAt).getTime() - new Date(storedAfterConfirm.createdAt).getTime()) / (1000 * 60 * 60);

  const followUp = await handleTelegramMessage({
    message: {
      message_id: 13,
      from: { id: 123 },
      chat: { id: 555 },
      text: "add github https://github.com/ikotelnikov",
    },
    updateId: 23,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient,
    dryRun: true,
  });

  const stored = await pendingStore.getPending(555);

  assert.equal(confirmed.status, "confirmed");
  assert.equal(stored.context.recentEntity.slug, "ikotelnikov");
  assert.equal(stored.state, "awaiting_confirmation");
  assert.ok(ttlHours >= 71.5);
  assert.equal(followUp.status, "processed");
  assert.equal(followUp.pendingState.operation.slug, "ikotelnikov");
  assert.equal(followUp.pendingState.operation.fields.links[0].href, "https://github.com/ikotelnikov");
  assert.equal(followUp.pendingState.operation.continuationOf.slug, "ikotelnikov");
});

test("photo-only message can start a continuation draft from recent project context", async () => {
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
        gallery: [],
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
    async applyCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        nextItem: mapped.item,
        commitSha: "abc123",
        paths: {
          itemPath: "content/projects/items/montenegro-jewish-home.json",
          indexPath: "content/projects/index.json",
          assetPaths: [],
        },
      };
    },
  };
  const extractionClient = {
    async extractIntent() {
      return {
        ok: false,
        usedModel: "test",
        attempts: 1,
        reason: "validation_failed",
        error: "simulated vague request",
        rawText: null,
      };
    },
    async resolveTarget() {
      return {
        ok: true,
        usedModel: "test",
        resolution: {
          matchedSlug: "montenegro-jewish-home",
          confidence: "high",
          question: null,
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
        entity: "project",
        slug: "montenegro-jewish-home",
        action: "create",
        fields: {
          slug: "montenegro-jewish-home",
          sourceLocale: "ru",
        },
      },
    },
  }));

  const followUp = await handleTelegramMessage({
    message: {
      message_id: 13,
      from: { id: 123 },
      chat: { id: 555 },
      photo: [{ file_id: "ph2", file_unique_id: "uniq2", width: 1200, height: 800, file_size: 1024 }],
    },
    updateId: 23,
    pendingStore,
    repository,
    photoStore,
    extractionClient,
    telegramClient,
    dryRun: true,
  });

  assert.equal(followUp.status, "processed");
  assert.equal(followUp.pendingState.operation.entity, "project");
  assert.equal(followUp.pendingState.operation.slug, "montenegro-jewish-home");
  assert.equal(followUp.pendingState.operation.fields.photoAction, "append");
  assert.equal(followUp.pendingState.operation.fields.gallery.length, 1);
});

test("ambiguous recent project continuation asks which project and keeps attachments", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async readItem(_entity, slug) {
      return {
        sourceLocale: "ru",
        slug,
        title: slug === "montenegro-jewish-home" ? "Montenegro Jewish Home" : "Budva Startup Week",
        status: "active",
        summary: "Community project",
        gallery: [],
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
          indexPath: "content/projects/index.json",
          itemPath: `content/projects/items/${parsedCommand.fields.slug}.json`,
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
        entity: "project",
        slug: "budva-startup-week",
        action: "create",
        fields: {
          slug: "budva-startup-week",
          title: "Budva Startup Week",
        },
      },
      recentEntities: [
        {
          entity: "project",
          slug: "budva-startup-week",
          action: "create",
          fields: {
            slug: "budva-startup-week",
            title: "Budva Startup Week",
          },
        },
        {
          entity: "project",
          slug: "montenegro-jewish-home",
          action: "create",
          fields: {
            slug: "montenegro-jewish-home",
            title: "Montenegro Jewish Home",
          },
        },
      ],
    },
  }));

  const clarification = await handleTelegramMessage({
    message: {
      message_id: 14,
      from: { id: 123 },
      chat: { id: 555 },
      caption: "add these photos to the project",
      photo: [{ file_id: "ph3", file_unique_id: "uniq3", width: 1200, height: 800, file_size: 1024 }],
    },
    updateId: 24,
    pendingStore,
    repository,
    photoStore,
    extractionClient: {
      async extractIntent() {
        return {
          ok: false,
          usedModel: "test",
          attempts: 1,
          reason: "validation_failed",
          error: "simulated vague project continuation",
          rawText: null,
        };
      },
    },
    telegramClient,
    dryRun: true,
  });

  const stored = await pendingStore.getPending(555);

  assert.equal(clarification.status, "clarification");
  assert.match(clarification.question, /Which item should I continue\?/);
  assert.match(clarification.question, /budva-startup-week/);
  assert.match(clarification.question, /montenegro-jewish-home/);
  assert.equal(stored.state, "awaiting_clarification");
  assert.equal(stored.operation.type, "continuation_selection");
  assert.equal(stored.operation.attachments.length, 1);
  assert.match(stored.operation.attachments[0].stagedPath, /assets\/uploads\/555\/14-photo-14-uniq3\.jpg/);
});

test("continuation selection accepts numeric reply and resumes the chosen project", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async readItem(_entity, slug) {
      return {
        sourceLocale: "ru",
        slug,
        title: slug === "budva-startup-week" ? "Budva Startup Week" : "Montenegro Jewish Home",
        status: "active",
        summary: "Community project",
        gallery: [],
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
          indexPath: "content/projects/index.json",
          itemPath: `content/projects/items/${parsedCommand.fields.slug}.json`,
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

  await pendingStore.setPending(555, createPendingRecord({
    chatId: 555,
    userId: 123,
    state: "awaiting_clarification",
    sourceMessageId: 14,
    sourceUpdateId: 24,
    operation: {
      type: "continuation_selection",
      text: "add these photos to the project",
      attachments: [
        {
          kind: "photo",
          fileId: "ph3",
          fileUniqueId: "uniq3",
          fileName: "photo-14-uniq3.jpg",
          mimeType: "image/jpeg",
          stagedPath: "assets/uploads/555/14-photo-14-uniq3.jpg",
        },
      ],
      candidates: [
        {
          entity: "project",
          slug: "budva-startup-week",
          action: "create",
          fields: {
            slug: "budva-startup-week",
            title: "Budva Startup Week",
          },
        },
        {
          entity: "project",
          slug: "montenegro-jewish-home",
          action: "create",
          fields: {
            slug: "montenegro-jewish-home",
            title: "Montenegro Jewish Home",
          },
        },
      ],
    },
    question: "Which item should I continue?",
    context: {
      recentEntity: {
        entity: "project",
        slug: "budva-startup-week",
        action: "create",
        fields: {
          slug: "budva-startup-week",
          title: "Budva Startup Week",
        },
      },
      recentEntities: [
        {
          entity: "project",
          slug: "budva-startup-week",
          action: "create",
          fields: {
            slug: "budva-startup-week",
            title: "Budva Startup Week",
          },
        },
        {
          entity: "project",
          slug: "montenegro-jewish-home",
          action: "create",
          fields: {
            slug: "montenegro-jewish-home",
            title: "Montenegro Jewish Home",
          },
        },
      ],
    },
  }));

  const resumed = await handleTelegramMessage({
    message: {
      message_id: 15,
      from: { id: 123 },
      chat: { id: 555 },
      text: "2",
    },
    updateId: 25,
    pendingStore,
    repository,
    photoStore,
    extractionClient: {
      async extractIntent() {
        throw new Error("selection reply should not call extraction");
      },
    },
    dryRun: true,
  });

  assert.equal(resumed.status, "processed");
  assert.equal(resumed.pendingState.operation.slug, "montenegro-jewish-home");
  assert.equal(resumed.pendingState.operation.fields.gallery.length, 1);
  assert.match(resumed.pendingState.operation.fields.gallery[0].src, /assets\/uploads\/555\/14-photo-14-uniq3\.jpg/);
});

test("generic operation clarification buffers attachments and resumes on later target reply", async () => {
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
      async extractIntent() {
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "participant",
            action: "update",
            slug: null,
            targetRef: null,
            confidence: "medium",
            needsConfirmation: true,
            summary: "update participant description",
            fields: {
              bio: "Новое описание",
            },
            questions: [],
            warnings: [],
          },
        };
      },
      async resolveTarget() {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: null,
            confidence: "low",
            question: null,
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(clarification.status, "clarification");
  assert.equal(clarification.pendingState.operation.type, "operation_resolution");

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
      async extractIntent() {
        throw new Error("generic clarification reply should not call extraction");
      },
      async resolveTarget() {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: null,
            confidence: "low",
            question: null,
          },
        };
      },
    },
    telegramClient,
    dryRun: true,
  });

  assert.equal(withPhoto.status, "clarification");
  assert.equal(withPhoto.pendingState.operation.attachments.length, 1);

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
      async extractIntent() {
        throw new Error("generic clarification reply should not call extraction");
      },
      async resolveTarget({ candidates }) {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: candidates.find((candidate) => candidate.slug === "tatyana-nirman")?.slug || null,
            confidence: "high",
            question: null,
          },
        };
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

test("medium-confidence target resolution asks for explicit clarification instead of auto-selecting", async () => {
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
      async extractIntent() {
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "participant",
            action: "update",
            slug: null,
            targetRef: "Татьяна",
            confidence: "medium",
            needsConfirmation: true,
            summary: "update participant description",
            fields: {
              bio: "Новое описание",
            },
            questions: [],
            warnings: [],
          },
        };
      },
      async resolveTarget() {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: "tatyana-nirman",
            confidence: "medium",
            question: null,
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "clarification");
  assert.equal(result.pendingState.operation.type, "operation_resolution");
  assert.match(result.question, /I need to confirm which participant you want to update/);
  assert.match(result.question, /1\. Татьяна Нирман \(tatyana-nirman\)/);
  assert.match(result.question, /2\. Татьяна Шматко \(tatyana-shmatko\)/);
});

test("medium-confidence continuation lookup asks clarification instead of auto-selecting", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async readItem() {
      throw new Error("should not read item before clarification");
    },
    async stageAttachment({ chatId, messageId, attachment }) {
      return {
        ...attachment,
        stagedPath: `assets/uploads/${chatId}/${messageId}-${attachment.fileName}`,
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

  await pendingStore.setPending(555, createPendingRecord({
    chatId: 555,
    userId: 123,
    state: "idle",
    sourceMessageId: 10,
    sourceUpdateId: 20,
    operation: null,
    context: {
      recentEntities: [
        {
          entity: "participant",
          slug: "tatyana-nirman",
          action: "update",
          fields: {
            slug: "tatyana-nirman",
            name: "Татьяна Нирман",
          },
        },
        {
          entity: "participant",
          slug: "tatyana-shmatko",
          action: "update",
          fields: {
            slug: "tatyana-shmatko",
            name: "Татьяна Шматко",
          },
        },
      ],
    },
  }));

  const result = await handleTelegramMessage({
    message: {
      message_id: 51,
      from: { id: 123 },
      chat: { id: 555 },
      caption: "добавь это фото для Татьяны",
      photo: [{ file_id: "ph7", file_unique_id: "uniq7", width: 1200, height: 800, file_size: 1024 }],
    },
    updateId: 61,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async extractIntent() {
        throw new Error("continuation routing should not call extractIntent");
      },
      async resolveTarget({ candidates }) {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: candidates.find((candidate) => candidate.slug === "tatyana-nirman")?.slug || null,
            confidence: "medium",
            question: null,
          },
        };
      },
    },
    telegramClient,
    dryRun: true,
  });

  assert.equal(result.status, "clarification");
  assert.equal(result.pendingState.operation.type, "continuation_selection");
  assert.match(result.question, /Which item should I continue\?/);
  assert.match(result.question, /Татьяна Нирман \(tatyana-nirman\)/);
  assert.match(result.question, /Татьяна Шматко \(tatyana-shmatko\)/);
});

test("recent entity ranking prefers explicit text match over plain recency", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
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
      async extractIntent() {
        return {
          ok: false,
          usedModel: "test",
          attempts: 1,
          reason: "validation_failed",
          error: "simulate continuation fallback",
          rawText: null,
        };
      },
      async resolveTarget({ candidates }) {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: candidates.find((candidate) => candidate.slug === "tatyana-nirman")?.slug || null,
            confidence: "high",
            question: null,
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.slug, "tatyana-nirman");
  assert.equal(result.pendingState.operation.continuationOf.slug, "tatyana-nirman");
});

test("continuation selection buffers extra text and photos until the final answer", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async readItem(_entity, slug) {
      return {
        sourceLocale: "ru",
        slug,
        title: slug === "budva-startup-week" ? "Budva Startup Week" : "Montenegro Jewish Home",
        status: "active",
        summary: "Community project",
        gallery: [],
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
          indexPath: "content/projects/index.json",
          itemPath: `content/projects/items/${parsedCommand.fields.slug}.json`,
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
    state: "awaiting_clarification",
    sourceMessageId: 14,
    sourceUpdateId: 24,
    operation: {
      type: "continuation_selection",
      text: "add these photos to the project",
      attachments: [
        {
          kind: "photo",
          fileId: "ph3",
          fileUniqueId: "uniq3",
          fileName: "photo-14-uniq3.jpg",
          mimeType: "image/jpeg",
          stagedPath: "assets/uploads/555/14-photo-14-uniq3.jpg",
        },
      ],
      candidates: [
        {
          entity: "project",
          slug: "budva-startup-week",
          action: "create",
          fields: {
            slug: "budva-startup-week",
            title: "Budva Startup Week",
          },
        },
        {
          entity: "project",
          slug: "montenegro-jewish-home",
          action: "create",
          fields: {
            slug: "montenegro-jewish-home",
            title: "Montenegro Jewish Home",
          },
        },
      ],
    },
    question: "Which item should I continue?",
    context: {
      recentEntity: {
        entity: "project",
        slug: "budva-startup-week",
        action: "create",
        fields: {
          slug: "budva-startup-week",
          title: "Budva Startup Week",
        },
      },
      recentEntities: [
        {
          entity: "project",
          slug: "budva-startup-week",
          action: "create",
          fields: {
            slug: "budva-startup-week",
            title: "Budva Startup Week",
          },
        },
        {
          entity: "project",
          slug: "montenegro-jewish-home",
          action: "create",
          fields: {
            slug: "montenegro-jewish-home",
            title: "Montenegro Jewish Home",
          },
        },
      ],
    },
  }));

  const clarified = await handleTelegramMessage({
    message: {
      message_id: 15,
      from: { id: 123 },
      chat: { id: 555 },
      text: "и поставь это главным фото",
    },
    updateId: 25,
    pendingStore,
    repository,
    photoStore,
    extractionClient: {
      async extractIntent() {
        throw new Error("clarification replies should not call extraction");
      },
      async resolveTarget() {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: null,
            confidence: "low",
            question: null,
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(clarified.status, "clarification");
  assert.match(clarified.question, /Which item should I continue\?/);

  const pendingAfterText = await pendingStore.getPending(555);
  assert.match(pendingAfterText.operation.text, /add these photos to the project/);
  assert.match(pendingAfterText.operation.text, /поставь это главным фото/);

  const withAnotherPhoto = await handleTelegramMessage({
    message: {
      message_id: 16,
      from: { id: 123 },
      chat: { id: 555 },
      photo: [{ file_id: "ph4", file_unique_id: "uniq4", width: 1200, height: 800, file_size: 2048 }],
    },
    updateId: 26,
    pendingStore,
    repository,
    photoStore,
    extractionClient: {
      async extractIntent() {
        throw new Error("clarification replies should not call extraction");
      },
      async resolveTarget() {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: null,
            confidence: "low",
            question: null,
          },
        };
      },
    },
    telegramClient,
    dryRun: true,
  });

  assert.equal(withAnotherPhoto.status, "clarification");

  const pendingAfterPhoto = await pendingStore.getPending(555);
  assert.equal(pendingAfterPhoto.operation.attachments.length, 2);
  assert.match(pendingAfterPhoto.operation.attachments[1].stagedPath, /assets\/uploads\/555\/16-photo-16-uniq4\.jpg/);
  assert.match(pendingAfterPhoto.operation.text, /поставь это главным фото/);

  const resumed = await handleTelegramMessage({
    message: {
      message_id: 17,
      from: { id: 123 },
      chat: { id: 555 },
      text: "2",
    },
    updateId: 27,
    pendingStore,
    repository,
    photoStore,
    extractionClient: {
      async extractIntent() {
        throw new Error("selection reply should not call extraction");
      },
      async resolveTarget() {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: null,
            confidence: "low",
            question: null,
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(resumed.status, "processed");
  assert.equal(resumed.pendingState.operation.slug, "montenegro-jewish-home");
  assert.equal(resumed.pendingState.operation.fields.gallery.length, 2);
  assert.match(resumed.pendingState.operation.fields.gallery[0].src, /assets\/uploads\/555\/14-photo-14-uniq3\.jpg/);
  assert.match(resumed.pendingState.operation.fields.gallery[1].src, /assets\/uploads\/555\/16-photo-16-uniq4\.jpg/);
  assert.match(resumed.pendingState.operation.requestText, /add these photos to the project/);
  assert.match(resumed.pendingState.operation.requestText, /поставь это главным фото/);
  assert.doesNotMatch(resumed.pendingState.operation.requestText, /^2$/);
});

test("continuation lookup resolves a precise recent context entity by name via LLM", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
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
      async extractIntent() {
        return {
          ok: false,
          usedModel: "test",
          attempts: 1,
          reason: "validation_failed",
          error: "simulated continuation handoff",
          rawText: null,
        };
      },
      async resolveTarget({ candidates }) {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: candidates.find((candidate) => candidate.slug === "tatyana-nirman")?.slug || null,
            confidence: "high",
            question: null,
          },
        };
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

test("continuation lookup falls back to repository candidates via LLM", async () => {
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
      async extractIntent() {
        return {
          ok: false,
          usedModel: "test",
          attempts: 1,
          reason: "validation_failed",
          error: "simulated continuation handoff",
          rawText: null,
        };
      },
      async resolveTarget({ candidates }) {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: candidates.find((candidate) => candidate.slug === "tatyana-nirman")?.slug || null,
            confidence: "high",
            question: null,
          },
        };
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

test("text-only uncertain continuation resolves target via recent context and repository lookup", async () => {
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
      async extractIntent() {
        return {
          ok: false,
          usedModel: "test",
          attempts: 1,
          reason: "validation_failed",
          error: "simulated uncertain continuation",
          rawText: null,
        };
      },
      async resolveTarget({ candidates }) {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: candidates.find((candidate) => candidate.slug === "tatyana-nirman")?.slug || null,
            confidence: "high",
            question: null,
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.entity, "participant");
  assert.equal(result.pendingState.operation.slug, "tatyana-nirman");
});

test("project photo update can append an additional gallery image", async () => {
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
      async extractIntent() {
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "project",
            action: "update",
            slug: null,
            targetRef: "project-existing",
            confidence: "high",
            needsConfirmation: true,
            summary: "append project photo",
            fields: {
              photoStagedPath: "assets/uploads/555/11-photo.jpg",
              photoAlt: "Second screenshot",
            },
            questions: [],
            warnings: [],
          },
        };
      },
      async resolveTarget() {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: "project-existing",
            confidence: "high",
            question: null,
          },
        };
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

test("attachment-first request is buffered until text arrives", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
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
        currentIndex: { items: [] },
        nextIndex: { items: [parsedCommand.fields.slug] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/projects/index.json",
          itemPath: `content/projects/items/${parsedCommand.fields.slug}.json`,
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

  const buffered = await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      photo: [{ file_id: "ph1", file_unique_id: "uniq1", width: 1200, height: 800, file_size: 1024 }],
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async extractIntent() {
        throw new Error("buffered attachment should not call extraction yet");
      },
    },
    telegramClient,
    dryRun: true,
  });

  assert.equal(buffered.status, "clarification");
  assert.equal(buffered.pendingState.operation.type, "message_bundle");
  assert.equal(buffered.pendingState.operation.attachments.length, 1);

  const resumed = await handleTelegramMessage({
    message: {
      message_id: 12,
      from: { id: 123 },
      chat: { id: 555 },
      text: "create project Montenegro Jewish Home with status active, stack community, and use the photo",
    },
    updateId: 22,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async extractIntent(input) {
        assert.equal(input.attachments.length, 1);
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "project",
            action: "create",
            slug: null,
            targetRef: "Montenegro Jewish Home",
            confidence: "high",
            needsConfirmation: true,
            summary: "create project from buffered messages",
            fields: {
              title: "Montenegro Jewish Home",
              status: "active",
              stack: "community",
              points: ["Community events"],
              photoStagedPath: input.attachments[0].stagedPath,
              photoAlt: "Montenegro Jewish Home",
            },
            questions: [],
            warnings: [],
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(resumed.status, "processed");
  assert.equal(resumed.pendingState.operation.slug, "montenegro-jewish-home");
  assert.match(resumed.pendingState.operation.fields.photoStagedPath, /assets\/uploads\/555\/11-photo-11-uniq1\.jpg/);
});

test("buffers a non-actionable source text message into a message bundle", async () => {
  const pendingStore = new PendingMemoryStore();

  const result = await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      text: "Forwarded note about a property management project in Montenegro.\nWe prepare apartments, manage Airbnb operations, and handle licensing for owners.",
    },
    updateId: 21,
    pendingStore,
    repository: {},
    photoStore: null,
    extractionClient: {
      async extractIntent() {
        throw new Error("source-only bundle message should not trigger extraction");
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "clarification");
  assert.equal(result.pendingState.operation.type, "message_bundle");
  assert.equal(result.pendingState.operation.sourceMessages.length, 1);
  assert.match(result.question, /Saved this source message/i);
  assert.equal(result.pendingState.operation.requestText, null);
});

test("russian delete command is treated as an immediate instruction, not a source bundle", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: ["doveritelnoe-upravlenie-v-chernogorii"] },
        nextIndex: { items: ["doveritelnoe-upravlenie-v-chernogorii"] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/projects/index.json",
          itemPath: "content/projects/items/doveritelnoe-upravlenie-v-chernogorii.json",
          assetPaths: [],
        },
      };
    },
    async findEntityBySlug() {
      return "project";
    },
    async listEntityCandidates() {
      return [{
        slug: "doveritelnoe-upravlenie-v-chernogorii",
        label: "Доверительное управление в Черногории",
        title: "Доверительное управление в Черногории",
      }];
    },
    async readItem() {
      return {
        sourceLocale: "ru",
        slug: "doveritelnoe-upravlenie-v-chernogorii",
        title: "Доверительное управление в Черногории",
        status: "active",
        stack: "service",
        summary: "Summary",
        points: ["Point"],
        links: [
          { label: "Instagram", href: "https://instagram.com/tatyananirman", external: true },
          { label: "Telegram", href: "https://t.me/tatyananirman", external: true },
          { label: "instagram.com", href: "https://www.instagram.com/tatyananirman/", external: true },
        ],
      };
    },
  };

  const result = await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      text: 'Удали дублирующий тег "instagram.com" на странице проекта doveritelnoe-upravlenie-v-chernogorii',
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async classifyMessageTurn() {
        return {
          ok: true,
          usedModel: "test",
          routing: {
            decision: "direct_instruction",
            reason: "full edit request",
          },
        };
      },
      async extractIntent() {
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "project",
            action: "update",
            slug: null,
            targetRef: "doveritelnoe-upravlenie-v-chernogorii",
            confidence: "high",
            needsConfirmation: true,
            summary: "remove duplicate instagram tag",
            fields: {},
            questions: [],
            warnings: [],
          },
        };
      },
      async resolveTarget() {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: "doveritelnoe-upravlenie-v-chernogorii",
            confidence: "high",
            question: null,
          },
        };
      },
      async editEntityObject(input) {
        return {
          ok: true,
          usedModel: "test",
          result: {
            fields: {
              ...input.currentFields,
              links: [
                { label: "Instagram", href: "https://instagram.com/tatyananirman", external: true },
                { label: "Telegram", href: "https://t.me/tatyananirman", external: true },
              ],
            },
            summary: "removed duplicate instagram link",
            warnings: [],
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.type, undefined);
  assert.equal(result.pendingState.operation.slug, "doveritelnoe-upravlenie-v-chernogorii");
});

test("bundle clarification executes when the user sends 'выполняй'", async () => {
  const pendingStore = new PendingMemoryStore();
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
          indexPath: "content/projects/index.json",
          itemPath: `content/projects/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
  };

  await pendingStore.setPending(555, createPendingRecord({
    chatId: 555,
    userId: 123,
    state: "awaiting_clarification",
    sourceMessageId: 11,
    sourceUpdateId: 21,
    operation: {
      type: "message_bundle",
      requestText: "create a project from this",
      attachments: [],
      extraction: null,
      sourceMessages: [
        {
          kind: "text",
          messageId: 10,
          updateId: 20,
          text: "Project source material",
          formattedTextHtml: null,
          attachmentKinds: [],
        },
      ],
    },
    question: "Saved this source message.",
  }));

  const result = await handleTelegramMessage({
    message: {
      message_id: 12,
      from: { id: 123 },
      chat: { id: 555 },
      text: "выполняй",
    },
    updateId: 22,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async classifyMessageTurn() {
        return {
          ok: true,
          usedModel: "test",
          routing: {
            decision: "bundle_execute",
            reason: "user asked to proceed",
          },
        };
      },
      async extractIntent(input) {
        assert.equal(input.messageBundle.instructionText, "create a project from this");
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "project",
            action: "create",
            slug: null,
            targetRef: "Bundle Project",
            confidence: "high",
            needsConfirmation: true,
            summary: "create project from bundle",
            fields: {
              title: "Bundle Project",
              status: "active",
              stack: "community",
              points: ["Point"],
            },
            questions: [],
            warnings: [],
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.slug, "bundle-project");
});

test("appends additional source text to an existing message bundle", async () => {
  const pendingStore = new PendingMemoryStore();

  await pendingStore.setPending(555, createPendingRecord({
    chatId: 555,
    userId: 123,
    state: "awaiting_clarification",
    sourceMessageId: 11,
    sourceUpdateId: 21,
    operation: {
      type: "message_bundle",
      requestText: null,
      attachments: [],
      extraction: null,
      sourceMessages: [
        {
          kind: "text",
          messageId: 11,
          updateId: 21,
          text: "First forwarded message about the project.",
          formattedTextHtml: null,
          attachmentKinds: [],
        },
      ],
    },
    question: "Saved this source message.",
  }));

  const result = await handleTelegramMessage({
    message: {
      message_id: 12,
      from: { id: 123 },
      chat: { id: 555 },
      text: "Second forwarded message with Instagram and Telegram contacts for the same project.",
    },
    updateId: 22,
    pendingStore,
    repository: {},
    photoStore: null,
    extractionClient: {
      async extractIntent() {
        throw new Error("bundle append should not trigger extraction");
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "clarification");
  assert.equal(result.pendingState.operation.type, "message_bundle");
  assert.equal(result.pendingState.operation.sourceMessages.length, 2);
  assert.equal(result.pendingState.operation.requestText, null);
  assert.match(result.question, /Saved 2 source messages/i);
});

test("processes an explicit instruction against a buffered message bundle", async () => {
  const pendingStore = new PendingMemoryStore();
  let extractionInput = null;
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
          indexPath: "content/projects/index.json",
          itemPath: `content/projects/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
  };

  await pendingStore.setPending(555, createPendingRecord({
    chatId: 555,
    userId: 123,
    state: "awaiting_clarification",
    sourceMessageId: 11,
    sourceUpdateId: 21,
    operation: {
      type: "message_bundle",
      requestText: null,
      attachments: [],
      extraction: null,
      sourceMessages: [
        {
          kind: "forwarded_text",
          messageId: 11,
          updateId: 21,
          text: "We help Russian-speaking apartment owners in Montenegro earn from short-term rentals.",
          formattedTextHtml: null,
          attachmentKinds: [],
        },
        {
          kind: "text",
          messageId: 12,
          updateId: 22,
          text: "Instagram: https://instagram.com/example.manager and Telegram: https://t.me/examplemanager",
          formattedTextHtml: null,
          attachmentKinds: [],
        },
      ],
    },
    question: "Saved 2 source messages.",
  }));

  const result = await handleTelegramMessage({
    message: {
      message_id: 13,
      from: { id: 123 },
      chat: { id: 555 },
      text: "create a project from this",
    },
    updateId: 23,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async classifyMessageTurn() {
        return {
          ok: true,
          usedModel: "test",
          routing: {
            decision: "direct_instruction",
            reason: "explicit create instruction",
          },
        };
      },
      async extractIntent(input) {
        extractionInput = input;
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "project",
            action: "create",
            slug: null,
            targetRef: "Montenegro Rental Management",
            confidence: "high",
            needsConfirmation: true,
            summary: "create project from bundle",
            fields: {
              title: "Montenegro Rental Management",
              status: "active",
              stack: "service",
              points: ["Short-term rental management for owners in Montenegro"],
              links: [
                { label: "Instagram", href: "https://instagram.com/example.manager", external: true },
                { label: "Telegram", href: "https://t.me/examplemanager", external: true },
              ],
            },
            questions: [],
            warnings: [],
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.ok(extractionInput);
  assert.equal(extractionInput.messageText, "create a project from this");
  assert.equal(extractionInput.messageBundle.instructionText, "create a project from this");
  assert.equal(extractionInput.messageBundle.sourceMessages.length, 2);
  assert.match(extractionInput.messageBundle.sourceMessages[0].text, /Russian-speaking apartment owners/i);
  assert.equal(result.pendingState.operation.slug, "montenegro-rental-management");
});

test("incomplete create request becomes clarification and resumes from follow-up text", async () => {
  const pendingStore = new PendingMemoryStore();
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
          indexPath: "content/projects/index.json",
          itemPath: `content/projects/items/${parsedCommand.fields.slug}.json`,
          assetPaths: [],
        },
      };
    },
  };

  const first = await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      text: "create a new project",
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async extractIntent() {
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "project",
            action: "create",
            slug: null,
            targetRef: null,
            confidence: "medium",
            needsConfirmation: true,
            summary: "create project",
            fields: {
              status: "idea",
              stack: "community",
              points: ["TBD"],
            },
            questions: [],
            warnings: [],
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(first.status, "clarification");
  assert.equal(first.pendingState.operation.type, "incomplete_operation");

  const resumed = await handleTelegramMessage({
    message: {
      message_id: 12,
      from: { id: 123 },
      chat: { id: 555 },
      text: "title Montenegro Jewish Home",
    },
    updateId: 22,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async extractIntent(input) {
        assert.match(input.messageText, /create a new project/i);
        assert.match(input.messageText, /title Montenegro Jewish Home/i);
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "project",
            action: "create",
            slug: null,
            targetRef: "Montenegro Jewish Home",
            confidence: "high",
            needsConfirmation: true,
            summary: "create project with title",
            fields: {
              title: "Montenegro Jewish Home",
              status: "idea",
              stack: "community",
              points: ["TBD"],
            },
            questions: [],
            warnings: [],
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(resumed.status, "processed");
  assert.equal(resumed.pendingState.operation.slug, "montenegro-jewish-home");
});

test("project-context news draft inherits projectSlugs", async () => {
  const pendingStore = new PendingMemoryStore();
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
      text: "create a news post Airbnb: moja ljubov skvozi goda for this project",
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async extractIntent() {
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "announcement",
            action: "create",
            slug: null,
            targetRef: null,
            confidence: "high",
            needsConfirmation: true,
            summary: "create project news",
            fields: {
              date: "2026-04-17",
              title: "Airbnb: moja ljubov skvozi goda",
              place: "Online",
              format: "news",
              paragraphs: ["Update text"],
            },
            questions: [],
            warnings: [],
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.deepEqual(result.pendingState.operation.fields.projectSlugs, ["doveritelnoe-upravlenie-v-chernogorii"]);
  assert.deepEqual(result.operation.nextItem.projectSlugs, ["doveritelnoe-upravlenie-v-chernogorii"]);
});

test("explicit news update does not get forced into recent project context", async () => {
  const pendingStore = new PendingMemoryStore();
  const extractionInputs = [];
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
      async extractIntent(input) {
        extractionInputs.push(input);
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "announcement",
            action: "update",
            slug: null,
            targetRef: "airbnb-moja-ljubov-skozi-goda",
            confidence: "high",
            needsConfirmation: true,
            summary: "update announcement link to project",
            fields: {
              projectSlugs: ["doveritelnoe-upravlenie-v-chernogorii"],
            },
            questions: [],
            warnings: [],
          },
        };
      },
      async resolveTarget() {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: "airbnb-moja-ljubov-skozi-goda",
            confidence: "high",
            question: null,
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(extractionInputs.length, 1);
  assert.equal(extractionInputs[0].pendingOperation, null);
  assert.equal(result.pendingState.operation.entity, "announce");
  assert.equal(result.pendingState.operation.slug, "airbnb-moja-ljubov-skozi-goda");
  assert.deepEqual(result.pendingState.operation.fields.projectSlugs, ["doveritelnoe-upravlenie-v-chernogorii"]);
});

test("link dedupe keeps one canonical URL when labels differ", async () => {
  const pendingStore = new PendingMemoryStore();
  const repository = {
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
    async findEntityBySlug() {
      return "project";
    },
    async listEntityCandidates() {
      return [{ slug: "montenegro-jewish-home", label: "Montenegro Jewish Home", title: "active" }];
    },
    async readItem() {
      return {
        sourceLocale: "ru",
        slug: "montenegro-jewish-home",
        title: "Montenegro Jewish Home",
        status: "active",
        stack: "community",
        points: ["Events"],
        links: [
          { label: "instagram.com", href: "https://www.instagram.com/jevreji.me/", external: true },
        ],
      };
    },
  };

  const result = await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      text: "add Instagram https://instagram.com/jevreji.me/ to montenegro-jewish-home",
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async extractIntent() {
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "project",
            action: "update",
            slug: null,
            targetRef: "montenegro-jewish-home",
            confidence: "high",
            needsConfirmation: true,
            summary: "add instagram",
            fields: {
              links: [
                { label: "Instagram", href: "https://instagram.com/jevreji.me/", external: true },
              ],
            },
            questions: [],
            warnings: [],
          },
        };
      },
      async resolveTarget() {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: "montenegro-jewish-home",
            confidence: "high",
            question: null,
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.equal(result.pendingState.operation.fields.links.length, 1);
  assert.equal(result.pendingState.operation.fields.links[0].label, "Instagram");
});

test("update object edit can remove a duplicate project link from the current item", async () => {
  const pendingStore = new PendingMemoryStore();
  let objectEditInput = null;
  const repository = {
    async previewCommand(parsedCommand, mapped) {
      return {
        action: parsedCommand.action,
        entity: parsedCommand.entity,
        slug: parsedCommand.fields.slug,
        currentIndex: { items: ["doveritelnoe-upravlenie-v-chernogorii"] },
        nextIndex: { items: ["doveritelnoe-upravlenie-v-chernogorii"] },
        nextItem: mapped.item,
        paths: {
          indexPath: "content/projects/index.json",
          itemPath: "content/projects/items/doveritelnoe-upravlenie-v-chernogorii.json",
          assetPaths: [],
        },
      };
    },
    async findEntityBySlug() {
      return "project";
    },
    async listEntityCandidates() {
      return [{
        slug: "doveritelnoe-upravlenie-v-chernogorii",
        label: "Доверительное управление в Черногории",
        title: "Доверительное управление в Черногории",
      }];
    },
    async readItem() {
      return {
        sourceLocale: "ru",
        slug: "doveritelnoe-upravlenie-v-chernogorii",
        title: "Доверительное управление в Черногории",
        status: "active",
        stack: "service",
        summary: "Summary",
        points: ["Point"],
        links: [
          { label: "Instagram", href: "https://instagram.com/tatyananirman", external: true },
          { label: "Telegram", href: "https://t.me/tatyananirman", external: true },
          { label: "instagram.com", href: "https://www.instagram.com/tatyananirman/", external: true },
        ],
      };
    },
  };

  const result = await handleTelegramMessage({
    message: {
      message_id: 11,
      from: { id: 123 },
      chat: { id: 555 },
      text: "please clean up project doveritelnoe-upravlenie-v-chernogorii and remove the duplicated tag instagram.com",
    },
    updateId: 21,
    pendingStore,
    repository,
    photoStore: null,
    extractionClient: {
      async extractIntent() {
        return {
          ok: true,
          usedModel: "test",
          attempts: 1,
          extraction: {
            intent: "content_operation",
            entity: "project",
            action: "update",
            slug: null,
            targetRef: "doveritelnoe-upravlenie-v-chernogorii",
            confidence: "high",
            needsConfirmation: true,
            summary: "delete duplicate instagram link",
            fields: {},
            questions: [],
            warnings: [],
          },
        };
      },
      async resolveTarget() {
        return {
          ok: true,
          usedModel: "test",
          resolution: {
            matchedSlug: "doveritelnoe-upravlenie-v-chernogorii",
            confidence: "high",
            question: null,
          },
        };
      },
      async editEntityObject(input) {
        objectEditInput = input;
        return {
          ok: true,
          usedModel: "test",
          result: {
            fields: {
              ...input.currentFields,
              links: [
                { label: "Instagram", href: "https://instagram.com/tatyananirman", external: true },
                { label: "Telegram", href: "https://t.me/tatyananirman", external: true },
              ],
            },
            summary: "removed duplicate instagram link",
            warnings: [],
          },
        };
      },
    },
    dryRun: true,
  });

  assert.equal(result.status, "processed");
  assert.ok(objectEditInput);
  assert.equal(objectEditInput.entity, "project");
  assert.equal(objectEditInput.currentFields.links.length, 3);
  assert.equal(result.pendingState.operation.fields.links.length, 2);
  assert.equal(result.operation.nextItem.links.length, 2);
  assert.equal(result.pendingState.operation.fields.links.some((link) => link.label === "instagram.com"), false);
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
