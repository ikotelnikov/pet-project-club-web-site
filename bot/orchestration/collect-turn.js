function buildMessageEntry({
  message,
  updateId,
  text,
  formattedTextHtml,
  attachments,
}) {
  return {
    messageId: message.message_id ?? null,
    updateId,
    text: text || null,
    formattedTextHtml: formattedTextHtml || null,
    attachments: Array.isArray(attachments) ? attachments : [],
    isForwarded: Boolean(message.forward_origin),
    hasQuote: Boolean(message.quote),
  };
}

export function collectTurn({
  message,
  updateId,
  text,
  formattedTextHtml,
  recentContext = null,
  attachments = [],
  existingTurn = null,
}) {
  if (existingTurn) {
    return {
      ...existingTurn,
      messages: [...(existingTurn.messages || [])],
    };
  }

  return {
    chatId: message.chat?.id || message.from?.id || null,
    userId: message.from?.id || null,
    messages: [
      buildMessageEntry({
        message,
        updateId,
        text,
        formattedTextHtml,
        attachments,
      }),
    ],
    recentContext: recentContext || {
      lastConfirmedObject: null,
      pendingDraft: null,
    },
  };
}

export function appendTurnMessage(turn, {
  message,
  updateId,
  text,
  formattedTextHtml,
  attachments,
}) {
  return {
    ...turn,
    messages: [
      ...(turn.messages || []),
      buildMessageEntry({
        message,
        updateId,
        text,
        formattedTextHtml,
        attachments,
      }),
    ],
  };
}
