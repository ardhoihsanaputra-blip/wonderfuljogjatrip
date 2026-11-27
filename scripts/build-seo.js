const fs = require("fs");
const { execSync } = require("child_process");

const data = JSON.parse(fs.readFileSync("data/packages.json", "utf8"));
const SITE = data.site;
const today = () => new Date().toISOString().slice(0, 10);

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const idr = (n) => "IDR " + n.toLocaleString("en-US");

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

// ---------- 2. JSON-LD ----------
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

// ---------- 3. Sitemap ----------
function sitemapLastmod() {
  try {
    const dirty = execSync("git status --porcelain index.html").toString().trim();
    if (dirty) return today(); // index.html baru berubah di run ini
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
</urlset>
`;
}

// ---------- Jalankan ----------
const q = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let html = fs.readFileSync("index.html", "utf8");

const startM = "<!-- AUTO:CARDS:START -->";
const endM = "<!-- AUTO:CARDS:END -->";
const re = new RegExp(`(${q(startM)})[\\s\\S]*?(${q(endM)})`);
if (!re.test(html)) throw new Error("Marker AUTO:CARDS tidak ditemukan di index.html");
html = html.replace(re, (_, a, b) => `${a}\n${data.cards.map(renderCard).join("\n\n")}\n${b}`);

html = html.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, () => renderLd());

fs.writeFileSync("index.html", html);
fs.writeFileSync("sitemap.xml", renderSitemap());
console.log(`Build selesai: ${data.cards.length} kartu, ${data.offers.length} offer, sitemap diperbarui`);
