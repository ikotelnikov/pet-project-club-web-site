import fs from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const siteUrl = "https://petprojectclub.me";
const defaultLocale = "ru";
const generatedLocales = {
  en: { lang: "en" },
  de: { lang: "de" },
  me: { lang: "sr-Latn-ME" },
  es: { lang: "es" },
};
const allLocales = {
  ru: { lang: "ru-RU" },
  ...generatedLocales,
};
const indexableSections = ["meetings", "projects", "participants"];
const templatePaths = {
  main: "index.html",
  meetings: "meetings/index.html",
  meetingDetail: "meetings/item/index.html",
  projects: "projects/index.html",
  projectDetail: "projects/item/index.html",
  participants: "participants/index.html",
  participantDetail: "participants/item/index.html",
  news: "news/index.html",
};

await main();

async function main() {
  const templates = await loadTemplates();
  const uiByLocale = await loadUiMessages();
  const content = await loadContent();

  await cleanupGeneratedOutputs();

  const sitemapEntries = [];

  for (const locale of Object.keys(allLocales)) {
    const localized = localizeSiteContent(content, locale);
    const localeRoutes = buildRoutesForLocale(locale, localized, uiByLocale[locale]);

    for (const route of localeRoutes) {
      const templateHtml = templates[route.templateKey];
      const transformedTemplate = locale === defaultLocale
        ? templateHtml
        : transformHtml(templateHtml, locale, allLocales[locale].lang);
      const pageHtml = buildPageHtml(transformedTemplate, route);
      await writeOutput(route.outputPath, pageHtml);

      if (route.indexable) {
        sitemapEntries.push({
          url: toAbsoluteUrl(route.publicPath),
          alternates: route.alternates,
          lastmod: route.lastmod || null,
        });
      }
    }

    const fallbackRoutes = buildFallbackRoutes(locale, uiByLocale[locale]);

    for (const route of fallbackRoutes) {
      const templateHtml = templates[route.templateKey];
      const transformedTemplate = locale === defaultLocale
        ? templateHtml
        : transformHtml(templateHtml, locale, allLocales[locale].lang);
      const pageHtml = buildPageHtml(transformedTemplate, route);
      await writeOutput(route.outputPath, pageHtml);
    }
  }

  await writeOutput("robots.txt", buildRobotsTxt());
  await writeOutput("sitemap.xml", buildSitemapXml(sitemapEntries));
}

async function loadTemplates() {
  const entries = await Promise.all(
    Object.entries(templatePaths).map(async ([key, filePath]) => {
      const html = await fs.readFile(path.join(repoRoot, filePath), "utf8");
      return [key, html];
    })
  );

  return Object.fromEntries(entries);
}

async function loadUiMessages() {
  const entries = await Promise.all(
    Object.keys(allLocales).map(async (locale) => {
      const value = await readJsonFile(path.join(repoRoot, "content", "i18n", "ui", `${locale}.json`));
      return [locale, value];
    })
  );

  return Object.fromEntries(entries);
}

async function loadContent() {
  const [
    mainPage,
    meetingsPage,
    announcementsIndex,
    archiveIndex,
    projectsPage,
    projectsIndex,
    participantsPage,
    participantsIndex,
    newsPage,
  ] = await Promise.all([
    readJsonFile(path.join(repoRoot, "content", "main", "page.json")),
    readJsonFile(path.join(repoRoot, "content", "meetings", "page.json")),
    readJsonFile(path.join(repoRoot, "content", "meetings", "announcements", "index.json")),
    readJsonFile(path.join(repoRoot, "content", "meetings", "archive", "index.json")),
    readJsonFile(path.join(repoRoot, "content", "projects", "page.json")),
    readJsonFile(path.join(repoRoot, "content", "projects", "index.json")),
    readJsonFile(path.join(repoRoot, "content", "participants", "page.json")),
    readJsonFile(path.join(repoRoot, "content", "participants", "index.json")),
    readJsonFile(path.join(repoRoot, "content", "news", "page.json")),
  ]);

  const [meetingItems, projectItems, participantItems] = await Promise.all([
    loadIndexedItems("meetings", [...new Set([...(announcementsIndex.items || []), ...(archiveIndex.items || [])])]),
    loadIndexedItems("projects", projectsIndex.items || []),
    loadIndexedItems("participants", participantsIndex.items || []),
  ]);

  return {
    mainPage,
    meetingsPage,
    announcementsIndex,
    archiveIndex,
    projectsPage,
    participantsPage,
    newsPage,
    meetingItems,
    projectItems,
    participantItems,
  };
}

async function loadIndexedItems(section, slugs) {
  const entries = await Promise.all(
    slugs.map(async (slug) => {
      const item = await readJsonFile(path.join(repoRoot, "content", section, "items", `${slug}.json`));
      return [slug, item];
    })
  );

  return Object.fromEntries(entries);
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function cleanupGeneratedOutputs() {
  for (const locale of [...Object.keys(generatedLocales), "ru"]) {
    await fs.rm(path.join(repoRoot, locale), { recursive: true, force: true });
  }

  for (const section of indexableSections) {
    const sectionRoot = path.join(repoRoot, section);
    const entries = await fs.readdir(sectionRoot, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "item") {
        continue;
      }

      await fs.rm(path.join(sectionRoot, entry.name), { recursive: true, force: true });
    }
  }

  for (const fileName of ["robots.txt", "sitemap.xml"]) {
    await fs.rm(path.join(repoRoot, fileName), { force: true });
  }
}

function localizeSiteContent(content, locale) {
  const mainPage = localizeContentNode(content.mainPage, locale);
  const meetingsPage = localizeContentNode(content.meetingsPage, locale);
  const projectsPage = localizeContentNode(content.projectsPage, locale);
  const participantsPage = localizeContentNode(content.participantsPage, locale);
  const newsPage = localizeContentNode(content.newsPage, locale);
  const projectItems = sortByFeaturedRank(
    Object.values(content.projectItems).map((item) => localizeContentNode(item, locale))
  );
  const participantItems = sortByFeaturedRank(
    Object.values(content.participantItems).map((item) => localizeContentNode(item, locale))
  );
  const meetingItems = Object.values(content.meetingItems).map((item) => localizeContentNode(item, locale));

  return {
    mainPage,
    meetingsPage,
    projectsPage,
    participantsPage,
    newsPage,
    projectItems,
    participantItems,
    meetingItems,
    announcementItems: sortByDateDesc(
      (content.announcementsIndex.items || [])
        .map((slug) => localizeContentNode(content.meetingItems[slug], locale))
        .filter(Boolean)
    ),
    archiveItems: sortByDateDesc(
      (content.archiveIndex.items || [])
        .map((slug) => localizeContentNode(content.meetingItems[slug], locale))
        .filter(Boolean)
    ),
  };
}

