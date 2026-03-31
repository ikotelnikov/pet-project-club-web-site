import path from "node:path";

import { GitHubContentRepository } from "../adapters/github/repository.js";
import { PendingFileStore } from "../adapters/storage/pending-file-store.js";
import { PendingMemoryStore } from "../adapters/storage/pending-memory-store.js";
import { handleTelegramMessage } from "../adapters/telegram/message-handler.js";
import { createExtractionClient } from "./create-extraction-client.js";
import { FilesystemContentRepository } from "../services/content-repository.js";
import { LocalPhotoStore } from "../services/photo-store.js";

export function createBotRuntime(config, overrides = {}) {
  const repository = overrides.repository || createRepository(config, overrides);
  const photoStore = overrides.photoStore || new LocalPhotoStore(repository);
  const pendingStore = overrides.pendingStore || createPendingStore(config, overrides);
  const extractionClient = overrides.extractionClient || createExtractionClient(config, {
    fetchImpl: overrides.fetchImpl,
  });
  const telegramClient = overrides.telegramClient || null;

  return {
    repository,
    photoStore,
    pendingStore,
    extractionClient,
    telegramClient,
    devMode: Boolean(config.devMode),
    async handleTelegramUpdate(update, options = {}) {
      return handleTelegramMessage({
        message: update.message,
        updateId: update.update_id,
        allowedUserId: config.telegramAllowedUserId,
        repository,
        pendingStore,
        photoStore,
        extractionClient,
        telegramClient,
        dryRun: options.dryRun ?? true,
      });
    },
  };
}

function createPendingStore(config, overrides) {
  if (overrides.useMemoryPendingStore) {
    return new PendingMemoryStore();
  }

  return new PendingFileStore({
    storageRoot: config.pendingStateRoot || path.join(config.repoRoot, "bot", "state", "pending"),
  });
}

function createRepository(config, overrides) {
  if (overrides.useGitHubRepository) {
    return new GitHubContentRepository({
      owner: config.githubRepoOwner,
      repo: config.githubRepoName,
      branch: config.githubBranch,
      token: config.githubWriteToken,
      fetchImpl: overrides.fetchImpl || fetch,
    });
  }

  return new FilesystemContentRepository(config);
}
