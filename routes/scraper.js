const express = require("express");
const router = express.Router();
const scraperController = require("../controllers/scraperController");

// Routes following UniScrapperApi-style naming
router.post("/details", scraperController.getDetails);
router.get("/search/:query", scraperController.search);
router.get("/trending", scraperController.getTrending);
router.get("/categories", scraperController.getCategories);
router.get("/category/:query/:page", scraperController.search);
router.post("/streams", scraperController.getStreams);

module.exports = router;
