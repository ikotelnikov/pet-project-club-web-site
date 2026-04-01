import fs from "node:fs/promises";
import path from "node:path";

import { ContentRepositoryError } from "../domain/errors.js";

export class FilesystemContentRepository {
  constructor({ contentRoot, assetsRoot, attachmentStageRoot }) {
    this.contentRoot = contentRoot;
    this.assetsRoot = assetsRoot;
    this.attachmentStageRoot = attachmentStageRoot;
  }

  getEntityPaths(entity, slug = null) {
    const sectionRoot = this.resolveSectionRoot(entity);
    const indexPath = this.resolveIndexPath(entity);
    const itemPath = slug ? path.join(sectionRoot, "items", `${slug}.json`) : null;

    return {
      sectionRoot,
      indexPath,
      itemPath,
    };
  }

  resolveSectionRoot(entity) {
    switch (entity) {
      case "announce":
      case "meeting":
        return path.join(this.contentRoot, "meetings");
      case "participant":
        return path.join(this.contentRoot, "participants");
      case "project":
        return path.join(this.contentRoot, "projects");
      default:
        throw new ContentRepositoryError(`Unsupported entity '${entity}'.`);
    }
  }

  resolveIndexPath(entity) {
    switch (entity) {
      case "announce":
        return path.join(this.contentRoot, "meetings", "announcements", "index.json");
      case "meeting":
        return path.join(this.contentRoot, "meetings", "archive", "index.json");
      case "participant":
        return path.join(this.contentRoot, "participants", "index.json");
      case "project":
        return path.join(this.contentRoot, "projects", "index.json");
      default:
        throw new ContentRepositoryError(`Unsupported entity '${entity}'.`);
    }
  }

  resolveAssetDirectory(entity) {
    switch (entity) {
      case "announce":
      case "meeting":
        return path.join(this.assetsRoot, "meetings");
      case "participant":
        return path.join(this.assetsRoot, "participants");
      case "project":
        return path.join(this.assetsRoot, "projects");
      default:
        throw new ContentRepositoryError(`Unsupported entity '${entity}'.`);
    }
  }

  async readIndex(entity) {
    const indexPath = this.resolveIndexPath(entity);
    return readJsonFile(indexPath);
  }

  async readItem(entity, slug) {
    const { itemPath } = this.getEntityPaths(entity, slug);
    return readJsonFile(itemPath);
  }

  async listEntityCandidates(entity) {
    const index = await this.readIndex(entity);
    const slugs = Array.isArray(index.items) ? index.items : [];
    const items = await Promise.all(
      slugs.map(async (slug) => {
        const item = await this.readItem(entity, slug);
        return buildCandidate(entity, slug, item);
      })
    );

    return items;
  }

  async findEntityBySlug(slug) {
    for (const entity of ["announce", "meeting", "participant", "project"]) {
      if (await this.indexContainsSlug(entity, slug)) {
        return entity;
      }
    }

    return null;
  }

  async indexContainsSlug(entity, slug) {
    const index = await this.readIndex(entity);
    return Array.isArray(index.items) && index.items.includes(slug);
  }

  async stageAttachment({ chatId, messageId, attachment, bytes }) {
    const directory = path.join(this.attachmentStageRoot, String(chatId));
    const fileName = `${messageId}-${attachment.fileName}`;
    const stagedPath = path.join(directory, fileName);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(stagedPath, Buffer.from(bytes));

    return {
      ...attachment,
      stagedPath: normalizeRepoRelativePath(path.relative(process.cwd(), stagedPath)),
      localPath: stagedPath,
    };
  }

  async planStagedPhoto(entity, slug, stagedPath) {
    return stagedPath
      ? {
          entity,
          slug,
          stagedPath,
          srcPath: normalizeRepoRelativePath(path.relative(process.cwd(), path.resolve(stagedPath))),
        }
      : null;
  }

  async applyStagedPhoto(entity, slug, stagedPath) {
    return this.planStagedPhoto(entity, slug, stagedPath);
  }

  async deleteStagedAttachment(stagedPath) {
    if (!stagedPath) {
      return;
    }

    await fs.rm(path.resolve(stagedPath), { force: true });
  }

  async itemExists(entity, slug) {
    const { itemPath } = this.getEntityPaths(entity, slug);

    try {
      await fs.access(itemPath);
      return true;
    } catch {
      return false;
    }
  }

