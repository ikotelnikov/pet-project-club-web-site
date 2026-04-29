import test from "node:test";
import assert from "node:assert/strict";

import { buildIntentAnalysisMessages } from "./intent-analysis.js";
import { buildOperationGenerationMessages } from "./generate-operation.js";

test("intent prompt teaches natural-language reference extraction across entities", () => {
  const messages = buildIntentAnalysisMessages({
    turn: {
      chatId: 1,
      userId: 1,
      messages: [],
      recentContext: {
        lastConfirmedObject: null,
        pendingDraft: null,
      },
    },
  });

  const systemPrompt = messages[0].content;
  assert.match(systemPrompt, /target\.ref is the best currently available human identifier/i);
  assert.match(systemPrompt, /including Cyrillic and spaces/i);
  assert.match(systemPrompt, /Меня зовут Аскер/);
  assert.match(systemPrompt, /Airbnb: моя любовь сквозь года/);
  assert.match(systemPrompt, /переведи проект X' -> entity project/i);
  assert.match(systemPrompt, /do not default to participant just because a recent participant exists/i);
  assert.match(systemPrompt, /requestedLocales\.targetLocales to \['\*'\]/i);
  assert.match(systemPrompt, /переведи проект vpn-dlya-grupp на все языки/);
});

test("operation prompt teaches canonical slug generation from natural identifiers", () => {
  const messages = buildOperationGenerationMessages({
    turn: {
      recentContext: {
        lastConfirmedObject: null,
        pendingDraft: null,
        activeSession: null,
      },
      messages: [],
    },
    resolved: {
      intent: "create",
      entity: "participant",
      target: {
        slug: null,
        exists: false,
        ref: "Аскер",
      },
      relatedEntities: [],
      currentObject: null,
    },
    entitySchema: {
      entity: "participant",
    },
  });

  const systemPrompt = messages[0].content;
  assert.match(systemPrompt, /natural-language text, not a final slug/i);
  assert.match(systemPrompt, /lowercase ASCII kebab-case/i);
  assert.match(systemPrompt, /transliterate non-Latin text such as Cyrillic to Latin/i);
  assert.match(systemPrompt, /doveritelnoe-upravlenie-v-chernogorii/);
});

test("operation prompt includes exact entity schema and alias guidance", () => {
  const messages = buildOperationGenerationMessages({
    turn: {
      recentContext: {
        lastConfirmedObject: null,
        pendingDraft: null,
        activeSession: null,
      },
      messages: [],
    },
    resolved: {
      intent: "create",
      entity: "participant",
      target: {
        slug: null,
        exists: false,
        ref: "Аскер",
      },
      relatedEntities: [],
      currentObject: null,
    },
    entitySchema: {
      entity: "participant",
      required: ["slug", "handle", "name", "role", "bio"],
      optional: ["photoAlt", "photoStagedPath"],
      aliases: {
        description: "bio",
      },
    },
  });

  const systemPrompt = messages[0].content;
  const userPrompt = messages[1].content;
  assert.match(systemPrompt, /entitySchema is the exact allowed field contract/i);
  assert.match(systemPrompt, /map it through entitySchema\.aliases/i);
  assert.match(systemPrompt, /Never return fields outside entitySchema/i);
  assert.match(userPrompt, /"aliases":\{"description":"bio"\}/);
});