function buildRoutesForLocale(locale, content, ui) {
  const siteName = ui.meta?.siteName || "Pet Project Club Budva";
  const projectMap = new Map(content.projectItems.map((item) => [item.slug, item]));
  const participantMap = new Map(content.participantItems.map((item) => [item.slug, item]));
  const projectNews = sortByDateDesc(
    [...content.announcementItems, ...content.archiveItems].filter(
      (item) => Array.isArray(item.projectSlugs) && item.projectSlugs.length > 0
    )
  );
  const routes = [
    createRoute({
      locale,
      templateKey: "main",
      publicPath: localePath(locale, ""),
      title: ui.meta?.main?.title || siteName,
      description: ui.meta?.main?.description || summarizePlainText(content.mainPage.hero?.lead),
      pageContent: renderMainPage(content.mainPage, locale),
      schema: buildMainSchema(content.mainPage, siteName),
      alternates: buildAlternateUrls(""),
      lastmod: latestDateFromMeetings(content.meetingItems),
    }),
    createRoute({
      locale,
      templateKey: "meetings",
      publicPath: localePath(locale, "meetings/"),
      title: ui.meta?.meetings?.title || `Meetings | ${siteName}`,
      description: ui.meta?.meetings?.description || summarizePlainText(content.meetingsPage.announcements?.description),
      pageContent: renderMeetingsHub(content.meetingsPage, content.announcementItems, content.archiveItems, ui, locale),
      schema: buildCollectionSchema({
        siteName,
        title: content.meetingsPage.announcements?.title || navLabel(ui, "meetings"),
        description: ui.meta?.meetings?.description || summarizePlainText(content.meetingsPage.formats?.description),
        publicPath: localePath(locale, "meetings/"),
        breadcrumb: [{ name: navLabel(ui, "meetings"), path: localePath(locale, "meetings/") }],
      }),
      alternates: buildAlternateUrls("meetings/"),
      lastmod: latestDateFromItems(content.announcementItems, content.archiveItems),
    }),
    createRoute({
      locale,
      templateKey: "projects",
      publicPath: localePath(locale, "projects/"),
      title: ui.meta?.projects?.title || `${content.projectsPage.list?.title || "Projects"} | ${siteName}`,
      description: ui.meta?.projects?.description || summarizePlainText(content.projectsPage.notes?.description),
      pageContent: renderProjectsHub(content.projectsPage, content.projectItems, participantMap, ui, locale),
      schema: buildCollectionSchema({
        siteName,
        title: content.projectsPage.list?.title || navLabel(ui, "projects"),
        description: ui.meta?.projects?.description || summarizePlainText(content.projectsPage.notes?.description),
        publicPath: localePath(locale, "projects/"),
        breadcrumb: [{ name: navLabel(ui, "projects"), path: localePath(locale, "projects/") }],
      }),
      alternates: buildAlternateUrls("projects/"),
      lastmod: latestDateFromProjects(content.projectItems),
    }),
    createRoute({
      locale,
      templateKey: "participants",
      publicPath: localePath(locale, "participants/"),
      title: ui.meta?.participants?.title || `${content.participantsPage.title || "Participants"} | ${siteName}`,
      description: ui.meta?.participants?.description || summarizePlainText(content.participantsPage.description),
      pageContent: renderParticipantsHub(content.participantsPage, content.participantItems, ui, locale),
      schema: buildCollectionSchema({
        siteName,
        title: content.participantsPage.title || navLabel(ui, "participants"),
        description: ui.meta?.participants?.description || summarizePlainText(content.participantsPage.description),
        publicPath: localePath(locale, "participants/"),
        breadcrumb: [{ name: navLabel(ui, "participants"), path: localePath(locale, "participants/") }],
      }),
      alternates: buildAlternateUrls("participants/"),
      lastmod: latestDateFromProjects(content.projectItems),
    }),
    createRoute({
      locale,
      templateKey: "news",
      publicPath: localePath(locale, "news/"),
      title: ui.meta?.news?.title || `${content.newsPage.list?.title || "News"} | ${siteName}`,
      description: ui.meta?.news?.description || summarizePlainText(content.newsPage.notes?.description),
      pageContent: renderNewsHub(content.newsPage, projectNews, projectMap, ui, locale),
      schema: buildCollectionSchema({
        siteName,
        title: content.newsPage.list?.title || navLabel(ui, "news"),
        description: ui.meta?.news?.description || summarizePlainText(content.newsPage.notes?.description),
        publicPath: localePath(locale, "news/"),
        breadcrumb: [{ name: navLabel(ui, "news"), path: localePath(locale, "news/") }],
      }),
      alternates: buildAlternateUrls("news/"),
      lastmod: latestDateFromItems(projectNews),
    }),
  ];

  for (const item of content.meetingItems) {
    routes.push(
      createRoute({
        locale,
        templateKey: "meetingDetail",
        publicPath: localePath(locale, `meetings/${item.slug}/`),
        title: `${item.title} | ${siteName}`,
        description: summarizePlainText(firstNonEmpty(item.paragraphs?.[0], item.detailsHtml, item.title)),
        pageContent: renderMeetingDetail(item, content.meetingsPage, locale),
        schema: buildMeetingSchema(item, siteName, localePath(locale, `meetings/${item.slug}/`), ui),
        alternates: buildAlternateUrls(`meetings/${item.slug}/`),
        lastmod: item.date || null,
      })
    );
  }

  for (const item of content.projectItems) {
    const owners = (item.ownerSlugs || []).map((slug) => participantMap.get(slug)).filter(Boolean);
    const relatedMeetings = projectNews.filter(
      (meeting) => Array.isArray(meeting.projectSlugs) && meeting.projectSlugs.includes(item.slug)
    );

    routes.push(
      createRoute({
        locale,
        templateKey: "projectDetail",
        publicPath: localePath(locale, `projects/${item.slug}/`),
        title: `${item.title} | ${siteName}`,
        description: summarizePlainText(firstNonEmpty(item.summary, item.detailsHtml, item.title)),
        pageContent: renderProjectDetail(item, content.projectsPage, owners, relatedMeetings, locale),
        schema: buildProjectSchema(item, owners, siteName, localePath(locale, `projects/${item.slug}/`), ui),
        alternates: buildAlternateUrls(`projects/${item.slug}/`),
        lastmod: latestDateFromItems(relatedMeetings) || null,
      })
    );
  }

  for (const item of content.participantItems) {
    const relatedProjects = content.projectItems.filter(
      (project) => Array.isArray(project.ownerSlugs) && project.ownerSlugs.includes(item.slug)
    );

    routes.push(
      createRoute({
        locale,
        templateKey: "participantDetail",
        publicPath: localePath(locale, `participants/${item.slug}/`),
        title: `${item.name || item.slug} | ${siteName}`,
        description: summarizePlainText(firstNonEmpty(item.bio, item.role, item.name, item.slug)),
        pageContent: renderParticipantDetail(item, content.participantsPage, relatedProjects, locale),
        schema: buildParticipantSchema(item, siteName, localePath(locale, `participants/${item.slug}/`), ui),
        alternates: buildAlternateUrls(`participants/${item.slug}/`),
        lastmod: latestDateFromProjects(relatedProjects),
      })
    );
  }

  return routes;
}

