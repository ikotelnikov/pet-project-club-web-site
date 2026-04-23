import { IntentContractSchema } from "../contracts/intent-contract.js";

function buildIntentExamples() {
  return [
    {
      input: {
        messages: [
          {
            text: "обнови новость airbnb-moja-ljubov-skozi-goda: projectSlugs = doveritelnoe-upravlenie-v-chernogorii",
          },
        ],
      },
      output: {
        intent: "update",
        entity: "announcement",
        target: {
          mode: "existing",
          ref: "airbnb-moja-ljubov-skozi-goda",
        },
        relatedEntities: [
          {
            entity: "project",
            ref: "doveritelnoe-upravlenie-v-chernogorii",
            role: "project_link",
          },
        ],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: [],
        },
        needsClarification: false,
        clarificationReason: null,
        clarificationQuestion: null,
        confidence: "high",
      },
    },
    {
      input: {
        messages: [
          {
            text: "обнови проект doveritelnoe-upravlenie-v-chernogorii",
          },
        ],
      },
      output: {
        intent: "update",
        entity: "project",
        target: {
          mode: "existing",
          ref: "doveritelnoe-upravlenie-v-chernogorii",
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: [],
        },
        needsClarification: false,
        clarificationReason: null,
        clarificationQuestion: null,
        confidence: "high",
      },
    },
    {
      input: {
        messages: [
          {
            text: "создай нового участника:",
          },
          {
            text: "Меня зовут Аскер. Я вырос в семье риелторов и сейчас снимаю недвижимость с FPV-дроном.",
          },
          {
            text: "Это на авку",
            attachmentKinds: ["photo"],
          },
        ],
      },
      output: {
        intent: "create",
        entity: "participant",
        target: {
          mode: "new",
          ref: "Аскер",
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: [],
        },
        needsClarification: false,
        clarificationReason: null,
        clarificationQuestion: null,
        confidence: "high",
      },
    },
    {
      input: {
        messages: [
          {
            text: "создай проект Доверительное управление в Черногории",
          },
          {
            text: "Помогаем владельцам недвижимости монетизировать квартиры и дома в Черногории.",
          },
        ],
      },
      output: {
        intent: "create",
        entity: "project",
        target: {
          mode: "new",
          ref: "Доверительное управление в Черногории",
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: [],
        },
        needsClarification: false,
        clarificationReason: null,
        clarificationQuestion: null,
        confidence: "high",
      },
    },
    {
      input: {
        messages: [
          {
            text: "создай новость",
          },
          {
            text: "Airbnb: моя любовь сквозь года",
          },
          {
            text: "История о том, как я пришла в посуточную аренду и выстроила сервис доверительного управления.",
          },
        ],
      },
      output: {
        intent: "create",
        entity: "announcement",
        target: {
          mode: "new",
          ref: "Airbnb: моя любовь сквозь года",
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: [],
        },
        needsClarification: false,
        clarificationReason: null,
        clarificationQuestion: null,
        confidence: "high",
      },
    },
    {
      input: {
        messages: [
          {
            text: "переведи проект vpn-dlya-grupp на все языки",
          },
        ],
      },
      output: {
        intent: "translate",
        entity: "project",
        target: {
          mode: "existing",
          ref: "vpn-dlya-grupp",
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: ["*"],
        },
        needsClarification: false,
        clarificationReason: null,
        clarificationQuestion: null,
        confidence: "high",
      },
    },
    {
      input: {
        messages: [
          {
            text: "переведи участника andrey на английский",
          },
        ],
      },
      output: {
        intent: "translate",
        entity: "participant",
        target: {
          mode: "existing",
          ref: "andrey",
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: ["en"],
        },
        needsClarification: false,
        clarificationReason: null,
        clarificationQuestion: null,
        confidence: "high",
      },
    },
    {
      input: {
        messages: [
          {
            text: "переведи новость airbnb-moja-ljubov-skozi-goda на en и es",
          },
        ],
      },
      output: {
        intent: "translate",
        entity: "announcement",
        target: {
          mode: "existing",
          ref: "airbnb-moja-ljubov-skozi-goda",
        },
        relatedEntities: [],
        requestedLocales: {
          sourceLocale: null,
          targetLocale: null,
          targetLocales: ["en", "es"],
        },
        needsClarification: false,
        clarificationReason: null,
        clarificationQuestion: null,
        confidence: "high",
      },
    },
  ];
}

