const Video = require("../model/Video");
const fetchApi = require("../utils/fetchApi");

function slugifyTitle(title = "") {
  return title
    .toString()
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['"`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

// Helper function to shuffle the array (Fisher-Yates shuffle)
function shuffleArray(array) {
  const shuffled = [...array]; // Create a copy to avoid mutating original
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

class XFreeScraperController {
  BASE_URL = "https://www.xfree.com/prbn2";

  // 🟢 TRENDING
  getTrending = async (req, res) => {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1);
      const count = Math.max(Number(req.query.count) || 30, 1);
      const skip = (page - 1) * count;

      console.log(`Fetching trending videos: page ${page}, count ${count}`);

      // Try fetching from API first
      const url = `${this.BASE_URL}?count=${count * page}`;
      const data = await fetchApi(url);

      // If API returns empty or fails, switch to DB
      if (!Array.isArray(data) || data.length === 0) {
        console.log("API returned empty, switching to DB...");

        const videosFromDB = await Video.find().skip(skip).limit(count).lean();

        // Shuffle the videos from DB before returning
        const shuffledVideos = shuffleArray(videosFromDB);
        return res.json(shuffledVideos);
      }

      // Process API data
      let videosFromAPI = data.map((item) => {
        const slug = slugifyTitle(item.title || "");
        return {
          id: slug,
          title: item.title || "",
          poster: item.poster || "",
          video: item.video || "",
        };
      });

      // Save new videos to DB
      const existingIds = new Set(
        (await Video.find({ id: { $in: videosFromAPI.map((v) => v.id) } })).map(
          (video) => video.id
        )
      );

      const missingVideos = videosFromAPI.filter(
        (video) => !existingIds.has(video.id)
      );

      if (missingVideos.length > 0) {
        await Video.insertMany(missingVideos);
        console.log(`Inserted ${missingVideos.length} new videos into DB.`);
      }

      // Return paginated results
      const startIndex = skip;
      const endIndex = startIndex + count;
      const paginated = videosFromAPI.slice(startIndex, endIndex);

      return res.json(paginated);
    } catch (error) {
      console.error("getTrending error:", error);

      // Calculate skip in catch block
      const page = Math.max(Number(req.query.page) || 1, 1);
      const count = Math.max(Number(req.query.count) || 30, 1);
      const skip = (page - 1) * count;

      // Fallback to DB on any error
      const videosFromDB = await Video.find().skip(skip).limit(count).lean();

      // Shuffle the videos from DB before returning
      const shuffledVideos = shuffleArray(videosFromDB);
      return res.json(shuffledVideos);
    }
  };

  // 🔍 SEARCH
  search = async (req, res) => {
    try {
      const { query } = req.params;
      if (!query) return res.status(400).json({ message: "Query is required" });

      const count = Number(req.query.count) || 10;
      const page = Number(req.query.page) || 1;
      const skip = (page - 1) * count;

      console.log(`Searching for: "${query}", page ${page}`);

      // Try API first
      const apiUrl = `https://www.xfree.com/prbn2/?search=${query}&count=${count}&offset=${skip}`;
      const data = await fetchApi(apiUrl);

      // If API returns empty, switch to DB
      if (!Array.isArray(data) || data.length === 0) {
        console.log("API search returned empty, switching to DB...");

        const videosFromDB = await Video.find({
          title: { $regex: query, $options: "i" },
        })
          .skip(skip)
          .limit(count)
          .lean();

        // Shuffle the videos from DB before returning
        const shuffledVideos = shuffleArray(videosFromDB);
        return res.json(shuffledVideos);
      }

      // Process API results
      const videosFromAPI = data.map((item) => {
        const slug = slugifyTitle(item.title || "");
        return {
          id: slug,
          title: item.title || "",
          poster: item.poster || "",
          video: item.video || "",
        };
      });

      // Save to DB (upsert)
      if (videosFromAPI.length > 0) {
        await Video.bulkWrite(
          videosFromAPI.map((video) => ({
            updateOne: {
              filter: { id: video.id },
              update: { $setOnInsert: video },
              upsert: true,
            },
          }))
        );
      }

      // Shuffle the videos from API before returning
      const shuffledVideos = shuffleArray(videosFromAPI);
      return res.json(shuffledVideos);
    } catch (error) {
      console.error("search error:", error);

      // Calculate skip in catch block
      const count = Number(req.query.count) || 10;
      const page = Number(req.query.page) || 1;
      const skip = (page - 1) * count;

      // Fallback to DB
      const videosFromDB = await Video.find({
        title: { $regex: req.params.query, $options: "i" },
      })
        .skip(skip)
        .limit(count)
        .lean();

      // Shuffle the videos from DB before returning
      const shuffledVideos = shuffleArray(videosFromDB);
      return res.json(shuffledVideos);
    }
  };

  // 📄 GET DETAILS
  getDetails = async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ message: "id is required in body" });
      }

      console.log(`Fetching details for: ${id}`);

      // Try API first
      const data = await fetchApi(`${this.BASE_URL}?count=60`);

      // If API returns empty, switch to DB
      if (!Array.isArray(data) || data.length === 0) {
        console.log("API returned empty, fetching from DB...");

        let videoFromDB = await Video.findOne({ id }).lean();

        if (!videoFromDB) {
          videoFromDB = await Video.findOne({
            id: { $regex: id, $options: "i" },
          }).lean();
        }

        if (!videoFromDB) {
          return res.status(404).json({
            id,
            title: "Not Found",
            poster: "",
            suggestedVideo: [],
            seasons: [
              {
                title: "Video",
                poster: "",
                episodes: [{ id: "", title: "Not Found" }],
              },
            ],
            type: "movie",
          });
        }

        const suggestedVideos = await Video.find({
          id: { $ne: videoFromDB.id },
        })
          .limit(200)
          .lean();

        // Shuffle suggested videos
        const shuffledSuggested = shuffleArray(suggestedVideos);

        return res.json({
          id: videoFromDB.id,
          title: videoFromDB.title,
          poster: videoFromDB.poster,
          suggestedVideo: shuffledSuggested,
          seasons: [
            {
              title: "Video",
              poster: videoFromDB.poster,
              episodes: [
                {
                  id: videoFromDB.id,
                  title: videoFromDB.title,
                  video: videoFromDB.video || "",
                },
              ],
            },
          ],
          type: "movie",
        });
      }

      // Process API results
      const results = data.map((item) => ({
        id: slugifyTitle(item.title || ""),
        title: item.title || "",
        poster: item.poster || "",
        video: item.video || "",
      }));

      let videoFromAPI = results.find(
        (item) => item.id.toLowerCase() === id.toLowerCase()
      );

      if (!videoFromAPI) {
        videoFromAPI = results.find((item) =>
          item.id.toLowerCase().includes(id.toLowerCase())
        );
      }

      // If not found in API, try DB
      if (!videoFromAPI) {
        let videoFromDB = await Video.findOne({ id }).lean();

        if (!videoFromDB) {
          return res.status(404).json({
            id,
            title: "Not Found",
            poster: "",
            suggestedVideo: [],
            seasons: [
              {
                title: "Video",
                poster: "",
                episodes: [{ id: "", title: "Not Found" }],
              },
            ],
            type: "movie",
          });
        }

        const suggestedVideos = await Video.find({
          id: { $ne: videoFromDB.id },
        })
          .limit(200)
          .lean();

        // Shuffle suggested videos
        const shuffledSuggested = shuffleArray(suggestedVideos);

        return res.json({
          id: videoFromDB.id,
          title: videoFromDB.title,
          poster: videoFromDB.poster,
          suggestedVideo: shuffledSuggested,
          seasons: [
            {
              title: "Video",
              poster: videoFromDB.poster,
              episodes: [
                {
                  id: videoFromDB.id,
                  title: videoFromDB.title,
                  video: videoFromDB.video || "",
                },
              ],
            },
          ],
          type: "movie",
        });
      }

      // Save to DB
      const existsInDB = await Video.findOne({ id: videoFromAPI.id });
      if (!existsInDB) {
        await Video.create({
          id: videoFromAPI.id,
          title: videoFromAPI.title,
          poster: videoFromAPI.poster,
          video: videoFromAPI.video,
        });
      }

      const suggestedVideos = await Video.find({ id: { $ne: videoFromAPI.id } })
        .limit(200)
        .lean();

      // Shuffle suggested videos
      const shuffledSuggested = shuffleArray(suggestedVideos);

      return res.json({
        id: videoFromAPI.id,
        title: videoFromAPI.title,
        poster: videoFromAPI.poster,
        suggestedVideo: shuffledSuggested,
        seasons: [
          {
            title: "Video",
            poster: videoFromAPI.poster,
            episodes: [
              {
                id: videoFromAPI.id,
                title: videoFromAPI.title,
                video: videoFromAPI.video || "",
              },
            ],
          },
        ],
        type: "movie",
      });
    } catch (error) {
      console.error("getDetails error:", error);

      // Fallback to DB
      const videoFromDB = await Video.findOne({ id: req.body.id }).lean();

      if (!videoFromDB) {
        return res.status(404).json({ message: "Video not found" });
      }

      const suggestedVideos = await Video.find({ id: { $ne: videoFromDB.id } })
        .limit(200)
        .lean();

      // Shuffle suggested videos
      const shuffledSuggested = shuffleArray(suggestedVideos);

      return res.json({
        id: videoFromDB.id,
        title: videoFromDB.title,
        poster: videoFromDB.poster,
        suggestedVideo: shuffledSuggested,
        seasons: [
          {
            title: "Video",
            poster: videoFromDB.poster,
            episodes: [
              {
                id: videoFromDB.id,
                title: videoFromDB.title,
                video: videoFromDB.video || "",
              },
            ],
          },
        ],
        type: "movie",
      });
    }
  };

  // 🗂️ CATEGORIES
  getCategories = async (req, res) => {
    return res.json({
      categories: [],
    });
  };

  // 🎭 CATEGORY
  getCategory = async (req, res) => {
    const { genre, page } = req.params;

    try {
      console.log(`Fetching category: ${genre}, page: ${page}`);

      // Try API first
      const url = `https://www.xfree.com/search?q=${encodeURIComponent(
        genre
      )}&count=50`;
      const data = await fetchApi(url);

      // If API returns empty, switch to DB
      if (!Array.isArray(data) || data.length === 0) {
        console.log("API category returned empty, switching to DB...");

        const videosFromDB = await Video.find({
          title: { $regex: genre, $options: "i" },
        })
          .limit(50)
          .lean();

        // Shuffle the videos from DB before returning
        const shuffledVideos = shuffleArray(videosFromDB);
        return res.json(shuffledVideos);
      }

      // Process API results
      const videosFromAPI = await Promise.all(
        data.map(async (item) => {
          const slug = slugifyTitle(item.title || "");

          const exists = await Video.findOne({ id: slug });
          if (!exists) {
            await Video.create({
              id: slug,
              title: item.title || "",
              poster: item.poster || "",
              video: item.video || "",
            });
          }

          return {
            id: slug,
            title: item.title || "",
            poster: item.poster || "",
          };
        })
      );

      // Shuffle the videos from API before returning
      const shuffledVideos = shuffleArray(videosFromAPI);
      return res.json(shuffledVideos);
    } catch (error) {
      console.error("getCategory error:", error);

      // Fallback to DB
      const videosFromDB = await Video.find({
        title: { $regex: req.params.genre, $options: "i" },
      })
        .limit(50)
        .lean();

      // Shuffle the videos from DB before returning
      const shuffledVideos = shuffleArray(videosFromDB);
      return res.json(shuffledVideos);
    }
  };

  // 📺 STREAMS
  getStreams = async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ message: "id is required in body" });
      }

      console.log("Fetching streams for:", id);

      // Try DB first for streams
      let video = await Video.findOne({ id }).lean();

      // Try partial match if not found
      if (!video) {
        video = await Video.findOne({
          id: { $regex: id, $options: "i" },
        }).lean();
      }

      // If not in DB, try API
      if (!video) {
        const data = await fetchApi(`${this.BASE_URL}?count=100`);

        if (Array.isArray(data) && data.length > 0) {
          const results = data.map((item) => ({
            id: slugifyTitle(item.title || ""),
            title: item.title || "",
            poster: item.poster || "",
            video: item.video || "",
          }));

          video = results.find(
            (item) => item.id.toLowerCase() === id.toLowerCase()
          );

          if (!video) {
            video = results.find((item) =>
              item.id.toLowerCase().includes(id.toLowerCase())
            );
          }

          // Save to DB if found
          if (video) {
            const exists = await Video.findOne({ id: video.id });
            if (!exists) {
              await Video.create(video);
            }
          }
        }
      }

      // Return fallback if still not found
      if (!video) {
        return res.status(404).json({
          id,
          title: "Not Found",
          poster: "",
          streams: [],
          type: "movie",
        });
      }

      // Generate streams
      const baseUrl = video.video || "";
      const qualities = ["1080P", "720P", "480P"];
      const streams = qualities.map((q) => ({
        url: baseUrl.includes("?")
          ? `${baseUrl}&quality=${q}`
          : `${baseUrl}?quality=${q}`,
        quality: q,
        subtitles: [],
      }));

      return res.json(streams);
    } catch (error) {
      console.error("getStreams error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  };
}

module.exports = new XFreeScraperController();
