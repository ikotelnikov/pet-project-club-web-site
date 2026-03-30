export function extractTelegramAttachments(message) {
  const attachments = [];

  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = [...message.photo].sort((left, right) => {
      const leftArea = (left.width || 0) * (left.height || 0);
      const rightArea = (right.width || 0) * (right.height || 0);
      return rightArea - leftArea;
    })[0];

    attachments.push({
      kind: "photo",
      fileId: largest.file_id,
      fileUniqueId: largest.file_unique_id || null,
      fileName: buildPhotoName(message, largest),
      mimeType: "image/jpeg",
      size: largest.file_size || null,
      width: largest.width || null,
      height: largest.height || null,
    });
  }

  if (message.video) {
    attachments.push({
      kind: "video",
      fileId: message.video.file_id,
      fileUniqueId: message.video.file_unique_id || null,
      fileName:
        message.video.file_name ||
        `video-${message.video.file_unique_id || message.video.file_id}.mp4`,
      mimeType: message.video.mime_type || "video/mp4",
      size: message.video.file_size || null,
      width: message.video.width || null,
      height: message.video.height || null,
      duration: message.video.duration || null,
    });
  }

  if (message.document) {
    attachments.push({
      kind: "document",
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id || null,
      fileName:
        message.document.file_name ||
        `document-${message.document.file_unique_id || message.document.file_id}`,
      mimeType: message.document.mime_type || "application/octet-stream",
      size: message.document.file_size || null,
    });
  }

  return attachments;
}

function buildPhotoName(message, photo) {
  const messageId = message.message_id || "photo";
  const uniqueId = photo.file_unique_id || photo.file_id || "photo";
  return `photo-${messageId}-${uniqueId}.jpg`;
}
