import test from "node:test";
import assert from "node:assert/strict";

import { TranslationClient } from "./translation-client.js";

test("translateFields retries when the model changes the output shape", async () => {
  const requests = [];
  const responses = [
    {
      output_text: JSON.stringify({
        title: "Translated title",
        links: [
          {
            label: "Site",
          },
        ],
      }),
    },
    {
      output_text: JSON.stringify({
        title: "Translated title",
        detailsHtml: "<p><strong>Hola</strong></p>",
        links: [
          {
            label: "Sitio",
            href: "https://example.com",
            external: true,
          },
        ],
      }),
    },
  ];

  const client = new TranslationClient({
    apiKey: "test-key",
    fetchImpl: async (_url, options) => {
      requests.push(JSON.parse(options.body));

      return {
        ok: true,
        async json() {
          return responses.shift();
        },
      };
    },
  });

  const result = await client.translateFields({
    entity: "project",
    sourceLocale: "ru",
    targetLocale: "es",
    fields: {
      title: "Исходный заголовок",
      detailsHtml: "<p><strong>Привет</strong></p>",
      links: [
        {
          label: "Site",
          href: "https://example.com",
          external: true,
        },
      ],
    },
  });

  assert.equal(requests.length, 2);
  assert.match(
    requests[1].input[1].content[0].text,
    /Previous output was rejected\./
  );
  assert.deepEqual(result, {
    title: "Translated title",
    detailsHtml: "<p><strong>Hola</strong></p>",
    links: [
      {
        label: "Sitio",
        href: "https://example.com",
        external: true,
      },
    ],
  });
});
