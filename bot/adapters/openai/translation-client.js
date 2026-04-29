import { BotConfigError } from "../../shared/errors.js";
import {
  applyTranslationToItem,
  DEFAULT_SOURCE_LOCALE,
  extractLocalizableFields,
  normalizeContentLocale,
  SUPPORTED_LOCALES,
} from "../../core/content-localization.js";
import { dedupeLinks } from "../../core/link-normalization.js";

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
    const requestPayload = {
      entity,
      sourceLocale,
      targetLocale,
      fields,
    };
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const repairNote = attempt === 0 || !lastError
        ? null
        : [
            "Previous output was rejected.",
            `Fix these issues: ${lastError}`,
            "Return the full corrected JSON object, not a patch.",
          ].join(" ");
      const text = await this.requestTranslationJson(requestPayload, repairNote);
      const parsed = normalizeTranslatedFields(JSON.parse(text));

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        lastError = "Translation output must be a JSON object.";
        continue;
      }

      const validationError = validateTranslatedFields(fields, parsed);
      if (!validationError) {
        return parsed;
      }

      lastError = validationError;
    }

    throw new Error(`Translation output failed validation. ${lastError || ""}`.trim());
  }

  async requestTranslationJson(payload, repairNote = null) {
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
                ...payload,
                repairNote,
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
    return extractJsonTextOutput(data);
  }
}

function buildTranslationPrompt() {
  return [
    "You translate website content fields into another locale.",
    "Return JSON only.",
    "Preserve the exact object shape of the provided fields.",
    "Translate only user-facing text.",
    "Do not change slugs, ids, URLs, handles, file paths, or HTML structure inside strings unless translation of visible text requires it.",
    "For HTML strings, preserve the original markup structure exactly: keep the same tags, nesting, list structure, line breaks, emphasis, and ordering; translate only the visible text nodes.",
    "Never convert HTML into plain text, never drop list items, and never remove or add bold, italic, or bullet formatting unless the source text itself changes structure.",
    "Keep arrays, paragraph boundaries, section boundaries, and link counts stable.",
    "For Markdown or list-like plain strings, preserve paragraph breaks, blank lines, bullet markers, numbering, block quotes, and emphasis markers such as **bold**, *italic*, _, and backticks.",
    "If the source string contains line breaks or list markers, keep the same line structure and the same number of list items.",
    "Do not summarize, compress, reorder, or merge adjacent paragraphs or bullets.",
    "When a link object includes label, href, external, translate label but preserve href and external.",
    "Do not introduce duplicate links. If multiple source links resolve to the same canonical URL, keep only one translated entry for that URL.",
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

function normalizeTranslatedFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  if (value.fields && typeof value.fields === "object" && !Array.isArray(value.fields)) {
    return normalizeTranslatedLinks(value.fields);
  }

  if (value.translatedFields && typeof value.translatedFields === "object" && !Array.isArray(value.translatedFields)) {
    return normalizeTranslatedLinks(value.translatedFields);
  }

  return normalizeTranslatedLinks(value);
}

function validateTranslatedFields(sourceFields, translatedFields) {
  return validateNodeShape(sourceFields, translatedFields, "fields");
}

function validateNodeShape(sourceValue, translatedValue, path) {
  if (Array.isArray(sourceValue)) {
    if (!Array.isArray(translatedValue)) {
      return `${path} must stay an array.`;
    }

    if (translatedValue.length !== sourceValue.length) {
      return `${path} array length changed from ${sourceValue.length} to ${translatedValue.length}.`;
    }

    for (let index = 0; index < sourceValue.length; index += 1) {
      const error = validateNodeShape(sourceValue[index], translatedValue[index], `${path}[${index}]`);
      if (error) {
        return error;
      }
    }

    return null;
  }

  if (isPlainObject(sourceValue)) {
    if (!isPlainObject(translatedValue)) {
      return `${path} must stay an object.`;
    }

    const sourceKeys = Object.keys(sourceValue);
    const translatedKeys = Object.keys(translatedValue);

    for (const key of sourceKeys) {
      if (!Object.prototype.hasOwnProperty.call(translatedValue, key)) {
        return `${path}.${key} is missing.`;
      }
    }

    for (const key of translatedKeys) {
      if (!Object.prototype.hasOwnProperty.call(sourceValue, key)) {
        return `${path}.${key} is unexpected.`;
      }
    }

    for (const key of sourceKeys) {
      const nextPath = `${path}.${key}`;
      const sourceEntry = sourceValue[key];
      const translatedEntry = translatedValue[key];

      if (key === "href" || key === "src" || key === "external") {
        if (JSON.stringify(sourceEntry) !== JSON.stringify(translatedEntry)) {
          return `${nextPath} must be preserved exactly.`;
        }
        continue;
      }

      const error = validateNodeShape(sourceEntry, translatedEntry, nextPath);
      if (error) {
        return error;
      }
    }

    return null;
  }

  if (typeof sourceValue === "string") {
    if (typeof translatedValue !== "string") {
      return `${path} must stay a string.`;
    }

    if (looksLikeHtml(sourceValue)) {
      const sourceTags = extractHtmlTagSequence(sourceValue);
      const translatedTags = extractHtmlTagSequence(translatedValue);

      if (sourceTags !== translatedTags) {
        return `${path} must preserve HTML tags and ordering.`;
      }
    }

    return null;
  }

  if (typeof sourceValue !== typeof translatedValue) {
    return `${path} type changed from ${typeof sourceValue} to ${typeof translatedValue}.`;
  }

  return null;
}

function looksLikeHtml(value) {
  return typeof value === "string" && /<[^>]+>/.test(value);
}

function extractHtmlTagSequence(value) {
  return String(value)
    .match(/<\/?([a-zA-Z0-9-]+)(?:\s[^>]*?)?>/g)?.join("|") || "";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeTranslatedLinks(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return fields;
  }

  return Array.isArray(fields.links)
    ? {
        ...fields,
        links: dedupeLinks(fields.links),
      }
    : fields;
}
