import { BotConfigError } from "../../shared/errors.js";
import { validateExtraction } from "../../core/extraction-validator.js";
import { ENTITY_SCHEMAS, buildEntitySchemaSnippet, buildStageSchemaSnippet } from "../../schemas/prompt-schemas.js";
import { dedupeLinks } from "../../core/link-normalization.js";
import { buildIntentAnalysisMessages } from "../../prompts/intent-analysis.js";
import { buildOperationGenerationMessages } from "../../prompts/generate-operation.js";
import { validateIntentContract } from "../../contracts/intent-contract.js";
import { validateOperationContract } from "../../contracts/operation-contract.js";

export class ExtractionClient {
  constructor({ apiKey, model = "gpt-4.1-mini", fetchImpl = globalThis.fetch, debugLogger = null } = {}) {
    if (!apiKey) {
      throw new BotConfigError("OPENAI_API_KEY is required for the OpenAI extraction client.");
    }

    if (typeof fetchImpl !== "function") {
      throw new BotConfigError("A fetch implementation is required for the OpenAI extraction client.");
    }

    this.kind = "openai";
    this.apiKey = apiKey;
    this.model = model;
    this.fetchImpl = fetchImpl;
    this.debugLogger = typeof debugLogger === "function" ? debugLogger : null;
  }

