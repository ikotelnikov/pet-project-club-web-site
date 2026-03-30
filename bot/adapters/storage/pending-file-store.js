import fs from "node:fs/promises";
import path from "node:path";

import { normalizePendingKey } from "../../core/confirmation-flow.js";

export class PendingFileStore {
  constructor({ storageRoot }) {
    this.storageRoot = storageRoot;
  }

  async getPending(chatId) {
    const filePath = this.resolveFilePath(chatId);

    try {
      const raw = await fs.readFile(filePath, "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async setPending(chatId, record) {
    const filePath = this.resolveFilePath(chatId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  async deletePending(chatId) {
    const filePath = this.resolveFilePath(chatId);
    await fs.rm(filePath, { force: true });
  }

  resolveFilePath(chatId) {
    return path.join(this.storageRoot, `${normalizePendingKey(chatId)}.json`);
  }
}