function buildFallbackRoutes(locale, ui) {
  return [
    createRoute({
      locale,
      templateKey: "meetingDetail",
      publicPath: localePath(locale, "meetings/item/"),
      title: ui.meta?.["meeting-detail"]?.title || "Meeting",
      description: ui.meta?.["meeting-detail"]?.description || "Meeting detail fallback page.",
      pageContent: renderFallbackDetail(ui.errors?.meetingSlugMissing || "Missing meeting slug."),
      schema: [],
      alternates: [],
      robots: "noindex,follow",
      indexable: false,
    }),
    createRoute({
      locale,
      templateKey: "projectDetail",
      publicPath: localePath(locale, "projects/item/"),
      title: ui.meta?.["project-detail"]?.title || "Project",
      description: ui.meta?.["project-detail"]?.description || "Project detail fallback page.",
      pageContent: renderFallbackDetail(ui.errors?.projectSlugMissing || "Missing project slug."),
      schema: [],
      alternates: [],
      robots: "noindex,follow",
      indexable: false,
    }),
    createRoute({
      locale,
      templateKey: "participantDetail",
      publicPath: localePath(locale, "participants/item/"),
      title: ui.meta?.["participant-detail"]?.title || "Participant",
      description: ui.meta?.["participant-detail"]?.description || "Participant detail fallback page.",
      pageContent: renderFallbackDetail(ui.errors?.participantSlugMissing || "Missing participant slug."),
      schema: [],
      alternates: [],
      robots: "noindex,follow",
      indexable: false,
    }),
  ];
}

function createRoute({
  locale,
  templateKey,
  publicPath,
  title,
  description,
  pageContent,
  schema,
  alternates,
  robots = "index,follow",
  indexable = true,
  lastmod = null,
}) {
  return {
    locale,
    templateKey,
    publicPath,
    outputPath: outputPathFromPublicPath(publicPath),
    title,
    description,
    pageContent,
    schema,
    alternates,
    robots,
    indexable,
    lastmod,
  };
}

function buildPageHtml(sourceHtml, route) {
  let html = sourceHtml;
  html = replacePageContent(html, route.pageContent);
  html = stripManagedSeo(html);
  html = replaceTagContent(html, /<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(route.title)}</title>`);
  html = replaceMetaContent(html, "name", "description", route.description);
  html = replaceMetaContent(html, "property", "og:title", route.title);
  html = replaceMetaContent(html, "property", "og:description", route.description);
  html = replaceMetaContent(html, "property", "og:url", toAbsoluteUrl(route.publicPath));
  html = replaceMetaContent(html, "name", "twitter:title", route.title);
  html = replaceMetaContent(html, "name", "twitter:description", route.description);

  const seoBlock = [
    `<meta name="robots" content="${route.robots}">`,
    `<link rel="canonical" href="${toAbsoluteUrl(route.publicPath)}">`,
    ...route.alternates.map((alternate) => `<link rel="alternate" hreflang="${alternate.hreflang}" href="${alternate.href}">`),
    `<script type="application/ld+json" data-seo-schema>${JSON.stringify(route.schema.length === 1 ? route.schema[0] : route.schema)}</script>`,
  ].join("\n  ");

  html = html.replace(/(<meta[^>]*name="description"[^>]*>)/i, (match) => `${match}\n  ${seoBlock}`);
  return html;
}

function replacePageContent(html, pageContent) {
  return html.replace(
    /<section id="page-content" class="page-stack" aria-live="polite">[\s\S]*?<\/section>(\s*<footer)/,
    (_match, footer) => `<section id="page-content" class="page-stack" aria-live="polite">${pageContent}</section>${footer}`
  );
}

function stripManagedSeo(html) {
  return html
    .replace(/\n\s*<meta name="robots" content="[^"]*">/g, "")
    .replace(/\n\s*<link rel="canonical" href="[^"]*">/g, "")
    .replace(/\n\s*<link rel="alternate" hreflang="[^"]*" href="[^"]*">/g, "")
    .replace(/\n\s*<script type="application\/ld\+json" data-seo-schema>[\s\S]*?<\/script>/g, "")
    .replace(/\n\s*<meta property="og:url" content="[^"]*">/g, "");
}

function replaceTagContent(html, pattern, replacement) {
  return html.replace(pattern, () => replacement);
}

function replaceMetaContent(html, attrName, attrValue, content) {
  const pattern = new RegExp(`<meta[^>]+${attrName}="${escapeRegExp(attrValue)}"[^>]+content="[^"]*"[^>]*>`, "i");

  if (pattern.test(html)) {
    return html.replace(pattern, (match) => match.replace(/content="[^"]*"/, () => `content="${escapeAttribute(content)}"`));
  }

  return html;
}

function transformHtml(html, locale, langTag) {
  return html
    .replace(/<html lang="[^"]+">/, `<html lang="${langTag}">`)
    .replace(/<body\b([^>]*)>/, (_match, attrs) => (/data-locale=/.test(attrs) ? `<body${attrs}>` : `<body${attrs} data-locale="${locale}">`))
    .replace(/((?:href|src)=["'])([^"']+)(["'])/g, (_match, prefix, value, suffix) => `${prefix}${rewriteRepoRelativeAsset(value)}${suffix}`)
    .replace(/(data-content-root=["'])([^"']+)(["'])/g, (_match, prefix, value, suffix) => `${prefix}${rewriteRepoRelativeAsset(value)}${suffix}`);
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

  if (!value.includes("styles.css") && !value.includes("script.js") && !value.includes("assets/") && !value.includes("content")) {
    return value;
  }

  return path.posix.normalize(`../${value}`);
}