  async extractIntent(input) {
    const body = buildResponsesRequest(buildSystemPrompt(), input, this.model);

    let attempts = 0;
    let lastError = null;

    while (attempts < 2) {
      attempts += 1;
      let rawText = null;

      try {
        const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`OpenAI API returned status ${response.status}.`);
        }

        const data = await response.json();
        const text = extractTextOutput(data);
        rawText = text;
        const extraction = normalizeExtraction(JSON.parse(text));

        validateExtraction(extraction);

        return {
          ok: true,
          usedModel: this.model,
          attempts,
          extraction,
        };
      } catch (error) {
        lastError = rawText ? attachRawText(error, rawText) : error;

        if (attempts >= 2 || !shouldRetryExtractionError(error)) {
          return {
            ok: false,
            usedModel: this.model,
            attempts,
            reason: "validation_failed",
            error: error instanceof Error ? error.message : String(error),
            rawText: typeof error?.rawText === "string" ? error.rawText : null,
          };
        }
      }
    }

    return {
      ok: false,
      usedModel: this.model,
      attempts,
      reason: "validation_failed",
      error: lastError instanceof Error ? lastError.message : String(lastError),
      rawText: typeof lastError?.rawText === "string" ? lastError.rawText : null,
    };
  }

  async resolveTarget(input) {
    const body = buildResponsesRequest(buildResolverPrompt(), input, this.model);

    let rawText = null;

    try {
      const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API returned status ${response.status}.`);
      }

      const data = await response.json();
      rawText = extractTextOutput(data);
      const resolution = normalizeResolution(JSON.parse(rawText));

      validateResolution(resolution);

      return {
        ok: true,
        usedModel: this.model,
        resolution,
      };
    } catch (error) {
      const enriched = rawText ? attachRawText(error, rawText) : error;
      return {
        ok: false,
        usedModel: this.model,
        reason: "resolution_failed",
        error: enriched instanceof Error ? enriched.message : String(enriched),
        rawText: typeof enriched?.rawText === "string" ? enriched.rawText : null,
      };
    }
  }

  async editEntityObject(input) {
    const body = buildResponsesRequest(buildObjectEditPrompt(), input, this.model);

    let rawText = null;

    try {
      const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API returned status ${response.status}.`);
      }

      const data = await response.json();
      rawText = extractTextOutput(data);
      const normalized = normalizeObjectEditResult(JSON.parse(rawText), input.entity);

      if (!normalized.fields || typeof normalized.fields !== "object" || Array.isArray(normalized.fields)) {
        throw new Error("Object edit response must include a fields object.");
      }

      return {
        ok: true,
        usedModel: this.model,
        result: normalized,
      };
    } catch (error) {
      const enriched = rawText ? attachRawText(error, rawText) : error;
      return {
        ok: false,
        usedModel: this.model,
        reason: "object_edit_failed",
        error: enriched instanceof Error ? enriched.message : String(enriched),
        rawText: typeof enriched?.rawText === "string" ? enriched.rawText : null,
      };
    }
  }

  async classifyMessageTurn(input) {
    const body = buildResponsesRequest(buildTurnRoutingPrompt(), input, this.model);

    let rawText = null;

    try {
      const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API returned status ${response.status}.`);
      }

      const data = await response.json();
      rawText = extractTextOutput(data);
      const routing = normalizeTurnRouting(JSON.parse(rawText));

      return {
        ok: true,
        usedModel: this.model,
        routing,
      };
    } catch (error) {
      const enriched = rawText ? attachRawText(error, rawText) : error;
      return {
        ok: false,
        usedModel: this.model,
        reason: "turn_routing_failed",
        error: enriched instanceof Error ? enriched.message : String(enriched),
        rawText: typeof enriched?.rawText === "string" ? enriched.rawText : null,
      };
    }
  }

  async analyzeIntent({ turn, debugContext = null }) {
    let rawText = null;
    const promptMessages = buildIntentAnalysisMessages({ turn });

    try {
      await this.#debug("openai_intent_request", {
        turn: sanitizeDebugValue(turn),
        promptMessages: sanitizeDebugValue(promptMessages),
      }, debugContext);
      rawText = await this.completeJsonText({
        messages: promptMessages,
      });
      const parsed = validateIntentContract(parseJsonResponseText(rawText));
      await this.#debug("openai_intent_response", {
        rawText: sanitizeDebugText(rawText),
        parsed: sanitizeDebugValue(parsed),
      }, debugContext);
      return parsed;
    } catch (error) {
      const enriched = rawText ? attachRawText(error, rawText) : error;
      await this.#debug("openai_intent_error", {
        rawText: sanitizeDebugText(rawText),
        error: enriched instanceof Error ? enriched.message : String(enriched),
      }, debugContext);
      throw enriched instanceof Error ? enriched : new Error(String(enriched));
    }
  }

  async generateOperation({ turn, resolved, entitySchema, debugContext = null }) {
    let rawText = null;
    const promptMessages = buildOperationGenerationMessages({
      turn,
      resolved,
      entitySchema,
    });

    try {
      await this.#debug("openai_operation_request", {
        turn: sanitizeDebugValue(turn),
        resolved: sanitizeDebugValue(resolved),
        entitySchema: sanitizeDebugValue(entitySchema),
        promptMessages: sanitizeDebugValue(promptMessages),
      }, debugContext);
      rawText = await this.completeJsonText({
        messages: promptMessages,
      });
      const parsed = validateOperationContract(parseJsonResponseText(rawText));
      await this.#debug("openai_operation_response", {
        rawText: sanitizeDebugText(rawText),
        parsed: sanitizeDebugValue(parsed),
      }, debugContext);
      return parsed;
    } catch (error) {
      const enriched = rawText ? attachRawText(error, rawText) : error;
      await this.#debug("openai_operation_error", {
        rawText: sanitizeDebugText(rawText),
        error: enriched instanceof Error ? enriched.message : String(enriched),
      }, debugContext);
      throw enriched instanceof Error ? enriched : new Error(String(enriched));
    }
  }

  async #debug(event, payload, debugContext = null) {
    if (!this.debugLogger) {
      return;
    }

    await this.debugLogger({
      event,
      ...(debugContext || {}),
      payload,
    });
  }

  async completeJsonText({ messages }) {
    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: messages.map((message) => ({
          role: message.role,
          content: [
            {
              type: "input_text",
              text: message.content,
            },
          ],
        })),
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API returned status ${response.status}.`);
    }

    const data = await response.json();
    return extractTextOutput(data);
  }
}

function sanitizeDebugText(rawText, maxLength = 4000) {
  if (typeof rawText !== "string") {
    return rawText ?? null;
  }

  return rawText.length > maxLength
    ? `${rawText.slice(0, maxLength)}…[truncated ${rawText.length - maxLength} chars]`
    : rawText;
}

function sanitizeDebugValue(value, maxTextLength = 1200) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDebugValue(item, maxTextLength));
  }

  if (!value || typeof value !== "object") {
    return typeof value === "string" ? sanitizeDebugText(value, maxTextLength) : value;
  }

  const next = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      next[key] = sanitizeDebugText(entry, maxTextLength);
      continue;
    }

    next[key] = sanitizeDebugValue(entry, maxTextLength);
  }

  return next;
}

