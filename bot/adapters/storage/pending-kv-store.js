import { normalizePendingKey } from "../../core/confirmation-flow.js";

export class PendingKvStore {
  constructor({ namespace, keyPrefix = "telegram-bot" }) {
    if (!namespace || typeof namespace.get !== "function") {
      throw new Error("PendingKvStore requires a KV namespace-like object with get/put/delete.");
    }

    this.namespace = namespace;
    this.keyPrefix = keyPrefix;
  }

  async getPending(chatId) {
    const raw = await this.namespace.get(this.resolveKey(chatId));

    if (!raw) {
      return null;
    }

    return JSON.parse(raw);
  }

  async setPending(chatId, record) {
    const ttlSeconds = resolveTtlSeconds(record);

    await this.namespace.put(this.resolveKey(chatId), JSON.stringify(record), {
      expirationTtl: ttlSeconds,
    });
  }

  async deletePending(chatId) {
    await this.namespace.delete(this.resolveKey(chatId));
  }

  resolveKey(chatId) {
    return `${this.keyPrefix}:${normalizePendingKey(chatId)}`;
  }
}

function resolveTtlSeconds(record) {
  if (!record || !record.expiresAt) {
    return 6 * 60 * 60;
  }

  const deltaMs = new Date(record.expiresAt).getTime() - Date.now();
  return Math.max(60, Math.ceil(deltaMs / 1000));
}
