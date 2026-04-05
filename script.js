const body = document.body;
const page = body.dataset.page;
const siteRoot = body.dataset.siteRoot || ".";
const contentRoot = body.dataset.contentRoot || "./content";
const pageContent = document.getElementById("page-content");
let updatedAt = document.getElementById("updated-at");
const root = document.documentElement;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const DEFAULT_LOCALE = "ru";
const LOCALE_STORAGE_KEY = "ppc-preferred-locale";
const LOCALE_META = {
  ru: {
    label: "Русский",
    shortLabel: "RU",
    lang: "ru-RU",
    flag: "🇷🇺",
  },
  en: {
    label: "English",
    shortLabel: "EN",
    lang: "en",
    flag: "🇬🇧",
  },
  de: {
    label: "Deutsch",
    shortLabel: "DE",
    lang: "de",
    flag: "🇩🇪",
  },
  me: {
    label: "Crnogorski",
    shortLabel: "ME",
    lang: "sr-Latn-ME",
    flag: "🇲🇪",
  },
  es: {
    label: "Espanol",
    shortLabel: "ES",
    lang: "es",
    flag: "🇪🇸",
  },
};
const SUPPORTED_LOCALES = Object.keys(LOCALE_META);
const PAGE_PATHS = {
  main: "",
  meetings: "meetings/",
  "meeting-detail": "meetings/item/",
  projects: "projects/",
  "project-detail": "projects/item/",
  participants: "participants/",
  "participant-detail": "participants/item/",
  news: "news/",
};
const LOCALE_GROUP_ALIASES = {
  ru: "ru",
  en: "en",
  de: "de",
  es: "es",
  sr: "me",
  bs: "me",
  hr: "me",
  mk: "me",
  cnr: "me",
};
const repoRootPath = body.dataset.locale ? getRepoRootFromSiteRoot(siteRoot) : siteRoot;
let uiMessages = {};

const pageLoaders = {
  main: renderMainPage,
  meetings: renderMeetingsPage,
  "meeting-detail": renderMeetingDetailPage,
  projects: renderProjectsPage,
  "project-detail": renderProjectDetailPage,
  participants: renderParticipantsPage,
  "participant-detail": renderParticipantDetailPage,
  news: renderNewsPage,
};

const localeState = initLocaleState();

if (!localeState.redirecting) {
  startApp(localeState);
}

async function startApp(locale) {
  uiMessages = await loadUiMessages(locale.locale);
  applyStaticUiChrome();

  if (updatedAt) {
    updatedAt.textContent = new Date().toLocaleDateString(locale.langTag, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  if (!prefersReducedMotion) {
    window.addEventListener("pointermove", (event) => {
      root.style.setProperty("--spot-x", `${event.clientX}px`);
      root.style.setProperty("--spot-y", `${event.clientY}px`);
    });
  }

  setActiveNav();
  initTopbarMenu();
  initLocaleSwitcher(locale);
  renderPage().finally(() => {
    initReveal();
    initCounters();
    initTerminal();
    initGallery();
    initStoryDeck();
    initFlowTabs();
    initTimelineTabs();
  });
}

function initLocaleState() {
  const pagePath = PAGE_PATHS[page] ?? "";
  const pathLocale = getPathLocale(window.location.pathname);
  const explicitLocale = body.dataset.locale || pathLocale || null;

  if (!explicitLocale) {
    const detectedLocale = detectPreferredLocale();
    const redirectHref = buildLocaleHref(detectedLocale, {
      pagePath,
      preserveLocation: true,
      localizedPage: false,
    });

    if (redirectHref) {
      window.location.replace(redirectHref);
      return {
        redirecting: true,
        locale: detectedLocale,
        langTag: LOCALE_META[detectedLocale]?.lang || detectedLocale,
        pagePath,
      };
    }
  }

  const locale = normalizeLocale(explicitLocale) || DEFAULT_LOCALE;
  const langTag = LOCALE_META[locale]?.lang || locale;
  root.lang = langTag;
  persistPreferredLocale(locale);

  return {
    redirecting: false,
    locale,
    langTag,
    pagePath,
  };
}

function initLocaleSwitcher(locale) {
  const footer = document.querySelector(".site-footer");

  if (!footer) {
    return;
  }

  const existing = footer.querySelector(".locale-switcher");

  if (existing) {
    existing.remove();
  }

  const switcher = document.createElement("nav");
  switcher.className = "locale-switcher";
  switcher.setAttribute("aria-label", t("aria.languageSwitcher", "Language switcher"));

  const options = SUPPORTED_LOCALES.map((localeKey) => {
    const meta = LOCALE_META[localeKey];
    const currentClass = localeKey === locale.locale ? " is-current" : "";
    const href = buildLocaleHref(localeKey, {
      pagePath: locale.pagePath,
      preserveLocation: true,
      localizedPage: true,
    });

    return `
      <a class="locale-link${currentClass}" href="${href}" data-locale-link="${localeKey}" aria-label="${meta.label}">
        <span>${meta.shortLabel}</span>
      </a>
    `;
  }).join("");

  switcher.innerHTML = `
    <span class="locale-switcher-label">${t("shell.languageSwitcherLabel", "Language")}</span>
    <div class="locale-switcher-links">${options}</div>
  `;

  switcher.querySelectorAll("[data-locale-link]").forEach((link) => {
    link.addEventListener("click", () => {
      const nextLocale = link.dataset.localeLink;

      if (nextLocale) {
        persistPreferredLocale(nextLocale);
      }
    });
  });

  footer.append(switcher);
}

async function loadUiMessages(locale) {
  const normalizedLocale = normalizeLocale(locale) || DEFAULT_LOCALE;

  try {
    return await loadJsonFile(`i18n/ui/${normalizedLocale}.json`);
  } catch {
    if (normalizedLocale === DEFAULT_LOCALE) {
      return {};
    }

    try {
      return await loadJsonFile(`i18n/ui/${DEFAULT_LOCALE}.json`);
    } catch {
      return {};
    }
  }
}

async function loadJsonFile(path) {
  const response = await fetch(`${contentRoot}/${path}`);

  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`);
  }

  return response.json();
}

function t(key, fallback = "") {
  const value = getNestedValue(uiMessages, key);
  return typeof value === "string" ? value : fallback;
}

function getNestedValue(source, key) {
  if (!source || typeof source !== "object" || typeof key !== "string") {
    return undefined;
  }

  return key.split(".").reduce((value, part) => {
    if (value && typeof value === "object" && part in value) {
      return value[part];
    }

    return undefined;
  }, source);
}

function applyStaticUiChrome() {
  const brandTitle = document.getElementById("main-brand-title") || document.querySelector(".brand-copy strong");
  const brandSubtitle = document.getElementById("main-brand-subtitle") || document.querySelector(".brand-copy span");
  const telegramLink = document.getElementById("main-telegram-link") || document.querySelector(".nav-cta");
  const menuToggle = document.querySelector("[data-menu-toggle]");
  const nav = document.getElementById("main-nav");
  const footerMark = document.querySelector(".footer-mark");
  const footerLinks = [...document.querySelectorAll(".footer-inline a")];
  const updatedLabel = updatedAt?.parentElement;

  if (brandTitle) {
    brandTitle.textContent = t("shell.brandTitle", "Pet Project Club");
  }

  if (brandSubtitle) {
    brandSubtitle.textContent = t("shell.brandSubtitle", "Budva / Montenegro");
  }

  if (menuToggle) {
    menuToggle.setAttribute("aria-label", t("aria.openNavigation", "Open navigation"));
  }

  if (nav) {
    nav.setAttribute("aria-label", t("aria.mainNavigation", "Main navigation"));
    nav.querySelectorAll("[data-nav]").forEach((link) => {
      const key = link.dataset.nav;
      const label = t(`shell.nav.${key}`, "");

      if (label) {
        link.textContent = label;
      }
    });
  }

  if (telegramLink) {
    telegramLink.textContent = t("shell.telegram", "Telegram");
  }

  if (footerMark) {
    footerMark.textContent = t("shell.footer.mark", "® Pet Project Club");
  }

  footerLinks.forEach((link) => {
    const href = link.getAttribute("href") || "";

    if (/maps\.google\.com/i.test(href)) {
      link.textContent = t("shell.footer.address", "Address: MONTECO Coworking, Budva");
    } else if (/t\.me\/ikotelnikov/i.test(href)) {
      link.textContent = t("shell.footer.contact", "Contact: @ikotelnikov");
    }
  });

  if (updatedLabel && updatedAt) {
    updatedLabel.innerHTML = `${escapeHtml(t("shell.footer.updatedAt", "Updated"))} <span id="updated-at"></span>`;
    const previousValue = updatedAt.textContent;
    updatedAt = document.getElementById("updated-at");

    if (updatedAt) {
      updatedAt.textContent = previousValue;
    }
  }

  applyPageMeta();
}

function applyPageMeta() {
  const pageTitle = t(`meta.${page}.title`, "");
  const pageDescription = t(`meta.${page}.description`, "");
  const titleNode = document.querySelector("title");
  const descriptionNode = document.querySelector('meta[name="description"]');

  if (pageTitle) {
    document.title = pageTitle;
    if (titleNode) {
      titleNode.textContent = pageTitle;
    }
  }

  if (pageDescription && descriptionNode) {
    descriptionNode.setAttribute("content", pageDescription);
  }
}

function getSiteName() {
  return t("meta.siteName", "Pet Project Club Budva");
}

function buildDocumentTitle(title) {
  return `${title} | ${getSiteName()}`;
}

function getUiPaginationCopy(scope) {
  return {
    prev: t(`${scope}.pagination.prev`, t("common.pagination.prev", "← Previous")),
    next: t(`${scope}.pagination.next`, t("common.pagination.next", "Next →")),
    page: t(`${scope}.pagination.page`, t("common.pagination.page", "Page")),
  };
}

function getEntityTypeLabel(type) {
  const normalizedType = type === "announce" ? "announcement" : type;
  return t(`meetings.types.${normalizedType}`, normalizedType || "");
}

function getPathLocale(pathname) {
  const segments = pathname.split("/").filter(Boolean);

  for (const segment of segments) {
    const normalized = normalizeLocale(segment);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function detectPreferredLocale() {
  const storedLocale = readStoredLocale();

  if (storedLocale) {
    return storedLocale;
  }

  const browserLocales = Array.isArray(navigator.languages) && navigator.languages.length
    ? navigator.languages
    : [navigator.language];

  for (const language of browserLocales) {
    const normalized = resolveLocaleFromLanguageTag(language);

    if (normalized) {
      return normalized;
    }
  }

  return DEFAULT_LOCALE;
}

function resolveLocaleFromLanguageTag(languageTag) {
  if (typeof languageTag !== "string") {
    return null;
  }

  const trimmedTag = languageTag.trim();

  if (!trimmedTag) {
    return null;
  }

  const directMatch = normalizeLocale(trimmedTag);

  if (directMatch) {
    return directMatch;
  }

  const baseLanguage = trimmedTag.split("-")[0]?.toLowerCase();
  return normalizeLocale(baseLanguage);
}

function normalizeLocale(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (!normalizedValue) {
    return null;
  }

  if (SUPPORTED_LOCALES.includes(normalizedValue)) {
    return normalizedValue;
  }

  return LOCALE_GROUP_ALIASES[normalizedValue] || null;
}

function buildLocaleHref(locale, options = {}) {
  const normalizedLocale = normalizeLocale(locale) || DEFAULT_LOCALE;
  const {
    pagePath = "",
    preserveLocation = false,
    localizedPage = Boolean(body.dataset.locale || getPathLocale(window.location.pathname)),
  } = options;
  const repoRoot = localizedPage
    ? getRepoRootFromSiteRoot(siteRoot)
    : siteRoot;
  const targetPath = `${repoRoot}/${normalizedLocale}/${pagePath}`;
  const url = new URL(targetPath, window.location.href);

  if (preserveLocation) {
    url.search = window.location.search;
    url.hash = window.location.hash;
  }

  return url.toString();
}

function getRepoRootFromSiteRoot(rootPath) {
  if (!rootPath || rootPath === ".") {
    return "..";
  }

  return `${rootPath}/..`;
}

function readStoredLocale() {
  try {
    return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function persistPreferredLocale(locale) {
  const normalized = normalizeLocale(locale);

  if (!normalized) {
    return;
  }

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, normalized);
  } catch {
    // Ignore storage errors and continue with URL-based locale state.
  }
}

async function renderPage() {
  if (!pageContent || !pageLoaders[page]) {
    return;
  }

  pageContent.innerHTML = `<section class="empty-state loading-state reveal"><p>${t("common.loadingContent", "Loading content from repository...")}</p></section>`;

  try {
    await pageLoaders[page]();
  } catch (error) {
    pageContent.innerHTML = `
      <section class="empty-state reveal">
        <p>${t("common.loadError", "Failed to load content from content/. Check JSON files and run the site through a static server.")}</p>
      </section>
    `;
    console.error(error);
  }
}

function setActiveNav() {
  const activePage = body.dataset.navPage || page;
  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.dataset.nav === activePage) {
      link.classList.add("is-active");
    }
  });
}

function initTopbarMenu() {
  const toggle = document.querySelector("[data-menu-toggle]");
  const nav = document.getElementById("main-nav");

  if (!toggle || !nav) {
    return;
  }

  const closeMenu = () => {
    toggle.setAttribute("aria-expanded", "false");
    nav.classList.remove("is-open");
  };

  toggle.addEventListener("click", () => {
    const nextExpanded = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(nextExpanded));
    nav.classList.toggle("is-open", nextExpanded);
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      if (window.matchMedia("(max-width: 720px)").matches) {
        closeMenu();
      }
    });
  });

  window.addEventListener("resize", () => {
    if (!window.matchMedia("(max-width: 720px)").matches) {
      closeMenu();
    }
  });
}

function resolveHref(href) {
  if (href == null) {
    return href;
  }

  if (href === "") {
    const cleanSiteRoot = siteRoot.endsWith("/") ? siteRoot.slice(0, -1) : siteRoot;
    return `${cleanSiteRoot}/`;
  }

  if (href.startsWith("http") || href.startsWith("#")) {
    return href;
  }

  const activeRoot = href.startsWith("assets/") ? repoRootPath : siteRoot;
  const cleanRoot = activeRoot.endsWith("/") ? activeRoot.slice(0, -1) : activeRoot;
  const cleanHref = href.startsWith("/") ? href.slice(1) : href;
  return `${cleanRoot}/${cleanHref}`;
}

async function readJson(path) {
  try {
    const response = await fetch(`${contentRoot}/${path}`);

    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.status}`);
    }

    return localizeContentNode(await response.json(), localeState.locale);
  } catch (error) {
    const fallbackNode = document.querySelector(`[data-fallback-path="${path}"]`);

    if (fallbackNode) {
      return localizeContentNode(JSON.parse(fallbackNode.textContent), localeState.locale);
    }

    if (window.__contentFallbackBundle?.[path]) {
      return localizeContentNode(window.__contentFallbackBundle[path], localeState.locale);
    }

    const bundleNode = document.getElementById("content-fallback-bundle");

    if (bundleNode) {
      if (!window.__contentFallbackBundle) {
        window.__contentFallbackBundle = JSON.parse(bundleNode.textContent);
      }

      if (window.__contentFallbackBundle[path]) {
        return localizeContentNode(window.__contentFallbackBundle[path], localeState.locale);
      }
    }

    throw error;
  }
}