function buildResponsesRequest(systemPrompt, input, model) {
  return {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: systemPrompt,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify(input, null, 2),
          },
        ],
      },
    ],
  };
}

function parseJsonResponseText(rawText) {
  const normalized = unwrapJsonCodeFence(rawText);
  return JSON.parse(normalized);
}

function unwrapJsonCodeFence(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text.startsWith("```")) {
    return text;
  }

  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : text;
}

function buildSystemPrompt() {
  return [
    "You are a structured extraction component for a private Telegram bot.",
    "Return JSON only.",
    "Do not include markdown, explanations, or prose outside the JSON object.",
    "Follow the intent-stage schema exactly.",
    "Allowed intents: content_operation, translation_operation, clarification_response, confirmation_response, non_actionable.",
    "Allowed entities: announcement, meeting, participant, project.",
    "Allowed actions: create, update, delete.",
    "Confidence must be exactly one of: high, medium, low.",
    "Never indicate that confirmation can be skipped.",
    "For update/delete, prefer targetRef over inventing a final slug.",
    "Slug may be provided either as top-level slug or as fields.slug. Both are valid.",
    "Supported content locales are: ru, en, de, me, es.",
    "If formattedTextHtml is provided and the user message clearly contains rich formatting that should be preserved, include fields.detailsHtml for any entity whose schema allows it.",
    "When using fields.detailsHtml, also keep the companion plain-text field stable when the schema expects one: participant.bio, project.summary, or meeting/announcement.paragraphs when possible.",
    "For announcement or meeting items that are news, demos, releases, or updates about one or more projects, include fields.projectSlugs as an array of project slugs when the project is known from the message or conversation context.",
    "If recent context clearly points to a project and the user asks to publish project news or an update, preserve that project relation in fields.projectSlugs.",
    "If the user explicitly asks to add, update, translate, or fix localized text for one locale, prefer intent = translation_operation.",
    "For translation_operation, keep entity populated, use action create or update when clear, and include fields.locale when the language is specified.",
    "For translation_operation, include only the locale-specific text fields that should change and avoid unrelated source-locale fields.",
    "If the user asks to add or update a translation but does not specify the target language, return translation_operation with no fields.locale and include one clarification question asking which locale to update.",
    "Use locale 'me' for Montenegrin and closely related local Balkan requests when the user clearly wants the /me/ site language.",
    "If pendingOperation is provided, treat it as the active conversation context rather than a fresh request.",
    "If pendingOperation.mode is 'active_draft', interpret the new message as a delta to the existing draft. Keep the same entity, action, and slug unless the user clearly asks to switch targets or start over.",
    "For active_draft follow-ups, prefer returning only the changed fields. Do not restate unchanged fields from pendingOperation.fields unless they must be replaced.",
    "Use pendingOperation.requestText, pendingOperation.summary, pendingOperation.currentAttachments, and recentEntities as context for short follow-ups such as 'also add GitHub', 'set this as the main photo', or 'for Tatyana'.",
    "If pendingOperation.mode is 'recent_entity_context', prefer continuing that entity for short additive requests, but allow explicit user text to override it.",
    "When recentEntities are provided, use them only as routing context. Do not invent changes to those entities unless the message actually requests one.",
    "The input may include messageBundle with instructionText and sourceMessages.",
    "When messageBundle is present, treat messageBundle.instructionText as the current user command.",
    "Treat messageBundle.sourceMessages as bundled source material and evidence that should be combined before deciding whether there is enough information.",
    "Do not treat each source message as a separate command. Use them together to create or update one entity when the instruction asks for that.",
    "If the bundle contains source material and the instruction asks to create or update something from it, prefer extracting from the whole bundle rather than only the latest message.",
    "If the user message includes contact data such as Telegram handles, LinkedIn URLs, X/Twitter URLs, GitHub URLs, or other public links, place them into fields.links as {label, href, external}.",
    "For fields.links, prefer one canonical entry per real URL. If the same URL appears more than once with labels like Telegram vs t.me/... or Instagram vs instagram.com, keep only one best entry.",
    "For participants, if a Telegram handle is clearly present, also set fields.handle.",
    "The input may include attachments. Use their kind, file names, and stagedPath values as evidence when deciding whether media should be associated with the entity.",
    "If an attached photo should become the main photo, set fields.photoStagedPath to one of the provided stagedPath values, optionally set fields.photoAlt, and use fields.photoAction='replace'.",
    "For project photo requests, use fields.photoAction='append' when the user clearly asks to add another/additional photo, 'replace' when they ask to change/update/replace the main photo, 'remove' when they ask to delete the current main photo, and 'clear' when they ask to remove all project photos.",
    "Do not emit raw transport objects such as photo, video, document, fileId, fileName, or mimeType inside fields.",
    "If the request is unclear, prefer one focused clarification question over guessing.",
    `Intent stage schema: ${buildStageSchemaSnippet("intent")}`,
    `Participant schema: ${buildEntitySchemaSnippet("participant")}`,
    `Project schema: ${buildEntitySchemaSnippet("project")}`,
    `Meeting schema: ${buildEntitySchemaSnippet("meeting")}`,
    `Announcement schema: ${buildEntitySchemaSnippet("announcement")}`,
  ].join(" ");
}

