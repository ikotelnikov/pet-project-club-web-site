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
  assert.equal(await pendingStore.getPending(555), null);
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
