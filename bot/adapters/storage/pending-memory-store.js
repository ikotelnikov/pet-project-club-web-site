export class PendingMemoryStore {
  constructor() {
    this.records = new Map();
  }

  async getPending(chatId) {
    return this.records.get(chatId) ?? null;
  }

  async setPending(chatId, record) {
    this.records.set(chatId, record);
  }

  async deletePending(chatId) {
    this.records.delete(chatId);
  }
}