function buildResolverPrompt() {
  return [
    "You resolve an update/delete target for a private Telegram content bot.",
    "Return JSON only.",
    "Choose at most one candidate from the provided list.",
    "Prefer exact handle, exact name, or exact title matches.",
    "If no confident match exists, return matchedSlug as null and ask one clarification question.",
    "Schema:",
    buildStageSchemaSnippet("targetResolution"),
  ].join(" ");
}

function buildObjectEditPrompt() {
  return [
    "You edit an existing website content object for a private Telegram bot.",
    "Return JSON only.",
    "Schema: {\"fields\": object, \"summary\": string|null, \"warnings\": string[]}.",
    "The input includes the user request, the current entity JSON, the current editable fields, and any requestedChanges already extracted from the user message.",
    "Return the full next fields object for the entity update, not just a partial patch.",
    "Preserve unrelated fields unless the request clearly changes or removes them.",
    "If the user asks to remove, delete, deduplicate, or fix one item in an array such as links, tags, points, sections, or projectSlugs, update that array explicitly in fields.",
    "For links, prefer keeping one canonical entry per URL when duplicates differ only by label or minor URL formatting.",
    "Never return duplicate links that point to the same canonical URL. Prefer labels like Telegram, Instagram, LinkedIn, GitHub, or X / Twitter over raw domain labels when both exist.",
    "Do not invent unrelated content. Do not change the slug unless the request clearly renames the entity.",
    "If the current object already contains structured formatting such as detailsHtml, preserve that structure unless the user clearly asks to rewrite it.",
    "When the user provides formatted replacement text for a field and the entity schema allows detailsHtml, return detailsHtml instead of flattening everything into one plain string.",
    "Keep the result compatible with the entity schema and the current content style.",
    `Participant schema: ${buildEntitySchemaSnippet("participant")}`,
    `Project schema: ${buildEntitySchemaSnippet("project")}`,
    `Meeting schema: ${buildEntitySchemaSnippet("meeting")}`,
    `Announcement schema: ${buildEntitySchemaSnippet("announcement")}`,
  ].join(" ");
}

function buildTurnRoutingPrompt() {
  return [
    "You classify the user's latest Telegram turn for a private content bot.",
    "Return JSON only.",
    'Schema: {"decision":"direct_instruction"|"bundle_source"|"bundle_execute"|"continuation"|"unclear","reason":string|null}.',
    "Use semantics, not keyword matching.",
    "direct_instruction: the latest message already contains a concrete create/update/delete/translate request that should be processed now.",
    "bundle_source: the latest message looks like source material, forwarded content, background context, or evidence that should be collected before execution.",
    "bundle_execute: the latest message tells the bot to proceed with already collected bundle/context rather than adding more source material.",
    "continuation: the latest message is best understood as continuing a recent entity or pending content context, especially for additive follow-ups.",
    "unclear: not enough information to classify confidently.",
    "If recent entities are provided, use them only as context and do not force continuation unless the message actually implies it.",
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
    throw new Error("OpenAI response did not include text output.");
  }

  return combined;
}

function shouldRetryExtractionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("JSON") ||
    message.includes("schema") ||
    message.includes("did not include text output") ||
    message.includes("Unexpected")
  );
}

function attachRawText(error, rawText) {
  if (error && typeof error === "object") {
    error.rawText = rawText;
  }

  return error;
}

