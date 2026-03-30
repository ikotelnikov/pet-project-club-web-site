import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { FilesystemContentRepository } from "./content-repository.js";

test("creates a participant item and updates the index", async () => {
  const fixture = await createFixture();
  const repository = new FilesystemContentRepository(fixture);

  const result = await repository.applyCommand(
    {
      entity: "participant",
      action: "create",
      fields: {
        slug: "participant-new-person",
      },
    },
    {
      item: {
        slug: "participant-new-person",
        handle: "@newperson",
        name: "New Person",
        role: "Builder",
        bio: "Bio",
        points: ["Point"],
      },
    }
  );

  const index = JSON.parse(await fs.readFile(path.join(fixture.contentRoot, "participants", "index.json"), "utf8"));
  const item = JSON.parse(
    await fs.readFile(
      path.join(fixture.contentRoot, "participants", "items", "participant-new-person.json"),
      "utf8"
    )
  );

  assert.equal(result.slug, "participant-new-person");
  assert.equal(index.items[0], "participant-new-person");
  assert.equal(item.name, "New Person");
});

test("updates an existing project item without duplicating the index entry", async () => {
  const fixture = await createFixture({
    entity: "project",
    slug: "project-existing",
    item: {
      slug: "project-existing",
      title: "Old title",
      status: "old",
      stack: "node",
      points: ["Old point"],
    },
  });
  const repository = new FilesystemContentRepository(fixture);

  await repository.applyCommand(
    {
      entity: "project",
      action: "update",
      fields: {
        slug: "project-existing",
      },
    },
    {
      item: {
        slug: "project-existing",
        title: "New title",
        status: "active",
        stack: "telegram / github actions",
        points: ["New point"],
      },
    }
  );

  const index = JSON.parse(await fs.readFile(path.join(fixture.contentRoot, "projects", "index.json"), "utf8"));
  const item = JSON.parse(
    await fs.readFile(path.join(fixture.contentRoot, "projects", "items", "project-existing.json"), "utf8")
  );

  assert.deepEqual(index.items, ["project-existing"]);
  assert.equal(item.title, "New title");
});

test("deletes an announcement and removes it from the index", async () => {
  const fixture = await createFixture({
    entity: "announce",
    slug: "announce-existing",
    item: {
      slug: "announce-existing",
      type: "announce",
      date: "2026-04-03",
      title: "Announcement",
      place: "Budva",
      format: "offline",
      paragraphs: ["One"],
    },
  });
  const repository = new FilesystemContentRepository(fixture);

  await repository.applyCommand(
    {
      entity: "announce",
      action: "delete",
      fields: {
        slug: "announce-existing",
      },
    },
    {
      item: null,
    }
  );

  const index = JSON.parse(
    await fs.readFile(path.join(fixture.contentRoot, "meetings", "announcements", "index.json"), "utf8")
  );

  await assert.rejects(
    () => fs.readFile(path.join(fixture.contentRoot, "meetings", "items", "announce-existing.json"), "utf8")
  );
  assert.deepEqual(index.items, []);
});

async function createFixture(seed = null) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ppc-bot-"));
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

  if (seed) {
    const repository = new FilesystemContentRepository({ contentRoot, assetsRoot });
    await repository.applyCommand(
      {
        entity: seed.entity,
        action: "create",
        fields: {
          slug: seed.slug,
        },
      },
      {
        item: seed.item,
      }
    );
  }

  return {
    contentRoot,
    assetsRoot,
  };
}