function renderMainPage(data, locale) {
  const terminal = data.hero?.stage?.terminal || {};
  const storyIcons = ["⚡", "💡", "🛠", "🧠"];
  const flowIcons = ["🤝", "🚀", "🧪", "⏱️"];

  return `
    <section class="home-hero reveal visible">
      <div class="home-hero-copy">
        <p class="home-kicker">${escapeHtml(data.hero?.kicker || "")}</p>
        <h1 class="home-title">${escapeHtml(data.hero?.title || "")}</h1>
        <p class="home-subtitle">${escapeHtml(data.hero?.lead || "")}</p>
        <p class="hero-description">${escapeHtml(data.hero?.description || "")}</p>
        <div class="hero-actions">
          ${renderLinkButton(data.hero?.primaryCta, "primary-link", locale)}
          ${renderLinkButton(data.hero?.secondaryCta, "secondary-link", locale)}
        </div>
      </div>
      <div class="home-stage reveal visible">
        <div class="stage-panel terminal-card">
          <div class="terminal-topline">
            <span>${escapeHtml(terminal.title || "club-session.log")}</span>
            <span class="terminal-status">${escapeHtml(terminal.status || "live")}</span>
          </div>
          <div class="terminal-body">
            <p><span class="terminal-prompt">$</span> <span>${escapeHtml((terminal.phrases || [])[0] || "")}</span><span class="cursor"></span></p>
            <ul class="terminal-list">
              ${(terminal.lines || []).map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
            </ul>
          </div>
        </div>
      </div>
    </section>
    <section class="home-stats reveal visible">
      ${(data.metrics || []).map((item) => renderMetricCard(item, locale)).join("")}
    </section>
    <section class="home-section reveal visible">
      <div class="section-heading">
        <p class="section-kicker">${escapeHtml(data.story?.tag || "")}</p>
        <h2>${escapeHtml(data.story?.title || "")}</h2>
        <p class="card-copy">${escapeHtml(data.story?.description || "")}</p>
      </div>
      <div class="home-bento-grid">
        ${(data.story?.items || []).map((item, index) => `
          <article class="item-card home-story-card ${index === 0 ? "home-wide-card" : ""} reveal visible">
            <span class="step-index" aria-hidden="true">${storyIcons[index] || "•"}</span>
            <h3>${escapeHtml(item.title || "")}</h3>
            <p class="item-copy">${escapeHtml(item.text || "")}</p>
          </article>
        `).join("")}
      </div>
    </section>
    <section class="home-section reveal visible">
      <div class="section-heading">
        <p class="section-kicker">${escapeHtml(data.flow?.tag || "")}</p>
        <h2>${escapeHtml(data.flow?.title || "")}</h2>
        <p class="card-copy">${escapeHtml(data.flow?.description || "")}</p>
      </div>
      <div class="home-flow-grid">
        ${(data.flow?.items || []).map((item, index) => `
          <article class="item-card home-flow-card reveal visible">
            <span class="step-index" aria-hidden="true">${flowIcons[index] || "•"}</span>
            <h3>${escapeHtml(item.title || "")}</h3>
            <p class="item-copy">${escapeHtml(item.text || "")}</p>
          </article>
        `).join("")}
      </div>
    </section>
    <section class="home-highlight reveal visible">
      <div class="home-highlight-copy">
        <p class="section-kicker">${escapeHtml(data.gallery?.tag || "")}</p>
        <h2>${escapeHtml(data.gallery?.title || "")}</h2>
        <p class="item-copy">${escapeHtml(data.gallery?.description || "")}</p>
      </div>
      <div class="gallery-shell">
        <div class="gallery-viewport">
          <div class="gallery-track">
            ${(data.gallery?.items || []).map((item) => `
              <figure class="gallery-slide reveal visible">
                <img src="${escapeAttribute(assetPath(item.src || ""))}" alt="${escapeAttribute(item.alt || "")}">
              </figure>
            `).join("")}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderMeetingsHub(pageData, announcementItems, archiveItems, ui, locale) {
  const archivePageSize = Number(pageData.archive?.pageSize || 10);
  const initialArchiveItems = archiveItems.slice(0, archivePageSize);

  return `
    ${renderMeetingCollection(pageData.announcements, announcementItems, ui, locale)}
    <section class="section-shell reveal visible">
      <div class="section-heading">
        <p class="section-kicker">${escapeHtml(pageData.formats?.tag || "")}</p>
        <h1>${escapeHtml(pageData.formats?.title || navLabel(ui, "meetings"))}</h1>
        <p class="card-copy">${escapeHtml(pageData.formats?.description || "")}</p>
      </div>
      <div class="home-flow-grid">
        ${(pageData.formats?.items || []).map((item) => `
          <article class="item-card reveal visible">
            <span class="step-index" aria-hidden="true">${escapeHtml(item.index || "•")}</span>
            <h3>${escapeHtml(item.title || "")}</h3>
            <p class="item-copy">${escapeHtml(item.text || "")}</p>
          </article>
        `).join("")}
      </div>
    </section>
    ${renderMeetingArchive(pageData.archive, initialArchiveItems, archiveItems.length, archivePageSize, ui, locale)}
  `;
}

function renderMeetingCollection(section, items, ui, locale) {
  return `
    <section class="section-shell reveal visible">
      <div class="section-heading">
        <p class="section-kicker">${escapeHtml(section?.tag || "")}</p>
        <h2>${escapeHtml(section?.title || navLabel(ui, "meetings"))}</h2>
        ${section?.description ? `<p class="card-copy">${section.description}</p>` : ""}
      </div>
      <div class="meeting-collection">
        ${items.length ? items.map((item) => renderMeetingPreviewCard(item, locale)).join("") : `<article class="item-card reveal visible"><h3>${escapeHtml(ui.common?.emptyTitle || "Nothing found")}</h3><p class="item-copy">${escapeHtml(ui.meetings?.emptyText || "There are no meetings here yet.")}</p></article>`}
      </div>
    </section>
  `;
}

function renderMeetingArchive(section, items, totalCount, visibleCount, ui, locale) {
  return `
    <section class="section-shell reveal visible">
      <div class="section-heading">
        <p class="section-kicker">${escapeHtml(section?.tag || "")}</p>
        <h2>${escapeHtml(section?.title || "Archive")}</h2>
      </div>
      <div class="meeting-feed" id="meetings-archive-feed">
        ${items.length ? items.map((item) => renderMeetingPreviewCard(item, locale)).join("") : `<article class="item-card reveal visible"><h3>${escapeHtml(ui.common?.emptyTitle || "Nothing found")}</h3><p class="item-copy">${escapeHtml(section?.empty || ui.meetings?.emptyText || "There are no meetings here yet.")}</p></article>`}
      </div>
      <div class="pagination-nav" id="meetings-archive-pagination" aria-label="${escapeAttribute(ui.aria?.meetingsPagination || "Meetings list controls")}">
        ${totalCount > visibleCount ? renderStaticLoadMore(getLoadMoreCopy(ui, "meetings", section?.pagination), visibleCount, totalCount) : ""}
      </div>
    </section>
  `;
}

function renderMeetingPreviewCard(item, locale) {
  const href = absoluteSitePath(locale, `meetings/${item.slug}/`);
  const summary = summarizePlainText(firstNonEmpty((item.paragraphs || [])[0], item.detailsHtml, item.title), 220);

  return `
    <article class="meeting-preview reveal visible${item.photo?.src ? "" : " no-photo"}">
      ${item.photo?.src ? `<a class="meeting-preview-media" href="${href}"><img src="${escapeAttribute(assetPath(item.photo.src))}" alt="${escapeAttribute(item.photo.alt || item.title || "")}"></a>` : ""}
      <div class="meeting-preview-body">
        ${item.date ? `<p class="meeting-date">${escapeHtml(item.date)}</p>` : ""}
        <h3 class="meeting-title"><a href="${href}">${escapeHtml(item.title || "")}</a></h3>
        <div class="meeting-meta">
          ${item.type ? `<span class="meta-pill">${escapeHtml(item.type === "announce" ? "Announcement" : "Meeting")}</span>` : ""}
          ${item.place ? `<span class="meta-pill">${escapeHtml(item.place)}</span>` : ""}
          ${item.format ? `<span class="meta-pill">${escapeHtml(item.format)}</span>` : ""}
        </div>
        ${summary ? `<p class="meeting-copy">${escapeHtml(summary)}</p>` : ""}
      </div>
    </article>
  `;
}

function renderMeetingDetail(item, pageData, locale) {
  return `
    <section class="meeting-detail-shell reveal visible">
      <div class="meeting-detail-head">
        <a class="detail-back-link" href="${absoluteSitePath(locale, "meetings/")}">${escapeHtml(pageData.detail?.backLabel || "← Back to meetings")}</a>
        <h1 class="meeting-detail-title">${escapeHtml(item.title || "")}</h1>
        <div class="meeting-meta">
          ${item.date ? `<span class="meta-pill">${escapeHtml(item.date)}</span>` : ""}
          ${item.place ? `<span class="meta-pill">${escapeHtml(item.place)}</span>` : ""}
          ${item.format ? `<span class="meta-pill">${escapeHtml(item.format)}</span>` : ""}
        </div>
        ${item.photo?.src ? `<div class="meeting-detail-media"><img src="${escapeAttribute(assetPath(item.photo.src))}" alt="${escapeAttribute(item.photo.alt || item.title || "")}"></div>` : ""}
      </div>
      <div class="meeting-detail-copy">
        ${renderRichText(item)}
      </div>
    </section>
  `;
}

function renderProjectsHub(pageData, projects, participantMap, ui, locale) {
  const listCopy = pageData.list || {};
  const pageSize = Number(listCopy.pageSize || 20);
  const firstPageItems = projects.slice(0, pageSize);

  return `
    <section class="section-shell reveal visible project-page-shell">
      <div class="section-heading">
        <h1>${escapeHtml(listCopy.title || "Projects")}</h1>
      </div>
      <div class="project-toolbar">
        <label class="project-search-shell" for="project-search">
          <input id="project-search" class="project-search-input" type="search" placeholder="${escapeAttribute(listCopy.searchPlaceholder || "Search: project, technology, author...")}" value="">
        </label>
      </div>
      <div class="project-results-meta" id="project-results-meta"></div>
      <div class="project-feed" id="project-feed">
        ${firstPageItems.length ? firstPageItems.map((item) => renderProjectPreviewCard(item, participantMap, locale)).join("") : `<article class="item-card reveal visible"><h3>${escapeHtml(listCopy.emptyTitle || "Nothing found")}</h3><p class="item-copy">${escapeHtml(listCopy.empty || "No matching projects yet.")}</p></article>`}
      </div>
      <div class="pagination-nav" id="project-pagination" aria-label="${escapeAttribute(ui.aria?.projectsPagination || "Projects list controls")}">
        ${projects.length > pageSize ? renderStaticLoadMore(getLoadMoreCopy(ui, "projects", listCopy.pagination), firstPageItems.length, projects.length) : ""}
      </div>
    </section>
    ${renderNotesSection(pageData.notes)}
  `;
}

function renderProjectPreviewCard(item, participantMap = new Map(), locale = defaultLocale) {
  const href = absoluteSitePath(locale, `projects/${item.slug}/`);
  const summary = summarizePlainText(firstNonEmpty(item.summary, (item.points || [])[0], item.detailsHtml), 220);
  const owners = (item.ownerSlugs || []).map((slug) => participantMap.get(slug)).filter(Boolean);
  const primaryLink = firstPrimaryLink(item.links);

  return `
    <article class="project-preview reveal visible${item.photo?.src ? "" : " no-photo"}">
      ${item.photo?.src ? `<a class="project-preview-media" href="${href}"><img src="${escapeAttribute(assetPath(item.photo.src))}" alt="${escapeAttribute(item.photo.alt || item.title || "")}"></a>` : ""}
      <div class="project-preview-body">
        ${item.status ? `<p class="meeting-date">${escapeHtml(item.status)}</p>` : ""}
        <h3 class="meeting-title"><a href="${href}">${escapeHtml(item.title || "")}</a></h3>
        <div class="meeting-meta">
          ${item.stack ? `<span class="meta-pill">${escapeHtml(item.stack)}</span>` : ""}
          ${owners.map((owner) => `<a class="meta-pill" href="${absoluteSitePath(locale, `participants/${owner.slug}/`)}">${escapeHtml(owner.name || owner.slug)}</a>`).join("")}
          ${primaryLink ? `<a class="meta-pill" href="${escapeAttribute(primaryLink.href)}"${primaryLink.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(primaryLink.label)}</a>` : ""}
        </div>
        ${summary ? `<p class="meeting-copy">${escapeHtml(summary)}</p>` : ""}
      </div>
    </article>
  `;
}

function renderProjectDetail(item, pageData, owners, relatedMeetings, locale) {
  const contactTags = renderEntityContactTags(item);
  const gallery = Array.isArray(item.gallery) && item.gallery.length
    ? item.gallery.filter((entry) => entry?.src)
    : (item.photo?.src ? [item.photo] : []);

  return `
    <section class="project-detail-shell reveal visible">
      <div class="project-detail-head">
        <a class="detail-back-link" href="${absoluteSitePath(locale, "projects/")}">${escapeHtml(pageData.detail?.backLabel || "← Back to projects")}</a>
        <h1 class="project-detail-title">${escapeHtml(item.title || "")}</h1>
        ${item.summary ? `<p class="card-copy project-detail-summary">${escapeHtml(item.summary)}</p>` : ""}
        <div class="project-detail-meta">
          ${item.status ? `<span class="meta-pill">${escapeHtml(item.status)}</span>` : ""}
          ${item.stack ? `<span class="meta-pill">${escapeHtml(item.stack)}</span>` : ""}
          ${owners.map((owner) => `<a class="meta-pill" href="${absoluteSitePath(locale, `participants/${owner.slug}/`)}">${escapeHtml(owner.name || owner.slug)}</a>`).join("")}
          ${contactTags}
        </div>
      </div>
      ${gallery.length ? `
        <section class="project-detail-gallery reveal visible">
          <div class="gallery-shell">
            <button class="gallery-nav prev" type="button" aria-label="Previous photo">‹</button>
            <div class="gallery-viewport">
              <div class="gallery-track">
                ${gallery.map((entry) => `
                  <figure class="gallery-slide reveal visible">
                    <img src="${escapeAttribute(assetPath(entry.src))}" alt="${escapeAttribute(entry.alt || item.title || "")}">
                  </figure>
                `).join("")}
              </div>
            </div>
            <button class="gallery-nav next" type="button" aria-label="Next photo">›</button>
          </div>
        </section>
      ` : ""}
      <section class="section-shell reveal visible">
        <div class="section-heading">
          <h2>${escapeHtml(pageData.detail?.detailsTitle || "Project details")}</h2>
        </div>
        <div class="meeting-detail-copy">
          ${renderRichText(item)}
        </div>
      </section>
      <section class="section-shell reveal visible">
        <div class="section-heading">
          <h2>${escapeHtml(pageData.detail?.newsTitle || "Project news")}</h2>
        </div>
        <div class="meeting-feed">
          ${relatedMeetings.length ? relatedMeetings.map((meeting) => renderMeetingPreviewCard(meeting, locale)).join("") : `<article class="item-card reveal visible"><h3>Nothing here yet</h3><p class="item-copy">No related meetings are linked to this project yet.</p></article>`}
        </div>
      </section>
    </section>
  `;
}

function renderEntityContactTags(item) {
  const tags = [];
  const seen = new Set();

  const pushTag = (key, markup) => {
    if (!markup || seen.has(key)) {
      return;
    }

    seen.add(key);
    tags.push(markup);
  };

  const telegramHandle = normalizeTelegramHandle(item.handle);
  if (telegramHandle) {
    pushTag(
      `telegram:${telegramHandle}`,
      `<a class="meta-pill meta-pill-link" href="https://t.me/${telegramHandle}" target="_blank" rel="noopener noreferrer">@${telegramHandle}</a>`
    );
  } else if (item.handle) {
    pushTag(`handle:${item.handle}`, `<span class="meta-pill">${escapeHtml(item.handle)}</span>`);
  }

  for (const link of dedupeRenderableLinks(Array.isArray(item.links) ? item.links : [])) {
    if (!link?.href || !link?.label) {
      continue;
    }

    const normalizedHref = resolveRenderableHref(link.href);
    if (telegramHandle && normalizedHref === `https://t.me/${telegramHandle}`) {
      continue;
    }

    pushTag(
      `link:${normalizedHref}`,
      `<a class="meta-pill meta-pill-link" href="${escapeAttribute(normalizedHref)}"${link.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(link.label)}</a>`
    );
  }

  return tags.join("");
}

