import path from "node:path";

import { GitHubContentRepository } from "../adapters/github/repository.js";
import { PendingFileStore } from "../adapters/storage/pending-file-store.js";
import { PendingMemoryStore } from "../adapters/storage/pending-memory-store.js";
import { handleTelegramMessage } from "../adapters/telegram/message-handler.js";
import { createExtractionClient } from "./create-extraction-client.js";
import { createTranslationClient } from "./create-translation-client.js";
import { FilesystemContentRepository } from "../services/content-repository.js";
import { LocalPhotoStore } from "../services/photo-store.js";
import { buildContentPageUrl } from "../core/content-links.js";
import { runPostConfirmationTranslations } from "../services/post-confirmation-translation.js";

export function createBotRuntime(config, overrides = {}) {
  const publicSiteBaseUrl = resolvePublicSiteBaseUrl(config);
  const repository = overrides.repository || createRepository(config, overrides);
  const photoStore = overrides.photoStore || new LocalPhotoStore(repository);
  const pendingStore = overrides.pendingStore || createPendingStore(config, overrides);
  const extractionClient = overrides.extractionClient || createExtractionClient(config, {
    fetchImpl: overrides.fetchImpl,
  });
  const translationClient = overrides.translationClient === undefined
    ? createTranslationClient(config, { fetchImpl: overrides.fetchImpl })
    : overrides.translationClient;
  const telegramClient = overrides.telegramClient || null;

  return {
    repository,
    photoStore,
    pendingStore,
    extractionClient,
    translationClient,
    telegramClient,
    devMode: Boolean(config.devMode),
    publicSiteBaseUrl,
    async handleTelegramUpdate(update, options = {}) {
      const result = await handleTelegramMessage({
        message: update.message,
        updateId: update.update_id,
        allowedUserId: config.telegramAllowedUserId,
        repository,
        pendingStore,
        photoStore,
        extractionClient,
        translationClient,
        telegramClient,
        dryRun: options.dryRun ?? true,
      });

      return augmentTelegramResult(result, {
        publicSiteBaseUrl,
      });
    },
    async runPostConfirmTranslations(result) {
      if (!result?.translationPlan || !telegramClient) {
        return;
      }

      await runPostConfirmationTranslations({
        repository,
        translationClient,
        telegramClient,
        chatId: result.chatId,
        entity: result.translationPlan.entity,
        slug: result.translationPlan.slug,
        sourceLocale: result.translationPlan.sourceLocale,
        siteBaseUrl: publicSiteBaseUrl,
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

function resolvePublicSiteBaseUrl(config) {
  if (config.publicSiteBaseUrl) {
    return config.publicSiteBaseUrl;
  }

  if (config.githubRepoOwner && config.githubRepoName) {
    return `https://${config.githubRepoOwner}.github.io/${config.githubRepoName}`;
  }

  return null;
}

function augmentTelegramResult(result, { publicSiteBaseUrl } = {}) {
  if (!result?.writeResult?.entity || !result?.writeResult?.slug) {
    return result;
  }

  const sourceLocale =
    result.operation?.fields?.locale ||
    result.translationPlan?.sourceLocale ||
    result.operation?.fields?.sourceLocale ||
    result.pendingState?.operation?.fields?.sourceLocale ||
    "ru";

  return {
    ...result,
    writeResult: {
      ...result.writeResult,
      pageUrl: buildContentPageUrl({
        siteBaseUrl: publicSiteBaseUrl,
        entity: result.writeResult.entity,
        slug: result.writeResult.slug,
        locale: sourceLocale,
      }),
    },
  };
}
