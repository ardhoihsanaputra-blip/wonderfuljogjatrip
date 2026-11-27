const fs = require("fs");

const IMAGE_EXT = /\.(webp|jpe?g|png)$/i;

// Kata umum yang tidak dipakai untuk mencocokkan gambar dengan topik
const STOPWORDS = new Set([
  "travel", "guide", "what", "see", "the", "of", "and", "to", "tour", "tours",
  "trip", "visit", "for", "from", "with", "its", "how", "best", "time", "in",
  "at", "a", "an", "java", "indonesia", "yogyakarta", "east", "central",
]);

function tokens(s) {
  return String(s)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "")
    .split(/[^a-z]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// Semua gambar di root repo, kecuali logo
function listImages() {
  return fs
    .readdirSync(".")
    .filter((f) => IMAGE_EXT.test(f) && !/^logo/i.test(f) && fs.statSync(f).isFile())
    .sort();
}

// Nama tempat dari keyword, misalnya "Borobudur Temple travel guide" menjadi "Borobudur Temple"
function placeName(keyword) {
  return String(keyword)
    .replace(/\s+(travel guide|what to see|guide)$/i, "")
    .trim();
}

// Hitung berapa kali setiap gambar sudah dipakai di artikel
function usageCounts(articles) {
  const counts = {};
  for (const a of articles) {
    if (a.image) counts[a.image] = (counts[a.image] || 0) + 1;
  }
  return counts;
}

// Pilih gambar: override manual dari topics.json jika ada, lalu cocokkan kata kunci,
// lalu prioritaskan gambar yang paling jarang dipakai
function pickImage(topic, articles = []) {
  if (topic.image && fs.existsSync(topic.image)) return topic.image;

  const images = listImages();
  if (!images.length) throw new Error("Tidak ada file gambar (.webp/.jpg/.png) di root repo");

  const keywordSet = new Set(tokens(topic.keyword));
  const used = usageCounts(articles);

  const scored = images.map((file) => ({
    file,
    score: tokens(file).filter((t) => keywordSet.has(t)).length,
    uses: used[file] || 0,
  }));

  scored.sort((a, b) => b.score - a.score || a.uses - b.uses || a.file.localeCompare(b.file));
  return scored[0].file;
}

// Alt text untuk gambar, dibuat dari nama tempat
function altText(topic) {
  if (topic.imageAlt) return topic.imageAlt;
  return `${placeName(topic.keyword)} in Yogyakarta, Indonesia`;
}

module.exports = { pickImage, altText, placeName, listImages };