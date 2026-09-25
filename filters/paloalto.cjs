const { fetchURL } = require("./fetch-util.cjs");
const fs = require("fs");
const path = require("path");
const paloblocked = JSON.parse(
  fs.readFileSync(path.join(__dirname, "json/paloblocked.json"), "utf8")
);

async function palo(targetUrl) {
  try {
    const encoded = encodeURIComponent(targetUrl);
    const url = `https://urlfiltering.paloaltonetworks.com/single_cr/?url=${encoded}`;

    const resp = await fetchURL(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json,text/html,*/*",
        Referer: "https://urlfiltering.paloaltonetworks.com/",
      },
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }

    let text = await resp.text();

    text = text.replace(/[\t\n\r\f\v]+/g, "");
    text = text.replace(/ {2,}/g, " ");
    const legacyMatch = text.match(
      /Current Category<\/label>\s*<div class=" col-sm-10 col-lg-10 form-text">\s*([^<]+)\s*</i
    );
    const inlineMatch = text.match(/Current Category[^]*?form-text">\s*([^<]+)\s*</i);
    const fixedcategory = (legacyMatch?.[1] || inlineMatch?.[1] || "")
      .replace(/<[^>]*>/g, "")
      .trim();

    if (!fixedcategory) {
      return ["Unavailable (response changed)", true];
    }

    const categories = fixedcategory.split(",").map((c) => c.trim());

    const blocked = categories.some((cat) => paloblocked.includes(cat));

    return [fixedcategory, !blocked];
  } catch (err) {
    console.warn("Palo Error: " + err);
    return ["Unavailable (request failed)", true];
  }
}

module.exports = { palo };
