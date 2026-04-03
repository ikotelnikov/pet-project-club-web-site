import { BotConfigError } from "../../shared/errors.js";
import { validateExtraction } from "../../core/extraction-validator.js";
import { ENTITY_SCHEMAS, buildEntitySchemaSnippet, buildStageSchemaSnippet } from "../../schemas/prompt-schemas.js";

export class ExtractionClient {
  constructor({ apiKey, model = "gpt-4.1-mini", fetchImpl = globalThis.fetch } = {}) {
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

function buildSystemPrompt() {
  return [
    "You are a structured extraction component for a private Telegram bot.",
    "Return JSON only.",
    "Do not include markdown, explanations, or prose outside the JSON object.",
    "Follow the intent-stage schema exactly.",
    "Allowed intents: content_operation, clarification_response, confirmation_response, non_actionable.",
    "Allowed entities: announcement, meeting, participant, project.",
    "Allowed actions: create, update, delete.",
    "Confidence must be exactly one of: high, medium, low.",
    "Never indicate that confirmation can be skipped.",
    "For update/delete, prefer targetRef over inventing a final slug.",
    "Slug may be provided either as top-level slug or as fields.slug. Both are valid.",
    "If pendingOperation is provided, treat the user message as an edit to that pending preview. Keep the same entity, action, and slug unless the user clearly asks to change them. Prefer returning only the changed fields.",
    "If the user message includes contact data such as Telegram handles, LinkedIn URLs, X/Twitter URLs, GitHub URLs, or other public links, place them into fields.links as {label, href, external}.",
    "For participants, if a Telegram handle is clearly present, also set fields.handle.",
    "The input may include attachments. Use their kind, file names, and stagedPath values as evidence when deciding whether media should be associated with the entity.",
    "If an attached photo should become the main photo, set fields.photoStagedPath to one of the provided stagedPath values and optionally set fields.photoAlt.",
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
    needsConfirmation:
      typeof expandedExtraction.needsConfirmation === "boolean"
        ? expandedExtraction.needsConfirmation
        : true,
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

  if (typeof normalized.mainPhotoPath === "string" && !normalized.photoStagedPath) {
    normalized.photoStagedPath = normalized.mainPhotoPath;
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

  switch (entity) {
    case "participant":
      if (normalized.description && !normalized.bio) {
        normalized.bio = normalized.description;
      }
      if (normalized.details && !normalized.bio) {
        normalized.bio = normalized.details;
      }
      delete normalized.description;
      delete normalized.details;
      break;
    case "project":
      if (normalized.description && !normalized.summary) {
        normalized.summary = normalized.description;
      }
      if (normalized.details && !normalized.summary) {
        normalized.summary = normalized.details;
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

  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || null;
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
