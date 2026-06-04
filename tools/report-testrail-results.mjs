import { readFile } from "node:fs/promises";
import path from "node:path";

const STATUS = {
  passed: 1,
  untested: 3,
  failed: 5,
};

const PROJECT_ID = Number.parseInt(process.env.TESTRAIL_PROJECT_ID || "3", 10);
const SUITE_ID = Number.parseInt(process.env.TESTRAIL_SUITE_ID || "11", 10);
const NODE_RESULTS_PATH = process.env.NODE_TEST_RESULTS || "ci-results/node-tests.xml";
const PLAYWRIGHT_RESULTS_PATH = process.env.PLAYWRIGHT_TEST_RESULTS || "test-results/playwright-tests.json";

const TITLE_OVERRIDES = new Map([
  ["renders generated detail pages", "renders generated detail pages for meetings, projects, and participants"],
]);

const AGGREGATE_CASES = [
  {
    caseTitle: "same-origin site resources return no 4xx or request failures",
    source: "playwright",
  },
  {
    caseTitle: "website smoke regression passes on Chromium and WebKit desktop/mobile projects",
    source: "playwright",
  },
];

main().catch((error) => {
  console.error(`TestRail reporting failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main() {
  await loadEnvFile(process.env.TESTRAIL_ENV_FILE || "tools/testrail.env");

  const client = createTestRailClient();
  if (!client) {
    console.log("Skipping TestRail reporting because TESTRAIL_HOST, TESTRAIL_USERNAME, or TESTRAIL_API_KEY is not set.");
    return;
  }

  const [cases, nodeResults, playwrightResults] = await Promise.all([
    fetchAutomatedCases(client),
    readNodeResults(NODE_RESULTS_PATH),
    readPlaywrightResults(PLAYWRIGHT_RESULTS_PATH),
  ]);

  if (cases.length === 0) {
    console.log("No automated TestRail cases found; skipping run creation.");
    return;
  }

  const run = await client.post(`add_run/${PROJECT_ID}`, {
    suite_id: SUITE_ID,
    include_all: false,
    case_ids: cases.map((testCase) => testCase.id),
    name: buildRunName(),
    description: buildRunDescription(),
  });

  const results = buildCaseResults(cases, nodeResults, playwrightResults);
  if (results.length > 0) {
    await client.post(`add_results_for_cases/${run.id}`, { results });
  }

  console.log(`Created TestRail run ${run.id} and added ${results.length} result(s).`);
  const unmatched = [...nodeResults.values(), ...playwrightResults.values()]
    .filter((result) => !result.matched)
    .map((result) => result.title);

  if (unmatched.length > 0) {
    console.log(`Unmatched automated test titles: ${unmatched.slice(0, 20).join("; ")}${unmatched.length > 20 ? "; ..." : ""}`);
  }
}

function createTestRailClient() {
  const host = process.env.TESTRAIL_HOST?.replace(/\/+$/, "");
  const username = process.env.TESTRAIL_USERNAME;
  const apiKey = process.env.TESTRAIL_API_KEY;

  if (!host || !username || !apiKey) {
    return null;
  }

  const auth = Buffer.from(`${username}:${apiKey}`).toString("base64");
  const baseUrl = `${host}/index.php?/api/v2`;

  return {
    async get(endpoint) {
      return requestTestRail(`${baseUrl}/${endpoint}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
    },
    async post(endpoint, body) {
      return requestTestRail(`${baseUrl}/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    },
  };
}

async function loadEnvFile(filePath) {
  const envText = await readOptionalText(filePath);
  if (!envText.trim()) {
    return;
  }

  for (const rawLine of envText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = unwrapEnvValue(line.slice(separatorIndex + 1).trim());
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function unwrapEnvValue(value) {
  const quote = value[0];
  if ((quote === "\"" || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value;
}

async function requestTestRail(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }

  return body;
}

async function fetchAutomatedCases(client) {
  const cases = [];
  let offset = 0;
  const limit = 250;

  while (true) {
    const page = await client.get(`get_cases/${PROJECT_ID}&suite_id=${SUITE_ID}&limit=${limit}&offset=${offset}`);
    const pageCases = Array.isArray(page?.cases) ? page.cases : [];
    cases.push(...pageCases.filter((testCase) => testCase.custom_case_is_automated));

    if (!page?._links?.next || pageCases.length === 0) {
      break;
    }

    offset += limit;
  }

  return cases;
}

async function readNodeResults(filePath) {
  const xml = await readOptionalText(filePath);
  const results = new Map();

  for (const testcase of matchAll(xml, /<testcase\b([^>]*)\/>|<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g)) {
    const attrs = parseXmlAttributes(testcase[1] || testcase[2] || "");
    const body = testcase[3] || "";
    const title = attrs.name;
    if (!title) {
      continue;
    }

    const status = body.includes("<failure") || body.includes("<error") ? STATUS.failed : STATUS.passed;
    const elapsed = secondsToElapsed(Number.parseFloat(attrs.time || "0"));
    const message = stripXml(body).trim();
    addResult(results, title, {
      title,
      status_id: status,
      elapsed,
      comment: buildComment("Node", status, message),
      matched: false,
    });
  }

  return results;
}

async function readPlaywrightResults(filePath) {
  const jsonText = await readOptionalText(filePath);
  const results = new Map();

  if (!jsonText.trim()) {
    return results;
  }

  const report = JSON.parse(jsonText);
  collectPlaywrightSpecs(report, [], results);
  return results;
}

function collectPlaywrightSpecs(value, titlePath, results) {
  if (!value || typeof value !== "object") {
    return;
  }

  const nextTitlePath = typeof value.title === "string" ? [...titlePath, value.title] : titlePath;

  if (Array.isArray(value.tests) && typeof value.title === "string") {
    const title = value.title;
    const attempts = value.tests.flatMap((test) => Array.isArray(test.results) ? test.results : []);
    const failed = attempts.some((attempt) => attempt.status === "failed" || attempt.status === "timedOut" || attempt.status === "interrupted");
    const skipped = attempts.length > 0 && attempts.every((attempt) => attempt.status === "skipped");
    const durationMs = attempts.reduce((sum, attempt) => sum + (Number.isFinite(attempt.duration) ? attempt.duration : 0), 0);
    const errorMessage = attempts
      .flatMap((attempt) => Array.isArray(attempt.errors) ? attempt.errors : [])
      .map((error) => error.message || error.value || "")
      .filter(Boolean)
      .join("\n\n");

    if (!skipped) {
      addResult(results, title, {
        title,
        status_id: failed ? STATUS.failed : STATUS.passed,
        elapsed: millisecondsToElapsed(durationMs),
        comment: buildComment(`Playwright: ${nextTitlePath.slice(0, -1).join(" > ")}`, failed ? STATUS.failed : STATUS.passed, errorMessage),
        matched: false,
      });
    }
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        collectPlaywrightSpecs(item, nextTitlePath, results);
      }
    } else if (child && typeof child === "object") {
      collectPlaywrightSpecs(child, nextTitlePath, results);
    }
  }
}

function buildCaseResults(cases, nodeResults, playwrightResults) {
  const allResults = new Map([...nodeResults, ...playwrightResults]);
  const caseById = new Map(cases.map((testCase) => [testCase.id, testCase]));
  const caseByTitle = new Map(cases.map((testCase) => [normalizeTitle(testCase.title), testCase]));
  const results = [];

  for (const result of allResults.values()) {
    const caseId = extractCaseId(result.title);
    const mappedTitle = TITLE_OVERRIDES.get(normalizeTitle(result.title)) || stripCaseId(result.title);
    const testCase = caseId ? caseById.get(caseId) : caseByTitle.get(normalizeTitle(mappedTitle));
    if (!testCase) {
      continue;
    }

    result.matched = true;
    results.push({
      case_id: testCase.id,
      status_id: result.status_id,
      elapsed: result.elapsed,
      comment: result.comment,
      version: process.env.GITHUB_SHA || null,
    });
  }

  for (const aggregate of AGGREGATE_CASES) {
    const testCase = caseByTitle.get(aggregate.caseTitle);
    if (!testCase) {
      continue;
    }

    const sourceResults = aggregate.source === "playwright"
      ? [...playwrightResults.values()]
      : [...nodeResults.values()];
    if (sourceResults.length === 0) {
      continue;
    }

    results.push({
      case_id: testCase.id,
      status_id: sourceResults.some((result) => result.status_id === STATUS.failed) ? STATUS.failed : STATUS.passed,
      elapsed: sumElapsed(sourceResults),
      comment: `Aggregate result from ${sourceResults.length} ${aggregate.source} test result(s).`,
      version: process.env.GITHUB_SHA || null,
    });
  }

  return dedupeResultsByCase(results);
}

function addResult(results, title, result) {
  const caseId = extractCaseId(title);
  const key = caseId
    ? `case:${caseId}`
    : normalizeTitle(TITLE_OVERRIDES.get(normalizeTitle(title)) || title);
  const existing = results.get(key);

  if (!existing) {
    results.set(key, result);
    return;
  }

  results.set(key, {
    ...existing,
    status_id: existing.status_id === STATUS.failed || result.status_id === STATUS.failed ? STATUS.failed : STATUS.passed,
    elapsed: sumElapsed([existing, result]),
    comment: `${existing.comment}\n\n${result.comment}`.trim(),
  });
}

function dedupeResultsByCase(results) {
  const byCase = new Map();

  for (const result of results) {
    const existing = byCase.get(result.case_id);
    if (!existing) {
      byCase.set(result.case_id, result);
      continue;
    }

    byCase.set(result.case_id, {
      ...existing,
      status_id: existing.status_id === STATUS.failed || result.status_id === STATUS.failed ? STATUS.failed : STATUS.passed,
      elapsed: sumElapsed([existing, result]),
      comment: `${existing.comment}\n\n${result.comment}`.trim(),
    });
  }

  return [...byCase.values()];
}

async function readOptionalText(filePath) {
  try {
    return await readFile(path.resolve(filePath), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function parseXmlAttributes(text) {
  const attrs = {};
  for (const match of matchAll(text, /([\w:-]+)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function stripXml(text) {
  return decodeXml(text.replace(/<[^>]+>/g, " "));
}

function decodeXml(text) {
  return text
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function normalizeTitle(title) {
  return stripCaseId(title)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function extractCaseId(title) {
  const match = String(title || "").match(/\[C(\d+)\]/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function stripCaseId(title) {
  return String(title || "").replace(/\[C\d+\]\s*/gi, "");
}

function buildRunName() {
  const runNumber = process.env.GITHUB_RUN_NUMBER;
  const refName = process.env.GITHUB_REF_NAME || process.env.GITHUB_HEAD_REF || "local";
  return runNumber ? `CI #${runNumber} - ${refName}` : `CI - ${new Date().toISOString()}`;
}

function buildRunDescription() {
  const lines = [
    "Automated run created by GitHub Actions.",
    process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `Workflow: ${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
    process.env.GITHUB_SHA ? `Commit: ${process.env.GITHUB_SHA}` : null,
    ...buildRunTimingLines(),
  ];

  return lines.filter(Boolean).join("\n");
}

function buildRunTimingLines() {
  const lines = [];
  const nodeSeconds = parsePositiveInteger(process.env.NODE_TEST_WALL_SECONDS);
  const playwrightSeconds = parsePositiveInteger(process.env.PLAYWRIGHT_TEST_WALL_SECONDS);
  const startedSeconds = parsePositiveInteger(process.env.CI_TEST_STARTED_SECONDS);

  if (nodeSeconds !== null) {
    lines.push(`Node test wall time: ${formatDuration(nodeSeconds)}`);
  }
  if (playwrightSeconds !== null) {
    lines.push(`Playwright test wall time: ${formatDuration(playwrightSeconds)}`);
  }
  if (startedSeconds !== null) {
    const totalSeconds = Math.max(0, Math.round(Date.now() / 1000) - startedSeconds);
    lines.push(`Test phase wall time before TestRail report: ${formatDuration(totalSeconds)}`);
  }

  return lines;
}

function buildComment(source, status, message) {
  const statusText = status === STATUS.failed ? "failed" : "passed";
  return [`${source} ${statusText}.`, message].filter(Boolean).join("\n\n").slice(0, 4000);
}

function millisecondsToElapsed(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return null;
  }
  return secondsToElapsed(ms / 1000);
}

function secondsToElapsed(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  const rounded = Math.max(1, Math.round(seconds));
  if (rounded < 60) {
    return `${rounded}s`;
  }

  return `${Math.ceil(rounded / 60)}m`;
}

function sumElapsed(results) {
  const seconds = results.reduce((sum, result) => sum + elapsedToSeconds(result.elapsed), 0);
  return seconds > 0 ? secondsToElapsed(seconds) : null;
}

function elapsedToSeconds(elapsed) {
  const match = String(elapsed || "").match(/^(\d+)([smh])$/);
  if (!match) {
    return 0;
  }

  const value = Number.parseInt(match[1], 10);
  if (match[2] === "h") {
    return value * 3600;
  }
  if (match[2] === "m") {
    return value * 60;
  }
  return value;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (remainingSeconds > 0 || parts.length === 0) {
    parts.push(`${remainingSeconds}s`);
  }

  return parts.join(" ");
}

function matchAll(text, regex) {
  return [...String(text || "").matchAll(regex)];
}