function normalizeTelegramHandle(value) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim().replace(/^@+/, "");
  return /^[A-Za-z0-9_]{4,}$/.test(cleaned) ? cleaned : null;
}

function dedupeRenderableLinks(links) {
  const deduped = [];
  const seenByKey = new Map();

  for (const link of Array.isArray(links) ? links : []) {
    if (!link?.href || !link?.label) {
      continue;
    }

    const key = buildRenderableLinkKey(link.href);
    const existingIndex = seenByKey.get(key);

    if (existingIndex == null) {
      seenByKey.set(key, deduped.length);
      deduped.push(link);
      continue;
    }

    if (scoreRenderableLinkLabel(link.label) > scoreRenderableLinkLabel(deduped[existingIndex].label)) {
      deduped[existingIndex] = link;
    }
  }

  return deduped;
}

function buildRenderableLinkKey(href) {
  try {
    const url = new URL(resolveRenderableHref(href), siteUrl);
    const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.hostname.replace(/^www\./i, "").toLowerCase()}${normalizedPath}${url.search}`;
  } catch {
    return String(href).trim().toLowerCase();
  }
}

function resolveRenderableHref(href) {
  try {
    return new URL(String(href), siteUrl).href;
  } catch {
    return String(href || "").trim();
  }
}

function scoreRenderableLinkLabel(label) {
  const normalized = String(label || "").trim().toLowerCase();

  if (!normalized) {
    return 0;
  }

  if (normalized === "telegram" || normalized === "instagram" || normalized === "linkedin" || normalized === "github" || normalized === "x / twitter") {
    return 3;
  }

  if (normalized.includes(".com") || normalized.includes(".me") || normalized.includes(".org") || normalized.includes(".net")) {
    return 1;
  }

  return 2;
}

function renderParticipantsHub(pageData, participants, ui, locale) {
  const pageSize = Number(pageData.pageSize || 20);
  const firstPageItems = participants.slice(0, pageSize);

  return `
    <section class="section-shell reveal visible participants-page-shell">
      <div class="section-heading">
        <p class="section-kicker">${escapeHtml(pageData.tag || "Participants")}</p>
        <h1>${escapeHtml(pageData.title || "Participants")}</h1>
        <p class="card-copy">${pageData.description || ""}</p>
      </div>
      <div class="people-grid" id="participants-grid">
        ${firstPageItems.map((item) => renderPersonCard(item, locale)).join("")}
      </div>
      <div class="pagination-nav" id="participants-pagination" aria-label="${escapeAttribute(ui.aria?.participantsPagination || "Participants list controls")}">
        ${participants.length > pageSize ? renderStaticLoadMore(getLoadMoreCopy(ui, "participants", pageData.pagination), firstPageItems.length, participants.length) : ""}
      </div>
    </section>
  `;
}

function renderPersonCard(item, locale) {
  const href = absoluteSitePath(locale, `participants/${item.slug}/`);
  const previewBio = summarizePlainText(item.bio, 180);

  return `
    <article class="person-card reveal visible">
      ${item.photo?.src ? `<a class="person-photo" href="${href}"><img src="${escapeAttribute(assetPath(item.photo.src))}" alt="${escapeAttribute(item.photo.alt || item.name || item.slug || "")}">${item.badge ? `<span class="person-badge person-photo-badge">${escapeHtml(item.badge)}</span>` : ""}</a>` : ""}
      <h3><a class="person-name-link" href="${href}">${escapeHtml(item.name || item.slug || "")}</a></h3>
      ${item.role ? `<p class="person-role">${escapeHtml(item.role)}</p>` : ""}
      ${previewBio ? `<p class="person-copy">${escapeHtml(previewBio)}</p>` : ""}
      ${Array.isArray(item.points) && item.points.length ? `<ul class="person-list">${item.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : ""}
    </article>
  `;
}

function renderParticipantDetail(item, pageData, relatedProjects, locale) {
  return `
    <section class="participant-detail-shell reveal visible">
      <div class="participant-detail-head">
        <a class="detail-back-link" href="${absoluteSitePath(locale, "participants/")}">${escapeHtml(pageData.detail?.backLabel || "← Back to participants")}</a>
        ${item.photo?.src ? `<figure class="participant-detail-media"><img src="${escapeAttribute(assetPath(item.photo.src))}" alt="${escapeAttribute(item.photo.alt || item.name || item.slug || "")}">${item.badge ? `<span class="person-badge person-photo-badge participant-detail-badge">${escapeHtml(item.detailBadge || item.badge)}</span>` : ""}</figure>` : ""}
        <h1 class="participant-detail-title">${escapeHtml(item.name || item.slug || "")}</h1>
        ${item.role ? `<p class="person-role participant-detail-role">${escapeHtml(item.role)}</p>` : ""}
        ${item.bio ? `<p class="person-copy participant-detail-bio">${escapeHtml(item.bio)}</p>` : ""}
      </div>
      ${Array.isArray(item.points) && item.points.length ? `<div class="detail-list-shell"><ul class="detail-list">${item.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul></div>` : ""}
    </section>
    <section class="section-shell reveal visible">
      <div class="section-heading">
        <h2>${escapeHtml(pageData.detail?.projectsTitle || "Participant projects")}</h2>
      </div>
      <div class="project-feed">
        ${relatedProjects.length ? relatedProjects.map((project) => renderProjectPreviewCard(project, new Map([[item.slug, item]]), locale)).join("") : `<article class="item-card reveal visible"><h3>Nothing here yet</h3><p class="item-copy">No projects are linked to this participant yet.</p></article>`}
      </div>
    </section>
  `;
}

function renderNewsHub(pageData, items, projectMap, ui, locale) {
  const listCopy = pageData.list || {};
  const pageSize = Number(listCopy.pageSize || 20);
  const firstPageItems = items.slice(0, pageSize);

  return `
    <section class="section-shell reveal visible project-page-shell">
      <div class="section-heading">
        <h1>${escapeHtml(listCopy.title || "News")}</h1>
      </div>
      <div class="project-toolbar">
        <label class="project-search-shell" for="news-search">
          <input id="news-search" class="project-search-input" type="search" placeholder="${escapeAttribute(listCopy.searchPlaceholder || "Search: project, technology, title...")}" value="">
        </label>
      </div>
      <div class="project-results-meta" id="news-results-meta"></div>
      <div class="meeting-feed" id="news-feed">
        ${firstPageItems.length ? firstPageItems.map((item) => renderNewsCard(item, projectMap, locale)).join("") : `<article class="item-card reveal visible"><h3>${escapeHtml(listCopy.emptyTitle || "Nothing found")}</h3><p class="item-copy">${escapeHtml(listCopy.empty || "No matching news yet.")}</p></article>`}
      </div>
      <div class="pagination-nav" id="news-pagination" aria-label="${escapeAttribute(ui.aria?.newsPagination || "News list controls")}">
        ${items.length > pageSize ? renderStaticLoadMore(getLoadMoreCopy(ui, "news", listCopy.pagination), firstPageItems.length, items.length) : ""}
      </div>
    </section>
    ${renderNotesSection(pageData.notes)}
  `;
}

function renderStaticLoadMore(copy = {}, visibleCount, totalCount) {
  return `
    <span class="pagination-status">${escapeHtml(formatLoadMoreStatus(copy.status, visibleCount, totalCount))}</span>
    ${visibleCount < totalCount ? `<button class="pagination-link" type="button" data-load-more>${escapeHtml(copy.loadMore || "Load more")}</button>` : ""}
  `;
}

function getLoadMoreCopy(ui, scope, overrides = {}) {
  return {
    loadMore: overrides?.loadMore || ui?.[scope]?.pagination?.loadMore || ui?.common?.pagination?.loadMore || "Load more",
    status: overrides?.status || ui?.[scope]?.pagination?.status || ui?.common?.pagination?.status || "Showing {shown} of {total}",
  };
}

function formatLoadMoreStatus(template, shown, total) {
  return String(template || "Showing {shown} of {total}")
    .replace(/\{shown\}/g, String(shown))
    .replace(/\{total\}/g, String(total));
}

function renderNewsCard(item, projectMap, locale) {
  const relatedProjects = (item.projectSlugs || [])
    .map((slug) => projectMap.get(slug))
    .filter(Boolean)
    .map((project) => `<a class="meta-pill" href="${absoluteSitePath(locale, `projects/${project.slug}/`)}">${escapeHtml(project.title || project.slug)}</a>`)
    .join("");

  return `
    <article class="meeting-preview reveal visible${item.photo?.src ? "" : " no-photo"}">
      ${item.photo?.src ? `<a class="meeting-preview-media" href="${absoluteSitePath(locale, `meetings/${item.slug}/`)}"><img src="${escapeAttribute(assetPath(item.photo.src))}" alt="${escapeAttribute(item.photo.alt || item.title || "")}"></a>` : ""}
      <div class="meeting-preview-body">
        ${item.date ? `<p class="meeting-date">${escapeHtml(item.date)}</p>` : ""}
        <h3 class="meeting-title"><a href="${absoluteSitePath(locale, `meetings/${item.slug}/`)}">${escapeHtml(item.title || "")}</a></h3>
        <div class="meeting-meta">
          ${relatedProjects}
        </div>
        <p class="meeting-copy">${escapeHtml(summarizePlainText(firstNonEmpty((item.paragraphs || [])[0], item.detailsHtml, item.title), 220))}</p>
      </div>
    </article>
  `;
}

function renderNotesSection(notes) {
  if (!notes) {
    return "";
  }

  return `
    <section class="status-shell reveal visible">
      <div class="status-copy">
        <p class="section-kicker">${escapeHtml(notes.tag || "")}</p>
        <h2>${escapeHtml(notes.title || "")}</h2>
        <p>${escapeHtml(notes.description || "")}</p>
      </div>
      <div class="status-grid">
        ${(notes.items || []).map((item) => `
          <article class="status-card reveal visible">
            <strong>${escapeHtml(item.title || "")}</strong>
            <p class="card-copy">${escapeHtml(item.text || "")}</p>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderMetricCard(item, locale) {
  return `
    <article class="metric-card">
      <span class="metric-label">${escapeHtml(item.label || "")}</span>
      <strong class="metric-value">${escapeHtml(String(item.value ?? ""))}</strong>
      <span class="card-copy">${escapeHtml(item.hint || "")}</span>
      ${item.href && item.ctaLabel ? `<a class="metric-link" href="${escapeAttribute(contentHref(item.href, locale))}">${escapeHtml(item.ctaLabel)}</a>` : ""}
    </article>
  `;
}

function renderLinkButton(item, className, locale) {
  if (!item?.href || !item?.label) {
    return "";
  }

  return `<a class="${className}" href="${escapeAttribute(contentHref(item.href, locale))}"${item.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(item.label)}</a>`;
}

function renderRichText(item) {
  if (item.detailsHtml) {
    return item.detailsHtml;
  }

  if (Array.isArray(item.paragraphs) && item.paragraphs.length) {
    return item.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
  }

  if (Array.isArray(item.points) && item.points.length) {
    return `<ul class="detail-list">${item.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>`;
  }

  return "";
}

function renderFallbackDetail(message) {
  return `
    <section class="empty-state reveal visible">
      <p>${escapeHtml(message)}</p>
    </section>
  `;
}

function buildMainSchema(pageData, siteName) {
  const description = summarizePlainText(pageData.hero?.description || pageData.hero?.lead);

  return [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: siteName,
      url: siteUrl,
      description,
      sameAs: ["https://t.me/PetProjectClubMNE"],
      logo: `${siteUrl}/assets/images/PetProjectClubLogoSquare.png`,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: siteName,
      url: siteUrl,
      description,
      inLanguage: Object.keys(allLocales),
    },
  ];
}

function buildCollectionSchema({ siteName, title, description, publicPath, breadcrumb }) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: title,
      description,
      url: toAbsoluteUrl(publicPath),
      isPartOf: {
        "@type": "WebSite",
        name: siteName,
        url: siteUrl,
      },
    },
    buildBreadcrumbSchema(breadcrumb),
  ];
}

