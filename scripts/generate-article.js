const fs = require("fs");

const API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.ARTICLE_MODEL || "openai/gpt-oss-120b";
const SITE = "https://wonderfultripjogja.com";
const BOOKING_URL = `${SITE}/#booking`;
const PACKAGES_URL = `${SITE}/#packages`;
const TODAY = new Date().toISOString().slice(0, 10);
const MAX_ATTEMPTS = 3;
const MAX_API_RETRIES = 5;
const MIN_WORDS = 220;
const MAX_WORDS = 450;

if (!API_KEY) throw new Error("GROQ_API_KEY belum diset di GitHub Secrets");

const topicsFile = JSON.parse(fs.readFileSync("data/topics.json", "utf8"));
const articles = JSON.parse(fs.readFileSync("data/articles.json", "utf8"));

// Daftar paket hanya untuk konteks nama destinasi, tanpa harga
const data = JSON.parse(fs.readFileSync("data/packages.json", "utf8"));
const destinationList = data.cards.map((c) => c.name).join("; ");

const SYSTEM = `You write SHORT travel blog posts for Wonderful Trip Jogja, a tour operator in Yogyakarta, Indonesia.
Audience: foreign tourists.

Rules:
- Focus on ONE destination only: the topic keyword. Do not drift into other destinations or general Java travel.
- Tell the reader about the place: what it is, what to see, the atmosphere, the best time to visit, and one or two practical visiting tips.
- Keep facts general. Never invent opening hours, prices, statistics, or policies.
- Do NOT talk about tour packages, inclusions, exclusions, tickets, prices, costs, beer, hotels, or booking details.
- Never write these words: included, excluded, inclusion, exclusion, ticket, tickets, beer, price, IDR, Rp.
- Length: 250 to 380 words of body content. Keep it short and focused.
- Structure: one <h2> heading, then 3 or 4 short <p> paragraphs. You may add one <ul> with at most 3 <li> items.
- Use only these HTML tags in bodyHtml: h2, p, ul, li, strong, a. No scripts, no images, no inline styles.
- Inside bodyHtml, write every double quote as &quot; so the JSON stays valid.
- Include one link to ${PACKAGES_URL} inside the text, naturally.
- End with one short sentence containing a link to ${BOOKING_URL} that invites the reader to ask about a tour.
- Write in English.

Output: ONLY a single JSON object with exactly these keys, and nothing before or after it:
"title" (string, max 65 characters), "description" (string, 110 to 155 characters), "bodyHtml" (string containing the HTML body).`;

function buildUserPrompt(topic) {
  return `Topic keyword (the ONE destination to write about): ${topic.keyword}
Angle: ${topic.angle}

Our tour names for reference only (do not list them or their prices): ${destinationList}

Write the short article now.`;
}

async function callModel(messages, maxTokens = 2000) {
  for (let tryNo = 1; tryNo <= MAX_API_RETRIES; tryNo++) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        messages,
      }),
    });

    const json = await res.json();
    if (res.ok) return json.choices[0].message.content;

    const msg = json?.error?.message || "";
    const code = json?.error?.code || "";
    const isRateLimit = res.status === 429 || code === "rate_limit_exceeded";
    const isBadJson = code === "json_validate_failed";

    if ((isRateLimit || isBadJson) && tryNo < MAX_API_RETRIES) {
      let waitSec = 3;
      if (isRateLimit) {
        const m = msg.match(/try again in ([\d.]+)s/i);
        waitSec = m ? Math.ceil(parseFloat(m[1])) + 2 : 15;
      }
      console.log(
        `${isRateLimit ? "Rate limit" : "JSON tidak valid"}, mencoba ulang dalam ${waitSec} detik (percobaan ${tryNo})`
      );
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      continue;
    }

    throw new Error("Groq API error: " + JSON.stringify(json));
  }
  throw new Error("Percobaan API habis");
}

// Mengambil objek JSON dari teks, termasuk jika model menambahkan penjelasan di sekitarnya
function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch (e) {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw e;
  }
}

function pickTopic() {
  return topicsFile.queue.find((t) => !articles.some((a) => a.keyword === t.keyword));
}