function normalizeExtraction(extraction) {
  if (!extraction || typeof extraction !== "object") {
    return extraction;
  }

  const expandedExtraction = expandExtractionShape(extraction);
  const intent =
    typeof expandedExtraction.intent === "string"
      ? expandedExtraction.intent.trim().toLowerCase()
      : expandedExtraction.intent;
  const normalized = {
    ...expandedExtraction,
    intent,
    entity: normalizeNullableScalar(expandedExtraction.entity),
    action: normalizeNullableScalar(expandedExtraction.action),
    slug: normalizeNullableScalar(expandedExtraction.slug),
    targetRef: normalizeNullableScalar(expandedExtraction.targetRef),
    confidence: normalizeConfidence(expandedExtraction.confidence),
    questions: Array.isArray(expandedExtraction.questions) ? expandedExtraction.questions : [],
    warnings: Array.isArray(expandedExtraction.warnings) ? expandedExtraction.warnings : [],
    fields:
      expandedExtraction.fields &&
      typeof expandedExtraction.fields === "object" &&
      !Array.isArray(expandedExtraction.fields)
        ? normalizeFieldAliases(
            normalizeNullableScalar(expandedExtraction.entity),
            expandedExtraction.fields
          )
        : {},
  };

  if (
    normalized.intent === "non_actionable" ||
    normalized.intent === "clarification_response" ||
    normalized.intent === "confirmation_response"
  ) {
    return {
      ...normalized,
      entity: normalized.entity ?? null,
      action: normalized.action ?? null,
      slug: normalized.slug ?? null,
      targetRef: normalized.targetRef ?? null,
      summary: normalizeSummary(expandedExtraction.summary, normalized.intent),
      needsConfirmation:
        typeof expandedExtraction.needsConfirmation === "boolean"
          ? expandedExtraction.needsConfirmation
          : normalized.intent === "confirmation_response",
      fields: normalizeNonOperationFields(normalized.intent, expandedExtraction.fields),
    };
  }

  return {
    ...normalized,
    action:
      normalized.intent === "translation_operation"
        ? normalized.action ?? "update"
        : normalized.action,
    slug: normalized.slug ?? deriveSlug(normalized.entity, normalized.fields),
    targetRef:
      normalized.targetRef ??
      normalized.slug ??
      normalized.fields.handle ??
      normalized.fields.name ??
      normalized.fields.title ??
      null,
    summary:
      normalizeSummary(expandedExtraction.summary, normalized.intent) ||
      summarizeEntityExpansion(normalized.entity, normalized.action, normalized.fields),
    needsConfirmation: true,
  };
}

function normalizeConfidence(confidence) {
  if (typeof confidence === "number" && Number.isFinite(confidence)) {
    if (confidence >= 0.8) {
      return "high";
    }

    if (confidence >= 0.45) {
      return "medium";
    }

    return "low";
  }

  if (typeof confidence !== "string") {
    return confidence;
  }

  const normalized = confidence.trim().toLowerCase();

  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }

  if (normalized.includes("high") || normalized === "strong" || normalized === "certain") {
    return "high";
  }

  if (normalized.includes("medium") || normalized === "moderate" || normalized === "med") {
    return "medium";
  }

  if (normalized.includes("low") || normalized === "weak" || normalized === "uncertain") {
    return "low";
  }

  return normalized;
}

function normalizeNullableScalar(value) {
  if (value == null) {
    return null;
  }

  return value;
}

function normalizeSummary(summary, intent) {
  if (typeof summary === "string" && summary.trim() !== "") {
    return summary.trim();
  }

  switch (intent) {
    case "non_actionable":
      return "No actionable website change detected.";
    case "clarification_response":
      return "Clarification received.";
    case "confirmation_response":
      return "Confirmation response received.";
    default:
      return null;
  }
}

function normalizeNonOperationFields(intent, fields) {
  if (intent === "confirmation_response") {
    const decision = fields && typeof fields === "object" ? fields.decision : null;
    return {
      decision: decision === "confirm" || decision === "cancel" ? decision : "confirm",
    };
  }

  return fields && typeof fields === "object" && !Array.isArray(fields) ? fields : {};
}

function expandExtractionShape(extraction) {
  return expandFlatEntityPayloadShape(expandEntityArrayShape(expandEntityObjectShape(extraction)));
}