async function renderMainPage() {
  const data = await readJson("main/page.json");
  applyMainChrome(data.shell);
  window.__terminalPhrases = data.hero.stage?.terminal?.phrases || null;
  const terminal = data.hero.stage?.terminal || {};
  const storyIcons = ["⚡", "💡", "🛠", "🧠"];
  const flowIcons = ["🤝", "🚀", "🧪", "⏱️"];

  pageContent.innerHTML = `
    <section class="home-hero reveal">
      <div class="home-hero-copy">
        <p class="home-kicker">${data.hero.kicker || ""}</p>
        <h1 class="home-title">${data.hero.title}</h1>
        <p class="home-subtitle">${data.hero.lead}</p>
        <p class="hero-description">${data.hero.description}</p>

        <div class="hero-actions">
          <a class="primary-link" href="${resolveHref(data.hero.primaryCta.href)}"${data.hero.primaryCta.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>
            ${data.hero.primaryCta.label}
          </a>
          <a class="secondary-link" href="${resolveHref(data.hero.secondaryCta.href)}">
            ${data.hero.secondaryCta.label}
          </a>
        </div>
      </div>

      <div class="home-stage reveal">
        <div class="stage-panel terminal-card">
          <div class="terminal-topline">
            <span>${terminal.title || t("visual.mainTerminalTitle", "club-session.log")}</span>
            <span class="terminal-status">${terminal.status || t("visual.mainTerminalStatus", "live")}</span>
          </div>
          <div class="terminal-body">
            <p><span class="terminal-prompt">$</span> <span id="terminal-line"></span><span class="cursor"></span></p>
            <ul class="terminal-list">
              ${(terminal.lines || [])
                .map((line) => `<li>${line}</li>`)
                .join("")}
            </ul>
          </div>
        </div>
      </div>
    </section>

    <section class="home-stats reveal">
      ${data.metrics.map(renderMetricCard).join("")}
    </section>

    <section class="home-section reveal">
      <div class="section-heading">
        <p class="section-kicker">${data.story.tag}</p>
        <h2>${data.story.title}</h2>
        <p class="card-copy">${data.story.description}</p>
      </div>
      <div class="story-tabs" data-story-tabs aria-label="${t("aria.storyCards", "Story cards")}"></div>
      <div class="home-bento-grid story-deck" data-story-deck>
        ${(data.story.items || []).map((item, index) => `
          <article class="item-card home-story-card ${index === 0 ? "home-wide-card" : ""} reveal">
            <span class="step-index" aria-hidden="true">${storyIcons[index] || "•"}</span>
            <h3>${item.title}</h3>
            <p class="item-copy">${item.text}</p>
          </article>
        `).join("")}
      </div>
    </section>

    <section class="home-section reveal">
      <div class="section-heading">
        <p class="section-kicker">${data.flow.tag}</p>
        <h2>${data.flow.title}</h2>
        <p class="card-copy">${data.flow.description}</p>
      </div>
      <div class="story-tabs" data-flow-tabs aria-label="${t("aria.flowCards", "Flow cards")}"></div>
      <div class="home-flow-grid" data-flow-cards>
        ${(data.flow.items || []).map((item, index) => `
          <article class="item-card home-flow-card reveal">
            <span class="step-index" aria-hidden="true">${flowIcons[index] || "•"}</span>
            <h3>${item.title}</h3>
            <p class="item-copy">${item.text}</p>
          </article>
        `).join("")}
      </div>
    </section>

    <section class="home-highlight reveal">
      <div class="home-highlight-copy">
        <p class="section-kicker">${data.gallery.tag}</p>
        <h2>${data.gallery.title}</h2>
        <p class="item-copy">${data.gallery.description}</p>
      </div>
      <div class="gallery-shell">
        <button class="gallery-nav prev" type="button" aria-label="${t("aria.previousPhoto", "Previous photo")}">‹</button>
        <div class="gallery-viewport">
          <div class="gallery-track">
            ${data.gallery.items
              .map((item) => `
                <figure class="gallery-slide reveal">
                  <img src="${resolveHref(item.src)}" alt="${item.alt}">
                </figure>
              `)
              .join("")}
          </div>
        </div>
        <button class="gallery-nav next" type="button" aria-label="${t("aria.nextPhoto", "Next photo")}">›</button>
      </div>
    </section>
  `;
}

function applyMainChrome(shell) {
  if (!shell) {
    return;
  }

  const brandTitle = document.getElementById("main-brand-title");
  const brandSubtitle = document.getElementById("main-brand-subtitle");
  const nav = document.getElementById("main-nav");
  const telegram = document.getElementById("main-telegram-link");
  const footer = document.getElementById("main-footer-copy");

  if (brandTitle) {
    brandTitle.textContent = t("shell.brandTitle", shell.brandTitle || "Pet Project Club");
  }

  if (brandSubtitle) {
    brandSubtitle.textContent = t("shell.brandSubtitle", shell.brandSubtitle || "Budva / Montenegro");
  }

  if (nav && Array.isArray(shell.nav)) {
    nav.innerHTML = shell.nav
      .map((item) => {
        const active = item.key === page ? " is-active" : "";
        return `<a href="${item.href}" data-nav="${item.key}" class="${active.trim()}">${t(`shell.nav.${item.key}`, item.label)}</a>`;
      })
      .join("");
    nav.setAttribute("aria-label", t("aria.mainNavigation", "Main navigation"));
  }

  if (telegram && shell.telegram) {
    telegram.textContent = t("shell.telegram", shell.telegram.label || "Telegram");
    telegram.href = shell.telegram.href || "#";
  }

  if (footer) {
    if (typeof shell.footer === "string") {
      footer.textContent = shell.footer;
    } else if (shell.footer) {
      const mark = `<span class="footer-mark">${t("shell.footer.mark", shell.footer.mark || "® Pet Project Club")}</span>`;
      const links = Array.isArray(shell.footer.links)
        ? shell.footer.links
            .map((item) => {
              const organizerId =
                /t\.me\/ikotelnikov/i.test(item.href || "") || /contact:/i.test(item.label || "")
                  ? ' id="footer-contact-organizer"'
                  : "";
              let label = item.label;

              if (/maps\.google\.com/i.test(item.href || "")) {
                label = t("shell.footer.address", item.label);
              } else if (/t\.me\/ikotelnikov/i.test(item.href || "")) {
                label = t("shell.footer.contact", item.label);
              }

              return `<a${organizerId} href="${item.href}"${item.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${label}</a>`;
            })
            .join("")
        : "";

      footer.innerHTML = `
        <div class="footer-inline">
          ${mark}
          ${links}
        </div>
      `;
    } else {
      footer.textContent = "";
    }
  }
}

