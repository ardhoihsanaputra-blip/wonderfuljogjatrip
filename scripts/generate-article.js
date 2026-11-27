const fs = require("fs");

const API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.ARTICLE_MODEL || "openai/gpt-oss-120b";
const SITE = "https://wonderfultripjogja.com";
const BOOKING_URL = `${SITE}/#booking`;
const TODAY = new Date().toISOString().slice(0, 10);
const MAX_ATTEMPTS = 3;
const MAX_RATE_RETRIES = 5;

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

// Daftar harga resmi (hanya angka ini yang boleh muncul di artikel)
const allowedPrices = [
  ...new Set([...data.cards.map((c) => c.startPrice), ...data.offers.map((o) => o.price)]),
].sort((a, b) => a - b);
const allowedPriceList = allowedPrices.map((p) => "IDR " + p.toLocaleString("en-US")).join(", ");

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
- Prices: the ONLY prices you may write are these: ${allowedPriceList}. Write them exactly as "IDR 450,000". Do not write any other IDR amount.
- For Yogyakarta day tours, state that attraction entrance tickets are NOT included.
- Every trip includes a free beer for each participant. Mention it once, naturally.
- Mention that visitors should check current conditions with the operator before traveling.
- Length: 800 to 1000 words of body content. This is mandatory.
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

async function callModel(messages) {
  for (let tryNo = 1; tryNo <= MAX_RATE_RETRIES; tryNo++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 3000,
        response_format: { type: "json_object" },
        messages,
      }),
    });

    const json = await res.json();
    if (res.ok) return json.choices[0].message.content;

    const msg = json?.error?.message || "";
    const isRateLimit = res.status === 429 || json?.error?.code === "rate_limit_exceeded";

    if (isRateLimit && tryNo < MAX_RATE_RETRIES) {
      // Ambil angka detik dari pesan, misalnya "Please try again in 5.6775s"
      const m = msg.match(/try again in ([\d.]+)s/i);
      const waitSec = m ? Math.ceil(parseFloat(m[1])) + 2 : 15;
      console.log(`Rate limit, menunggu ${waitSec} detik (percobaan ${tryNo})`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      continue;
    }

    throw new Error("Groq API error: " + JSON.stringify(json));
  }
  throw new Error("Rate limit: percobaan habis");
}

function validate(a) {
  const problems = [];
  if (!a || !a.title || a.title.length > 70) problems.push(`title ${a?.title?.length ?? 0} karakter (maks 65)`);
  if (!a || !a.description || a.description.length < 70 || a.description.length > 165)
    problems.push(`description ${a?.description?.length ?? 0} karakter (110 sampai 155)`);
  if (!a || !a.bodyHtml) problems.push("bodyHtml kosong");

  const body = a?.bodyHtml || "";
  const words = body.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  if (words < 700 || words > 1300) problems.push(`jumlah kata ${words} (harus 800 sampai 1000)`);

  if (/<script|<iframe|<img|style=/i.test(body)) problems.push("tag terlarang ditemukan");
  if (!body.includes(BOOKING_URL)) problems.push("link booking tidak ada");

  // Regex hanya menangkap format angka ribuan, sehingga koma di akhir kalimat tidak ikut terbaca
  for (const m of body.matchAll(/IDR\s?(\d{1,3}(?:,\d{3})+)/g)) {
    const n = Number(m[1].replace(/,/g, ""));
    if (!allowedPrices.includes(n)) problems.push(`harga tidak dikenal: IDR ${m[1]}`);
  }
  return problems;
}

async function generateValidArticle() {
  const baseMessages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: userPrompt },
  ];

  let messages = [...baseMessages];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const raw = await callModel(messages);

    let article = null;
    let problems;
    try {
      article = JSON.parse(raw);
      problems = validate(article);
    } catch (e) {
      problems = ["output bukan JSON yang valid"];
    }

    if (!problems.length) return article;

    console.log(`Percobaan ${attempt} gagal: ${problems.join("; ")}`);
    if (attempt === MAX_ATTEMPTS) break;

    // Hanya kirim prompt awal + daftar masalah, tanpa jawaban lama, agar token tidak membengkak
    messages = [
      ...baseMessages,
      {
        role: "user",
        content: `Your previous output failed these checks: ${problems.join("; ")}. Write the COMPLETE JSON object again and fix every problem. The body must be 800 to 1000 words. Use only these prices: ${allowedPriceList}.`,
      },
    ];
  }

  throw new Error(`Artikel gagal validasi setelah ${MAX_ATTEMPTS} percobaan`);
}

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

const escAttr = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

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
  const article = await generateValidArticle();

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