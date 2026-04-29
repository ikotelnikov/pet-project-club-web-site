import test from "node:test";
import assert from "node:assert/strict";

import { buildTelegramReply, buildTelegramReplyText } from "./reply-text.js";

test("buildConfirmedText renders per-locale translation links when available", () => {
  const text = buildTelegramReplyText({
    status: "confirmed",
    writeResult: {
      action: "translate",
      entity: "announce",
      slug: "presentation-creometrix-0804",
      translationLinks: [
        {
          locale: "en",
          url: "https://example.com/en/meetings/item/?slug=presentation-creometrix-0804",
        },
        {
          locale: "de",
          url: "https://example.com/de/meetings/item/?slug=presentation-creometrix-0804",
        },
      ],
    },
  }, { dryRun: false });

  assert.match(text, /^Applied successfully\./);
  assert.match(text, /translate announce presentation-creometrix-0804/);
  assert.match(text, /Links:\nEN - https:\/\/example\.com\/en\/meetings\/item\/\?slug=presentation-creometrix-0804\nDE - https:\/\/example\.com\/de\/meetings\/item\/\?slug=presentation-creometrix-0804/);
  assert.doesNotMatch(text, /\nLink:/);
});

test("processed preview offers confirm and cancel only", () => {
  const reply = buildTelegramReply({
    status: "processed",
    pendingState: {
      state: "awaiting_confirmation",
      operation: {
        preview: {
          entity: "participant",
          action: "update",
          slug: "ikotelnikov",
          fields: {
            bio: "Builds the club.",
          },
          files: [],
          attachments: [],
        },
      },
    },
  }, { dryRun: false });

  assert.match(reply.text, /Reply with confirm or cancel\./);
  assert.match(reply.text, /send more details, links, or photos before confirming/i);
  assert.deepEqual(reply.replyMarkup, {
    inline_keyboard: [
      [
        { text: "Confirm", callback_data: "confirm" },
        { text: "Cancel", callback_data: "cancel" },
      ],
    ],
  });
});

test("processed preview mentions continued recent entity when present", () => {
  const reply = buildTelegramReply({
    status: "processed",
    pendingState: {
      state: "awaiting_confirmation",
      operation: {
        continuationOf: {
          entity: "participant",
          slug: "tatyana-nirman",
          summary: "Татьяна Нирман",
        },
        preview: {
          entity: "participant",
          action: "update",
          slug: "tatyana-nirman",
          fields: {
            bio: "Updated bio",
          },
          files: [],
          attachments: [],
        },
      },
    },
  }, { dryRun: false });

  assert.match(reply.text, /Continuing: participant tatyana-nirman \(Татьяна Нирман\)/);
});

test("processed preview renders compact diff lines for removals and additions", () => {
  const reply = buildTelegramReply({
    status: "processed",
    pendingState: {
      state: "awaiting_confirmation",
      operation: {
        preview: {
          entity: "project",
          action: "update",
          slug: "doveritelnoe-upravlenie-v-chernogorii",
          fields: {
            links: 2,
          },
          changes: [
            {
              field: "links",
              beforeCount: 3,
              afterCount: 2,
              removed: ["instagram.com -> https://www.instagram.com/tatyananirman/"],
              added: [],
            },
            {
              field: "summary",
              before: "Old summary",
              after: "New summary",
            },
          ],
          files: [],
          attachments: [],
        },
      },
    },
  }, { dryRun: false });

  assert.match(reply.text, /Changes:/);
  assert.match(reply.text, /links: removed instagram\.com -> https:\/\/www\.instagram\.com\/tatyananirman\//);
  assert.match(reply.text, /summary: Old summary -> New summary/);
});

test("command state reply renders context summary", () => {
  const text = buildTelegramReplyText({
    status: "command",
    command: "state",
    contextState: {
      hasContext: true,
      state: "awaiting_clarification",
      operationType: "v2_intent_clarification",
      messageCount: 3,
      fileCount: 1,
      intentSummary: {
        intent: "create",
        entity: "participant",
        targetRef: "asker",
      },
      doubt: {
        reason: "target_missing",
        question: "Which participant should be created?",
      },
    },
  });

  assert.match(text, /Context state: awaiting_clarification/);
  assert.match(text, /Pending type: v2_intent_clarification/);
  assert.match(text, /Messages: 3/);
  assert.match(text, /Files: 1/);
  assert.match(text, /Intent: create participant asker/);
  assert.match(text, /Doubt: target_missing: Which participant should be created\?/);
});

test("command help reply describes the new controls", () => {
  const text = buildTelegramReplyText({
    status: "command",
    command: "help",
  });

  assert.match(text, /\/new - clear the current context and start over/);
  assert.match(text, /\/state - show the current context/);
  assert.match(text, /\/help - show this help/);
  assert.match(text, /confirm or cancel/);
});
