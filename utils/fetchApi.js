const puppeteer = require("puppeteer");

async function fetchApi(url) {
  console.log("Fetching URL:", url);

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"], // Add these for better compatibility
    });
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
    );

    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

    // Extract JSON from <pre> tag
    const content = await page.$eval("pre", (el) => el.textContent);

    await browser.close();

    const data = JSON.parse(content);

    return data;
  } catch (error) {
    console.error("Fetch API error:", error.message);

    // Return empty array on ANY error (including Chrome not found)
    // This triggers the DB fallback in the controller
    return [];
  }
}

module.exports = fetchApi;
