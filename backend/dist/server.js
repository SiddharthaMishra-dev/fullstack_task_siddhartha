"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const redis = __importStar(require("redis"));
const mongodb_1 = require("mongodb");
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
// Load environment variables
dotenv_1.default.config();
// Constants
const PORT = parseInt(process.env.PORT || '5000', 10);
const REDIS_URL = process.env.REDIS_URL || '';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const REDIS_KEY = 'FULLSTACK_TASK_SIDDHARTHA';
const COLLECTION_NAME = 'assignment_siddhartha';
const MAX_CACHE_ITEMS = 50;
// Initialize Express app
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Create HTTP server
const server = http_1.default.createServer(app);
// Initialize Socket.io
const io = new socket_io_1.Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
});
// Initialize Redis client
const redisClient = redis.createClient({
    url: REDIS_URL,
});
// Initialize MongoDB client
const mongoClient = new mongodb_1.MongoClient(MONGO_URI);
let notesCollection;
// Connect to Redis and MongoDB
async function initializeConnections() {
    try {
        try {
            console.log(`Attempting to connect to Redis at ${REDIS_URL}`);
            await redisClient.connect();
            console.log('Successfully connected to Redis');
        }
        catch (redisError) {
            console.error('Redis connection error:', redisError);
            console.log('Please check your Redis connection string and make sure Redis is running.');
            process.exit(1);
        }
        try {
            console.log(`Attempting to connect to MongoDB at ${MONGO_URI}`);
            await mongoClient.connect();
            console.log('Successfully connected to MongoDB');
            const db = mongoClient.db('');
            notesCollection = db.collection(COLLECTION_NAME);
        }
        catch (mongoError) {
            console.error('MongoDB connection error:', mongoError);
            console.log('Please check your MongoDB connection string and make sure MongoDB is running.');
            await redisClient.quit().catch((e) => console.error('Error closing Redis connection:', e));
            process.exit(1);
        }
    }
    catch (error) {
        console.error('Unexpected error during connection initialization:', error);
        process.exit(1);
    }
}
// Get all notes from both Redis and MongoDB
async function getAllNotes() {
    const cachedNotes = await redisClient.get(REDIS_KEY);
    const redisNotes = cachedNotes ? JSON.parse(cachedNotes) : [];
    const mongoDocs = await notesCollection.find({}).toArray();
    const mongoNotes = mongoDocs.map((doc) => ({
        id: doc.id,
        text: doc.text,
        completed: doc.completed,
        createdAt: new Date(doc.createdAt),
    }));
    return [...mongoNotes, ...redisNotes];
}
// Move notes from Redis to MongoDB when cache exceeds limit
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
            console.log('Notes moved to MongoDB and cache cleared');
        }
    }
}
// Socket.io connection handler
io.on('connection', (socket) => {
    console.log('New client connected');
    // Handle adding new notes
    socket.on('add', async (note) => {
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
            const allNotes = await getAllNotes();
            io.emit('noteList', allNotes);
            console.log('Note added:', newTask);
        }
        catch (error) {
            console.error('Error adding note:', error);
        }
    });
    // Handle task deletion
    socket.on('delete', async (taskId) => {
        try {
            const cachedNotes = await redisClient.get(REDIS_KEY);
            let notes = cachedNotes ? JSON.parse(cachedNotes) : [];
            let taskIndex = notes.findIndex((task) => task.id === taskId);
            if (taskIndex !== -1) {
                // Task found in Redis
                notes.splice(taskIndex, 1);
                await redisClient.set(REDIS_KEY, JSON.stringify(notes));
            }
            else {
                // Task not in Redis, delete from MongoDB
                await notesCollection.deleteOne({ id: taskId });
            }
            const allNotes = await getAllNotes();
            io.emit('taskList', allNotes);
        }
        catch (error) {
            console.error('Error deleting task:', error);
        }
    });
    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});
// HTTP endpoint to fetch all notes
app.get('/fetchAllnotes', async (req, res) => {
    try {
        const allNotes = await getAllNotes();
        res.json(allNotes);
    }
    catch (error) {
        console.error('Error fetching notes:', error);
        res.status(500).json({ error: 'Failed to fetch notes' });
    }
});
// Start server
async function startServer() {
    await initializeConnections();
    server.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}
// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    try {
        await redisClient.quit();
        await mongoClient.close();
        process.exit(0);
    }
    catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
});
// Start the server
startServer();
//# sourceMappingURL=server.js.map