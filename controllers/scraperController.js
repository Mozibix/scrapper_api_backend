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

class XFreeScraperController {
  BASE_URL = "https://www.xfree.com/prbn2";

  // 🟢 TRENDING
  getTrending = async (req, res) => {
    try {
      const count = Number(req.query.count) || 50;
      let videosFromDB = await Video.find().limit(count).lean();

      // If not enough data, we need to scrape more
      let totalFetched = videosFromDB.length;

      while (totalFetched < count) {
        const url = `${this.BASE_URL}?count=${count}`;
        const data = await fetchApi(url);

        const newVideos = Array.isArray(data)
          ? await Promise.all(
              data.map(async (item) => {
                const slug = slugifyTitle(item.title || "");

                // Save to DB if not already there
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
            )
          : [];

        // Add new videos to the fetched list
        videosFromDB = [...videosFromDB, ...newVideos];
        totalFetched = videosFromDB.length;

        if (totalFetched >= count) break;
      }

      return res.json(videosFromDB.slice(0, count));
    } catch (error) {
      console.error("getTrending error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  };

  // 🔍 SEARCH
  search = async (req, res) => {
    try {
      const { query } = req.params;
      if (!query) return res.status(400).json({ message: "Query is required" });

      const count = Number(req.query.count) || 50;
      const page = Number(req.query.page) || 1;
      const skip = (page - 1) * count;

      let videosFromDB = await Video.find({
        title: { $regex: query, $options: "i" },
      })
        .skip(skip)
        .limit(count)
        .lean();

      // If no exact match or partial match found, try a more flexible search
      if (videosFromDB.length < 1) {
        console.log("No exact match found, performing a flexible search...");

        // Perform a more flexible search using similar titles
        videosFromDB = await Video.find({
          title: { $regex: `.*${query}.*`, $options: "i" },
        })
          .skip(skip)
          .limit(count)
          .lean();
      }

      // If still no results found, return an empty array
      if (videosFromDB.length < 1) {
        await this.fetchAndSaveMoreData();

        return res.json([]); // Return empty if no matches found
      }

      // Return the result up to the requested count
      return res.json(videosFromDB.slice(0, count));
    } catch (error) {
      console.error("search error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  };

  getDetails = async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ message: "id is required in body" });
      }

      // 1️⃣ Try fetching from DB first
      let videoFromDB = await Video.findOne({ id }).lean();

      // 2️⃣ If not found in DB, fetch more data from external API
      if (!videoFromDB) {
        // 3️⃣ Fetch data from the external source
        const data = await fetchApi(`${this.BASE_URL}?count=60`);
        if (!Array.isArray(data) || data.length === 0) {
          return res
            .status(500)
            .json({ message: "No data returned from source" });
        }

        // 4️⃣ Normalize all items with slug ids
        const results = data.map((item) => ({
          id: slugifyTitle(item.title || ""),
          title: item.title || "",
          poster: item.poster || "",
          video: item.video || "",
        }));

        // 5️⃣ Try to find exact match first
        videoFromDB = results.find(
          (item) => item.id.toLowerCase() === id.toLowerCase()
        );

        // 6️⃣ If not found, try a partial match
        if (!videoFromDB) {
          videoFromDB = results.find((item) =>
            item.id.toLowerCase().includes(id.toLowerCase())
          );
        }

        // 7️⃣ If still not found, return fallback response
        if (!videoFromDB) {
          const fallback = {
            id,
            title: "Not Found - fallback",
            poster: "",
            suggestedVideo: [],
            seasons: [
              {
                title: "Video",
                poster: "",
                episodes: [{ id: "", title: "Not Found - fallback" }],
              },
            ],
            type: "movie",
          };
          // Fetch and save additional data to DB after fallback
          await this.fetchAndSaveMoreData();
          return res.status(200).json(fallback);
        }

        // 8️⃣ Save the found data to the database if it doesn't already exist
        const exists = await Video.findOne({ id: videoFromDB.id });
        if (!exists) {
          await Video.create({
            id: videoFromDB.id,
            title: videoFromDB.title,
            poster: videoFromDB.poster,
            video: videoFromDB.video,
          });
        }
      }

      // 9️⃣ Create suggested videos (excluding the found one)
      const suggestedVideos = await Video.find({ id: { $ne: videoFromDB.id } })
        .limit(4)
        .lean();

      // 🔟 Build the response structure
      const details = {
        id: videoFromDB.id,
        title: videoFromDB.title,
        poster: videoFromDB.poster,
        suggestedVideo: suggestedVideos,
        seasons: [
          {
            title: "Video",
            poster: videoFromDB.poster,
            episodes: [
              {
                id: videoFromDB.id,
                title: videoFromDB.title,
                video:
                  videoFromDB.video ||
                  "https://cdn77.hqmediago.com/files/czechsnooper.com/e007/thumbnail-hq.mp4",
              },
            ],
          },
        ],
        type: "movie",
      };

      return res.json(details);
    } catch (error) {
      console.error("getDetails error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  };

  // Helper function to fetch and update DB with more data
  fetchAndSaveMoreData = async () => {
    try {
      const data = await fetchApi(`${this.BASE_URL}?count=60`);
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("No data returned from external source");
      }

      const results = data.map((item) => ({
        id: slugifyTitle(item.title || ""),
        title: item.title || "",
        poster: item.poster || "",
        video: item.video || "",
      }));

      // Save to DB
      await Promise.all(
        results.map(async (item) => {
          const exists = await Video.findOne({ id: item.id });
          if (!exists) {
            await Video.create({
              id: item.id,
              title: item.title,
              poster: item.poster,
              video: item.video,
            });
          }
        })
      );
    } catch (error) {
      console.error("fetchAndSaveMoreData error:", error);
    }
  };

  // 🗂️ CATEGORIES
  getCategories = async (req, res) => {
    return res.json({
      categories: [
        "Action",
        "Adventure",
        "Animation",
        "Comedy",
        "Crime",
        "Documentary",
        "Drama",
        "Family",
        "Fantasy",
        "History",
        "Horror",
        "Music",
        "Mystery",
        "Romance",
        "Science Fiction",
        "TV Movie",
        "Thriller",
        "War",
        "Western",
      ],
    });
  };

  // 🎭 CATEGORY (genre & page)
  getCategory = async (req, res) => {
    const { genre, page } = req.params;
    const searchQuery = page == 2 ? "Demon Slayer" : genre;

    try {
      let videosFromDB = await Video.find({
        title: { $regex: searchQuery, $options: "i" },
      })
        .limit(50)
        .lean();

      let totalFetched = videosFromDB.length;

      while (totalFetched < 50) {
        const url = `https://www.xfree.com/search?q=${encodeURIComponent(
          searchQuery
        )}&count=50`;
        const data = await fetchApi(url);

        const newVideos = Array.isArray(data)
          ? await Promise.all(
              data.map(async (item) => {
                const slug = slugifyTitle(item.title || "");

                // Save to DB if not already there
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
            )
          : [];

        videosFromDB = [...videosFromDB, ...newVideos];
        totalFetched = videosFromDB.length;

        if (totalFetched >= 50) break;
      }

      return res.json(videosFromDB);
    } catch (error) {
      console.error("getCategory error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  };

  // 📺 STREAMS: Fetch video streams for a given id
  getStreams = async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) {
        return res.status(400).json({ message: "id is required in body" });
      }

      console.log("Fetching streams for:", id);

      // 1️⃣ Try fetching from DB first
      let videoFromDB = await Video.findOne({ id }).lean();

      // 2️⃣ If not found in DB, fetch more data from external API
      if (!videoFromDB) {
        // 3️⃣ Fetch data from the external source
        const data = await fetchApi(`${this.BASE_URL}?count=100`);
        if (!Array.isArray(data) || data.length === 0) {
          return res
            .status(500)
            .json({ message: "No data returned from source" });
        }

        // 4️⃣ Normalize all items with slug ids
        const results = data.map((item) => ({
          id: slugifyTitle(item.title || ""),
          title: item.title || "",
          poster: item.poster || "",
          video: item.video || "",
          link: item.link || "", // assuming `link` field is present in the data
        }));

        // 5️⃣ Try to find exact match first
        videoFromDB = results.find(
          (item) => item.id.toLowerCase() === id.toLowerCase()
        );

        // 6️⃣ If not found, try a partial match
        if (!videoFromDB) {
          videoFromDB = results.find((item) =>
            item.id.toLowerCase().includes(id.toLowerCase())
          );
        }

        // 7️⃣ If still not found, return fallback response
        if (!videoFromDB) {
          const fallback = {
            id,
            title: "Not Found - fallback",
            poster: "",
            streams: [],
            type: "movie",
          };
          // Fetch and save additional data to DB after fallback
          await this.fetchAndSaveMoreData();
          return res.status(200).json(fallback);
        }

        // 8️⃣ Save the found data to the database if it doesn't already exist
        const exists = await Video.findOne({ id: videoFromDB.id });
        if (!exists) {
          await Video.create({
            id: videoFromDB.id,
            title: videoFromDB.title,
            poster: videoFromDB.poster,
            video: videoFromDB.video,
            link: videoFromDB.link,
          });
        }
      }

      // 9️⃣ Find the video streams
      const baseUrl =
        videoFromDB.video ||
        videoFromDB.link ||
        videoFromDB.poster?.replace(
          "thumbnail-hq-720x-frame",
          "thumbnail-hq"
        ) ||
        "";

      // Example: generate multiple qualities (dummy transformation, but based on found item)
      const qualities = ["1080P", "720P", "480P"];
      const streams = qualities.map((q, i) => ({
        url: baseUrl.includes("?")
          ? `${baseUrl}&quality=${q}`
          : `${baseUrl}?quality=${q}`,
        quality: q,
        subtitles: [],
      }));

      // 🔟 Return the streams data
      await this.fetchAndSaveMoreData();

      return res.json(streams);
    } catch (error) {
      console.error("getStreams error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  };
}

module.exports = new XFreeScraperController();
