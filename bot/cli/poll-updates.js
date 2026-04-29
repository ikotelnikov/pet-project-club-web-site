import process from "node:process";

import { loadBotConfig } from "../config.js";
import { ExtractionClient } from "../adapters/openai/extraction-client.js";
import { PendingFileStore } from "../adapters/storage/pending-file-store.js";
import { PrototypeExtractionClient } from "../adapters/openai/prototype-extraction-client.js";
import { FilesystemContentRepository } from "../services/content-repository.js";
import { FileOffsetStore } from "../services/offset-store.js";
import { LocalPhotoStore } from "../services/photo-store.js";
import { TelegramClient } from "../services/telegram-client.js";
import { processTelegramUpdates } from "../services/telegram-update-processor.js";

const args = new Set(process.argv.slice(2));
const dryRun = !args.has("--apply");

try {
  const config = loadBotConfig();
  const telegramClient = new TelegramClient({
    botToken: config.telegramBotToken,
  });
  const repository = new FilesystemContentRepository(config);
  const photoStore = new LocalPhotoStore(repository);
  const extractionClient = createExtractionClient(config);
  const pendingStore = new PendingFileStore({
    storageRoot: config.pendingStateRoot,
  });
  const offsetStore = new FileOffsetStore({
    stateFilePath: config.telegramOffsetStatePath,
  });
  const offset = await offsetStore.readOffset();

  if (config.telegramUpdateCoalesceDelayMs > 0) {
    await delay(config.telegramUpdateCoalesceDelayMs);
  }

  const updates = await telegramClient.getUpdates({
    offset,
    limit: 20,
    timeout: 0,
  });
  const result = await processTelegramUpdates({
    updates,
    allowedUserId: config.telegramAllowedUserId,
    repository,
    photoStore,
    telegramClient,
    offsetStore,
    pendingStore,
    extractionClient,
    useIntentPipeline: config.useIntentPipeline,
    dryRun,
  });

  process.stdout.write(`${JSON.stringify({ dryRun, fetched: updates.length, ...result }, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function createExtractionClient(config) {
  if (config.extractionBackend === "openai") {
    return new ExtractionClient({
      apiKey: config.openAiApiKey,
      model: config.openAiModel || undefined,
    });
  }

  return new PrototypeExtractionClient();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
