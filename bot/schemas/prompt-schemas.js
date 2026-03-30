export const ENTITY_SCHEMAS = {
  participant: {
    entity: "participant",
    required: ["slug", "handle", "name", "role", "bio"],
    optional: ["points", "location", "tags", "links", "photoAlt"],
    aliases: {
      description: "bio",
      details: "bio",
      about: "bio",
    },
    matchingKeys: ["slug", "handle", "name"],
  },
  project: {
    entity: "project",
    required: ["slug", "title", "status", "stack"],
    optional: ["summary", "points", "location", "tags", "ownerSlugs", "links", "photoAlt"],
    aliases: {
      description: "summary",
      details: "summary",
      owners: "ownerSlugs",
    },
    matchingKeys: ["slug", "title"],
  },
  meeting: {
    entity: "meeting",
    required: ["slug", "date", "title", "place", "format"],
    optional: ["placeUrl", "paragraphs", "sections", "links", "photoAlt"],
    aliases: {
      description: "paragraphs",
      details: "paragraphs",
      agenda: "sections",
    },
    matchingKeys: ["slug", "title", "date"],
  },
  announcement: {
    entity: "announcement",
    required: ["slug", "date", "title", "place", "format"],
    optional: ["placeUrl", "paragraphs", "sections", "links", "photoAlt"],
    aliases: {
      description: "paragraphs",
      details: "paragraphs",
      agenda: "sections",
    },
    matchingKeys: ["slug", "title", "date"],
  },
};

export const STAGE_SCHEMAS = {
  intent: {
    intent: "content_operation | clarification_response | confirmation_response | non_actionable",
    entity: "announcement | meeting | participant | project | null",
    action: "create | update | delete | null",
    targetRef: "string | null",
    confidence: "high | medium | low",
    summary: "string",
    needsConfirmation: "boolean",
    fields: "object",
    questions: "string[]",
    warnings: "string[]",
  },
  targetResolution: {
    matchedSlug: "string | null",
    confidence: "high | medium | low",
    question: "string | null",
  },
  fieldNormalization: {
    fields: "object",
    confidence: "high | medium | low",
    question: "string | null",
    warnings: "string[]",
  },
};

export function buildEntitySchemaSnippet(entity) {
  const schema = ENTITY_SCHEMAS[entity];
  return schema ? JSON.stringify(schema, null, 2) : "{}";
}

export function buildStageSchemaSnippet(stage) {
  const schema = STAGE_SCHEMAS[stage];
  return schema ? JSON.stringify(schema, null, 2) : "{}";
}
