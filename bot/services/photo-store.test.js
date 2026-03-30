import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { ContentValidationError } from "../domain/errors.js";
import { FilesystemContentRepository } from "./content-repository.js";
import { LocalPhotoStore } from "./photo-store.js";

test("plans a participant photo with a canonical filename", async () => {
  const fixture = await createFixture();
  const repository = new FilesystemContentRepository(fixture);
  const store = new LocalPhotoStore(repository);
  const sourcePath = path.join(fixture.root, "source.jpg");

  await fs.writeFile(sourcePath, "fake image");

  const plan = await store.planPhoto("participant", "participant-ivan-kotelnikov", sourcePath);

  assert.equal(plan.filename, "participant-ivan-kotelnikov-01.jpg");
  assert.equal(
    plan.destinationPath,
    path.join(fixture.assetsRoot, "participants", "participant-ivan-kotelnikov-01.jpg")
  );
});

test("copies a project photo into the canonical assets folder", async () => {
  const fixture = await createFixture();
  const repository = new FilesystemContentRepository(fixture);
  const store = new LocalPhotoStore(repository);
  const sourcePath = path.join(fixture.root, "source.png");

  await fs.writeFile(sourcePath, "fake png bytes");

  const plan = await store.applyPhoto("project", "project-club-site-bot", sourcePath);
  const copied = await fs.readFile(plan.destinationPath, "utf8");

  assert.equal(copied, "fake png bytes");
});

test("rejects unsupported photo extensions", async () => {
  const fixture = await createFixture();
  const repository = new FilesystemContentRepository(fixture);
  const store = new LocalPhotoStore(repository);
  const sourcePath = path.join(fixture.root, "source.gif");

  await fs.writeFile(sourcePath, "gif bytes");

  await assert.rejects(
    () => store.planPhoto("meeting", "meeting-2026-03-open-circle", sourcePath),
    (error) =>
      error instanceof ContentValidationError &&
      error.message === "Unsupported photo extension '.gif'. Allowed: .jpg, .jpeg, .png, .webp."
  );
});

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ppc-photo-"));
  const contentRoot = path.join(root, "content");
  const assetsRoot = path.join(root, "assets");

  await fs.mkdir(contentRoot, { recursive: true });
  await fs.mkdir(assetsRoot, { recursive: true });

  return {
    root,
    contentRoot,
    assetsRoot,
  };
}
