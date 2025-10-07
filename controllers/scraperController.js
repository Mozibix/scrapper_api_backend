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
  // getTrending = async (req, res) => {
  //   try {
  //     const page = Math.max(Number(req.query.page) || 1, 1); // default to 1, no negative/zero
  //     const count = Math.max(Number(req.query.count) || 30, 1); // default to 30, no negative/zero
  //     const totalNeeded = page * count; // Total videos we need in DB to serve this page
  //     console.log(totalNeeded);
  //     // Fetch videos from DB
  //     let videosFromDB = await Video.find().limit(totalNeeded).lean();
  //     let totalFetched = videosFromDB.length;

  //     // If not enough data, keep fetching until we can serve the requested page
  //     while (totalFetched < totalNeeded) {
  //       const url = `${this.BASE_URL}?count=${totalNeeded}`; // You can tune this batch size
  //       const data = await fetchApi(url);

  //       const newVideos = Array.isArray(data)
  //         ? await Promise.all(
  //             data.map(async (item) => {
  //               const slug = slugifyTitle(item.title || "");

  //               const exists = await Video.findOne({ id: slug });
  //               if (!exists) {
  //                 await Video.create({
  //                   id: slug,
  //                   title: item.title || "",
  //                   poster: item.poster || "",
  //                   video: item.video || "",
  //                 });
  //               }

  //               return {
  //                 id: slug,
  //                 title: item.title || "",
  //                 poster: item.poster || "",
  //               };
  //             })
  //           )
  //         : [];

  //       // Merge new videos into DB-fetched list
  //       videosFromDB = [...videosFromDB, ...newVideos];
  //       totalFetched = videosFromDB.length;
  //     }

  //     // Calculate start/end indices for the requested page
  //     const startIndex = (page - 1) * count;
  //     const endIndex = startIndex + count;

  //     // Slice the data for the requested page
  //     const paginated = videosFromDB.slice(startIndex, endIndex);

  //     return res.json(paginated);
  //   } catch (error) {
  //     console.error("getTrending error:", error);
  //     return res.status(500).json({ message: "Internal server error" });
  //   }
  // };

  getTrending = async (req, res) => {
    try {
      const page = Math.max(Number(req.query.page) || 1, 1); // default to 1, no negative/zero
      const count = Math.max(Number(req.query.count) || 30, 1); // default to 30, no negative/zero
      const totalNeeded = page * count; // Total videos we need in DB to serve this page

      console.log(`Total videos needed: ${totalNeeded}`);

      // 1. Fetch videos from the API (external source) first
      const url = `${this.BASE_URL}?count=${totalNeeded}`;
      const data = await fetchApi(url);

      if (!Array.isArray(data) || data.length === 0) {
        return res
          .status(404)
          .json({ message: "No data found from the external API." });
      }

      let videosFromAPI = data.map((item) => {
        const slug = slugifyTitle(item.title || "");
        return {
          id: slug,
          title: item.title || "",
          poster: item.poster || "",
          video: item.video || "",
        };
      });

      // 2. Fetch the existing videos from the DB (just the ones needed)
      let videosFromDB = await Video.find({
        id: { $in: videosFromAPI.map((v) => v.id) },
      }).lean();

      // 3. Check which videos are missing from DB and need to be inserted
      const existingIds = new Set(videosFromDB.map((video) => video.id));
      const missingVideos = videosFromAPI.filter(
        (video) => !existingIds.has(video.id)
      );

      // 4. Insert the missing videos into DB (if any)
      if (missingVideos.length > 0) {
        await Video.insertMany(missingVideos);
        console.log(`Inserted ${missingVideos.length} new videos into DB.`);
      }

      // 5. Combine API and DB results, avoiding duplicates
      videosFromDB = [...videosFromDB, ...missingVideos];

      // 6. Calculate the slice for pagination
      const startIndex = (page - 1) * count;
      const endIndex = startIndex + count;

      // Slice the data for the requested page
      const paginated = videosFromDB.slice(startIndex, endIndex);

      // 7. Return the paginated data
      return res.json(paginated);
    } catch (error) {
      console.error("getTrending error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  };

  search = async (req, res) => {
    try {
      const { query } = req.params;
      if (!query) return res.status(400).json({ message: "Query is required" });

      const count = Number(req.query.count) || 10; // Desired count per page
      const page = Number(req.query.page) || 1; // Current page
      const skip = (page - 1) * count; // Skip based on page number

      const totalNeeded = page * count; // Total number of videos we want to fetch and serve

      // Step 1: Fetch videos from the external API concurrently for the required pages
      const apiPages = [];
      const totalPages = Math.ceil(totalNeeded / count);

      for (let i = 0; i < totalPages; i++) {
        apiPages.push(fetchVideosFromAPI(query, count, i + 1)); // Fetch page i + 1
      }

      const apiResults = await Promise.all(apiPages); // Wait for all API requests to resolve

      let videosFromAPI = [];
      apiResults.forEach((data) => {
        if (Array.isArray(data) && data.length > 0) {
          const newVideos = data.map((item) => {
            const slug = slugifyTitle(item.title || "");
            return {
              id: slug,
              title: item.title || "",
              poster: item.poster || "",
              video: item.video || "",
            };
          });

          // Insert only new videos into DB if not already there
          videosFromAPI = [...videosFromAPI, ...newVideos];
        }
      });

      // Step 2: Batch insert only unique videos into DB (to avoid duplicates)
      if (videosFromAPI.length > 0) {
        const existingIds = new Set(
          (
            await Video.find({ id: { $in: videosFromAPI.map((v) => v.id) } })
          ).map((video) => video.id)
        );

        const uniqueVideos = videosFromAPI.filter(
          (v) => !existingIds.has(v.id)
        );

        if (uniqueVideos.length > 0) {
          try {
            // Insert unique videos using upsert to avoid duplicate key errors
            await Video.bulkWrite(
              uniqueVideos.map((video) => ({
                updateOne: {
                  filter: { id: video.id },
                  update: { $setOnInsert: video },
                  upsert: true,
                },
              }))
            );
            console.log(`Inserted ${uniqueVideos.length} new videos into DB.`);
          } catch (error) {
            console.error("Error inserting videos:", error);
          }
        }
      }

      // Step 3: Fetch additional results from DB if needed
      let videosFromDB = [];
      if (videosFromAPI.length < totalNeeded) {
        console.log("Not enough data from API, fetching from DB...");

        videosFromDB = await Video.find({
          title: { $regex: query, $options: "i" }, // Match query case-insensitively
        })
          .skip(skip)
          .limit(count)
          .lean();
      }

      // Combine results from API and DB
      const combinedResults = [...videosFromAPI, ...videosFromDB];

      // Step 4: Return paginated results
      const paginatedResults = combinedResults.slice(skip, skip + count);
      return res.json(paginatedResults);
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

      // Step 1️⃣: Try fetching data from the external API first
      const data = await fetchApi(`${this.BASE_URL}?count=60`);
      if (!Array.isArray(data) || data.length === 0) {
        return res
          .status(500)
          .json({ message: "No data returned from source" });
      }

      // Step 2️⃣: Normalize all items with slug ids
      const results = data.map((item) => ({
        id: slugifyTitle(item.title || ""),
        title: item.title || "",
        poster: item.poster || "",
        video: item.video || "",
      }));

      // Step 3️⃣: Try to find exact match first
      let videoFromAPI = results.find(
        (item) => item.id.toLowerCase() === id.toLowerCase()
      );

      // Step 4️⃣: If not found in API, try a partial match
      if (!videoFromAPI) {
        videoFromAPI = results.find((item) =>
          item.id.toLowerCase().includes(id.toLowerCase())
        );
      }

      // Step 5️⃣: If not found in API, fetch from DB
      let videoFromDB = null;
      if (!videoFromAPI) {
        videoFromDB = await Video.findOne({ id }).lean();
      }

      // Step 6️⃣: If video found in DB, use it, otherwise fallback
      if (!videoFromAPI && !videoFromDB) {
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

      // Step 7️⃣: If we found the video in API, insert/update in DB if necessary
      if (videoFromAPI) {
        const existsInDB = await Video.findOne({ id: videoFromAPI.id });
        if (!existsInDB) {
          await Video.create({
            id: videoFromAPI.id,
            title: videoFromAPI.title,
            poster: videoFromAPI.poster,
            video: videoFromAPI.video,
          });
        }
      }

      // Step 8️⃣: If we have a video (either from API or DB), create the suggested videos
      const suggestedVideos = await Video.find({
        id: { $ne: videoFromAPI?.id || videoFromDB?.id },
      })
        .limit(200)
        .lean();

      // Step 9️⃣: Build the response structure
      const details = {
        id: (videoFromAPI || videoFromDB).id,
        title: (videoFromAPI || videoFromDB).title,
        poster: (videoFromAPI || videoFromDB).poster,
        suggestedVideo: suggestedVideos,
        seasons: [
          {
            title: "Video",
            poster: (videoFromAPI || videoFromDB).poster,
            episodes: [
              {
                id: (videoFromAPI || videoFromDB).id,
                title: (videoFromAPI || videoFromDB).title,
                video:
                  (videoFromAPI || videoFromDB).video ||
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
      const data = await fetchApi(`${this.BASE_URL}?count=50`);
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
      // categories: [
      //   "Action",
      //   "Adventure",
      //   "Animation",
      //   "Comedy",
      //   "Crime",
      //   "Documentary",
      //   "Drama",
      //   "Family",
      //   "Fantasy",
      //   "History",
      //   "Horror",
      //   "Music",
      //   "Mystery",
      //   "Romance",
      //   "Science Fiction",
      //   "TV Movie",
      //   "Thriller",
      //   "War",
      //   "Western",
      // ],
      categories: [],
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

const fetchVideosFromAPI = async (query, count, page) => {
  const offset = (page - 1) * count; // Calculate offset based on the page number
  const url = `https://www.xfree.com/prbn2/?search=${query}&count=${count}&offset=${offset}`;
  return fetchApi(url);
};
