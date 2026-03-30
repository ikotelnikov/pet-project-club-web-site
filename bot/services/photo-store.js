import fs from "node:fs/promises";
import path from "node:path";

import { ContentValidationError } from "../domain/errors.js";

const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

export class LocalPhotoStore {
  constructor(contentRepository) {
    this.contentRepository = contentRepository;
  }

  async planPhoto(entity, slug, sourcePath) {
    if (!sourcePath) {
      return null;
    }

    const resolvedSourcePath = path.resolve(sourcePath);
    const extension = await resolveExtension(resolvedSourcePath);
    const filename = `${slug}-01${extension}`;
    const directory = this.contentRepository.resolveAssetDirectory(entity);
    const destinationPath = path.join(directory, filename);

    return {
      entity,
      slug,
      sourcePath: resolvedSourcePath,
      filename,
      destinationPath,
    };
  }

  async applyPhoto(entity, slug, sourcePath) {
    const plan = await this.planPhoto(entity, slug, sourcePath);

    if (!plan) {
      return null;
    }

    await fs.mkdir(path.dirname(plan.destinationPath), { recursive: true });
    await fs.copyFile(plan.sourcePath, plan.destinationPath);

    return plan;
  }

  async planStagedPhoto(entity, slug, stagedPath) {
    if (typeof this.contentRepository.planStagedPhoto === "function") {
      return this.contentRepository.planStagedPhoto(entity, slug, stagedPath);
    }

    return this.planPhoto(entity, slug, stagedPath);
  }

  async applyStagedPhoto(entity, slug, stagedPath) {
    if (typeof this.contentRepository.applyStagedPhoto === "function") {
      return this.contentRepository.applyStagedPhoto(entity, slug, stagedPath);
    }

    return this.applyPhoto(entity, slug, stagedPath);
  }
}

async function resolveExtension(filePath) {
  try {
    const stats = await fs.stat(filePath);

    if (!stats.isFile()) {
      throw new ContentValidationError(`Photo source '${filePath}' is not a file.`);
    }
  } catch (error) {
    if (error instanceof ContentValidationError) {
      throw error;
    }

    throw new ContentValidationError(`Photo source '${filePath}' does not exist.`);
  }

  const extension = path.extname(filePath).toLowerCase();

  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new ContentValidationError(
      `Unsupported photo extension '${extension || "(none)"}'. Allowed: ${[...SUPPORTED_EXTENSIONS].join(", ")}.`
    );
  }

  return extension;
}
