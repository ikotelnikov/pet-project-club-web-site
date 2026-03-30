import { ContentRepositoryError } from "../../domain/errors.js";

const GITHUB_API_ROOT = "https://api.github.com";

export class GitHubContentRepository {
  constructor({
    owner,
    repo,
    branch,
    token,
    fetchImpl = fetch,
  }) {
    if (!owner || !repo || !branch || !token) {
      throw new ContentRepositoryError(
        "GitHubContentRepository requires owner, repo, branch, and token."
      );
    }

    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  getEntityPaths(entity, slug = null) {
    const sectionRoot = this.resolveSectionRoot(entity);
    const indexPath = this.resolveIndexPath(entity);
    const itemPath = slug ? `${sectionRoot}/items/${slug}.json` : null;

    return {
      sectionRoot,
      indexPath,
      itemPath,
    };
  }

  resolveSectionRoot(entity) {
    switch (entity) {
      case "announce":
      case "meeting":
        return "content/meetings";
      case "participant":
        return "content/participants";
      case "project":
        return "content/projects";
      default:
        throw new ContentRepositoryError(`Unsupported entity '${entity}'.`);
    }
  }

  resolveIndexPath(entity) {
    switch (entity) {
      case "announce":
        return "content/meetings/announcements/index.json";
      case "meeting":
        return "content/meetings/archive/index.json";
      case "participant":
        return "content/participants/index.json";
      case "project":
        return "content/projects/index.json";
      default:
        throw new ContentRepositoryError(`Unsupported entity '${entity}'.`);
    }
  }

  resolveAssetDirectory(entity) {
    switch (entity) {
      case "announce":
      case "meeting":
        return "assets/meetings";
      case "participant":
        return "assets/participants";
      case "project":
        return "assets/projects";
      default:
        throw new ContentRepositoryError(`Unsupported entity '${entity}'.`);
    }
  }

  async readIndex(entity) {
    const indexPath = this.resolveIndexPath(entity);
    const file = await this.getFile(indexPath);
    return parseJsonFile(indexPath, file.content);
  }

  async readItem(entity, slug) {
    const { itemPath } = this.getEntityPaths(entity, slug);
    const file = await this.getFile(itemPath);
    return parseJsonFile(itemPath, file.content);
  }

  async itemExists(entity, slug) {
    const { itemPath } = this.getEntityPaths(entity, slug);
    const file = await this.getFileOrNull(itemPath);
    return Boolean(file);
  }

  async previewCommand(parsedCommand, { item }) {
    const { entity, action } = parsedCommand;
    const slug = parsedCommand.fields.slug;
    const exists = await this.itemExists(entity, slug);
    const currentIndex = await this.readIndex(entity);

    validateCommandPreconditions(action, slug, exists);

    return {
      action,
      entity,
      slug,
      exists,
      currentIndex,
      nextIndex: updateIndexItems(currentIndex, slug, action),
      nextItem: item,
      paths: this.getEntityPaths(entity, slug),
    };
  }

  async applyCommand(parsedCommand, { item }) {
    const preview = await this.previewCommand(parsedCommand, { item });
    const slug = parsedCommand.fields.slug;
    const { itemPath, indexPath } = preview.paths;
    const commitMessage = buildCommitMessage(parsedCommand);
    const head = await this.getBranchHead();
    const treeEntries = [
      {
        path: indexPath,
        mode: "100644",
        type: "blob",
        content: stringifyJson(preview.nextIndex),
      },
    ];

    if (parsedCommand.action === "delete") {
      treeEntries.push({
        path: itemPath,
        mode: "100644",
        type: "blob",
        sha: null,
      });
    } else {
      treeEntries.push({
        path: itemPath,
        mode: "100644",
        type: "blob",
        content: stringifyJson(item),
      });
    }

    const tree = await this.request("POST", `/repos/${this.owner}/${this.repo}/git/trees`, {
      base_tree: head.treeSha,
      tree: treeEntries,
    });
    const commit = await this.request("POST", `/repos/${this.owner}/${this.repo}/git/commits`, {
      message: commitMessage,
      tree: tree.sha,
      parents: [head.commitSha],
    });

    await this.request("PATCH", `/repos/${this.owner}/${this.repo}/git/refs/heads/${this.branch}`, {
      sha: commit.sha,
      force: false,
    });

    return {
      action: parsedCommand.action,
      entity: parsedCommand.entity,
      slug,
      paths: {
        itemPath,
        indexPath,
      },
      indexChanged:
        JSON.stringify(preview.currentIndex) !== JSON.stringify(preview.nextIndex),
      commitSha: commit.sha,
      commitMessage,
    };
  }

  async getBranchHead() {
    const ref = await this.request(
      "GET",
      `/repos/${this.owner}/${this.repo}/git/ref/heads/${this.branch}`
    );
    const commit = await this.request(
      "GET",
      `/repos/${this.owner}/${this.repo}/git/commits/${ref.object.sha}`
    );

    return {
      commitSha: ref.object.sha,
      treeSha: commit.tree.sha,
    };
  }

  async getFile(filePath) {
    const file = await this.getFileOrNull(filePath);

    if (!file) {
      throw new ContentRepositoryError(`File '${filePath}' does not exist in GitHub.`);
    }

    return file;
  }

  async getFileOrNull(filePath) {
    const encodedPath = encodeRepoPath(filePath);
    const response = await this.rawRequest(
      "GET",
      `/repos/${this.owner}/${this.repo}/contents/${encodedPath}?ref=${encodeURIComponent(this.branch)}`
    );

    if (response.status === 404) {
      return null;
    }

    const payload = await parseApiResponse(response, filePath);

    if (!payload || Array.isArray(payload) || payload.type !== "file") {
      throw new ContentRepositoryError(`Unexpected GitHub contents response for '${filePath}'.`);
    }

    return {
      sha: payload.sha,
      content: decodeGitHubContent(payload.content, payload.encoding),
    };
  }

  async request(method, pathname, body = null) {
    const response = await this.rawRequest(method, pathname, body);
    return parseApiResponse(response, pathname);
  }

  rawRequest(method, pathname, body = null) {
    return this.fetchImpl(`${GITHUB_API_ROOT}${pathname}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.token}`,
        "user-agent": "pet-project-club-bot",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}

function validateCommandPreconditions(action, slug, exists) {
  if (action === "create" && exists) {
    throw new ContentRepositoryError(`Cannot create '${slug}' because it already exists.`);
  }

  if ((action === "update" || action === "delete") && !exists) {
    throw new ContentRepositoryError(`Cannot ${action} '${slug}' because it does not exist.`);
  }
}

function updateIndexItems(indexData, slug, action) {
  const nextIndex = structuredClone(indexData);
  const items = Array.isArray(nextIndex.items) ? [...nextIndex.items] : [];

  if (action === "create" || action === "update") {
    if (!items.includes(slug)) {
      items.unshift(slug);
    }
  }

  if (action === "delete") {
    nextIndex.items = items.filter((entry) => entry !== slug);
    return nextIndex;
  }

  nextIndex.items = items;
  return nextIndex;
}

function buildCommitMessage(parsedCommand) {
  return `bot: ${parsedCommand.action} ${parsedCommand.entity} ${parsedCommand.fields.slug}`;
}

function stringifyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseJsonFile(filePath, content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new ContentRepositoryError(
      `Failed to parse JSON file '${filePath}' from GitHub: ${error.message}`
    );
  }
}

function decodeGitHubContent(content, encoding) {
  if (encoding !== "base64") {
    throw new ContentRepositoryError(`Unsupported GitHub content encoding '${encoding}'.`);
  }

  const normalizedContent = content.replace(/\n/g, "");

  if (typeof Buffer !== "undefined") {
    return Buffer.from(normalizedContent, "base64").toString("utf8");
  }

  if (typeof atob === "function") {
    return decodeUtf8Bytes(
      Uint8Array.from(atob(normalizedContent), (character) => character.charCodeAt(0))
    );
  }

  throw new ContentRepositoryError("No base64 decoder is available in this runtime.");
}

async function parseApiResponse(response, context = "") {
  let payload = null;
  let rawText = null;

  try {
    payload = await response.json();
  } catch {
    try {
      rawText = await response.text();
    } catch {
      rawText = null;
    }
  }

  if (!response.ok) {
    const messageParts = [];

    if (payload && typeof payload.message === "string") {
      messageParts.push(payload.message);
    } else {
      messageParts.push(`GitHub API request failed with ${response.status}.`);
    }

    if (context) {
      messageParts.push(`context=${context}`);
    }

    if (payload && typeof payload.documentation_url === "string") {
      messageParts.push(payload.documentation_url);
    }

    if (payload && typeof payload.error === "string") {
      messageParts.push(payload.error);
    }

    if (rawText && rawText.trim() !== "") {
      messageParts.push(rawText.trim());
    }

    throw new ContentRepositoryError(messageParts.join(" | "));
  }

  return payload;
}

function encodeRepoPath(filePath) {
  return filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function decodeUtf8Bytes(bytes) {
  if (typeof TextDecoder !== "undefined") {
    return new TextDecoder().decode(bytes);
  }

  return String.fromCharCode(...bytes);
}