function buildMeetingSchema(item, siteName, publicPath, ui) {
  const description = summarizePlainText(firstNonEmpty((item.paragraphs || []).join(" "), item.detailsHtml, item.title), 300);

  return [
    {
      "@context": "https://schema.org",
      "@type": "Event",
      name: item.title,
      description,
      startDate: item.date || undefined,
      eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
      eventStatus: "https://schema.org/EventScheduled",
      location: item.place
        ? {
            "@type": "Place",
            name: item.place,
            url: item.placeUrl || undefined,
          }
        : undefined,
      image: item.photo?.src ? [toAbsoluteUrl(item.photo.src)] : undefined,
      organizer: {
        "@type": "Organization",
        name: siteName,
        url: siteUrl,
      },
      url: toAbsoluteUrl(publicPath),
    },
    buildBreadcrumbSchema([
      { name: navLabel(ui, "meetings"), path: localeLikePath(publicPath, "meetings/") },
      { name: item.title, path: publicPath },
    ]),
  ];
}

function buildProjectSchema(item, owners, siteName, publicPath, ui) {
  const description = summarizePlainText(firstNonEmpty(item.summary, item.detailsHtml, item.title), 300);

  return [
    {
      "@context": "https://schema.org",
      "@type": "CreativeWork",
      name: item.title,
      description,
      url: toAbsoluteUrl(publicPath),
      image: item.photo?.src ? [toAbsoluteUrl(item.photo.src)] : undefined,
      creator: owners.length
        ? owners.map((owner) => ({
            "@type": "Person",
            name: owner.name || owner.slug,
            url: toAbsoluteUrl(localeLikePath(publicPath, `participants/${owner.slug}/`)),
          }))
        : undefined,
      publisher: {
        "@type": "Organization",
        name: siteName,
        url: siteUrl,
      },
    },
    buildBreadcrumbSchema([
      { name: navLabel(ui, "projects"), path: localeLikePath(publicPath, "projects/") },
      { name: item.title, path: publicPath },
    ]),
  ];
}

