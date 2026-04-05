import { BotConfigError } from "../../shared/errors.js";
import {
  applyTranslationToItem,
  DEFAULT_SOURCE_LOCALE,
  extractLocalizableFields,
  normalizeContentLocale,
  SUPPORTED_LOCALES,
} from "../../core/content-localization.js";

export class TranslationClient {
  constructor({ apiKey, model = "gpt-4.1-mini", fetchImpl = globalThis.fetch } = {}) {
    if (!apiKey) {
      throw new BotConfigError("OPENAI_API_KEY is required for the OpenAI translation client.");
    }

    if (typeof fetchImpl !== "function") {
      throw new BotConfigError("A fetch implementation is required for the OpenAI translation client.");
    }

    this.kind = "openai-translation";
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
  }

  async translateItem({ entity, item, sourceLocale = DEFAULT_SOURCE_LOCALE, targetLocales = SUPPORTED_LOCALES.filter((locale) => locale !== DEFAULT_SOURCE_LOCALE) }) {
    let nextItem = { ...item };
    const normalizedSourceLocale = normalizeContentLocale(sourceLocale) || DEFAULT_SOURCE_LOCALE;
    const localizableFields = extractLocalizableFields(entity, item);

    for (const locale of targetLocales) {
      const normalizedLocale = normalizeContentLocale(locale);

      if (!normalizedLocale || normalizedLocale === normalizedSourceLocale) {
        continue;
      }

      if (nextItem.translationStatus?.[normalizedLocale] === "edited") {
        continue;
      }

      const translatedFields = await this.translateFields({
        entity,
        sourceLocale: normalizedSourceLocale,
        targetLocale: normalizedLocale,
        fields: localizableFields,
      });

      nextItem = applyTranslationToItem(entity, nextItem, normalizedLocale, translatedFields, "machine");
    }

    return nextItem;
  }

  async translateFields({ entity, sourceLocale, targetLocale, fields }) {
    const body = {
      model: this.model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: buildTranslationPrompt(),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify({
                entity,
                sourceLocale,
                targetLocale,
                fields,
              }, null, 2),
            },
          ],
        },
      ],
    };

    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`OpenAI translation API returned status ${response.status}.`);
    }

    const data = await response.json();
    const text = extractJsonTextOutput(data);
    const parsed = JSON.parse(text);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Translation output must be a JSON object.");
    }

    return parsed;
  }
}

function buildTranslationPrompt() {
  return [
    "You translate website content fields into another locale.",
    "Return JSON only.",
    "Preserve the exact object shape of the provided fields.",
    "Translate only user-facing text.",
    "Do not change slugs, ids, URLs, handles, file paths, or HTML structure inside strings unless translation of visible text requires it.",
    "Keep arrays, paragraph boundaries, section boundaries, and link counts stable.",
    "When a link object includes label, href, external, translate label but preserve href and external.",
    "When a photo object includes src and alt, translate alt but preserve src.",
    "Supported target locales are ru, en, de, me, es.",
  ].join(" ");
}

function extractTextOutput(responseData) {
  if (typeof responseData.output_text === "string" && responseData.output_text.trim() !== "") {
    return responseData.output_text;
  }

  const chunks = [];

  for (const outputItem of responseData.output ?? []) {
    for (const contentItem of outputItem.content ?? []) {
      if (contentItem.type === "output_text" && typeof contentItem.text === "string") {
        chunks.push(contentItem.text);
      }
    }
  }

  const combined = chunks.join("\n").trim();

  if (!combined) {
    throw new Error("OpenAI translation response did not include text output.");
  }

  return combined;
}

function extractJsonTextOutput(responseData) {
  const text = extractTextOutput(responseData);
  return stripJsonCodeFences(text);
}

function stripJsonCodeFences(text) {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}
