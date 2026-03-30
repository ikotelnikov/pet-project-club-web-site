import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { FilesystemContentRepository } from "./content-repository.js";
import { FileOffsetStore } from "./offset-store.js";
import { LocalPhotoStore } from "./photo-store.js";
import { PendingFileStore } from "../adapters/storage/pending-file-store.js";
import { PrototypeExtractionClient } from "../adapters/openai/prototype-extraction-client.js";
import { extractCommandText } from "../adapters/telegram/message-handler.js";
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