function buildParticipantSchema(item, siteName, publicPath, ui) {
  return [
    {
      "@context": "https://schema.org",
      "@type": "Person",
      name: item.name || item.slug,
      description: summarizePlainText(firstNonEmpty(item.bio, item.role, item.name, item.slug), 300),
      image: item.photo?.src ? toAbsoluteUrl(item.photo.src) : undefined,
      jobTitle: item.role || undefined,
      url: toAbsoluteUrl(publicPath),
      worksFor: {
        "@type": "Organization",
        name: siteName,
        url: siteUrl,
      },
    },
    buildBreadcrumbSchema([
      { name: navLabel(ui, "participants"), path: localeLikePath(publicPath, "participants/") },
      { name: item.name || item.slug, path: publicPath },
    ]),
  ];
}

function buildBreadcrumbSchema(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: toAbsoluteUrl(item.path),
    })),
  };
}

function buildAlternateUrls(pathSuffix) {
  const alternates = [
    { hreflang: "x-default", href: toAbsoluteUrl(pathSuffix) },
    { hreflang: "ru", href: toAbsoluteUrl(pathSuffix) },
  ];

  for (const locale of Object.keys(generatedLocales)) {
    alternates.push({
      hreflang: locale,
      href: toAbsoluteUrl(localePath(locale, pathSuffix)),
    });
  }

  return alternates;
}

