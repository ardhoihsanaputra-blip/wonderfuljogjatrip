const fs = require("fs");

const API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.ARTICLE_MODEL || "llama-3.3-70b-versatile";
const SITE = "https://wonderfultripjogja.com";
const BOOKING_URL = `${SITE}/#booking`;
const TODAY = new Date().toISOString().slice(0, 10);

if (!API_KEY) throw new Error("GROQ_API_KEY belum diset di GitHub Secrets");

const data = JSON.parse(fs.readFileSync("data/packages.json", "utf8"));
const topics = JSON.parse(fs.readFileSync("data/topics.json", "utf8"));
const articles = JSON.parse(fs.readFileSync("data/articles.json", "utf8"));

// Pilih topik pertama yang belum pernah dipakai
const topic = topics.queue.find((t) => !articles.some((a) => a.keyword === t.keyword));
if (!topic) {
  console.log("Antrian topik kosong. Tambahkan topik baru di data/topics.json");
  process.exit(0);
}

// Daftar harga yang boleh muncul di artikel (diambil dari data resmi)
const allowedPrices = new Set([
  ...data.cards.map((c) => c.startPrice),
  ...data.offers.map((o) => o.price),
]);

const packageSummary = data.cards
  .map(
    (c) =>
      `- ${c.name}: starting from IDR ${c.startPrice.toLocaleString("en-US")}/pax, pickup ${c.pickup.join(", ")}${
        c.hotel ? ", includes 2–3 star hotel" : ", entrance tickets NOT included"
      }`
  )
  .join("\n");

const SYSTEM = `You write travel articles for Wonderful Trip Jogja, a tour operator in Yogyakarta, Indonesia.
Audience: foreign tourists planning a trip to Java.
Rules:
- Be accurate and practical. Never invent prices, opening hours, policies, or statistics.
- Only use prices from the package list provided. Write them as "IDR 450,000".
- For Yogyakarta day tours, state that attraction entrance tickets are NOT included.
- Every trip includes a free beer for each participant. Mention it once, naturally.
- Mention that visitors should check current conditions with the operator before traveling.
- Length: 700 to 1000 words of body content.
- Use only these HTML tags in bodyHtml: h2, h3, p, ul, li, strong, a. No scripts, no images, no inline styles.
- Include one link to ${SITE}/#packages and one call to action linking to ${BOOKING_URL}.
- Write in English.
Output: ONLY a JSON object with exactly these keys:
"title" (string, max 65 characters), "description" (string, 110 to 155 characters), "bodyHtml" (string containing the HTML body).`;

const userPrompt = `Topic keyword: ${topic.keyword}
Angle: ${topic.angle}

Our packages:
${packageSummary}

Write the article now.`;

async function callModel() {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.4,
      max_tokens: 4000,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error("Groq API error: " + JSON.stringify(json));
  const text = json.choices[0].message.content;
  return JSON.parse(text);
}

function validate(a) {
  const problems = [];
  if (!a.title || a.title.length > 70) problems.push(`title ${a.title?.length} karakter`);
  if (!a.description || a.description.length < 70 || a.description.length > 165)
    problems.push(`description ${a.description?.length} karakter`);
  if (!a.bodyHtml) problems.push("bodyHtml kosong");

  const words = (a.bodyHtml || "").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  if (words < 600 || words > 1300) problems.push(`jumlah kata ${words}`);

  if (/<script|<iframe|<img|style=/i.test(a.bodyHtml || "")) problems.push("tag terlarang ditemukan");
  if (!(a.bodyHtml || "").includes(BOOKING_URL)) problems.push("link booking tidak ada");

  for (const m of (a.bodyHtml || "").matchAll(/IDR\s?([\d.,]+)/g)) {
    const n = Number(m[1].replace(/[.,]/g, ""));
    if (!allowedPrices.has(n)) problems.push(`harga tidak dikenal: IDR ${m[1]}`);
  }
  return problems;
}

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

const escAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

function renderPage(a, slug) {
  const url = `${SITE}/articles/${slug}.html`;
  const ld = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description: a.description,
    datePublished: TODAY,
    dateModified: TODAY,
    author: { "@type": "Organization", name: "Wonderful Trip Jogja" },
    publisher: {
      "@type": "Organization",
      name: "Wonderful Trip Jogja",
      logo: { "@type": "ImageObject", url: `${SITE}/logo.png` },
    },
    mainEntityOfPage: url,
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escAttr(a.title)}</title>
<meta name="description" content="${escAttr(a.description)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:title" content="${escAttr(a.title)}">
<meta property="og:description" content="${escAttr(a.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/borobudur-sunrise-1.webp">
<link rel="icon" href="/logo.png" sizes="64x64" type="image/png">
<script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
</script>
<style>
body{font:17px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0c1b33;margin:0;background:#f4f7fb}
.w{max-width:760px;margin:auto;padding:24px 18px 60px;background:#fff}
a{color:#0f52ba}
h1{font-size:2rem;line-height:1.2}
h2{margin-top:2em}
.back{font-weight:700;display:inline-block;margin-bottom:12px}
.cta{display:inline-block;background:#15803d;color:#fff;padding:12px 24px;border-radius:6px;font-weight:700;text-decoration:none}
</style>
</head>
<body>
<div class="w">
<a class="back" href="${SITE}/">← Wonderful Trip Jogja</a>
<h1>${escAttr(a.title)}</h1>
<p><small>Published ${TODAY}</small></p>
${a.bodyHtml}
<p><a class="cta" href="${BOOKING_URL}">Check prices &amp; book on WhatsApp</a></p>
</div>
</body>
</html>
`;
}

(async () => {
  const article = await callModel();
  const problems = validate(article);
  if (problems.length) {
    console.error("Artikel gagal validasi:\n- " + problems.join("\n- "));
    process.exit(1);
  }

  const slug = `${TODAY}-${slugify(topic.keyword)}`;
  fs.mkdirSync("articles", { recursive: true });
  fs.writeFileSync(`articles/${slug}.html`, renderPage(article, slug));

  articles.unshift({
    keyword: topic.keyword,
    slug,
    title: article.title,
    description: article.description,
    date: TODAY,
  });
  fs.writeFileSync("data/articles.json", JSON.stringify(articles, null, 2) + "\n");

  console.log(`Artikel dibuat: articles/${slug}.html`);
})();