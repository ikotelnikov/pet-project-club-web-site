import test from "node:test";
import assert from "node:assert/strict";

import { buildIntentAnalysisMessages } from "./intent-analysis.js";

test("intent analysis prompt includes staged attachment metadata", () => {
  const messages = buildIntentAnalysisMessages({
    turn: {
      chatId: 555,
      userId: 123,
      recentContext: null,
      messages: [{
        messageId: 999,
        text: "добавь это фото к проекту systema-works",
        formattedTextHtml: null,
        attachments: [{
          kind: "photo",
          originalKind: "document",
          fileName: "capture_20260522192336355.png",
          stagedPath: "assets/uploads/555/999-capture_20260522192336355.png",
          mimeType: "image/png",
        }],
      }],
    },
  });

  const userPayload = JSON.parse(messages[1].content);
  assert.deepEqual(userPayload.messages[0].attachmentKinds, ["photo"]);
  assert.deepEqual(userPayload.messages[0].attachments, [{
    kind: "photo",
    originalKind: "document",
    fileName: "capture_20260522192336355.png",
    stagedPath: "assets/uploads/555/999-capture_20260522192336355.png",
    mimeType: "image/png",
  }]);
});
