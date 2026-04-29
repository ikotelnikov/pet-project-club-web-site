const INTENT_VALUES = ["create", "update", "delete", "translate", "undo", "noop"];
const ENTITY_VALUES = ["announcement", "meeting", "project", "participant"];
const TARGET_MODE_VALUES = ["existing", "new", "unknown"];
const CONFIDENCE_VALUES = ["low", "medium", "high"];
const CLARIFICATION_REASON_VALUES = [
  "target_ambiguity",
  "target_missing",
  "locale_missing",
  "insufficient_data",
];

export const IntentContractSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "intent",
    "entity",
    "target",
    "relatedEntities",
    "requestedLocales",
    "needsClarification",
    "clarificationReason",
    "clarificationQuestion",
    "confidence",
  ],
  properties: {
    intent: { enum: INTENT_VALUES },
    entity: { enum: [...ENTITY_VALUES, null] },
    target: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "ref"],
      properties: {
        mode: { enum: [...TARGET_MODE_VALUES, null] },
        ref: { type: ["string", "null"] },
      },
    },
    relatedEntities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["entity", "ref", "role"],
        properties: {
          entity: { enum: ENTITY_VALUES },
          ref: { type: "string", minLength: 1 },
          role: { type: "string", minLength: 1 },
        },
      },
    },
    requestedLocales: {
      type: "object",
      additionalProperties: false,
      required: ["sourceLocale", "targetLocale", "targetLocales"],
      properties: {
        sourceLocale: { type: ["string", "null"] },
        targetLocale: { type: ["string", "null"] },
        targetLocales: {
          type: "array",
          items: { type: "string", minLength: 1 },
        },
      },
    },
    needsClarification: { type: "boolean" },
    clarificationReason: { enum: [...CLARIFICATION_REASON_VALUES, null] },
    clarificationQuestion: { type: ["string", "null"] },
    confidence: { enum: CONFIDENCE_VALUES },
  },
};

export function validateIntentContract(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Intent contract must be an object.");
  }

  if (!INTENT_VALUES.includes(value.intent)) {
    throw new Error(`Invalid intent '${value.intent}'.`);
  }

  if (value.entity !== null && !ENTITY_VALUES.includes(value.entity)) {
    throw new Error(`Invalid entity '${value.entity}'.`);
  }

  if (!value.target || typeof value.target !== "object" || Array.isArray(value.target)) {
    throw new Error("Intent contract target must be an object.");
  }

  if (value.target.mode !== null && !TARGET_MODE_VALUES.includes(value.target.mode)) {
    throw new Error(`Invalid target mode '${value.target.mode}'.`);
  }

  if (value.target.ref !== null && (typeof value.target.ref !== "string" || value.target.ref.trim() === "")) {
    throw new Error("Intent contract target.ref must be a non-empty string or null.");
  }

  if (!Array.isArray(value.relatedEntities)) {
    throw new Error("Intent contract relatedEntities must be an array.");
  }

  for (const item of value.relatedEntities) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Each related entity must be an object.");
    }

    if (!ENTITY_VALUES.includes(item.entity)) {
      throw new Error(`Invalid related entity '${item.entity}'.`);
    }

    if (typeof item.ref !== "string" || item.ref.trim() === "") {
      throw new Error("Each related entity ref must be a non-empty string.");
    }

    if (typeof item.role !== "string" || item.role.trim() === "") {
      throw new Error("Each related entity role must be a non-empty string.");
    }
  }

  if (!value.requestedLocales || typeof value.requestedLocales !== "object" || Array.isArray(value.requestedLocales)) {
    throw new Error("Intent contract requestedLocales must be an object.");
  }

  if (!Array.isArray(value.requestedLocales.targetLocales)) {
    throw new Error("Intent contract requestedLocales.targetLocales must be an array.");
  }

  if (typeof value.needsClarification !== "boolean") {
    throw new Error("Intent contract needsClarification must be boolean.");
  }

  if (
    value.clarificationReason !== null &&
    !CLARIFICATION_REASON_VALUES.includes(value.clarificationReason)
  ) {
    throw new Error(`Invalid clarificationReason '${value.clarificationReason}'.`);
  }

  if (value.clarificationQuestion !== null && (typeof value.clarificationQuestion !== "string" || value.clarificationQuestion.trim() === "")) {
    throw new Error("Intent contract clarificationQuestion must be a non-empty string or null.");
  }

  if (!CONFIDENCE_VALUES.includes(value.confidence)) {
    throw new Error(`Invalid confidence '${value.confidence}'.`);
  }

  return value;
}
