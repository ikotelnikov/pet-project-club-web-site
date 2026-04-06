import test from "node:test";
import assert from "node:assert/strict";

import { buildTelegramReplyText } from "./reply-text.js";

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
