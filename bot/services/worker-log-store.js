const DEFAULT_INDEX_KEY = "worker-log:index";
const DEFAULT_MAX_ENTRIES = 200;

export class WorkerKvLogStore {
  constructor({ namespace, indexKey = DEFAULT_INDEX_KEY, maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
    if (!namespace || typeof namespace.get !== "function" || typeof namespace.put !== "function") {
      throw new Error("WorkerKvLogStore requires a KV namespace-like object with get and put.");
    }

    this.namespace = namespace;
    this.indexKey = indexKey;
    this.maxEntries = Number.isInteger(maxEntries) && maxEntries > 0 ? maxEntries : DEFAULT_MAX_ENTRIES;
  }

  async write(entry) {
    const now = new Date();
    const timestamp = now.toISOString();
    const key = buildLogKey(now);
    const normalized = normalizeLogEntry(entry, {
      key,
      timestamp,
    });

    await this.namespace.put(key, JSON.stringify(normalized));

    const index = await this.#readIndex();
    index.unshift(buildIndexEntry(normalized));

    const dedupedIndex = index
      .filter((item, position, items) =>
        item?.key &&
        position === items.findIndex((candidate) => candidate?.key === item.key)
      );
    const nextIndex = dedupedIndex.slice(0, this.maxEntries);
    const overflow = dedupedIndex.slice(this.maxEntries);

    await this.namespace.put(this.indexKey, JSON.stringify(nextIndex));

    if (typeof this.namespace.delete === "function") {
      await Promise.all(
        overflow
          .map((item) => item?.key)
          .filter(Boolean)
          .map((key) => this.namespace.delete(key))
      );
    }

    return normalized;
  }

  async listRecent(filters = {}) {
    const {
      limit = 20,
      level = null,
      event = null,
      since = null,
    } = filters;
    const normalizedLimit = Math.max(1, Math.min(100, Number.parseInt(String(limit), 10) || 20));
    const sinceTimestamp = normalizeSinceTimestamp(since);
    const index = await this.#readIndex();
    const matched = index.filter((item) => {
      if (!item?.key) {
        return false;
      }

      if (level && item.level !== level) {
        return false;
      }

      if (event && item.event !== event) {
        return false;
      }

      if (sinceTimestamp && typeof item.timestamp === "string" && item.timestamp < sinceTimestamp) {
        return false;
      }

      return true;
    }).slice(0, normalizedLimit);

    const records = [];

    for (const item of matched) {
      const raw = await this.namespace.get(item.key);
      if (!raw) {
        continue;
      }

      try {
        records.push(JSON.parse(raw));
      } catch {
        // Skip malformed records but keep the endpoint usable.
      }
    }

    return records;
  }

  async #readIndex() {
    const raw = await this.namespace.get(this.indexKey);

    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

export class NoopWorkerLogStore {
  async write(entry) {
    return entry;
  }

  async listRecent() {
    return [];
  }
}

function buildLogKey(now) {
  const random = Math.random().toString(36).slice(2, 10);
  return `worker-log:${now.getTime()}:${random}`;
}

function normalizeLogEntry(entry, defaults) {
  const normalized = entry && typeof entry === "object" ? entry : {};

  return {
    key: defaults.key,
    timestamp: defaults.timestamp,
    level: normalizeLevel(normalized.level),
    event: typeof normalized.event === "string" && normalized.event.trim() ? normalized.event.trim() : "app_log",
    message: typeof normalized.message === "string" && normalized.message.trim() ? normalized.message.trim() : null,
    updateId: normalized.updateId ?? null,
    messageId: normalized.messageId ?? null,
    chatId: normalized.chatId ?? null,
    fromUserId: normalized.fromUserId ?? null,
    payload: normalized.payload && typeof normalized.payload === "object" ? normalized.payload : {},
  };
}

function buildIndexEntry(entry) {
  return {
    key: entry.key,
    timestamp: entry.timestamp,
    level: entry.level,
    event: entry.event,
    updateId: entry.updateId ?? null,
    chatId: entry.chatId ?? null,
  };
}

function normalizeLevel(level) {
  const normalized = typeof level === "string" ? level.trim().toLowerCase() : "";

  if (normalized === "debug" || normalized === "info" || normalized === "warn" || normalized === "error") {
    return normalized;
  }

  return "info";
}

function normalizeSinceTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