function buildRobotsTxt() {
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`;
}

function buildSitemapXml(entries) {
  const body = entries
    .map((entry) => {
      const alternates = (entry.alternates || [])
        .map((alternate) => `    <xhtml:link rel="alternate" hreflang="${escapeAttribute(alternate.hreflang)}" href="${escapeAttribute(alternate.href)}" />`)
        .join("\n");
      const lastmod = entry.lastmod ? `    <lastmod>${escapeHtml(entry.lastmod)}</lastmod>` : "";

      return [
        "  <url>",
        `    <loc>${escapeHtml(entry.url)}</loc>`,
        alternates,
        lastmod,
        "  </url>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body}\n</urlset>\n`;
}

function localePath(locale, suffix) {
  const cleanSuffix = String(suffix || "");
  return locale === defaultLocale ? cleanSuffix : `${locale}/${cleanSuffix}`;
}

function absoluteSitePath(locale, suffix) {
  return `/${localePath(locale, suffix)}`;
}

function contentHref(value, locale) {
  if (typeof value !== "string" || !value) {
    return "#";
  }

  if (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("mailto:") ||
    value.startsWith("tel:") ||
    value.startsWith("#") ||
    value.startsWith("/")
  ) {
    return value;
  }

  return absoluteSitePath(locale, value);
}

function assetPath(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/")) {
    return value;
  }

  return `/${value.replace(/^\.?\//, "")}`;
}

function outputPathFromPublicPath(publicPath) {
  const trimmed = String(publicPath || "").replace(/^\/+|\/+$/g, "");
  return trimmed ? path.join(trimmed, "index.html") : "index.html";
}

function toAbsoluteUrl(value) {
  if (!value) {
    return siteUrl;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  const clean = String(value).replace(/^\/+/, "");
  return clean ? `${siteUrl}/${clean}` : `${siteUrl}/`;
}

function localeLikePath(publicPath, suffix) {
  const segments = String(publicPath).replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);
  const maybeLocale = segments[0];
  const locale = Object.prototype.hasOwnProperty.call(generatedLocales, maybeLocale) ? maybeLocale : defaultLocale;
  return localePath(locale, suffix);
}

function navLabel(ui, key) {
  return ui.shell?.nav?.[key] || key;
}

function latestDateFromItems(...groups) {
  const items = groups.flat().filter(Boolean);
  return items.map((item) => item.date).filter(Boolean).sort().at(-1) || null;
}

function latestDateFromMeetings(meetingItems) {
  return latestDateFromItems(...Object.values(meetingItems));
}

function latestDateFromProjects(projectItems) {
  return latestDateFromItems(projectItems);
}

function sortByDateDesc(items) {
  return [...items].sort((left, right) => String(right?.date || "").localeCompare(String(left?.date || "")));
}

function sortByFeaturedRank(items) {
  return [...items].sort((left, right) => {
    const leftRank = Number.isFinite(Number(left?.featuredRank)) ? Number(left.featuredRank) : Number.POSITIVE_INFINITY;
    const rightRank = Number.isFinite(Number(right?.featuredRank)) ? Number(right.featuredRank) : Number.POSITIVE_INFINITY;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return String(left?.title || left?.name || left?.slug || "").localeCompare(
      String(right?.title || right?.name || right?.slug || ""),
      undefined,
      { sensitivity: "base" }
    );
  });
}

function firstPrimaryLink(links = []) {
  return Array.isArray(links) ? links[0] || null : null;
}

function localizeContentNode(value, locale) {
  if (Array.isArray(value)) {
    return value.map((entry) => localizeContentNode(entry, locale));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const base = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !["translations", "translationStatus", "machineSuggestions"].includes(key))
      .map(([key, entry]) => [key, localizeContentNode(entry, locale)])
  );
  const sourceLocale = normalizeLocale(base.sourceLocale) || defaultLocale;
  const translation = locale !== sourceLocale && value.translations && typeof value.translations === "object"
    ? value.translations[locale]
    : null;

  return translation && typeof translation === "object"
    ? deepMergeContent(base, localizeContentNode(translation, locale))
    : base;
}

function normalizeLocale(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(allLocales, normalized) ? normalized : null;
}

function deepMergeContent(baseValue, overrideValue) {
  if (Array.isArray(overrideValue)) {
    if (Array.isArray(baseValue) && overrideValue.every((entry) => isPlainObject(entry))) {
      return mergeArrayByIndex(baseValue, overrideValue);
    }

    return overrideValue.map((entry) => cloneContentValue(entry));
  }

  if (!overrideValue || typeof overrideValue !== "object") {
    return overrideValue;
  }

  const baseObject = isPlainObject(baseValue) ? baseValue : {};
  const result = { ...baseObject };

  for (const [key, value] of Object.entries(overrideValue)) {
    if (Array.isArray(value)) {
      result[key] = Array.isArray(result[key]) && value.every((entry) => isPlainObject(entry))
        ? mergeArrayByIndex(result[key], value)
        : value.map((entry) => cloneContentValue(entry));
      continue;
    }

    if (isPlainObject(value)) {
      result[key] = deepMergeContent(result[key], value);
      continue;
    }

    result[key] = value;
  }

  return result;
}

function mergeArrayByIndex(baseArray, overrideArray) {
  const result = [];
  const maxLength = Math.max(baseArray.length, overrideArray.length);

  for (let index = 0; index < maxLength; index += 1) {
    const overrideEntry = overrideArray[index];

    if (overrideEntry === undefined) {
      result.push(cloneContentValue(baseArray[index]));
      continue;
    }

    if (isPlainObject(overrideEntry) && isPlainObject(baseArray[index])) {
      result.push(deepMergeContent(baseArray[index], overrideEntry));
      continue;
    }

    result.push(cloneContentValue(overrideEntry));
  }

  return result;
}

function cloneContentValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneContentValue(entry));
  }

  if (isPlainObject(value)) {
    return deepMergeContent({}, value);
  }

  return value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function summarizePlainText(value, maxLength = 220) {
  const normalized = stripHtml(firstNonEmpty(value, "")).replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]+>/g, " ");
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function writeOutput(relativePath, contents) {
  const absolutePath = path.join(repoRoot, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, contents, "utf8");
}
