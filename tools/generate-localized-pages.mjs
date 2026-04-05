import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const locales = {
  ru: { lang: "ru-RU" },
  en: { lang: "en" },
  de: { lang: "de" },
  me: { lang: "sr-Latn-ME" },
  es: { lang: "es" },
};

const pages = [
  { template: "index.html", output: "index.html" },
  { template: "meetings/index.html", output: "meetings/index.html" },
  { template: "meetings/item/index.html", output: "meetings/item/index.html" },
  { template: "projects/index.html", output: "projects/index.html" },
  { template: "projects/item/index.html", output: "projects/item/index.html" },
  { template: "participants/index.html", output: "participants/index.html" },
  { template: "participants/item/index.html", output: "participants/item/index.html" },
  { template: "news/index.html", output: "news/index.html" },
];

async function main() {
  await Promise.all(
    Object.keys(locales).map(async (locale) => {
      await fs.rm(path.join(repoRoot, locale), { recursive: true, force: true });
    })
  );

  for (const [locale, localeConfig] of Object.entries(locales)) {
    for (const page of pages) {
      const sourcePath = path.join(repoRoot, page.template);
      const outputPath = path.join(repoRoot, locale, page.output);
      const sourceHtml = await fs.readFile(sourcePath, "utf8");
      const transformedHtml = transformHtml(sourceHtml, locale, localeConfig.lang);
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, transformedHtml, "utf8");
    }

    const localizedFallbacksPath = path.join(repoRoot, locale, "meetings", "fallbacks.js");
    await fs.mkdir(path.dirname(localizedFallbacksPath), { recursive: true });
    await fs.copyFile(
      path.join(repoRoot, "meetings", "fallbacks.js"),
      localizedFallbacksPath
    );
  }
}

function transformHtml(html, locale, langTag) {
  return html
    .replace(/<html lang="[^"]+">/, `<html lang="${langTag}">`)
    .replace(/<body\b([^>]*)>/, (_match, attrs) => {
      if (/data-locale=/.test(attrs)) {
        return `<body${attrs}>`;
      }

      return `<body${attrs} data-locale="${locale}">`;
    })
    .replace(/((?:href|src)=["'])([^"']+)(["'])/g, (_match, prefix, value, suffix) => {
      return `${prefix}${rewriteRepoRelativeAsset(value)}${suffix}`;
    })
    .replace(/(data-content-root=["'])([^"']+)(["'])/g, (_match, prefix, value, suffix) => {
      return `${prefix}${rewriteRepoRelativeAsset(value)}${suffix}`;
    });
}

function rewriteRepoRelativeAsset(value) {
  if (
    typeof value !== "string" ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("#") ||
    value.startsWith("mailto:") ||
    value.startsWith("tel:")
  ) {
    return value;
  }

  if (
    !value.includes("styles.css") &&
    !value.includes("script.js") &&
    !value.includes("assets/") &&
    !value.includes("content")
  ) {
    return value;
  }

  return path.posix.normalize(`../${value}`);
}

await main();
