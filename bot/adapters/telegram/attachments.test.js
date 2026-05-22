import test from "node:test";
import assert from "node:assert/strict";

import { extractTelegramAttachments } from "./attachments.js";

test("extractTelegramAttachments treats supported image documents as photos", () => {
  const attachments = extractTelegramAttachments({
    message_id: 999,
    document: {
      file_id: "file-1",
      file_unique_id: "unique-1",
      file_name: "capture_20260522192336355.png",
      mime_type: "image/png",
      file_size: 100333,
    },
  });

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].kind, "photo");
  assert.equal(attachments[0].originalKind, "document");
  assert.equal(attachments[0].fileName, "capture_20260522192336355.png");
  assert.equal(attachments[0].mimeType, "image/png");
});

test("extractTelegramAttachments keeps non-image documents as documents", () => {
  const attachments = extractTelegramAttachments({
    document: {
      file_id: "file-2",
      file_unique_id: "unique-2",
      file_name: "notes.pdf",
      mime_type: "application/pdf",
    },
  });

  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].kind, "document");
});
