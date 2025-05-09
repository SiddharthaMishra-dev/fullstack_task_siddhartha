import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { PlusCircle, StickyNote, Wifi, WifiOff } from "lucide-react";
import { BASE_URL } from "./utils/baseUrl";
import type { Note } from "./utils/schema";

const socket = io(BASE_URL);

export default function App() {
  const [notes, setnotes] = useState<Note[] | []>([]);
  const [newNote, setnewNote] = useState("");
  const [connected, setConnected] = useState(false);

  const fetchNotes = async () => {
    try {
      const response = await fetch(`${BASE_URL}/fetchAllnotes`);
      if (!response.ok) {
        throw new Error("Failed to fetch notes");
      }
      const data = await response.json();
      setnotes(data);
    } catch (error) {
      console.error("Error fetching notes:", error);
    }
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    socket.emit("add", newNote);
    setnewNote("");
  };

  const deleteNote = (nodeId: string) => {
    socket.emit("delete", nodeId);
  };

  useEffect(() => {
    socket.on("connect", () => {
      console.log("Connected to server");
      setConnected(true);
      fetchNotes();
    });
    socket.on("taskList", (updatednotes) => {
      console.log("Received updated task list:", updatednotes);
      setnotes(updatednotes);
    });

    socket.on("disconnect", () => {
      console.log("Disconnected from server");
      setConnected(false);
    });
    return () => {
      socket.off("connect");
      socket.off("taskList");
      socket.off("disconnect");
    };
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-gray-100 p-4">
          <StickyNote className="h-6 w-6 text-amber-700" />
          <h1 className="text-xl font-semibold text-gray-900">Note App</h1>
          <div className="ml-auto flex items-center gap-1 text-sm">
            {connected ? (
              <Wifi className="h-4 w-4 text-green-600" />
            ) : (
              <WifiOff className="h-4 w-4 text-red-600" />
            )}
            <span className={connected ? "text-green-600" : "text-red-600"}>
              {connected ? "Connected" : "Disconnected"}
            </span>
          </div>
        </div>

        <div className="p-4">
          <form
            onSubmit={handleAddTask}
            className="mb-4 flex gap-2"
          >
            <input
              type="text"
              value={newNote}
              onChange={(e) => setnewNote(e.target.value)}
              placeholder="New Note..."
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
            />
            <button
              type="submit"
              className="flex items-center gap-1 rounded-md bg-amber-700 px-3 py-2 text-sm font-medium text-white hover:bg-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
            >
              <PlusCircle className="h-4 w-4" />
              Add
            </button>
          </form>

          <div>
            <h2 className="mb-2 font-medium text-gray-700">Notes</h2>
            {notes.length === 0 ? (
              <p className="py-4 text-center text-sm text-gray-500">No notes yet. Add one above!</p>
            ) : (
              <div className="space-y-1">
                {notes.map((task) => (
                  <div
                    key={task.id}
                    className="group flex items-center justify-between border-b border-gray-100 py-3"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm ${
                          task.completed ? "text-gray-400 line-through" : "text-gray-700"
                        }`}
                      >
                        {task.text}
                      </span>
                    </div>
                    <button
                      onClick={() => deleteNote(task.id)}
                      className="invisible rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 group-hover:visible"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