function expandEntityObjectShape(extraction) {
  if (
    !extraction.entities ||
    typeof extraction.entities !== "object" ||
    Array.isArray(extraction.entities)
  ) {
    return extraction;
  }

  const entries = Object.entries(extraction.entities);

  if (entries.length === 0) {
    return extraction;
  }

  const [entityType, attributes] = entries[0];
  const normalizedAttributes =
    attributes && typeof attributes === "object" && !Array.isArray(attributes) ? attributes : {};

  return {
    ...extraction,
    entity: extraction.entity ?? entityType ?? null,
    slug: extraction.slug ?? normalizedAttributes.slug ?? null,
    targetRef:
      extraction.targetRef ??
      extraction.entityId ??
      extraction.entityName ??
      normalizedAttributes.handle ??
      normalizedAttributes.name ??
      normalizedAttributes.title ??
      null,
    fields: extraction.fields ?? normalizedAttributes,
    summary:
      extraction.summary ??
      summarizeEntityExpansion(entityType ?? extraction.entity, extraction.action, normalizedAttributes),
  };
}

function expandFlatEntityPayloadShape(extraction) {
  const fieldObject =
    extraction.entity && typeof extraction.entity === "object" && !Array.isArray(extraction.entity)
      ? extraction.entity
      : null;
  const entityType =
    typeof extraction.entityType === "string" && extraction.entityType.trim() !== ""
      ? extraction.entityType
      : null;

  if (!fieldObject || !entityType) {
    return extraction;
  }

  return {
    ...extraction,
    entity: entityType,
    slug: extraction.slug ?? fieldObject.slug ?? extraction.entityId ?? null,
    targetRef:
      extraction.targetRef ??
      extraction.entityId ??
      extraction.entityName ??
      fieldObject.handle ??
      fieldObject.name ??
      fieldObject.title ??
      null,
    fields: extraction.fields ?? fieldObject,
    summary:
      extraction.summary ??
      summarizeEntityExpansion(entityType, extraction.action ?? null, fieldObject),
  };
}

function expandEntityArrayShape(extraction) {
  if (!Array.isArray(extraction.entities) || extraction.entities.length === 0) {
    return extraction;
  }

  const firstEntity = extraction.entities[0];

  if (!firstEntity || typeof firstEntity !== "object") {
    return extraction;
  }

  const fields = resolveEntityFields(firstEntity);
  const entityType = firstEntity.type ?? firstEntity.entityType ?? null;
  const action = firstEntity.action ?? extraction.action ?? null;
  const summary =
    extraction.summary ?? summarizeEntityExpansion(entityType ?? extraction.entity, action, fields);

  return {
    ...extraction,
    entity: extraction.entity ?? entityType,
    action,
    confidence: extraction.confidence ?? firstEntity.confidence ?? null,
    slug: extraction.slug ?? fields.slug ?? firstEntity.entityId ?? firstEntity.id ?? null,
    targetRef:
      extraction.targetRef ??
      firstEntity.entityId ??
      firstEntity.entityName ??
      firstEntity.name ??
      firstEntity.handle ??
      firstEntity.title ??
      fields.handle ??
      fields.name ??
      fields.title ??
      null,
    fields: extraction.fields ?? fields,
    summary,
  };
}

function summarizeEntityExpansion(entity, action, fields) {
  if (!entity || !action) {
    return null;
  }

  const label = fields.name || fields.title || fields.handle || fields.slug || entity;
  return `${action} ${entity} ${label}`.trim();
}

function resolveEntityFields(entityRecord) {
  const candidates = [entityRecord.attributes, entityRecord.data, entityRecord.fields];

  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return candidate;
    }
  }

  return extractInlineEntityFields(entityRecord);
}

