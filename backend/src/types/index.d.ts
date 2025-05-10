interface Task {
    id: string;
    text: string;
    completed: boolean;
    createdAt: Date;
  }
  
  // Socket.io events
  declare namespace SocketIO {
    interface ServerEvents {
      add: (note: string) => void;
      delete: (taskId: string) => void;
      noteList: (notes: Task[]) => void;
      taskList: (tasks: Task[]) => void;
    }
  }