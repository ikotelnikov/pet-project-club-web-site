import assert from "node:assert/strict";
import test from "node:test";

import { GitHubContentRepository } from "./repository.js";

test("applyCommand retries when GitHub branch ref update is not a fast forward", async () => {
  const requests = [];
  let refReadCount = 0;
  let patchCount = 0;

  const repository = new GitHubContentRepository({
    owner: "owner",
    repo: "repo",
    branch: "main",
    token: "token",
    fetchImpl: async (url, options = {}) => {
      const pathname = new URL(url).pathname;
      requests.push({ method: options.method || "GET", pathname });

      if (pathname.endsWith("/contents/content/participants/items/alice.json")) {
        return jsonResponse({
          type: "file",
          encoding: "base64",
          sha: "item-sha",
          content: encodeJson({ slug: "alice", name: "Alice" }),
        });
      }

      if (pathname.endsWith("/contents/content/participants/index.json")) {
        return jsonResponse({
          type: "file",
          encoding: "base64",
          sha: "index-sha",
          content: encodeJson({ items: ["alice"] }),
        });
      }

      if (pathname.endsWith("/git/ref/heads/main")) {
        refReadCount += 1;
        return jsonResponse({ object: { sha: refReadCount === 1 ? "old-head" : "new-head" } });
      }

      if (pathname.endsWith("/git/commits/old-head")) {
        return jsonResponse({ tree: { sha: "old-tree" } });
      }

      if (pathname.endsWith("/git/commits/new-head")) {
        return jsonResponse({ tree: { sha: "new-tree" } });
      }

      if (pathname.endsWith("/git/trees")) {
        return jsonResponse({ sha: refReadCount === 1 ? "tree-1" : "tree-2" });
      }

      if (pathname.endsWith("/git/commits")) {
        return jsonResponse({ sha: refReadCount === 1 ? "commit-1" : "commit-2" });
      }

      if (pathname.endsWith("/git/refs/heads/main")) {
        patchCount += 1;

        if (patchCount === 1) {
          return jsonResponse(
            {
              message: "Update is not a fast forward",
              documentation_url: "https://docs.github.com/rest/git/refs#update-a-reference",
            },
            { status: 422 }
          );
        }

        return jsonResponse({ object: { sha: "commit-2" } });
      }

      throw new Error(`Unexpected request: ${options.method || "GET"} ${pathname}`);
    },
  });

  const result = await repository.applyCommand(
    {
      action: "update",
      entity: "participant",
      fields: {
        slug: "alice",
      },
    },
    {
      item: {
        slug: "alice",
        role: "Designer",
      },
    }
  );

  assert.equal(result.commitSha, "commit-2");
  assert.equal(patchCount, 2);
  assert.equal(requests.filter((request) => request.pathname.endsWith("/git/ref/heads/main")).length, 2);
});

function jsonResponse(payload, { status = 200 } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function encodeJson(value) {
  return Buffer.from(`${JSON.stringify(value)}\n`, "utf8").toString("base64");
}
