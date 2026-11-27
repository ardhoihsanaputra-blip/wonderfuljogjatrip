const fs = require("fs");
const { pickImage, altText } = require("./image-picker");

const articles = JSON.parse(fs.readFileSync("data/articles.json", "utf8"));
let changed = 0;

for (const a of articles) {
  const file = `articles/${a.slug}.html`;
  if (!fs.existsSync(file)) {
    console.log(`Lewati (file tidak ada): ${file}`);
    continue;
  }

  let html = fs.readFileSync(file, "utf8");
  if (html.includes('class="hero"') || html.includes(`alt="${a.keyword}`) || /<img\s/.test(html)) {
    continue;
  }

  // Gambar dipilih berdasarkan keyword, dan hitungan pemakaian diperbarui
  const image = a.image && fs.existsSync(a.image) ? a.image : pickImage({ keyword: a.keyword }, articles);
  const imgAlt = altText({ keyword: a.keyword });
  const SITE = "https://wonderfultripjogja.com";

  const imgTag = `<img src="${SITE}/${image}" alt="${imgAlt.replace(/"/g, "&quot;")}" width="1200" height="800" loading="eager" decoding="async" style="display:block;width:100%;height:auto;border-radius:10px;margin:16px 0">`;

  const updated = html.replace(/(<p><small>Published [^<]*<\/small><\/p>)/, `$1\n${imgTag}`);
  if (updated === html) {
    console.log(`Gagal menyisipkan gambar: ${file}`);
    continue;
  }

  fs.writeFileSync(file, updated);
  a.image = image;
  changed++;
  console.log(`Gambar ditambahkan: ${file} -> ${image}`);
}

fs.writeFileSync("data/articles.json", JSON.stringify(articles, null, 2) + "\n");
console.log(`Selesai. ${changed} artikel diperbarui.`);