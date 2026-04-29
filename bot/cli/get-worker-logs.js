import { loadBotConfig } from "../config.js";

const argv = process.argv.slice(2);
const config = loadBotConfig();
const baseUrl = readFlagValue(argv, "--base-url") || config.workerBaseUrl;
const limit = readFlagValue(argv, "--limit") || "20";
const level = readFlagValue(argv, "--level");
const event = readFlagValue(argv, "--event");
const since = readFlagValue(argv, "--since");
const adminToken = config.workerAdminToken;

if (!baseUrl) {
  throw new Error("Worker base URL is required. Set WORKER_BASE_URL or pass --base-url.");
}

if (!adminToken) {
  throw new Error("WORKER_ADMIN_TOKEN is required.");
}

const url = new URL(`${baseUrl.replace(/\/$/, "")}/admin/logs`);
url.searchParams.set("limit", limit);

if (level) {
  url.searchParams.set("level", level);
}

if (event) {
  url.searchParams.set("event", event);
}

if (since) {
  url.searchParams.set("since", since);
}

const response = await fetch(url, {
  headers: {
    "x-admin-token": adminToken,
  },
});
const payload = await response.text();

if (!response.ok) {
  throw new Error(`Log fetch failed with status ${response.status}: ${payload}`);
}

process.stdout.write(`${payload}\n`);

function readFlagValue(argvList, flagName) {
  const index = argvList.indexOf(flagName);

  if (index === -1) {
    return null;
  }

  const value = argvList[index + 1];

  if (!value || value.startsWith("--")) {
    throw new Error(`Flag '${flagName}' requires a value.`);
  }

  return value;
}