export function buildIntentAnalysisMessages({ turn }) {
  const examples = buildIntentExamples();

  return [
    {
      role: "system",
      content: [
        "You analyze a Telegram user turn for a CMS bot.",
        "Your job is only to identify the user's intent and references.",
        "Do not generate final content fields.",
        "Do not invent repository objects or slugs.",
        "Recent context is advisory only. It must never override an explicit target named by the user.",
        "If recentContext.activeSession is present, treat it as the current unresolved task context for this chat.",
        "Use recentContext.activeSession to preserve the active task when the new message looks like a continuation, clarification answer, forwarded detail, or attachment for the same task.",
        "Only switch away from recentContext.activeSession when the new messages clearly start a different task.",
        "For announcement and meeting items, keep archive placement, content format, and project relations as separate concepts.",
        "Archive, history, past meetings, move to archive, move from announcements, or turn into a meeting article describe a lifecycle transition, not a project relation.",
        "News, update, release, and demo describe publication style or content format, not archive placement by themselves.",
        "Project references should become relatedEntities only when the user names a real project or the project is clearly resolved from context.",
        "Do not treat archive words such as archive, news archive, history, old posts, or past events as project references.",
        "If the user asks to move an existing announcement into archive, history, or a meeting article, keep the same target item instead of inventing a project link.",
        "If the user asks to move an archived meeting back into announcements or current items, keep the same target item instead of inventing a project link.",
        "If the target is already resolved to an existing announcement or meeting item, requests like move to archive, archive this, remove from announcements, move out of announcements, сделай встречей, or перенеси в архив are specific enough and do not require clarification.",
        "target.ref is the best currently available human identifier for the target entity. It does not need to be a final repository slug.",
        "target.ref may be a slug, title, name, handle, heading, or short identifying phrase in the user's language, including Cyrillic and spaces.",
        "For create operations, prefer extracting target.ref from the strongest identifying phrase in the turn rather than leaving it null.",
        "Use self-introduction patterns and natural naming phrases as identifiers. Examples: participant 'Меня зовут Аскер' -> target.ref 'Аскер'; participant 'My name is John Smith' -> target.ref 'John Smith'; project 'проект Доверительное управление в Черногории' -> target.ref 'Доверительное управление в Черногории'.",
        "Forwarded profile text, titles, bios, captions, and avatar-photo notes can all contribute to target.ref when they clearly identify the same entity.",
        "Only leave target.ref null if the turn truly does not contain a usable identifier.",
        "For translate requests, identify the entity from the noun the user names: 'переведи проект X' -> entity project, 'переведи участника X' -> entity participant, 'переведи новость X' -> entity announcement, 'переведи встречу X' -> entity meeting.",
        "For translate requests without an explicit noun, infer the most likely entity from the referenced identifier and wording, but do not default to participant just because a recent participant exists.",
        "When the user says 'на все языки', 'to all languages', or equivalent, set requestedLocales.targetLocales to ['*'].",
        "When the user names explicit locales like 'на en и es' or 'to English and Spanish', populate requestedLocales.targetLocales with those exact locales.",
        "If the user mentions multiple entities, choose the primary target and put other referenced entities into relatedEntities.",
        "For linking a news item to a project, the news item is normally the primary target and the project is a related entity with role 'project_link'.",
        "If the request is ambiguous or missing a required target, set needsClarification=true.",
        "Return JSON only.",
        `Schema: ${JSON.stringify(IntentContractSchema)}`,
        `Examples: ${JSON.stringify(examples)}`,
      ].join("\n"),
    },
    {
      role: "user",
      content: JSON.stringify({
        chatId: turn.chatId,
        userId: turn.userId,
        messages: turn.messages.map((message) => ({
          messageId: message.messageId,
          text: message.text || null,
          formattedTextHtml: message.formattedTextHtml || null,
          attachmentKinds: Array.isArray(message.attachments)
            ? [...new Set(message.attachments.map((item) => item.kind).filter(Boolean))]
            : [],
          isForwarded: Boolean(message.isForwarded),
          hasQuote: Boolean(message.hasQuote),
        })),
        recentContext: turn.recentContext || {
          lastConfirmedObject: null,
          pendingDraft: null,
        },
      }),
    },
  ];
}