function normalizeFieldAliases(entity, fields) {
  const normalized = { ...fields };

  if (typeof normalized.locale === "string") {
    normalized.locale = normalizeLocaleCode(normalized.locale);
  }

  if (typeof normalized.sourceLocale === "string") {
    normalized.sourceLocale = normalizeLocaleCode(normalized.sourceLocale);
  }

  if (typeof normalized.mainPhotoPath === "string" && !normalized.photoStagedPath) {
    normalized.photoStagedPath = normalized.mainPhotoPath;
  }

  if (typeof normalized.photoAction === "string") {
    normalized.photoAction = normalized.photoAction.trim().toLowerCase();
  }

  if (typeof normalized.photoMode === "string" && !normalized.photoAction) {
    normalized.photoAction = normalized.photoMode.trim().toLowerCase();
  }

  if (typeof normalized.imageAction === "string" && !normalized.photoAction) {
    normalized.photoAction = normalized.imageAction.trim().toLowerCase();
  }

  if (normalized.photo && typeof normalized.photo === "object" && !Array.isArray(normalized.photo)) {
    if (typeof normalized.photo.stagedPath === "string" && !normalized.photoStagedPath) {
      normalized.photoStagedPath = normalized.photo.stagedPath;
    }

    if (typeof normalized.photo.alt === "string" && !normalized.photoAlt) {
      normalized.photoAlt = normalized.photo.alt;
    }
  }

  stripAttachmentTransportFields(normalized);

  if (Array.isArray(normalized.links)) {
    normalized.links = dedupeLinks(normalized.links);
  }

  switch (entity) {
    case "participant":
      if (normalized.description && !normalized.bio) {
        normalized.bio = normalized.description;
      }
      if (normalized.details && !normalized.bio) {
        normalized.bio = normalized.details;
      }
      if (typeof normalized.description === "string" && looksLikeHtml(normalized.description) && !normalized.detailsHtml) {
        normalized.detailsHtml = normalized.description;
      }
      if (typeof normalized.details === "string" && looksLikeHtml(normalized.details) && !normalized.detailsHtml) {
        normalized.detailsHtml = normalized.details;
      }
      delete normalized.description;
      delete normalized.details;
      break;
    case "project":
      if (normalized.description && !normalized.detailsHtml) {
        normalized.detailsHtml = normalized.description;
      }
      if (normalized.details && !normalized.detailsHtml) {
        normalized.detailsHtml = normalized.details;
      }
      delete normalized.description;
      delete normalized.details;
      break;
    case "meeting":
    case "announcement":
      if (normalized.description && !normalized.paragraphs) {
        normalized.paragraphs = [normalized.description];
      }
      if (normalized.details && !normalized.paragraphs) {
        normalized.paragraphs = [normalized.details];
      }
      delete normalized.description;
      delete normalized.details;
      break;
    default:
      break;
  }

  return pruneUnknownFields(entity, normalized);
}

function normalizeLocaleCode(value) {
  const normalized = String(value).trim().toLowerCase();

  switch (normalized) {
    case "ru":
    case "russian":
    case "russkiy":
    case "russkii":
    case "русский":
      return "ru";
    case "en":
    case "english":
    case "английский":
      return "en";
    case "de":
    case "german":
    case "deutsch":
    case "немецкий":
      return "de";
    case "me":
    case "montenegrin":
    case "crnogorski":
    case "montenegro":
    case "черногорский":
      return "me";
    case "es":
    case "spanish":
    case "espanol":
    case "español":
    case "испанский":
      return "es";
    default:
  return normalized;
}

function looksLikeHtml(value) {
  return typeof value === "string" && /<[^>]+>/.test(value);
}

function normalizeObjectEditResult(result, entity) {
  if (!result || typeof result !== "object") {
    return result;
  }

  return {
    fields:
      result.fields && typeof result.fields === "object" && !Array.isArray(result.fields)
        ? normalizeFieldAliases(entity, result.fields)
        : {},
    summary: typeof result.summary === "string" && result.summary.trim() !== "" ? result.summary.trim() : null,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  };
}

function normalizeTurnRouting(result) {
  const allowed = new Set(["direct_instruction", "bundle_source", "bundle_execute", "continuation", "unclear"]);
  const decision =
    typeof result?.decision === "string" && allowed.has(result.decision.trim().toLowerCase())
      ? result.decision.trim().toLowerCase()
      : "unclear";

  return {
    decision,
    reason: typeof result?.reason === "string" && result.reason.trim() !== "" ? result.reason.trim() : null,
  };
}
}

