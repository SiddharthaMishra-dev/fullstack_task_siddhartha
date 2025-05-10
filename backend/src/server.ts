import express, { Express, Request, Response } from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import * as redis from 'redis';
import { MongoClient, Collection } from 'mongodb';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const PORT: number = parseInt(process.env.PORT || '5000', 10);
const REDIS_URL: string = process.env.REDIS_URL || '';
const MONGO_URI: string = process.env.MONGO_URI || 'mongodb://localhost:27017';
const REDIS_KEY: string = 'FULLSTACK_TASK_SIDDHARTHA';
const COLLECTION_NAME: string = 'assignment_siddhartha';
const MAX_CACHE_ITEMS: number = 50;

interface Task {
  id: string;
  text: string;
  completed: boolean;
  createdAt: Date;
}

const app: Express = express();
app.use(cors());
app.use(express.json());

const server: http.Server = http.createServer(app);

const io: SocketIOServer = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const redisClient: redis.RedisClientType = redis.createClient({
  url: REDIS_URL,
});

const mongoClient: MongoClient = new MongoClient(MONGO_URI);
let notesCollection: Collection;

async function initializeConnections(): Promise<void> {
  try {
    try {
      console.log(`Attempting to connect to Redis at ${REDIS_URL}`);
      await redisClient.connect();
      console.log('Successfully connected to Redis');
    } catch (redisError) {
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
    } catch (mongoError) {
      console.error('MongoDB connection error:', mongoError);
      console.log('Please check your MongoDB connection string and make sure MongoDB is running.');

      await redisClient.quit().catch((e) => console.error('Error closing Redis connection:', e));
      process.exit(1);
    }
  } catch (error) {
    console.error('Unexpected error during connection initialization:', error);
    process.exit(1);
  }
}

async function getAllNotes(): Promise<Task[]> {
  const cachedNotes = await redisClient.get(REDIS_KEY);
  const redisNotes: Task[] = cachedNotes ? JSON.parse(cachedNotes) : [];
  const mongoDocs = await notesCollection.find({}).toArray();
  const mongoNotes: Task[] = mongoDocs.map((doc: any) => ({
    id: doc.id,
    text: doc.text,
    completed: doc.completed,
    createdAt: new Date(doc.createdAt),
  }));
  return [...mongoNotes, ...redisNotes];
}

async function moveNotesToMongo(): Promise<void> {
  const cachedNotes = await redisClient.get(REDIS_KEY);

  if (cachedNotes) {
    const notes: Task[] = JSON.parse(cachedNotes);

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

io.on('connection', (socket) => {
  console.log('New client connected');

  socket.on('add', async (note: string) => {
    try {
      const cachedNotes = await redisClient.get(REDIS_KEY);
      const notes: Task[] = cachedNotes ? JSON.parse(cachedNotes) : [];
      
      const newTask: Task = {
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
    } catch (error) {
      console.error('Error adding note:', error);
    }
  });

  socket.on('delete', async (taskId: string) => {
    try {
      const cachedNotes = await redisClient.get(REDIS_KEY);
      let notes: Task[] = cachedNotes ? JSON.parse(cachedNotes) : [];
      
      let taskIndex = notes.findIndex((task) => task.id === taskId);
      
      if (taskIndex !== -1) {
        notes.splice(taskIndex, 1);
        await redisClient.set(REDIS_KEY, JSON.stringify(notes));
      } else {
        await notesCollection.deleteOne({ id: taskId });
      }
      
      const allNotes = await getAllNotes();
      io.emit('noteList', allNotes);
    } catch (error) {
      console.error('Error deleting note:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

app.get('/fetchAllnotes', async (req: Request, res: Response) => {
  try {
    const allNotes = await getAllNotes();
    res.json(allNotes);
  } catch (error) {
    console.error('Error fetching notes:', error);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

async function startServer(): Promise<void> {
  await initializeConnections();
  
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  
  try {
    await redisClient.quit();
    await mongoClient.close();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

startServer();