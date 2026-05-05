import test from "node:test";
import assert from "node:assert/strict";

import { handleTelegramWebhookRequest } from "./webhook.js";

function createRuntime({ result }) {
  const sentMessages = [];
  const translationRuns = [];

  return {
    sentMessages,
    translationRuns,
    telegramClient: {
      async sendMessage(payload) {
        sentMessages.push(payload);
        return { ok: true };
      },
      async answerCallbackQuery() {
        return { ok: true };
      },
    },
    logStore: {
      async write() {},
      async listRecent() { return []; },
    },
    async handleTelegramUpdate() {
      return result;
    },
    async runPostConfirmTranslations(job, options) {
      translationRuns.push({ job, options });
      return {
        successes: [],
        failures: [],
        remainingLocales: [],
      };
    },
    devMode: false,
  };
}

test("webhook sends immediate processing ack as reply to a normal message", async () => {
  const runtime = createRuntime({
    result: {
      status: "command",
      command: "help",
    },
  });

  const request = new Request("https://local.test/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      update_id: 1,
      message: {
        message_id: 100,
        from: { id: 123 },
        chat: { id: 555 },
        text: "/help",
      },
    }),
  });

  const response = await handleTelegramWebhookRequest({
    request,
    runtime,
  });

  assert.equal(response.status, 200);
  assert.equal(runtime.sentMessages.length, 2);
  assert.deepEqual(runtime.sentMessages[0], {
    chatId: 555,
    text: "Processing...",
    replyToMessageId: 100,
  });
  assert.equal(runtime.sentMessages[1].chatId, 555);
  assert.match(runtime.sentMessages[1].text, /Main controls:/);
});

test("webhook does not send processing ack for callback queries", async () => {
  const runtime = createRuntime({
    result: {
      status: "control",
      hasPending: false,
    },
  });

  const request = new Request("https://local.test/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      update_id: 2,
      callback_query: {
        id: "cb-1",
        from: { id: 123 },
        data: "confirm",
        message: {
          message_id: 101,
          chat: { id: 555 },
        },
      },
    }),
  });

  const response = await handleTelegramWebhookRequest({
    request,
    runtime,
  });

  assert.equal(response.status, 200);
  assert.equal(runtime.sentMessages.length, 1);
  assert.equal(runtime.sentMessages[0].chatId, 555);
  assert.doesNotMatch(runtime.sentMessages[0].text, /Processing\.\.\./);
});

test("webhook schedules confirmed translation plan as a one-locale background job", async () => {
  const waitUntilTasks = [];
  const runtime = createRuntime({
    result: {
      status: "confirmed",
      chatId: 555,
      operation: {
        entity: "project",
        action: "create",
        fields: {
          slug: "systema-works",
        },
      },
      writeResult: {
        entity: "project",
        slug: "systema-works",
      },
      translationPlan: {
        entity: "project",
        slug: "systema-works",
        sourceLocale: "ru",
        targetLocales: null,
      },
    },
  });

  const request = new Request("https://local.test/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      update_id: 3,
      callback_query: {
        id: "cb-2",
        from: { id: 123 },
        data: "confirm",
        message: {
          message_id: 102,
          chat: { id: 555 },
        },
      },
    }),
  });

  const response = await handleTelegramWebhookRequest({
    request,
    runtime,
    adminToken: "secret",
    executionCtx: {
      waitUntil(task) {
        waitUntilTasks.push(task);
      },
    },
  });

  assert.equal(response.status, 200);
  assert.equal(waitUntilTasks.length, 1);
  await Promise.all(waitUntilTasks);
  assert.equal(runtime.translationRuns.length, 1);
  assert.equal(runtime.translationRuns[0].options.maxLocales, 1);
  assert.deepEqual(runtime.translationRuns[0].job, {
    chatId: 555,
    entity: "project",
    slug: "systema-works",
    sourceLocale: "ru",
    targetLocales: null,
  });
});
