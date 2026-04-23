import { OperationContractSchema } from "../contracts/operation-contract.js";

function buildOperationExamples() {
  return [
    {
      input: {
        resolved: {
          intent: "update",
          entity: "announcement",
          target: {
            slug: "airbnb-moja-ljubov-skozi-goda",
            exists: true,
          },
          relatedEntities: [
            {
              entity: "project",
              slug: "doveritelnoe-upravlenie-v-chernogorii",
              role: "project_link",
              exists: true,
            },
          ],
        },
      },
      output: {
        entity: "announcement",
        action: "update",
        targetSlug: "airbnb-moja-ljubov-skozi-goda",
        newObject: null,
        patch: {
          projectSlugs: ["doveritelnoe-upravlenie-v-chernogorii"],
        },
        translation: null,
        assetActions: [],
        warnings: [],
      },
    },
    {
      input: {
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
      },
      output: {
        entity: "participant",
        action: "create",
        targetSlug: null,
        newObject: {
          slug: "asker",
          name: "Аскер",
        },
        patch: null,
        translation: null,
        assetActions: [],
        warnings: [],
      },
    },
    {
      input: {
        resolved: {
          intent: "create",
          entity: "project",
          target: {
            slug: null,
            exists: false,
            ref: "Доверительное управление в Черногории",
          },
          relatedEntities: [],
          currentObject: null,
        },
      },
      output: {
        entity: "project",
        action: "create",
        targetSlug: null,
        newObject: {
          slug: "doveritelnoe-upravlenie-v-chernogorii",
          title: "Доверительное управление в Черногории",
        },
        patch: null,
        translation: null,
        assetActions: [],
        warnings: [],
      },
    },
  ];
}

export function buildOperationGenerationMessages({ turn, resolved, entitySchema }) {
  const examples = buildOperationExamples();

  return [
    {
      role: "system",
      content: [
        "You generate a structured content operation for a Telegram CMS bot.",
        "Use the resolved target information as ground truth.",
        "If turn.recentContext.activeSession is present, use it as unresolved task context for continuity across multiple messages.",
        "Do not invent existing objects or slugs.",
        "entitySchema is the exact allowed field contract for the current entity. Use only fields allowed by entitySchema.",
        "If the user implies a field name that is not directly allowed, map it through entitySchema.aliases when available instead of inventing a new field.",
        "Never return fields outside entitySchema.required, entitySchema.optional, or entitySchema.aliases mappings.",
        "resolved.target.ref or the strongest human identifier in the turn may be natural-language text, not a final slug.",
        "For action='create', generate a canonical repository slug from the strongest available identifier when needed.",
        "Slug rules: lowercase ASCII kebab-case; transliterate non-Latin text such as Cyrillic to Latin; remove punctuation; collapse spaces and repeated separators into single hyphens.",
        "For action='update', return a patch only, not the full object.",
        "For action='create', return newObject.",
        "For action='delete', return only targetSlug.",
        "For announcement and meeting items, keep fields.type, fields.format, and fields.projectSlugs as separate concepts.",
        "fields.type controls whether the item is stored as a current announcement or an archived meeting article.",
        "Use type='announce' for a current announcement and type='meeting' for an archived or past meeting article.",
        "fields.format describes presentation format such as news, in-person, online, release, or demo. It does not control archive placement.",
        "fields.projectSlugs links the item to one or more real existing projects. Only set projectSlugs when a real project is explicitly named or clearly resolved from context.",
        "Never use projectSlugs for archive, status, category, workflow, or synthetic concepts such as archive-news.",
        "If the user asks to move or transfer an existing announcement into archive, history, past meetings, or a meeting article, prefer patch.type='meeting'.",
        "If the user asks to move an archived meeting article back into announcements or current items, prefer patch.type='announce'.",
        "If resolved.target exists and resolved.entity='announcement', and the user asks to move the item to archive, history, past meetings, or out of announcements, generate patch.type='meeting' without asking for extra clarification.",
        "If resolved.target exists and resolved.entity='meeting', and the user asks to move the item back into announcements or current items, generate patch.type='announce' without asking for extra clarification.",
        "If the user asks to publish or update project news, prefer entity='announcement', patch.format='news', and patch.projectSlugs only when a real project is identified.",
        "If the request mixes archive words with news words but no real project is identified, do not invent projectSlugs. Prefer a type transition when the target is an existing announcement or meeting item.",
        "Preserve user formatting when relevant.",
        "Do not restate unchanged fields unless required for correctness.",
        "Return JSON only.",
        `Schema: ${JSON.stringify(OperationContractSchema)}`,
        `Examples: ${JSON.stringify(examples)}`,
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        turn: {
          recentContext: turn.recentContext || {
            lastConfirmedObject: null,
            pendingDraft: null,
            activeSession: null,
          },
          messages: turn.messages.map((message) => ({
            messageId: message.messageId,
            text: message.text || null,
            formattedTextHtml: message.formattedTextHtml || null,
            attachments: Array.isArray(message.attachments)
              ? message.attachments.map((attachment) => ({
                  kind: attachment.kind || null,
                  fileName: attachment.fileName || null,
                  stagedPath: attachment.stagedPath || null,
                  mimeType: attachment.mimeType || null,
                }))
              : [],
          })),
        },
        resolved,
        entitySchema,
      }),
    },
  ];
}
