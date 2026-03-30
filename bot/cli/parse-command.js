import process from "node:process";

import { loadBotConfig } from "../config.js";
import { CommandParseError } from "../domain/errors.js";
import { parseTelegramCommand } from "../parsers/telegram-command.js";
import { FilesystemContentRepository } from "../services/content-repository.js";

const input = await readStdin();

try {
  const config = loadBotConfig();
  const repository = new FilesystemContentRepository(config);
  const parsed = parseTelegramCommand(input);
  const paths = repository.getEntityPaths(parsed.entity, parsed.fields.slug || null);

  process.stdout.write(
    `${JSON.stringify(
      {
        parsed,
        paths,
      },
      null,
      2
    )}\n`
  );
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
