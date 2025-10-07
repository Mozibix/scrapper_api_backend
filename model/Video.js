const mongoose = require("mongoose");

const videoSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  title: String,
  poster: String,
  video: String,
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Video", videoSchema);