function stripAttachmentTransportFields(fields) {
  if (fields.photo && typeof fields.photo === "object" && !Array.isArray(fields.photo)) {
    delete fields.photo;
  }

  if (fields.video && typeof fields.video === "object" && !Array.isArray(fields.video)) {
    delete fields.video;
  }

  if (fields.document && typeof fields.document === "object" && !Array.isArray(fields.document)) {
    delete fields.document;
  }

  const transportKeys = [
    "mainPhotoPath",
    "photoFileId",
    "photoFileName",
    "videoFileId",
    "videoFileName",
    "documentFileId",
    "documentFileName",
    "fileId",
    "fileName",
    "fileIds",
    "fileNames",
    "attachmentId",
    "attachmentIds",
    "attachmentName",
    "attachmentNames",
  ];

  for (const key of transportKeys) {
    delete fields[key];
  }
}

function extractInlineEntityFields(entityRecord) {
  const reservedKeys = new Set([
    "type",
    "entityType",
    "entity",
    "entityId",
    "entityName",
    "action",
    "confidence",
    "attributes",
    "data",
    "fields",
    "slug",
    "summary",
    "question",
    "questions",
    "warning",
    "warnings",
    "matchedSlug",
  ]);
  const inlineFields = {};

  for (const [key, value] of Object.entries(entityRecord)) {
    if (reservedKeys.has(key)) {
      continue;
    }

    inlineFields[key] = value;
  }

  return inlineFields;
}

function deriveSlug(entity, fields) {
  if (!fields || typeof fields !== "object") {
    return null;
  }

  const handleCandidate =
    typeof fields.handle === "string" && fields.handle.trim() !== ""
      ? fields.handle.replace(/^@+/, "")
      : null;
  const titleCandidate =
    typeof fields.name === "string" && fields.name.trim() !== ""
      ? fields.name
      : typeof fields.title === "string" && fields.title.trim() !== ""
        ? fields.title
        : null;

  switch (entity) {
    case "participant":
      return slugify(handleCandidate || titleCandidate);
    case "project":
    case "meeting":
    case "announcement":
      return slugify(titleCandidate);
    default:
      return slugify(titleCandidate);
  }
}

function pruneUnknownFields(entity, fields) {
  const schema = ENTITY_SCHEMAS[entity];

  if (!schema) {
    return fields;
  }

  const allowedFields = new Set([
    ...(schema.required || []),
    ...(schema.optional || []),
  ]);

  return Object.fromEntries(
    Object.entries(fields).filter(([key]) => allowedFields.has(key))
  );
}

function slugify(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const slug = transliterateToAscii(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || null;
}

function transliterateToAscii(value) {
  const charMap = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
    ї: "yi", і: "i", є: "e", ґ: "g", ђ: "dj", ј: "j", љ: "lj", њ: "nj", ћ: "c", џ: "dz", ѕ: "dz",
    А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ё: "E", Ж: "Zh", З: "Z", И: "I", Й: "Y",
    К: "K", Л: "L", М: "M", Н: "N", О: "O", П: "P", Р: "R", С: "S", Т: "T", У: "U", Ф: "F",
    Х: "H", Ц: "Ts", Ч: "Ch", Ш: "Sh", Щ: "Sch", Ъ: "", Ы: "Y", Ь: "", Э: "E", Ю: "Yu", Я: "Ya",
    Ї: "Yi", І: "I", Є: "E", Ґ: "G", Ђ: "Dj", Ј: "J", Љ: "Lj", Њ: "Nj", Ћ: "C", Џ: "Dz", Ѕ: "Dz",
  };

  return Array.from(String(value), (char) => charMap[char] ?? char).join("");
}

function normalizeResolution(value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  return {
    matchedSlug: typeof value.matchedSlug === "string" && value.matchedSlug.trim() !== ""
      ? value.matchedSlug.trim()
      : null,
    confidence: normalizeConfidence(value.confidence),
    question: typeof value.question === "string" && value.question.trim() !== ""
      ? value.question.trim()
      : null,
  };
}

function validateResolution(value) {
  if (!value || typeof value !== "object") {
    throw new BotConfigError("Resolution must be an object.");
  }

  if (
    value.confidence !== "high" &&
    value.confidence !== "medium" &&
    value.confidence !== "low"
  ) {
    throw new BotConfigError("Resolution confidence must be high, medium, or low.");
  }

  if (value.matchedSlug !== null && typeof value.matchedSlug !== "string") {
    throw new BotConfigError("Resolution matchedSlug must be a string or null.");
  }

  if (value.question !== null && typeof value.question !== "string") {
    throw new BotConfigError("Resolution question must be a string or null.");
  }

  return value;
}
