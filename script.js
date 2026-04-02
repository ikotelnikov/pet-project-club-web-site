const body = document.body;
const page = body.dataset.page;
const siteRoot = body.dataset.siteRoot || ".";
const contentRoot = body.dataset.contentRoot || "./content";
const pageContent = document.getElementById("page-content");
const updatedAt = document.getElementById("updated-at");
const root = document.documentElement;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const pageLoaders = {
  main: renderMainPage,
  meetings: renderMeetingsPage,
  "meeting-detail": renderMeetingDetailPage,
  projects: renderProjectsPage,
  participants: renderParticipantsPage,
  "participant-detail": renderParticipantDetailPage,
  links: renderLinksPage,
};

if (updatedAt) {
  updatedAt.textContent = new Date().toLocaleDateString("ru-RU", {
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
renderPage().finally(() => {
  initReveal();
  initCounters();
  initTerminal();
  initGallery();
});

async function renderPage() {
  if (!pageContent || !pageLoaders[page]) {
    return;
  }

  pageContent.innerHTML = `<section class="empty-state loading-state reveal"><p>Загружаю контент из репозитория…</p></section>`;

  try {
    await pageLoaders[page]();
  } catch (error) {
    pageContent.innerHTML = `
      <section class="empty-state reveal">
        <p>Не удалось загрузить контент из <code>content/</code>. Проверьте JSON-файлы и запустите сайт через статический сервер.</p>
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

  const cleanRoot = siteRoot.endsWith("/") ? siteRoot.slice(0, -1) : siteRoot;

  if (href === "") {
    return `${cleanRoot}/`;
  }

  if (href.startsWith("http") || href.startsWith("#")) {
    return href;
  }

  const cleanHref = href.startsWith("/") ? href.slice(1) : href;
  return `${cleanRoot}/${cleanHref}`;
}

async function readJson(path) {
  try {
    const response = await fetch(`${contentRoot}/${path}`);

    if (!response.ok) {
      throw new Error(`Failed to load ${path}: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    const fallbackNode = document.querySelector(`[data-fallback-path="${path}"]`);

    if (fallbackNode) {
      return JSON.parse(fallbackNode.textContent);
    }

    if (window.__contentFallbackBundle?.[path]) {
      return window.__contentFallbackBundle[path];
    }

    const bundleNode = document.getElementById("content-fallback-bundle");

    if (bundleNode) {
      if (!window.__contentFallbackBundle) {
        window.__contentFallbackBundle = JSON.parse(bundleNode.textContent);
      }

      if (window.__contentFallbackBundle[path]) {
        return window.__contentFallbackBundle[path];
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
            <span>${terminal.title || "club-session.log"}</span>
            <span class="terminal-status">${terminal.status || "live"}</span>
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
      <div class="home-bento-grid">
        ${(data.story.items || []).map((item, index) => `
          <article class="item-card ${index === 0 ? "home-wide-card" : ""} reveal">
            <span class="card-tag">${String(index + 1).padStart(2, "0")}</span>
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
      <div class="home-flow-grid">
        ${(data.flow.items || []).map((item) => `
          <article class="item-card reveal">
            <span class="step-index">${item.index}</span>
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
        <button class="gallery-nav prev" type="button" aria-label="Previous photo">‹</button>
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
        <button class="gallery-nav next" type="button" aria-label="Next photo">›</button>
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
    brandTitle.textContent = shell.brandTitle || "";
  }

  if (brandSubtitle) {
    brandSubtitle.textContent = shell.brandSubtitle || "";
  }

  if (nav && Array.isArray(shell.nav)) {
    nav.innerHTML = shell.nav
      .map((item) => {
        const active = item.key === page ? " is-active" : "";
        return `<a href="${item.href}" data-nav="${item.key}" class="${active.trim()}">${item.label}</a>`;
      })
      .join("");
  }

  if (telegram && shell.telegram) {
    telegram.textContent = shell.telegram.label || "";
    telegram.href = shell.telegram.href || "#";
  }

  if (footer) {
    if (typeof shell.footer === "string") {
      footer.textContent = shell.footer;
    } else if (shell.footer) {
      const mark = shell.footer.mark ? `<span class="footer-mark">${shell.footer.mark}</span>` : "";
      const links = Array.isArray(shell.footer.links)
        ? shell.footer.links
            .map((item) => {
              const organizerId =
                /t\.me\/ikotelnikov/i.test(item.href || "") || /contact:/i.test(item.label || "")
                  ? ' id="footer-contact-organizer"'
                  : "";
              return `<a${organizerId} href="${item.href}"${item.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${item.label}</a>`;
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
        <p>Не удалось открыть встречу: в адресе отсутствует параметр <code>slug</code>.</p>
      </section>
    `;
    return;
  }

  const [item, pageData] = await Promise.all([
    readJson(`meetings/items/${slug}.json`),
    readJson("meetings/page.json"),
  ]);

  document.title = `${item.title} | Meetings | Pet Project Club Budva`;

  pageContent.innerHTML = renderMeetingDetail(item, pageData);
}

async function renderProjectsPage() {
  const [projectsData, projectItems] = await Promise.all([
    readJson("projects/page.json"),
    readIndexedItems("projects"),
  ]);
  const projectsSection = {
    ...projectsData.projects,
    items: projectItems,
  };

  pageContent.innerHTML = `
    ${renderHero(projectsData.hero, projectsData.signals, "projects")}
    ${renderMetrics(projectsData.metrics)}
    ${renderCardSection(projectsSection, "two-up", "project")}
    ${renderStatusSection(projectsData.notes)}
  `;
}

async function renderParticipantsPage() {
  const [participantsData, participantItems] = await Promise.all([
    readJson("participants/page.json"),
    readIndexedItems("participants"),
  ]);
  const pageSize = Number(participantsData.pageSize || 9);
  const title = participantsData.title || "Участники Pet Project Club";
  const description = participantsData.description || `Для включения в список учасников, редактирования данных или удаления из него напишите <a href="#footer-contact-organizer">организатору</a>.`;

  document.title = `${title} | Pet Project Club Budva`;

  pageContent.innerHTML = `
    <section class="section-shell reveal participants-page-shell">
      <div class="section-heading">
        <p class="section-kicker">${participantsData.tag || "Participants"}</p>
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
        <p>Не удалось открыть участника: в адресе отсутствует параметр <code>slug</code>.</p>
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

  document.title = `${participant.name || slug} | Participants | Pet Project Club Budva`;

  pageContent.innerHTML = renderParticipantDetail(participant, participantsData, relatedProjects);
}

async function readIndexedItems(sectionPath) {
  const index = await readJson(`${sectionPath}/index.json`);
  return Promise.all(
    (index.items || []).map((slug) => readJson(`${sectionPath}/items/${slug}.json`))
  );
}

async function renderLinksPage() {
  const data = await readJson("links/page.json");

  pageContent.innerHTML = `
    ${renderHero(data.hero, data.signals, "links")}
    ${renderMetrics(data.metrics)}
    ${renderLinksSection(data.groups)}
    ${renderStatusSection(data.notes)}
  `;
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
          <span class="terminal-status">ready for telegram</span>
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
          <span class="terminal-status">contributors open</span>
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

  if (kind === "links") {
    return `
      <div class="visual-panel">
        <div class="visual-frame"></div>
        <div class="visual-dots"><span></span><span></span><span></span></div>
        <div class="hero-visual-main">
          <div class="link-cloud">
            <div class="cloud-node c1">telegram</div>
            <div class="cloud-node c2">docs</div>
            <div class="cloud-node c3">forms</div>
            <div class="cloud-node c4">tools</div>
            <div class="cloud-node c5">launch</div>
          </div>
        </div>
      </div>
      <div class="terminal-card">
        <div class="terminal-topline">
          <span>links.map</span>
          <span class="terminal-status">shared access</span>
        </div>
        <div class="terminal-body">
          <ul class="terminal-list">
            <li>Собирайте входные точки и повторяющиеся ресурсы.</li>
            <li>Храните ссылки в контенте, а не в шаблоне страницы.</li>
            <li>Бот сможет обновлять этот список без правки HTML.</li>
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
  const items = (section.items || [])
    .map((item) => `
      <article class="item-card reveal">
        <span class="step-index">${item.index}</span>
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
      <div class="timeline-grid">
        ${items}
      </div>
    </section>
  `;
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
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const links = Array.isArray(item.links) ? item.links : [];
  const handle = item.handle || item.slug || "participant";
  const name = item.name || item.slug || "Untitled participant";
  const role = item.role || "Role not specified";
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
  const footerBits = [
    renderPersonHandle(item.handle),
    ...tags.map((tag) => `<span class="meta-pill">${tag}</span>`),
    ...links.map((link) => `<a class="meta-pill meta-pill-link" href="${resolveHref(link.href)}"${link.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${link.label}</a>`),
  ].filter(Boolean).join("");

  return `
    <article class="person-card reveal">
      ${photo}
      <h3><a class="person-name-link" href="${href}">${name}</a></h3>
      <p class="person-role">${role}</p>
      ${previewBio ? `<p class="person-copy">${previewBio}${bio.length > previewBio.length ? ` <a class="read-more-link" href="${href}">more --&gt;</a>` : ""}</p>` : ""}
      ${points.length ? `
        <ul class="person-list">
          ${points.map((point) => `<li>${point}</li>`).join("")}
        </ul>
      ` : ""}
      ${footerBits ? `<div class="person-footer">${footerBits}</div>` : ""}
    </article>
  `;
}

function renderParticipantDetail(item, pageData, relatedProjects) {
  const backHref = resolveHref("participants/");
  const handle = item.handle || item.slug;
  const photo = item.photo?.src
    ? `
      <div class="participant-detail-media">
        <img src="${resolveHref(item.photo.src)}" alt="${item.photo.alt || item.name || item.slug}">
      </div>
    `
    : "";
  const footerBits = [
    renderPersonHandle(item.handle),
    ...(Array.isArray(item.tags) ? item.tags.map((tag) => `<span class="meta-pill">${tag}</span>`) : []),
    ...(Array.isArray(item.links)
      ? item.links.map((link) => `<a class="meta-pill meta-pill-link" href="${resolveHref(link.href)}"${link.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${link.label}</a>`)
      : []),
  ].filter(Boolean).join("");

  return `
    <section class="participant-detail-shell reveal">
      <div class="participant-detail-head">
        <a class="detail-back-link" href="${backHref}">${pageData.detail?.backLabel || "← Ко всем участникам"}</a>
        ${handle ? `<div class="participant-detail-meta">${renderPersonHandle(handle)}</div>` : ""}
        <h1 class="participant-detail-title">${item.name || item.slug}</h1>
        ${item.role ? `<p class="person-role participant-detail-role">${item.role}</p>` : ""}
        ${footerBits ? `<div class="participant-detail-meta">${footerBits}</div>` : ""}
      </div>
      ${photo}
      ${item.bio ? `<div class="participant-detail-copy"><p class="person-copy">${item.bio}</p></div>` : ""}
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
        <p class="section-kicker">Projects</p>
        <h2>Проекты участника</h2>
        <p class="card-copy">Проекты, в которых этот участник указан как владелец или основной contributor.</p>
      </div>
      <div class="card-grid two-up">
        ${relatedProjects.length ? relatedProjects.map((project, index) => renderItemCard(project, index, "project")).join("") : `<article class="item-card reveal"><h3>Пока пусто</h3><p class="item-copy">Для этого участника пока не привязаны проекты.</p></article>`}
      </div>
    </section>
  `;
}

function renderPersonHandle(handle) {
  if (!handle) {
    return "";
  }

  if (handle.startsWith("@")) {
    const username = handle.replace(/^@+/, "");
    return `<a class="card-tag card-tag-link" href="https://t.me/${username}" target="_blank" rel="noopener noreferrer">${handle}</a>`;
  }

  return `<span class="card-tag">${handle}</span>`;
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

function renderLinksSection(section) {
  return `
    <section class="section-shell reveal">
      <div class="section-heading">
        <p class="section-kicker">${section.tag}</p>
        <h2>${section.title}</h2>
        <p class="card-copy">${section.description}</p>
      </div>
      <div class="link-grid">
        ${section.items.map(renderLinkGroup).join("")}
      </div>
    </section>
  `;
}

function renderLinkGroup(group) {
  return `
    <article class="link-card reveal">
      <span class="card-tag">${group.label}</span>
      <h3>${group.title}</h3>
      <p class="item-copy">${group.text}</p>
      <ul class="link-list">
        ${group.links
          .map((link) => `<li><a href="${resolveHref(link.href)}"${link.external ? ' target="_blank" rel="noopener noreferrer"' : ""}>${link.label}</a></li>`)
          .join("")}
      </ul>
    </article>
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
        ${items.length ? items.map((item) => renderMeetingPreviewCard(item)).join("") : `<p class="card-copy">${section.empty || "Пока здесь нет встреч."}</p>`}
      </div>
      ${totalPages > 1 ? renderMeetingsPagination(section.pagination, currentPage, totalPages) : ""}
    </section>
  `;
}

function renderMeetingsPagination(copy = {}, currentPage, totalPages) {
  const prevHref = currentPage > 1 ? `?page=${currentPage - 1}` : "";
  const nextHref = currentPage < totalPages ? `?page=${currentPage + 1}` : "";

  return `
    <nav class="pagination-nav" aria-label="Meetings pagination">
      ${prevHref
        ? `<a class="pagination-link" href="${prevHref}">${copy.prev || "← Previous"}</a>`
        : `<span class="pagination-link is-disabled">${copy.prev || "← Previous"}</span>`}
      <span class="pagination-status">${copy.page || "Page"} ${currentPage} / ${totalPages}</span>
      ${nextHref
        ? `<a class="pagination-link" href="${nextHref}">${copy.next || "Next →"}</a>`
        : `<span class="pagination-link is-disabled">${copy.next || "Next →"}</span>`}
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
        ${lead ? `<p class="meeting-copy">${lead}${hasMore ? ` <a class="read-more-link" href="${href}">read more --&gt;</a>` : ""}</p>` : ""}
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
            <p class="section-kicker">${section.tag || item.type}</p>
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
        <a class="detail-back-link" href="${backHref}">${pageData.detail?.backLabel || "← Back to meetings"}</a>
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
  const shell = document.querySelector(".gallery-shell");

  if (!shell) {
    return;
  }

  const viewport = shell.querySelector(".gallery-viewport");
  const prev = shell.querySelector(".gallery-nav.prev");
  const next = shell.querySelector(".gallery-nav.next");

  if (!viewport || !prev || !next) {
    return;
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
}
