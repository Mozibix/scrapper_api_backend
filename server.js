const express = require("express");
const cors = require("cors");
const scraperRoutes = require("./routes/scraper");
const connectDB = require("./config/db");

require("dotenv").config(); // Load environment variables

const app = express();
const PORT = process.env.PORT || 4000;

// Enable CORS
app.use(cors());

// Parse JSON bodies
app.use(express.json());

connectDB();
// Log every request
app.use((req, res, next) => {
  const start = Date.now();

  // Log incoming request
  console.log("======================================");
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  if (Object.keys(req.body || {}).length > 0) {
    // console.log("🟢 Request Body:", JSON.stringify(req.body, null, 2));
  }

  // Capture response body
  const oldSend = res.send;
  res.send = function (body) {
    res.responseBody = body;
    return oldSend.apply(res, arguments);
  };

  // When response finishes
  res.on("finish", () => {
    const duration = Date.now() - start;
    console.log(`🔵 Status: ${res.statusCode} | ⏱️ ${duration}ms`);
    try {
      if (res.responseBody) {
        const parsed =
          typeof res.responseBody === "string"
            ? JSON.parse(res.responseBody)
            : res.responseBody;
        // console.log("🟣 Response Body:", JSON.stringify(parsed, null, 2));
      }
    } catch {
      // console.log("🟣 Response Body (raw):", res.responseBody);
    }
    console.log("======================================\n");
  });

  next();
});

// Default route for root
app.get("/", (req, res) => {
  res.send({
    message: "🚀 XFree Scraper API is running!",
    endpoints: {
      trending: "/api/trending",
      search: "/api/search/:query",
      details: "/api/details",
      categories: "/api/categories",
      category: "/api/category/:genre/:page",
      streams: "/api/streams",
    },
  });
});

// Main API routes

app.use("/api", scraperRoutes);

// Catch-all 404
app.use((req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
