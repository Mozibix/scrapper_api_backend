const { Impit } = require("impit");
const cheerio = require("cheerio");

const fetchApi = async (url) => {
  console.log("Fetching URL:", url);

  try {
    const impit = new Impit({
      browser: "chrome", // simulate Chrome user agent + headers
      ignoreTlsErrors: true, // ignore SSL certificate issues
      timeout: 30000, // 30 seconds timeout
    });

    const response = await impit.fetch(url);
    const html = await response.text();

    // 1️⃣ Try: raw JSON response (some APIs return JSON directly)
    try {
      return JSON.parse(html);
    } catch {
      // 2️⃣ If not JSON, try extracting <pre> content
      const $ = cheerio.load(html);
      const preText = $("pre").text().trim();

      if (preText) {
        try {
          return JSON.parse(preText);
        } catch (err) {
          console.error("Error parsing <pre> JSON:", err.message);
          return [];
        }
      }

      // 3️⃣ No data found
      return [];
    }
  } catch (error) {
    console.error("Fetch API error:", error.message);
    return [];
  }
};

module.exports = fetchApi;
