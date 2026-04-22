import { ContentRepositoryError } from "../../domain/errors.js";
import { mergeContentItems } from "../../core/content-localization.js";

const GITHUB_API_ROOT = "https://api.github.com";
const RETRYABLE_GITHUB_STATUSES = new Set([502, 503, 504]);

export class GitHubContentRepository {
  constructor({
    owner,
    repo,
    branch,
    token,
    attachmentStageRoot = "assets/uploads",
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
    this.attachmentStageRoot = attachmentStageRoot;
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

  async listEntityCandidates(entity) {
    const index = await this.readIndex(entity);
    const slugs = Array.isArray(index.items) ? index.items : [];
    const items = await Promise.all(
      slugs.map(async (slug) => {
        const item = await this.readItem(entity, slug);
        return buildCandidate(entity, slug, item);
      })
    );

    return items;
  }

  async findEntityBySlug(slug) {
    for (const entity of ["announce", "meeting", "participant", "project"]) {
      if (await this.indexContainsSlug(entity, slug)) {
        return entity;
      }
    }

    return null;
  }

  async indexContainsSlug(entity, slug) {
    const index = await this.readIndex(entity);
    return Array.isArray(index.items) && index.items.includes(slug);
  }

  async stageAttachment({ chatId, messageId, attachment, bytes }) {
    const fileName = `${messageId}-${attachment.fileName}`;
    const stagedPath = `${this.attachmentStageRoot}/${chatId}/${fileName}`;
    await this.putFileFromBytes(stagedPath, bytes, `bot: stage attachment ${fileName}`);

    return {
      ...attachment,
      stagedPath,
    };
  }

  async planStagedPhoto(entity, slug, stagedPath) {
    return stagedPath
      ? {
          entity,
          slug,
          stagedPath,
          srcPath: stagedPath,
        }
      : null;
  }

  async applyStagedPhoto(entity, slug, stagedPath) {
    return this.planStagedPhoto(entity, slug, stagedPath);
  }

  async deleteStagedAttachment(stagedPath) {
    if (!stagedPath) {
      return;
    }

    const stagedFile = await this.getFileOrNull(stagedPath);

    if (!stagedFile) {
      return;
    }

    await this.deleteFile(stagedPath, stagedFile.sha, `bot: remove staged attachment ${stagedPath}`);
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
    const existingItem = exists ? await this.readItem(entity, slug) : null;
    const assetPaths = action === "delete" ? resolveManagedAssetPaths(existingItem) : [];
    const nextItem = action === "update"
      ? mergeContentItems(existingItem, item, { entity })
      : item;
    const indexPreview = await buildIndexPreview({
      repository: this,
      entity,
      action,
      slug,
      existingItem,
      nextItem,
    });

    validateCommandPreconditions(action, slug, exists);

    return {
      action,
      entity,
      slug,
      exists,
      currentIndex: indexPreview.indexWrites[0]?.current ?? null,
      nextIndex: indexPreview.indexWrites[0]?.next ?? null,
      currentItem: existingItem,
      nextItem,
      paths: {
        ...this.getEntityPaths(entity, slug),
        indexPath: indexPreview.primaryIndexPath || this.resolveIndexPath(entity),
        extraIndexPaths: indexPreview.indexWrites
          .map((entry) => entry.path)
          .filter((entry) => entry !== (indexPreview.primaryIndexPath || this.resolveIndexPath(entity))),
        assetPaths,
      },
      indexWrites: indexPreview.indexWrites,
    };
  }

  async applyCommand(parsedCommand, { item }) {
    const preview = await this.previewCommand(parsedCommand, { item });
    const slug = parsedCommand.fields.slug;
    const { itemPath, indexPath } = preview.paths;
    const assetPaths = Array.isArray(preview.paths.assetPaths) ? preview.paths.assetPaths : [];
    const commitMessage = buildCommitMessage(parsedCommand);
    const head = await this.getBranchHead();
    const treeEntries = (preview.indexWrites || [{
      path: indexPath,
      next: preview.nextIndex,
    }]).map((indexWrite) => ({
      path: indexWrite.path,
      mode: "100644",
      type: "blob",
      content: stringifyJson(indexWrite.next),
    }));

    if (parsedCommand.action === "delete") {
      treeEntries.push({
        path: itemPath,
        mode: "100644",
        type: "blob",
        sha: null,
      });

      for (const assetPath of assetPaths) {
        const currentAsset = await this.getFileOrNull(assetPath);

        if (!currentAsset) {
          continue;
        }

        treeEntries.push({
          path: assetPath,
          mode: "100644",
          type: "blob",
          sha: null,
        });
      }
    } else {
      treeEntries.push({
        path: itemPath,
        mode: "100644",
        type: "blob",
        content: stringifyJson(preview.nextItem),
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
        extraIndexPaths: (preview.indexWrites || [])
          .map((entry) => entry.path)
          .filter((entry) => entry !== indexPath),
        assetPaths,
      },
      indexChanged: (preview.indexWrites || []).some(
        (entry) => JSON.stringify(entry.current) !== JSON.stringify(entry.next)
      ),
      commitSha: commit.sha,
      commitMessage,
    };
  }

  async previewUndoLastChange(target = null) {
    const undoTarget = target || (await this.findLatestContentCommit());
    const files = await this.buildUndoFiles(undoTarget);

    return {
      action: "undo",
      entity: "content",
      slug: undoTarget.commitSha.slice(0, 7),
      target: undoTarget,
      paths: {
        files: files.map((file) => file.path),
      },
    };
  }

  async applyUndoLastChange(target = null) {
    const undoTarget = target || (await this.findLatestContentCommit());
    const files = await this.buildUndoFiles(undoTarget);
    const head = await this.getBranchHead();
    const treeEntries = files.map((file) =>
      file.parentContent == null
        ? {
            path: file.path,
            mode: "100644",
            type: "blob",
            sha: null,
          }
        : {
            path: file.path,
            mode: "100644",
            type: "blob",
            content: file.parentContent,
          }
    );

    const tree = await this.request("POST", `/repos/${this.owner}/${this.repo}/git/trees`, {
      base_tree: head.treeSha,
      tree: treeEntries,
    });
    const commit = await this.request("POST", `/repos/${this.owner}/${this.repo}/git/commits`, {
      message: `bot: undo ${undoTarget.commitSha.slice(0, 7)}`,
      tree: tree.sha,
      parents: [head.commitSha],
    });

    await this.request("PATCH", `/repos/${this.owner}/${this.repo}/git/refs/heads/${this.branch}`, {
      sha: commit.sha,
      force: false,
    });

    return {
      action: "undo",
      entity: "content",
      slug: undoTarget.commitSha.slice(0, 7),
      commitSha: commit.sha,
      commitMessage: `bot: undo ${undoTarget.commitSha.slice(0, 7)}`,
      paths: {
        files: files.map((file) => file.path),
      },
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

  async findLatestContentCommit() {
    const commits = await this.request(
      "GET",
      `/repos/${this.owner}/${this.repo}/commits?sha=${encodeURIComponent(this.branch)}&per_page=10`
    );

    for (const commit of commits) {
      const details = await this.request("GET", `/repos/${this.owner}/${this.repo}/commits/${commit.sha}`);
      const relevantFiles = (details.files || []).filter((file) => isUndoManagedPath(file.filename));

      if (relevantFiles.length > 0 && details.parents?.[0]?.sha) {
        return {
          commitSha: details.sha,
          parentSha: details.parents[0].sha,
          message: details.commit?.message || "",
        };
      }
    }

    throw new ContentRepositoryError("No previous content commit is available to undo.");
  }

  async getFile(filePath) {
    const file = await this.getFileOrNull(filePath);

    if (!file) {
      throw new ContentRepositoryError(`File '${filePath}' does not exist in GitHub.`);
    }

    return file;
  }

  async getFileAtRefOrNull(filePath, ref) {
    const encodedPath = encodeRepoPath(filePath);
    const response = await this.rawRequest(
      "GET",
      `/repos/${this.owner}/${this.repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`
    );

    if (response.status === 404) {
      return null;
    }

    const payload = await parseApiResponse(response, `${filePath}@${ref}`);

    if (!payload || Array.isArray(payload) || payload.type !== "file") {
      throw new ContentRepositoryError(`Unexpected GitHub contents response for '${filePath}' at ref '${ref}'.`);
    }

    return {
      sha: payload.sha,
      content: decodeGitHubContent(payload.content, payload.encoding),
    };
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
      rawContent: payload.content.replace(/\n/g, ""),
      encoding: payload.encoding,
    };
  }

  async getRawFile(filePath) {
    const file = await this.getFileOrNull(filePath);

    if (!file) {
      throw new ContentRepositoryError(`File '${filePath}' does not exist in GitHub.`);
    }

    return file;
  }

  async request(method, pathname, body = null) {
    const response = await this.rawRequest(method, pathname, body);
    return parseApiResponse(response, pathname);
  }

  rawRequest(method, pathname, body = null) {
    return requestWithRetry(async () =>
      this.fetchImpl(`${GITHUB_API_ROOT}${pathname}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.token}`,
          "user-agent": "pet-project-club-bot",
          "x-github-api-version": "2022-11-28",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      })
    );
  }

  async putFileFromBytes(filePath, bytes, message) {
    await this.putFileFromBase64(filePath, bytesToBase64(bytes), message);
  }

  async putFileFromBase64(filePath, base64Content, message) {
    const current = await this.getFileOrNull(filePath);
    const encodedPath = encodeRepoPath(filePath);

    await this.request("PUT", `/repos/${this.owner}/${this.repo}/contents/${encodedPath}`, {
      message,
      branch: this.branch,
      content: base64Content,
      ...(current?.sha ? { sha: current.sha } : {}),
    });
  }

  async deleteFile(filePath, sha, message) {
    const encodedPath = encodeRepoPath(filePath);

    await this.request("DELETE", `/repos/${this.owner}/${this.repo}/contents/${encodedPath}`, {
      message,
      branch: this.branch,
      sha,
    });
  }

  async buildUndoFiles(target) {
    const details = await this.request("GET", `/repos/${this.owner}/${this.repo}/commits/${target.commitSha}`);
    const relevantFiles = (details.files || []).filter((file) => isUndoManagedPath(file.filename));

    return Promise.all(
      relevantFiles.map(async (file) => {
        const parentFile = await this.getFileAtRefOrNull(file.filename, target.parentSha);
        return {
          path: file.filename,
          parentContent: parentFile?.content ?? null,
        };
      })
    );
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

async function buildIndexPreview({
  repository,
  entity,
  action,
  slug,
  existingItem,
  nextItem,
}) {
  const currentIndexEntity = resolveMeetingIndexEntity(entity, existingItem) || entity;
  const nextIndexEntity = action === "delete"
    ? currentIndexEntity
    : (resolveMeetingIndexEntity(entity, nextItem) || entity);

  if (currentIndexEntity === nextIndexEntity) {
    const currentIndex = await repository.readIndex(currentIndexEntity);
    return {
      primaryIndexPath: repository.resolveIndexPath(currentIndexEntity),
      indexWrites: [{
        path: repository.resolveIndexPath(currentIndexEntity),
        current: currentIndex,
        next: updateIndexItems(currentIndex, slug, action),
      }],
    };
  }

  const sourceIndex = await repository.readIndex(currentIndexEntity);
  const targetIndex = await repository.readIndex(nextIndexEntity);

  return {
    primaryIndexPath: repository.resolveIndexPath(currentIndexEntity),
    indexWrites: [
      {
        path: repository.resolveIndexPath(currentIndexEntity),
        current: sourceIndex,
        next: updateIndexItems(sourceIndex, slug, "delete"),
      },
      {
        path: repository.resolveIndexPath(nextIndexEntity),
        current: targetIndex,
        next: updateIndexItems(targetIndex, slug, "update"),
      },
    ],
  };
}

function resolveMeetingIndexEntity(entity, item) {
  if (entity !== "announce" && entity !== "meeting") {
    return null;
  }

  if (item?.type === "meeting") {
    return "meeting";
  }

  if (item?.type === "announce") {
    return "announce";
  }

  return entity;
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

async function requestWithRetry(requestFn, maxAttempts = 3) {
  let lastResponse = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await requestFn();
    lastResponse = response;

    if (!RETRYABLE_GITHUB_STATUSES.has(response.status) || attempt === maxAttempts) {
      return response;
    }

    await delay(attempt * 400);
  }

  return lastResponse;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function buildCandidate(entity, slug, item) {
  switch (entity) {
    case "participant":
      return {
        slug,
        label: item.name || slug,
        handle: item.handle || null,
        title: item.role || null,
      };
    case "project":
      return {
        slug,
        label: item.title || slug,
        handle: null,
        title: item.status || null,
      };
    case "meeting":
    case "announce":
      return {
        slug,
        label: item.title || slug,
        handle: null,
        title: item.date || null,
      };
    default:
      return {
        slug,
        label: slug,
        handle: null,
        title: null,
      };
  }
}

function resolveManagedAssetPaths(item) {
  const paths = [];

  if (item?.photo?.src && typeof item.photo.src === "string" && item.photo.src.startsWith("assets/")) {
    paths.push(item.photo.src);
  }

  for (const entry of Array.isArray(item?.gallery) ? item.gallery : []) {
    if (entry?.src && typeof entry.src === "string" && entry.src.startsWith("assets/") && !paths.includes(entry.src)) {
      paths.push(entry.src);
    }
  }

  return paths;
}

function isUndoManagedPath(filePath) {
  return typeof filePath === "string" && (filePath.startsWith("content/") || filePath.startsWith("assets/"));
}