// Meminta ide topik baru (satu destinasi per topik) saat antrian habis
async function refillTopics() {
  const used = new Set(
    [...topicsFile.queue.map((t) => t.keyword), ...articles.map((a) => a.keyword)].map((k) => k.toLowerCase())
  );
  const raw = await callModel(
    [
      {
        role: "system",
        content:
          "You suggest blog topics for a Yogyakarta tour operator aimed at foreign tourists. Output ONLY a JSON object.",
      },
      {
        role: "user",
        content: `Suggest 8 new English blog topics. Each topic must focus on ONE single place in Java, such as a temple, a cave, a volcano, a waterfall, a crater, a village, or a market in Yogyakarta, Central Java, or East Java. Do not suggest general travel tips, itineraries, or comparisons. Avoid these existing keywords: ${[...used].join("; ")}.
Return JSON exactly in this form: {"queue":[{"keyword":"Name of the place plus 'travel guide' or 'what to see'","angle":"one sentence on what to say about this single place"}]}`,
      },
    ],
    1500
  );

  const parsed = parseJson(raw);
  const list = Array.isArray(parsed.queue) ? parsed.queue : [];
  const seen = new Set();
  return list
    .filter((t) => t && typeof t.keyword === "string" && typeof t.angle === "string")
    .filter((t) => {
      const k = t.keyword.toLowerCase();
      if (used.has(k) || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8);
}

function validate(a) {
  const problems = [];
  if (!a || !a.title || a.title.length > 70) problems.push(`title ${a?.title?.length ?? 0} karakter (maks 65)`);
  if (!a || !a.description || a.description.length < 70 || a.description.length > 165)
    problems.push(`description ${a?.description?.length ?? 0} karakter (110 sampai 155)`);
  if (!a || !a.bodyHtml) problems.push("bodyHtml kosong");

  const body = a?.bodyHtml || "";
  const words = body.replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
  if (words < MIN_WORDS || words > MAX_WORDS)
    problems.push(`jumlah kata ${words} (harus ${MIN_WORDS} sampai ${MAX_WORDS})`);

  if (/<script|<iframe|<img|style=/i.test(body)) problems.push("tag terlarang ditemukan");
  if (!body.includes(BOOKING_URL)) problems.push("link booking tidak ada");
  if (!body.includes(PACKAGES_URL)) problems.push("link paket tidak ada");

  const banned = body.match(/\b(includ\w*|exclud\w*|tickets?|beer|price\w*|cost\w*|IDR|Rp)\b/gi);
  if (banned) problems.push(`kata terlarang: ${[...new Set(banned)].join(", ")}`);

  return problems;
}

async function generateValidArticle(topic) {
  const baseMessages = [
    { role: "system", content: SYSTEM },
    { role: "user", content: buildUserPrompt(topic) },
  ];
  let messages = [...baseMessages];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const raw = await callModel(messages);

    let article = null;
    let problems;
    try {
      article = parseJson(raw);
      problems = validate(article);
    } catch (e) {
      problems = ["output bukan JSON yang valid"];
    }

    if (!problems.length) return article;

    console.log(`Percobaan ${attempt} gagal: ${problems.join("; ")}`);
    if (attempt === MAX_ATTEMPTS) break;

    messages = [
      ...baseMessages,
      {
        role: "user",
        content: `Your previous output failed these checks: ${problems.join("; ")}. Write the COMPLETE JSON object again. Keep the body between ${MIN_WORDS} and ${MAX_WORDS} words, focus only on the one destination, do not mention inclusions, tickets, beer, or prices, and escape all double quotes inside bodyHtml.`,
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
.w{max-width:720px;margin:auto;padding:24px 18px 60px;background:#fff}
a{color:#0f52ba}
h1{font-size:2rem;line-height:1.2}
h2{margin-top:1.6em}
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
<p><a class="cta" href="${BOOKING_URL}">Ask about a tour on WhatsApp</a></p>
</div>
</body>
</html>
`;
}

(async () => {
  let topic = pickTopic();

  if (!topic) {
    console.log("Antrian topik habis, meminta ide topik baru...");
    const fresh = await refillTopics();
    if (!fresh.length) {
      console.log("Tidak ada topik baru yang valid. Berhenti tanpa membuat artikel.");
      process.exit(0);
    }
    topicsFile.queue.push(...fresh);
    fs.writeFileSync("data/topics.json", JSON.stringify(topicsFile, null, 2) + "\n");
    topic = pickTopic();
    console.log(`Antrian diisi ulang dengan ${fresh.length} topik baru.`);
  }

  const article = await generateValidArticle(topic);

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
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});