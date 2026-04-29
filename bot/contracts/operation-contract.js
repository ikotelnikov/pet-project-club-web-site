const ENTITY_VALUES = ["announcement", "meeting", "project", "participant"];
const ACTION_VALUES = ["create", "update", "delete", "translate"];

export const OperationContractSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "entity",
    "action",
    "targetSlug",
    "newObject",
    "patch",
    "translation",
    "assetActions",
    "warnings",
  ],
  properties: {
    entity: { enum: ENTITY_VALUES },
    action: { enum: ACTION_VALUES },
    targetSlug: { type: ["string", "null"] },
    newObject: { type: ["object", "null"] },
    patch: { type: ["object", "null"] },
    translation: {
      type: ["object", "null"],
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
    assetActions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
      },
    },
    warnings: {
      type: "array",
      items: { type: "string" },
    },
  },
};

export function validateOperationContract(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Operation contract must be an object.");
  }

  if (!ENTITY_VALUES.includes(value.entity)) {
    throw new Error(`Invalid entity '${value.entity}'.`);
  }

  if (!ACTION_VALUES.includes(value.action)) {
    throw new Error(`Invalid action '${value.action}'.`);
  }

  if (!Array.isArray(value.assetActions)) {
    throw new Error("Operation contract assetActions must be an array.");
  }

  if (!Array.isArray(value.warnings)) {
    throw new Error("Operation contract warnings must be an array.");
  }

  if (value.action === "create") {
    if (!value.newObject || typeof value.newObject !== "object" || Array.isArray(value.newObject)) {
      throw new Error("Create operation must include newObject.");
    }
    if (value.patch !== null) {
      throw new Error("Create operation patch must be null.");
    }
  }

  if (value.action === "update") {
    if (!value.targetSlug || typeof value.targetSlug !== "string") {
      throw new Error("Update operation must include targetSlug.");
    }
    if (!value.patch || typeof value.patch !== "object" || Array.isArray(value.patch)) {
      throw new Error("Update operation must include patch.");
    }
    if (value.newObject !== null) {
      throw new Error("Update operation newObject must be null.");
    }
  }

  if (value.action === "delete") {
    if (!value.targetSlug || typeof value.targetSlug !== "string") {
      throw new Error("Delete operation must include targetSlug.");
    }
    if (value.newObject !== null || value.patch !== null) {
      throw new Error("Delete operation must not include newObject or patch.");
    }
  }

  if (value.action === "translate") {
    if (!value.targetSlug || typeof value.targetSlug !== "string") {
      throw new Error("Translate operation must include targetSlug.");
    }
    if (!value.translation || typeof value.translation !== "object" || Array.isArray(value.translation)) {
      throw new Error("Translate operation must include translation.");
    }
  }

  return value;
}
