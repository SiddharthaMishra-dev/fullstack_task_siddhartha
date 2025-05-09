const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const redis = require("redis");
const { MongoClient } = require("mongodb");
const cors = require("cors");

require("dotenv").config();

const PORT = process.env.PORT || 5000;
const REDIS_URL = process.env.REDIS_URL;

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const REDIS_KEY = "FULLSTACK_TASK_SIDDHARTHA";
const COLLECTION_NAME = "assignment_siddhartha";
const MAX_CACHE_ITEMS = 50;

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const redisClient = redis.createClient({
  url: REDIS_URL,
});

const mongoClient = new MongoClient(MONGO_URI);
let notesCollection;

async function initializeConnections() {
  try {
    try {
      console.log(`Attempting to connect to Redis at ${REDIS_URL}`);
      await redisClient.connect();
      console.log("Successfully connected to Redis");
    } catch (redisError) {
      console.error("Redis connection error:", redisError);
      console.log("Please check your Redis connection string and make sure Redis is running.");
      process.exit(1);
    }

    try {
      console.log(`Attempting to connect to MongoDB at ${MONGO_URI}`);
      await mongoClient.connect();
      console.log("Successfully connected to MongoDB");

      const db = mongoClient.db("");
      notesCollection = db.collection(COLLECTION_NAME);
    } catch (mongoError) {
      console.error("MongoDB connection error:", mongoError);
      console.log("Please check your MongoDB connection string and make sure MongoDB is running.");

      await redisClient.quit().catch((e) => console.error("Error closing Redis connection:", e));
      process.exit(1);
    }
  } catch (error) {
    console.error("Unexpected error during connection initialization:", error);
    process.exit(1);
  }
}

async function getAllNotes() {
  const cachedNotes = await redisClient.get(REDIS_KEY);
  const redisnotes = cachedNotes ? JSON.parse(cachedNotes) : [];
  const mongonotes = await notesCollection.find({}).toArray();
  return [...mongonotes, ...redisnotes];
}

async function moveNotesToMongo() {
  const cachedNotes = await redisClient.get(REDIS_KEY);

  if (cachedNotes) {
    const notes = JSON.parse(cachedNotes);

    if (notes.length > MAX_CACHE_ITEMS) {
      console.log(`Cache exceeds ${MAX_CACHE_ITEMS} items. Moving to MongoDB...`);
      if (notes.length > 0) {
        await notesCollection.insertMany(notes);
      }
      await redisClient.set(REDIS_KEY, JSON.stringify([]));
      console.log("notes moved to MongoDB and cache cleared");
    }
  }
}

io.on("connection", (socket) => {
  console.log("New client connected");
  socket.on("add", async (note) => {
    try {
      const cachedNotes = await redisClient.get(REDIS_KEY);
      const notes = cachedNotes ? JSON.parse(cachedNotes) : [];
      const newTask = {
        id: Date.now().toString(),
        text: note,
        completed: false,
        createdAt: new Date(),
      };
      notes.push(newTask);
      await redisClient.set(REDIS_KEY, JSON.stringify(notes));
      await moveNotesToMongo();
      const allnotes = await getAllNotes();
      io.emit("noteList", allnotes);

      console.log("Note added:", newTask);
    } catch (error) {
      console.error("Error adding note:", error);
    }
  });

  socket.on("delete", async (taskId) => {
    try {
      const cachedNotes = await redisClient.get(REDIS_KEY);
      let notes = cachedNotes ? JSON.parse(cachedNotes) : [];
      let taskIndex = notes.findIndex((task) => task.id === taskId);

      if (taskIndex !== -1) {
        notes.splice(taskIndex, 1);
        await redisClient.set(REDIS_KEY, JSON.stringify(notes));
      } else {
        await notesCollection.deleteOne({ id: taskId });
      }
      const allnotes = await getAllNotes();
      io.emit("taskList", allnotes);
    } catch (error) {
      console.error("Error deleting task:", error);
    }
  });
  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

app.get("/fetchAllnotes", async (req, res) => {
  try {
    const allnotes = await getAllNotes();
    res.json(allnotes);
  } catch (error) {
    console.error("Error fetching notes:", error);
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

async function startServer() {
  await initializeConnections();

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

process.on("SIGINT", async () => {
  console.log("Shutting down server...");

  try {
    await redisClient.quit();
    await mongoClient.close();
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
});

startServer();