async function renderMeetingsPage() {
  const [data, announcementsIndex, archiveIndex] = await Promise.all([
    readJson("meetings/page.json"),
    readJson("meetings/announcements/index.json"),
    readJson("meetings/archive/index.json"),
  ]);

  const allAnnouncementItems = await Promise.all(
    (announcementsIndex.items || [])
      .map((slug) => readJson(`meetings/items/${slug}.json`))
  );
  const sortedAnnouncementItems = sortMeetingsByDateDesc(allAnnouncementItems);
  const announcementItems = sortedAnnouncementItems.slice(0, data.announcements?.limit || 2);

  const allArchiveItems = await Promise.all(
    (archiveIndex.items || []).map((slug) => readJson(`meetings/items/${slug}.json`))
  );
  const sortedArchiveItems = sortMeetingsByDateDesc(allArchiveItems);
  const pageSize = data.archive?.pageSize || archiveIndex.pageSize || 10;
  const pageParam = Number.parseInt(new URLSearchParams(window.location.search).get("page") || "1", 10);
  const currentPage = Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1;
  const totalPages = Math.max(1, Math.ceil(sortedArchiveItems.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const start = (safePage - 1) * pageSize;
  const archiveItems = sortedArchiveItems.slice(start, start + pageSize);

  pageContent.innerHTML = `
    ${renderMeetingCollection(data.announcements, announcementItems, "announcements")}
    ${renderTimelineSection(data.formats)}
    ${renderMeetingsFeed(data.archive, archiveItems, safePage, totalPages)}
  `;
}

function sortMeetingsByDateDesc(items = []) {
  return [...items].sort((left, right) => {
    const leftDate = typeof left?.date === "string" ? left.date : "";
    const rightDate = typeof right?.date === "string" ? right.date : "";
    return rightDate.localeCompare(leftDate);
  });
}

async function renderMeetingDetailPage() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug");

  if (!slug) {
    pageContent.innerHTML = `
      <section class="empty-state reveal">
        <p>${t("errors.meetingSlugMissing", "Could not open the meeting because the URL is missing the slug parameter.")}</p>
      </section>
    `;
    return;
  }

  const [item, pageData] = await Promise.all([
    readJson(`meetings/items/${slug}.json`),
    readJson("meetings/page.json"),
  ]);

  document.title = buildDocumentTitle(item.title || t("shell.nav.meetings", "Meetings"));

  pageContent.innerHTML = renderMeetingDetail(item, pageData);
}

async function renderProjectsPage() {
  const [projectsData, projectItems, participantItems] = await Promise.all([
    readJson("projects/page.json"),
    readIndexedItems("projects"),
    readIndexedItems("participants"),
  ]);
  const ownerMap = new Map(participantItems.map((item) => [item.slug, item]));
  const listCopy = projectsData.list || {};
  const pageSize = Number(listCopy.pageSize || 6);
  const searchPlaceholder = listCopy.searchPlaceholder || t("projects.searchPlaceholder", "Find a project, stack, owner, or request");
  const emptyText = listCopy.empty || t("projects.emptyText", "There are no projects matching this request yet.");
  const query = new URLSearchParams(window.location.search);
  const initialPage = Number(query.get("page") || "1");
  let currentPage = Number.isFinite(initialPage) && initialPage > 0 ? Math.floor(initialPage) : 1;
  let currentSearch = (query.get("q") || "").trim();

  document.title = buildDocumentTitle(listCopy.title || t("projects.title", "Club projects"));

  pageContent.innerHTML = `
    <section class="section-shell reveal project-page-shell">
      <div class="section-heading">
        <h1>${listCopy.title || "Проекты клуба"}</h1>
      </div>
      <div class="project-toolbar">
        <label class="project-search-shell" for="project-search">
          <input id="project-search" class="project-search-input" type="search" placeholder="${searchPlaceholder}" value="${escapeHtml(currentSearch)}">
        </label>
      </div>
      <div class="project-results-meta" id="project-results-meta"></div>
      <div class="project-feed" id="project-feed"></div>
      <div class="pagination-nav" id="project-pagination" aria-label="${t("aria.projectsPagination", "Projects pagination")}"></div>
    </section>
    ${renderStatusSection(projectsData.notes)}
  `;

  const searchInput = document.getElementById("project-search");
  const feed = document.getElementById("project-feed");
  const pagination = document.getElementById("project-pagination");
  const resultsMeta = document.getElementById("project-results-meta");

  if (!searchInput || !feed || !pagination || !resultsMeta) {
    return;
  }

  const updateUrl = () => {
    const nextQuery = new URLSearchParams();

    if (currentSearch) {
      nextQuery.set("q", currentSearch);
    }

    if (currentPage > 1) {
      nextQuery.set("page", String(currentPage));
    }

    const nextUrl = nextQuery.toString()
      ? `${window.location.pathname}?${nextQuery.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, "", nextUrl);
  };

  const getFilteredProjects = () => {
    const normalizedSearch = currentSearch.toLowerCase();

    if (!normalizedSearch) {
      return projectItems.slice();
    }

    return projectItems.filter((item) => {
      const ownerNames = (item.ownerSlugs || [])
        .map((slug) => ownerMap.get(slug)?.name || ownerMap.get(slug)?.handle || slug)
        .join(" ");
      const haystack = [
        item.title,
        item.summary,
        item.status,
        item.stack,
        item.detailsHtml,
        ...(item.points || []),
        ...(item.tags || []),
        ownerNames,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  };

  const renderProjectPageState = () => {
    const filteredProjects = getFilteredProjects();
    const totalPages = Math.max(1, Math.ceil(filteredProjects.length / pageSize));
    currentPage = Math.min(currentPage, totalPages);
    const pageItems = filteredProjects.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    resultsMeta.innerHTML = currentSearch
      ? `
        <span>${listCopy.resultsLabel || t("projects.resultsLabel", "Projects found")}: <strong>${filteredProjects.length}</strong></span>
      `
      : "";

    feed.innerHTML = pageItems.length
      ? pageItems.map((item) => renderProjectPreviewCard(item, ownerMap)).join("")
      : `<article class="item-card reveal"><h3>${listCopy.emptyTitle || t("common.emptyTitle", "Nothing found")}</h3><p class="item-copy">${emptyText}</p></article>`;

    feed.querySelectorAll(".reveal").forEach((node) => {
      node.classList.add("visible");
    });

    pagination.innerHTML = totalPages > 1
      ? renderGenericPagination(
          {
            prev: listCopy.pagination?.prev || "← Previous",
            next: listCopy.pagination?.next || "Next →",
            page: listCopy.pagination?.page || "Page",
          },
          currentPage,
          totalPages
        )
      : "";

    pagination.querySelectorAll("[data-project-page]").forEach((button) => {
      button.addEventListener("click", () => {
        currentPage = Number(button.dataset.projectPage);
        updateUrl();
        renderProjectPageState();
      });
    });

    updateUrl();
  };

  searchInput.addEventListener("input", () => {
    currentSearch = searchInput.value.trim();
    currentPage = 1;
    renderProjectPageState();
  });

  renderProjectPageState();
}

async function renderParticipantsPage() {
  const [participantsData, participantItems] = await Promise.all([
    readJson("participants/page.json"),
    readIndexedItems("participants"),
  ]);
  const pageSize = Number(participantsData.pageSize || 9);
  const title = participantsData.title || t("participants.title", "Pet Project Club participants");
  const description = participantsData.description || t("participants.description", "To join the participants list, edit your data, or remove it, contact the organizer.");

  document.title = buildDocumentTitle(title);

  pageContent.innerHTML = `
    <section class="section-shell reveal participants-page-shell">
      <div class="section-heading">
        <p class="section-kicker">${participantsData.tag || t("participants.tag", "Participants")}</p>
        <h1>${title}</h1>
        <p class="card-copy">${description}</p>
      </div>
      <div class="people-grid" id="participants-grid"></div>
      <div class="list-sentinel" id="participants-sentinel" aria-hidden="true"></div>
    </section>
  `;

  const grid = document.getElementById("participants-grid");
  const sentinel = document.getElementById("participants-sentinel");

  if (!grid || !sentinel) {
    return;
  }

  let renderedCount = 0;

  const renderNextBatch = () => {
    const nextItems = participantItems.slice(renderedCount, renderedCount + pageSize);

    if (!nextItems.length) {
      sentinel.remove();
      return false;
    }

    const wrapper = document.createElement("div");
    wrapper.innerHTML = nextItems.map(renderPersonCard).join("");
    const cards = [...wrapper.children];
    cards.forEach((card) => {
      card.classList.add("visible");
      grid.appendChild(card);
    });
    renderedCount += nextItems.length;

    if (renderedCount >= participantItems.length) {
      sentinel.remove();
    }

    return true;
  };

  renderNextBatch();

  if (!sentinel.isConnected) {
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) {
      return;
    }

    const hasMore = renderNextBatch();
    if (!hasMore || !sentinel.isConnected) {
      observer.disconnect();
    }
  }, { rootMargin: "200px 0px" });

  observer.observe(sentinel);
}

async function renderParticipantDetailPage() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug");

  if (!slug) {
    pageContent.innerHTML = `
      <section class="empty-state reveal">
        <p>${t("errors.participantSlugMissing", "Could not open the participant because the URL is missing the slug parameter.")}</p>
      </section>
    `;
    return;
  }

  const [participant, participantsData, projectItems] = await Promise.all([
    readJson(`participants/items/${slug}.json`),
    readJson("participants/page.json"),
    readIndexedItems("projects"),
  ]);
  const relatedProjects = projectItems.filter((project) =>
    Array.isArray(project.ownerSlugs) && project.ownerSlugs.includes(slug)
  );

  document.title = buildDocumentTitle(participant.name || slug);

  pageContent.innerHTML = renderParticipantDetail(participant, participantsData, relatedProjects);
}

async function renderProjectDetailPage() {
  const params = new URLSearchParams(window.location.search);
  const slug = params.get("slug");

  if (!slug) {
    pageContent.innerHTML = `
      <section class="empty-state reveal">
        <p>${t("errors.projectSlugMissing", "Could not open the project because the URL is missing the slug parameter.")}</p>
      </section>
    `;
    return;
  }

  const [project, projectsData, participantItems, announcementItems, archiveItems] = await Promise.all([
    readJson(`projects/items/${slug}.json`),
    readJson("projects/page.json"),
    readIndexedItems("participants"),
    readMeetingIndexItems("meetings/announcements/index.json"),
    readMeetingIndexItems("meetings/archive/index.json"),
  ]);
  const participantsBySlug = new Map(participantItems.map((item) => [item.slug, item]));
  const relatedMeetings = [...announcementItems, ...archiveItems]
    .filter((item) => Array.isArray(item.projectSlugs) && item.projectSlugs.includes(slug))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  document.title = buildDocumentTitle(project.title || slug);

  pageContent.innerHTML = renderProjectDetail(project, projectsData, participantsBySlug, relatedMeetings);
}

async function readIndexedItems(sectionPath) {
  const index = await readJson(`${sectionPath}/index.json`);
  return Promise.all(
    (index.items || []).map((slug) => readJson(`${sectionPath}/items/${slug}.json`))
  );
}

async function readMeetingIndexItems(indexPath) {
  const index = await readJson(indexPath);
  return Promise.all(
    (index.items || []).map((slug) => readJson(`meetings/items/${slug}.json`))
  );
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
  const sourceLocale = normalizeLocale(base.sourceLocale) || DEFAULT_LOCALE;
  const translation = locale !== sourceLocale && value.translations && typeof value.translations === "object"
    ? value.translations[locale]
    : null;

  return translation && typeof translation === "object"
    ? deepMergeContent(base, localizeContentNode(translation, locale))
    : base;
}

function deepMergeContent(baseValue, overrideValue) {
  if (Array.isArray(overrideValue)) {
    return overrideValue.map((entry) => cloneContentValue(entry));
  }

  if (!overrideValue || typeof overrideValue !== "object") {
    return overrideValue;
  }

  const baseObject = baseValue && typeof baseValue === "object" && !Array.isArray(baseValue)
    ? baseValue
    : {};
  const result = { ...baseObject };

  for (const [key, value] of Object.entries(overrideValue)) {
    if (Array.isArray(value)) {
      result[key] = value.map((entry) => cloneContentValue(entry));
      continue;
    }

    if (value && typeof value === "object") {
      result[key] = deepMergeContent(result[key], value);
      continue;
    }

    result[key] = value;
  }

  return result;
}

function cloneContentValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneContentValue(entry));
  }

  if (value && typeof value === "object") {
    return deepMergeContent({}, value);
  }

  return value;
}

async function renderNewsPage() {
  const [pageData, projectItems, announcementItems, archiveItems] = await Promise.all([
    readJson("news/page.json"),
    readIndexedItems("projects"),
    readMeetingIndexItems("meetings/announcements/index.json"),
    readMeetingIndexItems("meetings/archive/index.json"),
  ]);
  const projectTitleBySlug = new Map(projectItems.map((item) => [item.slug, item.title || item.slug]));
  const listCopy = pageData.list || {};
  const pageSize = Number(listCopy.pageSize || 8);
  const query = new URLSearchParams(window.location.search);
  const initialPage = Number(query.get("page") || "1");
  let currentPage = Number.isFinite(initialPage) && initialPage > 0 ? Math.floor(initialPage) : 1;
  let currentSearch = (query.get("q") || "").trim();
  const allItems = sortMeetingsByDateDesc(
    [...announcementItems, ...archiveItems].filter(
      (item) => Array.isArray(item.projectSlugs) && item.projectSlugs.length > 0
    )
  );

  document.title = buildDocumentTitle(listCopy.title || t("news.title", "Project news"));

  pageContent.innerHTML = `
    <section class="section-shell reveal project-page-shell">
      <div class="section-heading">
        <h1>${listCopy.title || t("news.title", "Project news")}</h1>
      </div>
      <div class="project-toolbar">
        <label class="project-search-shell" for="news-search">
          <input id="news-search" class="project-search-input" type="search" placeholder="${listCopy.searchPlaceholder || t("news.searchPlaceholder", "Search: project, technology, title...")}" value="${escapeHtml(currentSearch)}">
        </label>
      </div>
      <div class="project-results-meta" id="news-results-meta"></div>
      <div class="meeting-feed" id="news-feed"></div>
      <div class="pagination-nav" id="news-pagination" aria-label="${t("aria.newsPagination", "News pagination")}"></div>
    </section>
    ${pageData.notes ? renderStatusSection(pageData.notes) : ""}
  `;

  const searchInput = document.getElementById("news-search");
  const feed = document.getElementById("news-feed");
  const pagination = document.getElementById("news-pagination");
  const resultsMeta = document.getElementById("news-results-meta");

  if (!searchInput || !feed || !pagination || !resultsMeta) {
    return;
  }

  const updateUrl = () => {
    const nextQuery = new URLSearchParams();

    if (currentSearch) {
      nextQuery.set("q", currentSearch);
    }

    if (currentPage > 1) {
      nextQuery.set("page", String(currentPage));
    }

    const nextUrl = nextQuery.toString()
      ? `${window.location.pathname}?${nextQuery.toString()}`
      : window.location.pathname;
    window.history.replaceState({}, "", nextUrl);
  };

  const getFilteredItems = () => {
    const normalizedSearch = currentSearch.toLowerCase();

    if (!normalizedSearch) {
      return allItems.slice();
    }

    return allItems.filter((item) => {
      const relatedProjectTitles = (item.projectSlugs || [])
        .map((slug) => projectTitleBySlug.get(slug) || slug)
        .join(" ");
      const haystack = [
        item.title,
        item.place,
        item.format,
        item.date,
        ...(item.paragraphs || []),
        ...(item.sections || []).flatMap((section) => [section.title, ...(section.paragraphs || [])]),
        relatedProjectTitles,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  };

  const renderNewsState = () => {
    const filteredItems = getFilteredItems();
    const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
    currentPage = Math.min(currentPage, totalPages);
    const pageItems = filteredItems.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    resultsMeta.innerHTML = currentSearch
      ? `
        <span>${listCopy.resultsLabel || t("news.resultsLabel", "News found")}: <strong>${filteredItems.length}</strong></span>
      `
      : "";

    feed.innerHTML = pageItems.length
      ? pageItems.map((item) => renderMeetingPreviewCard(item)).join("")
      : `<article class="item-card reveal"><h3>${listCopy.emptyTitle || t("common.emptyTitle", "Nothing found")}</h3><p class="item-copy">${listCopy.empty || t("news.emptyText", "Try changing the search query.")}</p></article>`;

    feed.querySelectorAll(".reveal").forEach((node) => {
      node.classList.add("visible");
    });

    pagination.innerHTML = totalPages > 1
      ? renderGenericPagination(
          {
            prev: listCopy.pagination?.prev || getUiPaginationCopy("news").prev,
            next: listCopy.pagination?.next || getUiPaginationCopy("news").next,
            page: listCopy.pagination?.page || getUiPaginationCopy("news").page,
          },
          currentPage,
          totalPages
        )
      : "";

    pagination.querySelectorAll("[data-project-page]").forEach((button) => {
      button.addEventListener("click", () => {
        currentPage = Number(button.dataset.projectPage);
        updateUrl();
        renderNewsState();
        window.scrollTo({ top: 0, behavior: prefersReducedMotion ? "auto" : "smooth" });
      });
    });
  };

  searchInput.addEventListener("input", () => {
    currentSearch = searchInput.value.trim();
    currentPage = 1;
    updateUrl();
    renderNewsState();
  });

  renderNewsState();
}

function renderHero(hero, signals = [], visualKind = "main") {
  return `
    <section class="hero-shell reveal">
      <div class="hero-grid">
        <div class="hero-copy">
          <div class="eyebrow-row">
            <span class="eyebrow-chip">${hero.eyebrow}</span>
            <span class="eyebrow-chip subtle">${hero.badge}</span>
          </div>

          <h1 class="hero-title">${hero.title}</h1>
          <p class="hero-lead">${hero.lead}</p>
          <p class="hero-description">${hero.description}</p>

          <div class="hero-actions">
            <a class="primary-link" href="${resolveHref(hero.primaryCta.href)}"${hero.primaryCta.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>
              ${hero.primaryCta.label}
            </a>
            <a class="secondary-link" href="${resolveHref(hero.secondaryCta.href)}">
              ${hero.secondaryCta.label}
            </a>
          </div>

          <div class="hero-signal-grid">
            ${signals.map(renderSignalCard).join("")}
          </div>
        </div>

        <div class="hero-visual reveal">
          ${renderVisual(visualKind)}
        </div>
      </div>
    </section>
  `;
}

function renderVisual(kind) {
  if (kind === "meetings") {
    return `
      <div class="visual-panel">
        <div class="visual-frame"></div>
        <div class="visual-dots"><span></span><span></span><span></span></div>
        <div class="hero-visual-main">
          <div class="stack-visual">
            <div class="stack-card s1">signal</div>
            <div class="stack-card s2">session</div>
            <div class="stack-card s3">follow-up</div>
          </div>
        </div>
      </div>
      <div class="terminal-card">
        <div class="terminal-topline">
          <span>meetings.feed</span>
          <span class="terminal-status">${t("visual.meetingsTerminalStatus", "ready for telegram")}</span>
        </div>
        <div class="terminal-body">
          <p><span class="terminal-prompt">$</span> <span id="terminal-line"></span><span class="cursor"></span></p>
          <ul class="terminal-list">
            <li>Анонсировать тему, формат и место.</li>
            <li>Собрать участников, слоты и обновления.</li>
            <li>Сохранить результат встречи в контент.</li>
          </ul>
        </div>
      </div>
    `;
  }

  if (kind === "projects") {
    return `
      <div class="visual-panel">
        <div class="visual-frame"></div>
        <div class="visual-dots"><span></span><span></span><span></span></div>
        <div class="hero-visual-main">
          <div class="radar">
            <div class="radar-ring r1"></div>
            <div class="radar-ring r2"></div>
            <div class="radar-ring r3"></div>
            <div class="radar-node center">ship</div>
            <div class="radar-node n1">idea</div>
            <div class="radar-node n2">team</div>
            <div class="radar-node n3">build</div>
            <div class="radar-node n4">review</div>
          </div>
        </div>
      </div>
      <div class="terminal-card">
        <div class="terminal-topline">
          <span>projects.index</span>
          <span class="terminal-status">${t("visual.projectsTerminalStatus", "contributors open")}</span>
        </div>
        <div class="terminal-body">
          <ul class="terminal-list">
            <li>Показывайте текущий статус проекта, а не только идею.</li>
            <li>Фиксируйте, кто нужен: design, frontend, backend, product.</li>
            <li>Держите маленький, понятный next step.</li>
          </ul>
        </div>
      </div>
    `;
  }

  return `
    <div class="visual-panel">
      <div class="visual-frame"></div>
      <div class="visual-dots"><span></span><span></span><span></span></div>
      <div class="hero-visual-main">
        <div class="radar">
          <div class="radar-ring r1"></div>
          <div class="radar-ring r2"></div>
          <div class="radar-ring r3"></div>
          <div class="radar-node center">club</div>
          <div class="radar-node n1">idea</div>
          <div class="radar-node n2">team</div>
          <div class="radar-node n3">ship</div>
          <div class="radar-node n4">feedback</div>
        </div>
      </div>
    </div>
    <div class="terminal-card">
      <div class="terminal-topline">
        <span>club-session.log</span>
        <span class="terminal-status">live</span>
      </div>
      <div class="terminal-body">
        <p><span class="terminal-prompt">$</span> <span id="terminal-line"></span><span class="cursor"></span></p>
        <ul class="terminal-list">
          <li>Найти людей, которые делают, а не обещают.</li>
          <li>Принести идею, набросок или почти готовый проект.</li>
          <li>Уйти с фидбеком, планом и следующей точкой запуска.</li>
        </ul>
      </div>
    </div>
  `;
}

function renderSignalCard(item) {
  return `
    <article class="signal-card">
      <span class="signal-label">${item.label}</span>
      <strong>${item.value}</strong>
    </article>
  `;
}

function renderMetrics(items = []) {
  return `
    <section class="metrics-strip reveal">
      ${items.map(renderMetricCard).join("")}
    </section>
  `;
}

function renderMetricCard(item) {
  const isNumeric = typeof item.value === "number";
  const value = isNumeric
    ? `<strong class="metric-value" data-target="${item.value}">0</strong>`
    : `<strong class="metric-value">${item.value}</strong>`;

  return `
    <article class="metric-card">
      <span class="metric-label">${item.label}</span>
      ${value}
      <span class="card-copy">${item.hint}</span>
    </article>
  `;
}

function renderCardSection(section, gridClass = "", variant = "item") {
  const className = gridClass ? `card-grid ${gridClass}` : "card-grid";
  const cards = (section.items || []).map((item, index) => renderItemCard(item, index, variant)).join("");

  return `
    <section class="section-shell reveal">
      <div class="section-heading">
        <p class="section-kicker">${section.tag}</p>
        <h2>${section.title}</h2>
        <p class="card-copy">${section.description}</p>
      </div>
      <div class="${className}">
        ${cards}
      </div>
    </section>
  `;
}

function renderItemCard(item, index, variant) {
  const meta = [
    item.status,
    item.location,
    item.date,
    item.role,
    item.stack,
  ]
    .filter(Boolean)
    .map((entry) => `<span class="meta-pill">${entry}</span>`)
    .join("");

  const list = item.points && item.points.length
    ? `<ul class="${variant === "project" ? "project-list" : "item-list"}">${item.points.map((point) => `<li>${point}</li>`).join("")}</ul>`
    : `<p class="${variant === "project" ? "item-copy" : "card-copy"}">${item.text}</p>`;

  return `
    <article class="${variant === "project" ? "project-card" : "item-card"} reveal">
      ${item.index ? `<span class="step-index">${item.index}</span>` : ""}
      ${!item.index ? `<span class="card-tag">${String(index + 1).padStart(2, "0")}</span>` : ""}
      <h3>${item.title}</h3>
      ${meta ? `<div class="${variant === "project" ? "project-meta" : "card-meta"}">${meta}</div>` : ""}
      ${list}
    </article>
  `;
}

function renderTimelineSection(section) {
  const timelineIcons = ["🤝", "🚀", "🧪", "⏱️"];
  const items = (section.items || [])
    .map((item, index) => `
      <article class="item-card timeline-card reveal">
        <span class="step-index" aria-hidden="true">${timelineIcons[index] || "•"}</span>
        <h3>${item.title}</h3>
        <p class="item-copy">${item.text}</p>
      </article>
    `)
    .join("");

  return `
    <section class="section-shell reveal">
      <div class="section-heading">
        <p class="section-kicker">${section.tag}</p>
        <h2>${section.title}</h2>
        <p class="card-copy">${section.description}</p>
      </div>
      <div class="story-tabs" data-timeline-tabs aria-label="Meeting format cards"></div>
      <div class="timeline-grid" data-timeline-cards>
        ${items}
      </div>
    </section>
  `;
}

function initTimelineTabs() {
  const narrowScreen = window.matchMedia("(max-width: 640px)");

  document.querySelectorAll("[data-timeline-cards]").forEach((grid) => {
    const tabs = grid.parentElement?.querySelector("[data-timeline-tabs]");
    const cards = [...grid.querySelectorAll(".timeline-card")];
    if (!cards.length) {
      return;
    }

    if (grid.dataset.timelineTabsReady !== "true") {
      tabs?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-timeline-tab]");
        if (!button || !grid.classList.contains("is-mobile-deck")) {
          return;
        }

        setActiveTimelineTab(grid, Number(button.dataset.timelineTab));
      });

      grid.dataset.timelineTabsReady = "true";
    }

    syncTimelineTabs(grid, tabs, narrowScreen.matches);
  });

  if (window.__timelineTabsResizeBound) {
    return;
  }

  const handleResize = () => {
    document.querySelectorAll("[data-timeline-cards]").forEach((grid) => {
      const tabs = grid.parentElement?.querySelector("[data-timeline-tabs]");
      syncTimelineTabs(grid, tabs, narrowScreen.matches);
    });
  };

  if (typeof narrowScreen.addEventListener === "function") {
    narrowScreen.addEventListener("change", handleResize);
  } else if (typeof narrowScreen.addListener === "function") {
    narrowScreen.addListener(handleResize);
  }

  window.addEventListener("resize", handleResize);
  window.__timelineTabsResizeBound = true;
}

function syncTimelineTabs(grid, tabs, useTabsLayout) {
  const cards = [...grid.querySelectorAll(".timeline-card")];
  if (!cards.length) {
    return;
  }

  if (!useTabsLayout) {
    grid.classList.remove("is-mobile-deck");
    tabs?.classList.remove("is-visible");
    if (tabs) {
      tabs.innerHTML = "";
    }
    cards.forEach((card) => {
      card.hidden = false;
      card.classList.remove("is-active");
      card.removeAttribute("aria-hidden");
    });
    return;
  }

  const tabIcons = ["🤝", "🚀", "🧪", "⏱️"];
  grid.classList.add("is-mobile-deck");
  if (tabs) {
    tabs.classList.add("is-visible");
    tabs.innerHTML = cards
      .map((card, index) => `
        <button class="story-tab" type="button" data-timeline-tab="${index}" aria-label="Open meeting format card ${index + 1}">
          <span aria-hidden="true">${tabIcons[index] || "•"}</span>
        </button>
      `)
      .join("");
  }

  setActiveTimelineTab(grid, 0);
}

function setActiveTimelineTab(grid, activeIndex) {
  const cards = [...grid.querySelectorAll(".timeline-card")];
  const tabs = grid.parentElement?.querySelector("[data-timeline-tabs]");

  cards.forEach((card, index) => {
    const isActive = index === activeIndex;
    card.hidden = !isActive;
    card.classList.toggle("is-active", isActive);
    card.setAttribute("aria-hidden", String(!isActive));
  });

  tabs?.querySelectorAll("[data-timeline-tab]").forEach((button, index) => {
    button.classList.toggle("is-active", index === activeIndex);
    button.setAttribute("aria-pressed", String(index === activeIndex));
  });
}

function renderPeopleSection(section) {
  return `
    <section class="section-shell reveal">
      <div class="section-heading">
        <p class="section-kicker">${section.tag}</p>
        <h2>${section.title}</h2>
        <p class="card-copy">${section.description}</p>
      </div>
      <div class="people-grid">
        ${section.items.map(renderPersonCard).join("")}
      </div>
    </section>
  `;
}

function renderPersonCard(item) {
  const points = Array.isArray(item.points) ? item.points : [];
  const handle = item.handle || item.slug || "participant";
  const name = item.name || item.slug || t("participants.card.untitled", "Untitled participant");
  const role = item.role || t("participants.card.roleFallback", "Role not specified");
  const bio = item.bio || "";
  const href = resolveHref(`participants/item/?slug=${item.slug}`);
  const previewBio = truncateText(bio, 170);
  const photo = item.photo?.src
    ? `
      <a class="person-photo" href="${href}">
        <img src="${resolveHref(item.photo.src)}" alt="${item.photo.alt || name}">
      </a>
    `
    : "";
  const footerBits = renderEntityContactTags(item, { includeTags: true });

  return `
    <article class="person-card reveal">
      ${photo}
      <h3><a class="person-name-link" href="${href}">${name}</a></h3>
      <p class="person-role">${role}</p>
      ${previewBio ? `<p class="person-copy">${previewBio}${bio.length > previewBio.length ? ` <a class="read-more-link" href="${href}">${t("participants.card.readMore", "more -->")}</a>` : ""}</p>` : ""}
      ${points.length ? `
        <ul class="person-list">
          ${points.map((point) => `<li>${point}</li>`).join("")}
        </ul>
      ` : ""}
      ${footerBits ? `<div class="person-footer">${footerBits}</div>` : ""}
    </article>
  `;
}

function renderProjectPreviewCard(item, ownerMap = new Map()) {
  const href = resolveHref(`projects/item/?slug=${item.slug}`);
  const summary = item.summary || (Array.isArray(item.points) ? item.points[0] : "") || "";
  const previewSummary = truncateText(summary, 190);
  const hasMore = summary.length > previewSummary.length;
  const photo = getProjectGallery(item)[0];
  const owners = (item.ownerSlugs || [])
    .map((slug) => ownerMap.get(slug))
    .filter(Boolean);
  const ownerLinks = owners
    .map((owner) => `<a class="meta-pill" href="${resolveHref(`participants/item/?slug=${owner.slug}`)}">${owner.name || owner.slug}</a>`)
    .join("");
  const primaryUrl = getProjectPrimaryUrl(item);

  return `
    <article class="project-preview reveal${photo ? "" : " no-photo"}" id="${item.slug}">
      ${photo ? `
        <a class="project-preview-media" href="${href}">
          <img src="${resolveHref(photo.src)}" alt="${photo.alt || item.title}">
        </a>
      ` : ""}
      <div class="project-preview-body">
        ${item.status ? `<p class="meeting-date">${item.status}</p>` : ""}
        <h3 class="meeting-title"><a href="${href}">${item.title}</a></h3>
        <div class="meeting-meta">
          ${item.stack ? `<span class="meta-pill">${item.stack}</span>` : ""}
          ${ownerLinks}
          ${primaryUrl ? `<a class="meta-pill" href="${resolveHref(primaryUrl.href)}"${primaryUrl.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${primaryUrl.label}</a>` : ""}
        </div>
        ${previewSummary ? `<p class="meeting-copy">${escapeHtml(previewSummary)}${hasMore ? ` <a class="read-more-link" href="${href}">${t("projects.readMore", "more -->")}</a>` : ""}</p>` : ""}
      </div>
    </article>
  `;
}

function renderParticipantDetail(item, pageData, relatedProjects) {
  const backHref = resolveHref("participants/");
  const photo = item.photo?.src
    ? `
      <figure class="participant-detail-media">
        <img src="${resolveHref(item.photo.src)}" alt="${item.photo.alt || item.name || item.slug}">
      </figure>
    `
    : "";
  const footerBits = renderEntityContactTags(item, { includeTags: true });

  return `
    <section class="participant-detail-shell reveal">
      <div class="participant-detail-head">
        <a class="detail-back-link" href="${backHref}">${pageData.detail?.backLabel || t("participants.detail.backLabel", "← Back to participants")}</a>
        ${photo}
        <h1 class="participant-detail-title">${item.name || item.slug}</h1>
        ${item.role ? `<p class="person-role participant-detail-role">${item.role}</p>` : ""}
        ${footerBits ? `<div class="participant-detail-meta">${footerBits}</div>` : ""}
        ${item.bio ? `<p class="person-copy participant-detail-bio">${item.bio}</p>` : ""}
      </div>
      ${Array.isArray(item.points) && item.points.length ? `
        <div class="detail-list-shell">
          <ul class="detail-list">
            ${item.points.map((point) => `<li>${point}</li>`).join("")}
          </ul>
        </div>
      ` : ""}
    </section>
    <section class="section-shell reveal">
      <div class="section-heading">
        <h2>${t("participants.detail.projectsTitle", "Participant projects")}</h2>
      </div>
      <div class="project-feed">
        ${relatedProjects.length ? relatedProjects.map((project) => renderProjectPreviewCard(project, new Map([[item.slug, item]]))).join("") : `<article class="item-card reveal"><h3>${t("participants.detail.emptyTitle", "Nothing here yet")}</h3><p class="item-copy">${t("participants.detail.emptyText", "No projects are linked to this participant yet.")}</p></article>`}
      </div>
    </section>
  `;
}

function renderProjectDetail(item, pageData, participantsBySlug, relatedMeetings) {
  const gallery = getProjectGallery(item);
  const owners = (item.ownerSlugs || [])
    .map((slug) => participantsBySlug.get(slug))
    .filter(Boolean);
  const relatedParticipants = owners.length
    ? owners.map((owner) => `
      <a class="meta-pill" href="${resolveHref(`participants/item/?slug=${owner.slug}`)}">${owner.name || owner.slug}</a>
    `).join("")
    : "";
  const externalLinks = getProjectLinks(item)
    .map((link) => `<a class="meta-pill meta-pill-link" href="${resolveHref(link.href)}"${link.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${link.label}</a>`)
    .join("");
  const projectText = normalizeProjectDetailText(item);
  const detailsHtml = projectText.detailsHtml
    ? `<div class="project-richtext">${projectText.detailsHtml}</div>`
    : (Array.isArray(item.points) && item.points.length
      ? `
        <div class="detail-list-shell">
          <ul class="detail-list">
            ${item.points.map((point) => `<li>${point}</li>`).join("")}
          </ul>
        </div>
      `
      : "");

  return `
    <section class="project-detail-shell reveal">
      <div class="project-detail-head">
        <a class="detail-back-link" href="${resolveHref("projects/")}">${pageData.detail?.backLabel || t("projects.detail.backLabel", "← Back to projects")}</a>
        ${item.status ? `<p class="meeting-date project-state-label">${item.status}</p>` : ""}
        <h1 class="project-detail-title">${item.title || item.slug}</h1>
        ${projectText.summary ? `<p class="card-copy project-detail-summary">${projectText.summary}</p>` : ""}
        <div class="project-detail-meta">
          ${item.stack ? `<span class="meta-pill">${item.stack}</span>` : ""}
          ${relatedParticipants}
          ${externalLinks}
        </div>
      </div>
      ${renderProjectGallery(gallery, item.title || item.slug)}
      ${detailsHtml ? `
        <section class="section-shell reveal">
          <div class="section-heading">
            ${pageData.detail?.detailsTag ? `<p class="section-kicker">${pageData.detail.detailsTag}</p>` : ""}
            <h2>${pageData.detail?.detailsTitle || t("projects.detail.detailsTitle", "Project details")}</h2>
          </div>
          ${detailsHtml}
        </section>
      ` : ""}
      <section class="section-shell reveal">
        <div class="section-heading">
          ${pageData.detail?.ownersTag ? `<p class="section-kicker">${pageData.detail.ownersTag}</p>` : ""}
          <h2>${pageData.detail?.ownersTitle || t("projects.detail.ownersTitle", "Project creators")}</h2>
          ${pageData.detail?.ownersDescription ? `<p class="card-copy">${pageData.detail.ownersDescription}</p>` : ""}
        </div>
        <div class="project-owner-list">
          ${owners.length
            ? owners.map((owner) => renderPersonCard(owner)).join("")
            : `<article class="item-card reveal"><h3>${t("projects.detail.ownersEmptyTitle", "Not specified yet")}</h3><p class="item-copy">${t("projects.detail.ownersEmptyText", "This project does not list creators in ownerSlugs yet.")}</p></article>`}
        </div>
      </section>
      <section class="section-shell reveal">
        <div class="section-heading">
          ${pageData.detail?.newsTag ? `<p class="section-kicker">${pageData.detail.newsTag}</p>` : ""}
          <h2>${pageData.detail?.newsTitle || t("projects.detail.newsTitle", "News and related meetings")}</h2>
          ${pageData.detail?.newsDescription ? `<p class="card-copy">${pageData.detail.newsDescription}</p>` : ""}
        </div>
        <div class="meeting-feed">
          ${relatedMeetings.length
            ? relatedMeetings.map((meeting) => renderMeetingPreviewCard(meeting)).join("")
            : `<article class="item-card reveal"><h3>${t("projects.detail.relatedEmptyTitle", "Nothing here yet")}</h3><p class="item-copy">${t("projects.detail.relatedEmptyText", "Related meetings will appear here once a meeting or announcement includes projectSlugs.")}</p></article>`}
        </div>
      </section>
    </section>
  `;
}

function renderPersonHandle(handle) {
  if (!handle) {
    return "";
  }

  const username = normalizeTelegramHandle(handle);

  if (username) {
    return `<a class="card-tag card-tag-link" href="https://t.me/${username}" target="_blank" rel="noopener noreferrer">@${username}</a>`;
  }

  return `<span class="card-tag">${handle}</span>`;
}

function renderEntityContactTags(item, options = {}) {
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
    pushTag(`handle:${item.handle}`, `<span class="meta-pill">${item.handle}</span>`);
  }

  for (const link of Array.isArray(item.links) ? item.links : []) {
    if (!link?.href || !link?.label) {
      continue;
    }

    const normalizedHref = resolveHref(link.href);
    if (telegramHandle && normalizedHref === `https://t.me/${telegramHandle}`) {
      continue;
    }

    pushTag(
      `link:${normalizedHref}`,
      `<a class="meta-pill meta-pill-link" href="${normalizedHref}"${link.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${link.label}</a>`
    );
  }

  if (options.includeTags) {
    for (const tag of Array.isArray(item.tags) ? item.tags : []) {
      pushTag(`tag:${tag}`, `<span class="meta-pill">${tag}</span>`);
    }
  }

  return tags.join("");
}

function normalizeTelegramHandle(value) {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim().replace(/^@+/, "");

  if (/^[A-Za-z0-9_]{4,}$/.test(cleaned)) {
    return cleaned;
  }

  return null;
}

function truncateText(text, maxLength = 170) {
  if (typeof text !== "string") {
    return "";
  }

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength).trimEnd()}…`;
}

function renderProjectGallery(gallery, fallbackTitle) {
  if (!gallery.length) {
    return "";
  }

  return `
    <section class="project-detail-gallery reveal">
      <div class="gallery-shell">
        <button class="gallery-nav prev" type="button" aria-label="${t("aria.previousPhoto", "Previous photo")}">‹</button>
        <div class="gallery-viewport">
          <div class="gallery-track">
            ${gallery.map((item) => `
              <figure class="gallery-slide reveal">
                <img src="${resolveHref(item.src)}" alt="${item.alt || fallbackTitle}">
              </figure>
            `).join("")}
          </div>
        </div>
        <button class="gallery-nav next" type="button" aria-label="${t("aria.nextPhoto", "Next photo")}">›</button>
      </div>
    </section>
  `;
}

function getProjectGallery(item) {
  const gallery = Array.isArray(item.gallery) ? item.gallery.filter((entry) => entry?.src) : [];

  if (gallery.length) {
    return gallery;
  }

  return item.photo?.src ? [item.photo] : [];
}

function getProjectLinks(item) {
  const links = Array.isArray(item.links) ? item.links.filter((entry) => entry?.href && entry?.label) : [];

  if (item.url) {
    links.unshift({
      label: item.urlLabel || t("projects.openProject", "Open project"),
      href: item.url,
      external: true,
    });
  }

  return links;
}

function getProjectPrimaryUrl(item) {
  return getProjectLinks(item)[0] || null;
}

function normalizeProjectDetailText(item) {
  const rawSummary = typeof item.summary === "string" ? item.summary.trim() : "";
  const rawDetailsHtml = typeof item.detailsHtml === "string" ? item.detailsHtml.trim() : "";

  if (rawDetailsHtml) {
    const normalizedDetailsHtml = looksLikeHtml(rawDetailsHtml)
      ? rawDetailsHtml
      : plainTextToHtml(rawDetailsHtml);

    return {
      summary: rawSummary || summarizePlainText(stripHtml(rawDetailsHtml), 220),
      detailsHtml: normalizedDetailsHtml,
    };
  }

  if (rawSummary.length > 320) {
    return {
      summary: summarizePlainText(rawSummary, 220),
      detailsHtml: plainTextToHtml(rawSummary),
    };
  }

  return {
    summary: rawSummary || "",
    detailsHtml: "",
  };
}

function stripHtml(value) {
  return String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function summarizePlainText(value, maxLength = 220) {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  const firstSentenceMatch = normalized.match(new RegExp(`^(.{1,${maxLength}}?[.!?])(\\s|$)`));

  if (firstSentenceMatch) {
    return firstSentenceMatch[1].trim();
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function plainTextToHtml(value) {
  return value
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function looksLikeHtml(value) {
  return /<[^>]+>/.test(value);
}

function renderGenericPagination(copy = {}, currentPage, totalPages) {
  const prevPage = currentPage > 1 ? currentPage - 1 : null;
  const nextPage = currentPage < totalPages ? currentPage + 1 : null;

  return `
    ${prevPage
      ? `<button class="pagination-link" type="button" data-project-page="${prevPage}">${copy.prev || t("common.pagination.prev", "← Previous")}</button>`
      : `<span class="pagination-link is-disabled">${copy.prev || t("common.pagination.prev", "← Previous")}</span>`}
    <span class="pagination-status">${copy.page || t("common.pagination.page", "Page")} ${currentPage} / ${totalPages}</span>
    ${nextPage
      ? `<button class="pagination-link" type="button" data-project-page="${nextPage}">${copy.next || t("common.pagination.next", "Next →")}</button>`
      : `<span class="pagination-link is-disabled">${copy.next || t("common.pagination.next", "Next →")}</span>`}
  `;
}

function renderStatusSection(section) {
  return `
    <section class="status-shell reveal">
      <div class="status-copy">
        <p class="section-kicker">${section.tag}</p>
        <h2>${section.title}</h2>
        <p>${section.description}</p>
      </div>
      <div class="status-grid">
        ${section.items
          .map((item) => `
            <article class="status-card reveal">
              <strong>${item.title}</strong>
              <p class="card-copy">${item.text}</p>
            </article>
          `)
          .join("")}
      </div>
    </section>
  `;
}

function renderMeetingCollection(section, items, kind = "archive") {
  return `
    <section class="section-shell reveal">
      <div class="section-heading">
        <p class="section-kicker">${section.tag}</p>
        <h2>${section.title}</h2>
        ${section.description ? `<p class="card-copy">${section.description}</p>` : ""}
      </div>
      <div class="meeting-collection">
        ${items.map((item) => renderMeetingPreviewCard(item)).join("")}
      </div>
    </section>
  `;
}

function renderMeetingsFeed(section, items, currentPage, totalPages) {
  return `
    <section class="section-shell reveal">
      <div class="section-heading">
        <p class="section-kicker">${section.tag}</p>
        <h2>${section.title}</h2>
        <p class="card-copy">${section.description}</p>
      </div>
      <div class="meeting-feed">
        ${items.length ? items.map((item) => renderMeetingPreviewCard(item)).join("") : `<p class="card-copy">${section.empty || t("meetings.emptyText", "There are no meetings here yet.")}</p>`}
      </div>
      ${totalPages > 1 ? renderMeetingsPagination(section.pagination, currentPage, totalPages) : ""}
    </section>
  `;
}

function renderMeetingsPagination(copy = {}, currentPage, totalPages) {
  const prevHref = currentPage > 1 ? `?page=${currentPage - 1}` : "";
  const nextHref = currentPage < totalPages ? `?page=${currentPage + 1}` : "";

  return `
    <nav class="pagination-nav" aria-label="${t("aria.meetingsPagination", "Meetings pagination")}">
      ${prevHref
        ? `<a class="pagination-link" href="${prevHref}">${copy.prev || t("common.pagination.prev", "← Previous")}</a>`
        : `<span class="pagination-link is-disabled">${copy.prev || t("common.pagination.prev", "← Previous")}</span>`}
      <span class="pagination-status">${copy.page || t("common.pagination.page", "Page")} ${currentPage} / ${totalPages}</span>
      ${nextHref
        ? `<a class="pagination-link" href="${nextHref}">${copy.next || t("common.pagination.next", "Next →")}</a>`
        : `<span class="pagination-link is-disabled">${copy.next || t("common.pagination.next", "Next →")}</span>`}
    </nav>
  `;
}

function renderMeetingPreviewCard(item) {
  const href = resolveHref(`meetings/item/?slug=${item.slug}`);
  const meta = renderMeetingMeta(item);
  const photo = item.photo?.src
    ? `
      <a class="meeting-preview-media" href="${href}">
        <img src="${resolveHref(item.photo.src)}" alt="${item.photo.alt || item.title}">
      </a>
    `
    : "";
  const paragraphs = Array.isArray(item.paragraphs) ? item.paragraphs : [];
  const lead = paragraphs[0] || "";
  const hasMore = paragraphs.length > 1;

  return `
    <article class="meeting-preview reveal${photo ? "" : " no-photo"}" id="${item.slug}">
      ${photo}
      <div class="meeting-preview-body">
        ${item.date ? `<p class="meeting-date">${item.date}</p>` : ""}
        <h3 class="meeting-title"><a href="${href}">${item.title}</a></h3>
        ${meta ? `<div class="meeting-meta">${meta}</div>` : ""}
        ${lead ? `<p class="meeting-copy">${lead}${hasMore ? ` <a class="read-more-link" href="${href}">${t("meetings.readMore", "read more -->")}</a>` : ""}</p>` : ""}
      </div>
    </article>
  `;
}

function renderMeetingMeta(item) {
  const entries = [];

  if (item.place) {
    entries.push(item.placeUrl
      ? `<a class="meta-pill" href="${item.placeUrl}" target="_blank" rel="noopener noreferrer">${item.place}</a>`
      : `<span class="meta-pill">${item.place}</span>`);
  }

  if (item.format) {
    entries.push(`<span class="meta-pill">${item.format}</span>`);
  }

  return entries.join("");
}

function renderMeetingDetail(item, pageData) {
  const meta = renderMeetingMeta(item);
  const detailSections = (item.sections || [])
    .map((section) => {
      if (!section.items || !section.items.length) {
        return "";
      }

      return `
        <section class="section-shell reveal">
          <div class="section-heading">
            <p class="section-kicker">${section.tag || getEntityTypeLabel(item.type)}</p>
            <h2>${section.title}</h2>
          </div>
          <div class="detail-list-shell">
            <ul class="detail-list">
              ${section.items.map((entry) => `<li>${entry}</li>`).join("")}
            </ul>
          </div>
        </section>
      `;
    })
    .join("");
  const links = (item.links || [])
    .map((link) => `<a class="secondary-link" href="${link.href}"${link.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${link.label}</a>`)
    .join("");
  const backHref = resolveHref("meetings/");

  return `
    <section class="meeting-detail-shell reveal">
      <div class="meeting-detail-head">
        <a class="detail-back-link" href="${backHref}">${pageData.detail?.backLabel || t("meetings.detail.backLabel", "← Back to meetings")}</a>
        ${item.date ? `<p class="meeting-date">${item.date}</p>` : ""}
        <h1 class="meeting-detail-title">${item.title}</h1>
        ${meta ? `<div class="meeting-meta">${meta}</div>` : ""}
      </div>
      ${item.photo?.src ? `
        <div class="meeting-detail-media">
          <img src="${resolveHref(item.photo.src)}" alt="${item.photo.alt || item.title}">
        </div>
      ` : ""}
      <div class="meeting-detail-copy">
        ${(item.paragraphs || []).map((paragraph) => `<p class="meeting-copy">${paragraph}</p>`).join("")}
      </div>
      ${links ? `<div class="hero-actions">${links}</div>` : ""}
    </section>
    ${detailSections}
  `;
}

function initReveal() {
  const revealItems = document.querySelectorAll(".reveal");
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.14 }
  );

  revealItems.forEach((item) => revealObserver.observe(item));
}

function initCounters() {
  const counters = document.querySelectorAll("[data-target]");

  const counterObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        animateCount(entry.target);
        counterObserver.unobserve(entry.target);
      });
    },
    { threshold: 0.55 }
  );

  counters.forEach((item) => counterObserver.observe(item));
}

function animateCount(element) {
  const target = Number(element.dataset.target);
  const duration = 1200;
  const start = performance.now();

  const tick = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const value = Math.round(target * eased);
    element.textContent = value.toString();

    if (progress < 1) {
      requestAnimationFrame(tick);
    }
  };

  requestAnimationFrame(tick);
}

function initTerminal() {
  const terminalLine = document.getElementById("terminal-line");

  if (!terminalLine) {
    return;
  }

  const phrases = window.__terminalPhrases || [
    "sync --messages into content/",
    "review --idea and cut scope",
    "ship --small but real",
    "publish --progress in public",
  ];

  let phraseIndex = 0;
  let charIndex = 0;
  let deleting = false;

  const typeLoop = () => {
    const phrase = phrases[phraseIndex];

    if (!deleting) {
      charIndex += 1;
      terminalLine.textContent = phrase.slice(0, charIndex);

      if (charIndex === phrase.length) {
        deleting = true;
        window.setTimeout(typeLoop, 1100);
        return;
      }
    } else {
      charIndex -= 1;
      terminalLine.textContent = phrase.slice(0, charIndex);

      if (charIndex === 0) {
        deleting = false;
        phraseIndex = (phraseIndex + 1) % phrases.length;
      }
    }

    window.setTimeout(typeLoop, deleting ? 32 : 56);
  };

  typeLoop();
}

function initGallery() {
  document.querySelectorAll(".gallery-shell").forEach((shell) => {
    if (shell.dataset.galleryReady === "true") {
      return;
    }

    const viewport = shell.querySelector(".gallery-viewport");
    const prev = shell.querySelector(".gallery-nav.prev");
    const next = shell.querySelector(".gallery-nav.next");
    const slides = [...shell.querySelectorAll(".gallery-slide img")];

    if (!viewport || !prev || !next) {
      return;
    }

    if (slides.length <= 1) {
      shell.classList.add("gallery-shell-single");
      prev.hidden = true;
      next.hidden = true;
    }

    const scrollBySlide = (direction) => {
      const slide = viewport.querySelector(".gallery-slide");
      const slideWidth = slide ? slide.getBoundingClientRect().width : viewport.clientWidth;
      const gap = 16;
      viewport.scrollBy({
        left: direction * (slideWidth + gap),
        behavior: "smooth",
      });
    };

    prev.addEventListener("click", () => scrollBySlide(-1));
    next.addEventListener("click", () => scrollBySlide(1));

    slides.forEach((slide, index) => {
      let touchStartX = null;
      let touchStartY = null;
      let lastTouchOpenAt = 0;

      slide.addEventListener("click", () => {
        if (Date.now() - lastTouchOpenAt < 500) {
          return;
        }

        openGalleryLightbox(slides, index);
      });
      slide.addEventListener(
        "touchstart",
        (event) => {
          touchStartX = event.changedTouches[0]?.clientX ?? null;
          touchStartY = event.changedTouches[0]?.clientY ?? null;
        },
        { passive: true }
      );
      slide.addEventListener(
        "touchend",
        (event) => {
          const touchEndX = event.changedTouches[0]?.clientX ?? null;
          const touchEndY = event.changedTouches[0]?.clientY ?? null;
          if (
            touchStartX == null ||
            touchStartY == null ||
            touchEndX == null ||
            touchEndY == null
          ) {
            return;
          }

          const deltaX = touchEndX - touchStartX;
          const deltaY = touchEndY - touchStartY;
          if (Math.abs(deltaX) > 12 || Math.abs(deltaY) > 12) {
            return;
          }

          lastTouchOpenAt = Date.now();
          openGalleryLightbox(slides, index);
        },
        { passive: true }
      );
    });

    viewport.addEventListener(
      "wheel",
      (event) => {
        if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
          return;
        }

        event.preventDefault();
      },
      { passive: false }
    );

    shell.dataset.galleryReady = "true";
  });
}

function openGalleryLightbox(slides, startIndex) {
  if (!Array.isArray(slides) || slides.length === 0) {
    return;
  }

  const lightbox = ensureGalleryLightbox();
  const backdrop = lightbox.querySelector(".gallery-lightbox-backdrop");
  const image = lightbox.querySelector(".gallery-lightbox-image");
  const caption = lightbox.querySelector(".gallery-lightbox-caption");
  const counter = lightbox.querySelector(".gallery-lightbox-counter");
  const prev = lightbox.querySelector(".gallery-lightbox-prev");
  const next = lightbox.querySelector(".gallery-lightbox-next");
  const close = lightbox.querySelector(".gallery-lightbox-close");

  let currentIndex = startIndex;
  let touchStartX = null;

  const render = () => {
    const currentSlide = slides[currentIndex];
    image.src = currentSlide.currentSrc || currentSlide.src;
    image.alt = currentSlide.alt || "";
    caption.textContent = currentSlide.alt || "";
    counter.textContent = `${currentIndex + 1} / ${slides.length}`;
    prev.disabled = slides.length <= 1;
    next.disabled = slides.length <= 1;
    prev.hidden = slides.length <= 1;
    next.hidden = slides.length <= 1;
    counter.hidden = slides.length <= 1;
  };

  const step = (direction) => {
    if (slides.length <= 1) {
      return;
    }

    currentIndex = (currentIndex + direction + slides.length) % slides.length;
    render();
  };

  const closeLightbox = () => {
    lightbox.classList.remove("is-open");
    document.body.classList.remove("lightbox-open");
    close.removeEventListener("click", closeLightbox);
    backdrop.removeEventListener("click", closeLightbox);
    prev.removeEventListener("click", handlePrev);
    next.removeEventListener("click", handleNext);
    document.removeEventListener("keydown", handleKeydown);
    image.removeEventListener("touchstart", handleTouchStart);
    image.removeEventListener("touchend", handleTouchEnd);
  };

  const handlePrev = () => step(-1);
  const handleNext = () => step(1);
  const handleKeydown = (event) => {
    if (event.key === "Escape") {
      closeLightbox();
      return;
    }

    if (event.key === "ArrowLeft") {
      step(-1);
      return;
    }

    if (event.key === "ArrowRight") {
      step(1);
    }
  };
  const handleTouchStart = (event) => {
    touchStartX = event.changedTouches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (event) => {
    const touchEndX = event.changedTouches[0]?.clientX ?? null;
    if (touchStartX == null || touchEndX == null) {
      return;
    }

    const delta = touchEndX - touchStartX;
    if (Math.abs(delta) < 40) {
      return;
    }

    step(delta < 0 ? 1 : -1);
  };

  render();
  lightbox.classList.add("is-open");
  document.body.classList.add("lightbox-open");

  close.addEventListener("click", closeLightbox);
  backdrop.addEventListener("click", closeLightbox);
  prev.addEventListener("click", handlePrev);
  next.addEventListener("click", handleNext);
  document.addEventListener("keydown", handleKeydown);
  image.addEventListener("touchstart", handleTouchStart, { passive: true });
  image.addEventListener("touchend", handleTouchEnd, { passive: true });
}

function initStoryDeck() {
  const narrowScreen = window.matchMedia("(max-width: 640px)");

  document.querySelectorAll("[data-story-deck]").forEach((deck) => {
    const tabs = deck.parentElement?.querySelector("[data-story-tabs]");

    if (deck.dataset.storyDeckReady !== "true") {
      tabs?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-story-tab]");
        if (!button || !deck.classList.contains("is-mobile-deck")) {
          return;
        }

        setActiveStoryTab(deck, Number(button.dataset.storyTab));
      });

      deck.dataset.storyDeckReady = "true";
    }

    syncStoryDeck(deck, tabs, narrowScreen.matches);
  });

  if (window.__storyDeckResizeBound) {
    return;
  }

  const handleResize = () => {
    document.querySelectorAll("[data-story-deck]").forEach((deck) => {
      const tabs = deck.parentElement?.querySelector("[data-story-tabs]");
      syncStoryDeck(deck, tabs, narrowScreen.matches);
    });
  };

  if (typeof narrowScreen.addEventListener === "function") {
    narrowScreen.addEventListener("change", handleResize);
  } else if (typeof narrowScreen.addListener === "function") {
    narrowScreen.addListener(handleResize);
  }

  window.addEventListener("resize", handleResize);
  window.__storyDeckResizeBound = true;
}

function syncStoryDeck(deck, tabs, useDeckLayout) {
  const cards = [...deck.querySelectorAll(".home-story-card")];
  if (!cards.length) {
    return;
  }

  if (!useDeckLayout) {
    deck.classList.remove("is-mobile-deck");
    tabs?.classList.remove("is-visible");
    if (tabs) {
      tabs.innerHTML = "";
    }
    cards.forEach((card) => {
      card.hidden = false;
      card.classList.remove("is-active");
      card.removeAttribute("aria-hidden");
    });
    return;
  }

  deck.classList.add("is-mobile-deck");
  if (tabs) {
    const tabIcons = ["⚡", "💡", "🛠", "🧠"];
    tabs.classList.add("is-visible");
    tabs.innerHTML = cards
      .map((card, index) => `
        <button class="story-tab" type="button" data-story-tab="${index}" aria-label="${t("aria.openStoryCard", "Open story card")} ${index + 1}">
          <span aria-hidden="true">${tabIcons[index] || "•"}</span>
        </button>
      `)
      .join("");
  }

  setActiveStoryTab(deck, 0);
}

function setActiveStoryTab(deck, activeIndex) {
  const cards = [...deck.querySelectorAll(".home-story-card")];
  const tabs = deck.parentElement?.querySelector("[data-story-tabs]");

  cards.forEach((card, index) => {
    const isActive = index === activeIndex;
    card.hidden = !isActive;
    card.classList.toggle("is-active", isActive);
    card.setAttribute("aria-hidden", String(!isActive));
  });

  tabs?.querySelectorAll("[data-story-tab]").forEach((button, index) => {
    button.classList.toggle("is-active", index === activeIndex);
    button.setAttribute("aria-pressed", String(index === activeIndex));
  });
}

function initFlowTabs() {
  const narrowScreen = window.matchMedia("(max-width: 640px)");

  document.querySelectorAll("[data-flow-cards]").forEach((grid) => {
    const tabs = grid.parentElement?.querySelector("[data-flow-tabs]");
    const cards = [...grid.querySelectorAll(".home-flow-card")];
    if (!cards.length) {
      return;
    }

    if (grid.dataset.flowTabsReady !== "true") {
      tabs?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-flow-tab]");
        if (!button || !grid.classList.contains("is-mobile-tabs")) {
          return;
        }

        setActiveFlowTab(grid, Number(button.dataset.flowTab));
      });

      grid.dataset.flowTabsReady = "true";
    }

    syncFlowTabs(grid, tabs, narrowScreen.matches);
  });

  if (window.__flowTabsResizeBound) {
    return;
  }

  const handleResize = () => {
    document.querySelectorAll("[data-flow-cards]").forEach((grid) => {
      const tabs = grid.parentElement?.querySelector("[data-flow-tabs]");
      syncFlowTabs(grid, tabs, narrowScreen.matches);
    });
  };

  if (typeof narrowScreen.addEventListener === "function") {
    narrowScreen.addEventListener("change", handleResize);
  } else if (typeof narrowScreen.addListener === "function") {
    narrowScreen.addListener(handleResize);
  }

  window.addEventListener("resize", handleResize);
  window.__flowTabsResizeBound = true;
}

function syncFlowTabs(grid, tabs, useTabsLayout) {
  const cards = [...grid.querySelectorAll(".home-flow-card")];
  if (!cards.length) {
    return;
  }

  if (!useTabsLayout) {
    grid.classList.remove("is-mobile-tabs");
    grid.classList.remove("is-mobile-deck");
    tabs?.classList.remove("is-visible");
    if (tabs) {
      tabs.innerHTML = "";
    }
    cards.forEach((card) => {
      card.hidden = false;
      card.classList.remove("is-active");
      card.removeAttribute("aria-hidden");
    });
    return;
  }

  const tabIcons = ["🤝", "🚀", "🧪", "⏱️"];
  grid.classList.add("is-mobile-tabs");
  grid.classList.add("is-mobile-deck");
  if (tabs) {
    tabs.classList.add("is-visible");
    tabs.innerHTML = cards
      .map((card, index) => `
        <button class="story-tab" type="button" data-flow-tab="${index}" aria-label="${t("aria.openFlowCard", "Open flow card")} ${index + 1}">
          <span aria-hidden="true">${tabIcons[index] || "•"}</span>
        </button>
      `)
      .join("");
  }

  setActiveFlowTab(grid, 0);
}

function setActiveFlowTab(grid, activeIndex) {
  const cards = [...grid.querySelectorAll(".home-flow-card")];
  const tabs = grid.parentElement?.querySelector("[data-flow-tabs]");

  cards.forEach((card, index) => {
    const isActive = index === activeIndex;
    card.hidden = !isActive;
    card.classList.toggle("is-active", isActive);
    card.setAttribute("aria-hidden", String(!isActive));
  });

  tabs?.querySelectorAll("[data-flow-tab]").forEach((button, index) => {
    button.classList.toggle("is-active", index === activeIndex);
    button.setAttribute("aria-pressed", String(index === activeIndex));
  });
}

function ensureGalleryLightbox() {
  let lightbox = document.getElementById("gallery-lightbox");

  if (lightbox) {
    return lightbox;
  }

  lightbox = document.createElement("div");
  lightbox.id = "gallery-lightbox";
  lightbox.className = "gallery-lightbox";
  lightbox.innerHTML = `
    <div class="gallery-lightbox-backdrop"></div>
    <div class="gallery-lightbox-dialog" role="dialog" aria-modal="true" aria-label="${t("aria.imageViewer", "Image viewer")}">
      <button class="gallery-lightbox-close" type="button" aria-label="${t("aria.closeGallery", "Close gallery")}">×</button>
      <button class="gallery-lightbox-prev" type="button" aria-label="${t("aria.previousImage", "Previous image")}">‹</button>
      <div class="gallery-lightbox-media">
        <img class="gallery-lightbox-image" alt="">
        <div class="gallery-lightbox-meta">
          <span class="gallery-lightbox-counter"></span>
          <p class="gallery-lightbox-caption"></p>
        </div>
      </div>
      <button class="gallery-lightbox-next" type="button" aria-label="${t("aria.nextImage", "Next image")}">›</button>
    </div>
  `;

  document.body.appendChild(lightbox);
  return lightbox;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
