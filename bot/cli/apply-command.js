import process from "node:process";

import { loadBotConfig } from "../config.js";
import { CommandParseError } from "../domain/errors.js";
import { parseTelegramCommand } from "../parsers/telegram-command.js";
import { mapCommandToContent } from "../services/content-mapper.js";
import { LocalPhotoStore } from "../services/photo-store.js";
import { FilesystemContentRepository } from "../services/content-repository.js";

const argv = process.argv.slice(2);
const args = new Set(argv);
const dryRun = args.has("--dry-run");
const photoPath = readFlagValue(argv, "--photo");
const input = await readStdin();

try {
  const config = loadBotConfig();
  const repository = new FilesystemContentRepository(config);
  const photoStore = new LocalPhotoStore(repository);
  const parsed = parseTelegramCommand(input);
  const photo = await (dryRun
    ? photoStore.planPhoto(parsed.entity, parsed.fields.slug, photoPath)
    : photoStore.applyPhoto(parsed.entity, parsed.fields.slug, photoPath));
  const mapped = mapCommandToContent(parsed, {
    photoFilename: photo?.filename || null,
  });

  const result = dryRun
    ? await repository.previewCommand(parsed, mapped)
    : await repository.applyCommand(parsed, mapped);

  process.stdout.write(`${JSON.stringify({ ...result, photo }, null, 2)}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(error instanceof CommandParseError ? 2 : 1);
}

async function readStdin() {
  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  return chunks.join("");
}

function readFlagValue(argvList, flagName) {
  const index = argvList.indexOf(flagName);

  if (index === -1) {
    return null;
  }

  const value = argvList[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Flag '${flagName}' requires a value.`);
  }

  return value;
}
