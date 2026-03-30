export class BotConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "BotConfigError";
  }
}

export class CommandParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "CommandParseError";
  }
}

export class ContentRepositoryError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContentRepositoryError";
  }
}

export class ContentValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContentValidationError";
  }
}

export class TelegramBotError extends Error {
  constructor(message) {
    super(message);
    this.name = "TelegramBotError";
  }
}