  async applyCommand(parsedCommand, { item }) {
    const { entity, action } = parsedCommand;
    const slug = parsedCommand.fields.slug;
    const exists = await this.itemExists(entity, slug);

    if (action === "create" && exists) {
      throw new ContentRepositoryError(`Cannot create '${slug}' because it already exists.`);
    }

    if ((action === "update" || action === "delete") && !exists) {
      throw new ContentRepositoryError(`Cannot ${action} '${slug}' because it does not exist.`);
    }

    const currentIndex = await this.readIndex(entity);
    const nextIndex = updateIndexItems(currentIndex, slug, action);
    const { itemPath, indexPath } = this.getEntityPaths(entity, slug);
    const existingItem = action === "delete" ? await this.readItem(entity, slug) : null;
    const assetPaths = action === "delete" ? resolveManagedAssetPaths(existingItem) : [];

    if (action === "delete") {
      await fs.rm(itemPath, { force: true });
      await Promise.all(assetPaths.map((assetPath) => fs.rm(path.resolve(assetPath), { force: true })));
    } else {
      await fs.mkdir(path.dirname(itemPath), { recursive: true });
      await writeJsonFile(itemPath, item);
    }

    await fs.mkdir(path.dirname(indexPath), { recursive: true });
    await writeJsonFile(indexPath, nextIndex);

    return {
      action,
      entity,
      slug,
      paths: {
        itemPath,
        indexPath,
        assetPaths,
      },
      indexChanged: JSON.stringify(currentIndex) !== JSON.stringify(nextIndex),
    };
  }

  async previewCommand(parsedCommand, { item }) {
    const { entity, action } = parsedCommand;
    const slug = parsedCommand.fields.slug;
    const exists = await this.itemExists(entity, slug);
    const currentIndex = await this.readIndex(entity);
    const existingItem = action === "delete" && exists ? await this.readItem(entity, slug) : null;
    const assetPaths = action === "delete" ? resolveManagedAssetPaths(existingItem) : [];

    if (action === "create" && exists) {
      throw new ContentRepositoryError(`Cannot create '${slug}' because it already exists.`);
    }

    if ((action === "update" || action === "delete") && !exists) {
      throw new ContentRepositoryError(`Cannot ${action} '${slug}' because it does not exist.`);
    }

    return {
      action,
      entity,
      slug,
      exists,
      currentIndex,
      nextIndex: updateIndexItems(currentIndex, slug, action),
      nextItem: item,
      paths: {
        ...this.getEntityPaths(entity, slug),
        assetPaths,
      },
    };
  }
}

async function readJsonFile(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    throw new ContentRepositoryError(`Failed to read JSON file '${filePath}': ${error.message}`);
  }
}

async function writeJsonFile(filePath, value) {
  try {
    await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } catch (error) {
    throw new ContentRepositoryError(`Failed to write JSON file '${filePath}': ${error.message}`);
  }
}

function updateIndexItems(indexData, slug, action) {
  const nextIndex = structuredClone(indexData);
  const items = Array.isArray(nextIndex.items) ? [...nextIndex.items] : [];

  if (action === "create") {
    if (!items.includes(slug)) {
      items.unshift(slug);
    }
  }

  if (action === "update") {
    if (!items.includes(slug)) {
      items.unshift(slug);
    }
  }

  if (action === "delete") {
    nextIndex.items = items.filter((entry) => entry !== slug);
    return nextIndex;
  }

  nextIndex.items = items;
  return nextIndex;
}

function buildCandidate(entity, slug, item) {
  switch (entity) {
    case "participant":
      return {
        slug,
        label: item.name || slug,
        handle: item.handle || null,
        title: item.role || null,
      };
    case "project":
      return {
        slug,
        label: item.title || slug,
        handle: null,
        title: item.status || null,
      };
    case "meeting":
    case "announce":
      return {
        slug,
        label: item.title || slug,
        handle: null,
        title: item.date || null,
      };
    default:
      return {
        slug,
        label: slug,
        handle: null,
        title: null,
      };
  }
}

function normalizeRepoRelativePath(value) {
  return value.split(path.sep).join("/");
}

function resolveManagedAssetPaths(item) {
  const paths = [];

  if (item?.photo?.src && typeof item.photo.src === "string" && item.photo.src.startsWith("assets/")) {
    paths.push(item.photo.src);
  }

  return paths;
}
