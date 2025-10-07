const puppeteer = require("puppeteer");

async function fetchApi(url) {
  console.log("Fetching URL:", url);

  try {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"
    );

    await page.goto(url, { waitUntil: "networkidle2" });

    // Extract JSON from <pre> tag
    const content = await page.$eval("pre", (el) => el.textContent);

    await browser.close();

    const data = JSON.parse(content); // convert string to JSON

    return data;
  } catch (error) {
    console.error("Fetch API error:", error.message);
    return [];
  }
}

module.exports = fetchApi;
