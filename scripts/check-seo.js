const fs = require("fs");

const data = JSON.parse(fs.readFileSync("data/packages.json", "utf8"));
const SITE = data.site;
const errors = [];
const warnings = [];

const html = fs.readFileSync("index.html", "utf8");
const robots = fs.readFileSync("robots.txt", "utf8");
const sitemap = fs.readFileSync("sitemap.xml", "utf8");

// Head
const title = html.match(/<title>([^<]+)<\/title>/);
if (!title) errors.push("<title> tidak ada");
else if (title[1].length > 70) warnings.push(`Title ${title[1].length} karakter`);

const desc = html.match(/<meta name="description" content="([^"]+)"/);
if (!desc) errors.push("meta description tidak ada");
else if (desc[1].length < 70 || desc[1].length > 165)
  warnings.push(`Meta description ${desc[1].length} karakter (disarankan 70–165)`);

if (!html.includes(`<link rel="canonical" href="${SITE}/">`)) errors.push("canonical tidak sesuai");
if (/<meta name="robots"[^>]*noindex/i.test(html)) errors.push("index.html memiliki noindex");
if (!/<meta property="og:image"/.test(html)) errors.push("og:image tidak ada");

// JSON-LD
const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
if (!ld) errors.push("JSON-LD tidak ada");
else {
  try { JSON.parse(ld[1]); } catch (e) { errors.push("JSON-LD tidak valid: " + e.message); }
}

// Kartu statis
const block = html.match(/<!-- AUTO:CARDS:START -->([\s\S]*?)<!-- AUTO:CARDS:END -->/);
if (!block) errors.push("Marker AUTO:CARDS tidak ada");
else {
  const count = (block[1].match(/<article class="tk/g) || []).length;
  if (count !== data.cards.length)
    errors.push(`Jumlah kartu ${count}, seharusnya ${data.cards.length}`);
}

// Gambar
for (const m of html.matchAll(/<img\b[^>]*>/gi))
  if (!/\salt="/.test(m[0])) errors.push("<img> tanpa alt: " + m[0].slice(0, 60));
for (const m of html.matchAll(/(?:src|data-src)="([^"]+\.(?:webp|png))"/gi))
  if (!fs.existsSync(m[1])) errors.push("File gambar tidak ada: " + m[1]);

// Harga harus sama dengan array P di kalkulator
const pBlock = html.match(/var P=\[([\s\S]*?)\n\];/);
if (!pBlock) errors.push("Array P tidak ditemukan di script");
else {
  const jsPrices = new Set([...pBlock[1].matchAll(/\b\d{6,8}\b/g)].map((m) => Number(m[0])));
  for (const c of data.cards)
    if (!jsPrices.has(c.startPrice)) errors.push(`Harga kartu "${c.name}" (${c.startPrice}) tidak ada di kalkulator`);
  for (const o of data.offers)
    if (!jsPrices.has(o.price)) errors.push(`Harga "${o.name}" (${o.price}) tidak ada di kalkulator`);
}

// robots.txt
if (!robots.includes(`Sitemap: ${SITE}/sitemap.xml`)) errors.push("robots.txt: baris Sitemap salah");
if (/Disallow:\s*\/\s*$/m.test(robots)) errors.push("robots.txt memblokir seluruh situs");

// sitemap.xml
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (!locs.length) errors.push("sitemap.xml kosong");
if (!locs.every((u) => u.startsWith(SITE))) errors.push("sitemap.xml: ada domain yang salah");
if (!/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sitemap)) errors.push("lastmod tidak valid");
for (const m of sitemap.matchAll(/<image:loc>([^<]+)<\/image:loc>/g)) {
  const f = m[1].replace(SITE + "/", "");
  if (!fs.existsSync(f)) errors.push("Gambar di sitemap tidak ada: " + f);
}

// Status HTTP (hanya peringatan, karena situs mungkin belum live)
(async () => {
  for (const u of locs) {
    try {
      const r = await fetch(u, { method: "HEAD", redirect: "manual" });
      if (r.status !== 200) warnings.push(`${u} mengembalikan status ${r.status}`);
      else console.log(`✅ ${u} → 200`);
    } catch (e) {
      warnings.push(`${u} tidak bisa diakses: ${e.message}`);
    }
  }
  warnings.forEach((w) => console.warn("⚠️  " + w));
  errors.forEach((e) => console.error("❌ " + e));
  if (errors.length) process.exit(1);
  console.log("✅ Semua pemeriksaan SEO lolos");
})();
