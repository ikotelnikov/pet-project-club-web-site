import fs from "node:fs/promises";
import path from "node:path";

export class FileOffsetStore {
  constructor({ stateFilePath }) {
    this.stateFilePath = stateFilePath;
  }

  async readOffset() {
    try {
      const raw = await fs.readFile(this.stateFilePath, "utf8");
      const data = JSON.parse(raw);
      return Number.isInteger(data.updateOffset) ? data.updateOffset : 0;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return 0;
      }

      throw error;
    }
  }

  async writeOffset(updateOffset) {
    await fs.mkdir(path.dirname(this.stateFilePath), { recursive: true });
    await fs.writeFile(
      this.stateFilePath,
      `${JSON.stringify({ updateOffset }, null, 2)}\n`,
      "utf8"
    );
  }
}
