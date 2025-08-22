require('dotenv').config();
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const authMiddleware = require('./middleware/auth');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/users', authMiddleware, userRoutes);

const PORT = process.env.PORT || 5000;

// Simple map: userId -> socketId
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  socket.on('registerSocket', (userId) => {
    onlineUsers.set(userId, socket.id);
    socket.userId = userId;
    console.log('registered', userId, '->', socket.id);
  });

  socket.on('call-user', ({ toUserId, offer, fromUser, fromName }) => {
    const toSocket = onlineUsers.get(toUserId);
    if (!toSocket) {
      socket.emit('user-unavailable', { toUserId });
      return;
    }
    io.to(toSocket).emit('incoming-call', { offer, fromUser, fromName, fromSocket: socket.id });
  });

  socket.on('answer-call', ({ toSocket, answer }) => {
    io.to(toSocket).emit('call-accepted', { answer, fromSocket: socket.id });
  });

  socket.on('ice-candidate', ({ toSocket, candidate }) => {
    io.to(toSocket).emit('ice-candidate', { candidate, fromSocket: socket.id });
  });

  socket.on('end-call', ({ toSocket }) => {
    io.to(toSocket).emit('call-ended');
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      console.log('socket disconnected and removed for user', socket.userId);
    }
  });
});

// Connect to DB and start server

// Connect to DB and start server
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB Connected");
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch(err => console.error("❌ MongoDB Connection Error:", err));


