const { fetchURL } = require("./fetch-util.cjs");
const fs = require("fs");
const path = require("path");

const goguardiancats = JSON.parse(
  fs.readFileSync(path.join(__dirname, "json/goguardian.json"), "utf8")
);

function normalizeCategoryIds(payload) {
  if (!payload || typeof payload !== "object") return [];

  const ids = new Set();
  const maybeArrays = [payload.cats, payload.categories, payload.categoryIds];

  for (const arr of maybeArrays) {
    if (!Array.isArray(arr)) continue;
    for (const value of arr) {
      const num = Number(value);
      if (Number.isFinite(num)) ids.add(String(num));
    }
  }

  for (const key of ["categoryId", "blockedCategoryId", "cat"]) {
    const num = Number(payload[key]);
    if (Number.isFinite(num)) ids.add(String(num));
  }

  if (Array.isArray(payload.categories)) {
    for (const entry of payload.categories) {
      if (!entry || typeof entry !== "object") continue;

      for (const arr of [entry.cats, entry.categories, entry.categoryIds]) {
        if (!Array.isArray(arr)) continue;
        for (const value of arr) {
          const num = Number(value);
          if (Number.isFinite(num)) ids.add(String(num));
        }
      }

      for (const key of ["categoryId", "blockedCategoryId", "cat"]) {
        const num = Number(entry[key]);
        if (Number.isFinite(num)) ids.add(String(num));
      }
    }
  }

  return [...ids];
}

async function goguardian(urlToCheck) {
  try {
    const endpoint =
      "https://panther.goguardian.com/api/v1/ext/fullurl/categories?url=" +
      encodeURIComponent(urlToCheck.replace(/^https?:\/\//, ""));

    const response = await fetchURL(endpoint, {
      method: "GET",
      headers: {
        Authorization: "ccd522cc-ba45-4554-b0d8-567ebc8c38a3"
      }
    });

    const text = await response.text();
    const apiResponse = JSON.parse(text);
    const cats = normalizeCategoryIds(apiResponse);

    const pairs = cats
      .filter((cat) => goguardiancats[cat])
      .map((cat) => ({
        name: goguardiancats[cat][0],
        blocked: goguardiancats[cat][1]
      }));

    const catsName = pairs.map((p) => p.name);
    const shouldblocked = pairs.some((p) => p.blocked);

    return [catsName.join(", ") || "Unknown", shouldblocked];
  } catch (err) {
    console.warn("GoGuardian Error:", err);
    return "Error";
  }
}

module.exports = { goguardian };
