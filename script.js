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
  projects: renderProjectsPage,
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
  document.querySelectorAll("[data-nav]").forEach((link) => {
    if (link.dataset.nav === page) {
      link.classList.add("is-active");
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
    footer.textContent = shell.footer || "";
  }
}

async function renderMeetingsPage() {
  const data = await readJson("meetings/page.json");

  pageContent.innerHTML = `
    ${renderHero(data.hero, data.signals, "meetings")}
    ${renderMetrics(data.metrics)}
    ${renderTimelineSection(data.flow)}
    ${renderCardSection(data.sessions, "two-up")}
    ${renderStatusSection(data.notes)}
  `;
}

async function renderProjectsPage() {
  const [projectsData, participantsData] = await Promise.all([
    readJson("projects/page.json"),
    readJson("participants/page.json"),
  ]);

  pageContent.innerHTML = `
    ${renderHero(projectsData.hero, projectsData.signals, "projects")}
    ${renderMetrics(projectsData.metrics)}
    ${renderCardSection(projectsData.projects, "two-up", "project")}
    ${renderPeopleSection(participantsData)}
    ${renderStatusSection(projectsData.notes)}
  `;
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
  return `
    <article class="person-card reveal">
      <span class="card-tag">${item.handle}</span>
      <h3>${item.name}</h3>
      <p class="person-role">${item.role}</p>
      <p class="person-copy">${item.bio}</p>
      <ul class="person-list">
        ${item.points.map((point) => `<li>${point}</li>`).join("")}
      </ul>
    </article>
  `;
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
