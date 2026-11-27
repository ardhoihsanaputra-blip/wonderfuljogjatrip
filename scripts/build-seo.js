const fs = require("fs");
const { execSync } = require("child_process");

const data = JSON.parse(fs.readFileSync("data/packages.json", "utf8"));
const articles = fs.existsSync("data/articles.json")
  ? JSON.parse(fs.readFileSync("data/articles.json", "utf8"))
  : [];
const SITE = data.site;
const today = () => new Date().toISOString().slice(0, 10);

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const idr = (n) => "IDR " + n.toLocaleString("en-US");
const q = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------- 1. Kartu paket ----------
function renderCard(c) {
  const tags = c.hotel
    ? `<span class="tag-pill beer">🍺 Free Beer / pax</span>
        <span class="tag-pill hotel">🏨 2–3★ Hotel (2 pax/room)</span>`
    : `<span class="tag-pill beer">🍺 Free Beer / pax</span>
        <span class="tag-pill excl">⚠️ Entrance Tickets Excluded</span>`;

  return `  <article class="tk reveal in" data-c="${c.filter}">
    <div class="pic" style="--a:${c.colors[0]};--b:${c.colors[1]}">
      <img class="on" src="${c.image}" alt="${esc(c.imageAlt)}" width="600" height="400" loading="lazy" decoding="async">
    </div>
    <div class="inf">
      <em>${esc(c.badge)}</em>
      <h3>${esc(c.name)}</h3>
      <p>${esc(c.desc)}</p>
      <div class="tag-row">
        ${tags}
      </div>
      <small>Pickup times: ${c.pickup.join(", ")}</small>
    </div>
    <div class="bot">
      <div class="pr"><div>Starting from<b>${idr(c.startPrice)}</b><small>/pax</small></div></div>
      <a class="btn" href="#booking">Select</a>
    </div>
  </article>`;
}

// ---------- 2. Daftar artikel terbaru ----------
function renderLatest() {
  if (!articles.length) return "";
  const cards = articles
    .slice(0, 6)
    .map(
      (a) => `      <a class="lt-card" href="${SITE}/articles/${esc(a.slug)}.html">
        <small>${esc(a.date)}</small>
        <h3>${esc(a.title)}</h3>
        <p>${esc(a.description)}</p>
        <span class="lt-more">Read article →</span>
      </a>`
    )
    .join("\n");

  return `  <h2>Travel Guides &amp; Tips</h2>
  <p class="sub">Practical notes from our team for planning your Java trip.</p>
  <div class="lt-grid">
${cards}
  </div>`;
}

// ---------- 3. JSON-LD ----------
function renderLd() {
  const org = data.organization;
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TravelAgency",
        name: org.name,
        url: SITE + "/",
        telephone: org.telephone,
        availableLanguage: org.availableLanguage,
        image: SITE + "/" + org.image,
        address: { "@type": "PostalAddress", ...org.address },
        sameAs: org.sameAs,
      },
      {
        "@type": "ItemList",
        itemListElement: data.offers.map((o) => ({
          "@type": "TouristTrip",
          name: o.name,
          offers: { "@type": "Offer", priceCurrency: "IDR", price: String(o.price) },
        })),
      },
    ],
  };
  return `<script type="application/ld+json">\n${JSON.stringify(ld, null, 2)}\n</script>`;
}

// ---------- 4. Sitemap ----------
function sitemapLastmod() {
  try {
    const dirty = execSync("git status --porcelain index.html").toString().trim();
    if (dirty) return today();
    const d = execSync("git log -1 --format=%cs -- index.html").toString().trim();
    return d || today();
  } catch {
    return today();
  }
}

function renderSitemap() {
  const lm = sitemapLastmod();
  const images = data.sitemapImages
    .map(
      (i) => `    <image:image>
      <image:loc>${SITE}/${i.file}</image:loc>
      <image:title>${esc(i.title)}</image:title>
    </image:image>`
    )
    .join("\n");

  const articleUrls = articles
    .map(
      (a) => `  <url>
    <loc>${SITE}/articles/${a.slug}.html</loc>
    <lastmod>${a.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${SITE}/</loc>
    <lastmod>${lm}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
${images}
  </url>
${articleUrls}
</urlset>
`;
}

// ---------- Jalankan ----------
function replaceBlock(html, name, content) {
  const start = `<!-- AUTO:${name}:START -->`;
  const end = `<!-- AUTO:${name}:END -->`;
  const re = new RegExp(`${q(start)}[\\s\\S]*?${q(end)}`);
  if (!re.test(html)) throw new Error(`Marker AUTO:${name} tidak ditemukan di index.html`);
  return html.replace(re, () => `${start}\n${content}\n${end}`);
}

let html = fs.readFileSync("index.html", "utf8");
html = replaceBlock(html, "CARDS", data.cards.map(renderCard).join("\n\n"));
html = replaceBlock(html, "LATEST", renderLatest());
html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, () => renderLd());

fs.writeFileSync("index.html", html);
fs.writeFileSync("sitemap.xml", renderSitemap());
console.log(
  `Build selesai: ${data.cards.length} kartu, ${articles.length} artikel, ${data.offers.length} offer`
);