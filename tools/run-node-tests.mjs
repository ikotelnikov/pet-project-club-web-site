import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const junitIndex = args.indexOf("--junit");
const junitPath = junitIndex === -1 ? null : args[junitIndex + 1];
const testFiles = await findTestFiles("bot");

if (testFiles.length === 0) {
  console.error("No Node test files found under bot/.");
  process.exit(1);
}

const nodeArgs = ["--test"];
if (junitPath) {
  nodeArgs.push("--test-reporter=junit", `--test-reporter-destination=${junitPath}`);
}
nodeArgs.push(...testFiles);

const child = spawn(process.execPath, nodeArgs, {
  stdio: "inherit",
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Node tests terminated by ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

async function findTestFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findTestFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(entryPath);
    }
  }

  return files.sort();
}
