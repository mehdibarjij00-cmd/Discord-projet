const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();

const allowedOrigins = [
  process.env.CLIENT_URL,
  'https://arenalink-client.onrender.com',
  'http://localhost:5173',
].filter(Boolean);

app.use(cors({ origin: allowedOrigins, credentials: true }));

app.get('/', (_, res) => res.send('🚀 ArenaLink server running'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

io.on('connection', (socket) => {
  console.log(`✅ Connecté : ${socket.id}`);

  // ─── CHAT TEXTE ───
  socket.on('join_room', (roomName) => {
    socket.join(roomName);
    console.log(`💬 ${socket.id} → salon ${roomName}`);
  });

  socket.on('send_message', (data) => {
    io.to(data.room).emit('receive_message', data);
  });

  // ─── VOCAL — SIGNALING WebRTC ───
  socket.on('join-voice', ({ roomId, userId, username }) => {
    const voiceRoom = `voice-${roomId}`;
    socket.to(voiceRoom).emit('user-joined-voice', {
      socketId: socket.id,
      userId,
      username,
    });
    socket.join(voiceRoom);
    socket.data.voiceRoom = voiceRoom;
    console.log(`🎤 ${username ?? socket.id} a rejoint ${voiceRoom}`);
  });

  socket.on('webrtc-offer', ({ to, offer }) => {
    io.to(to).emit('webrtc-offer', { from: socket.id, offer });
  });

  socket.on('webrtc-answer', ({ to, answer }) => {
    io.to(to).emit('webrtc-answer', { from: socket.id, answer });
  });

  socket.on('webrtc-ice', ({ to, candidate }) => {
    io.to(to).emit('webrtc-ice', { from: socket.id, candidate });
  });

  socket.on('leave-voice', ({ roomId }) => {
    const voiceRoom = `voice-${roomId}`;
    socket.to(voiceRoom).emit('user-left-voice', socket.id);
    socket.leave(voiceRoom);
    socket.data.voiceRoom = null;
    console.log(`🔇 ${socket.id} a quitté ${voiceRoom}`);
  });

  socket.on('disconnect', () => {
    if (socket.data.voiceRoom) {
      socket.to(socket.data.voiceRoom).emit('user-left-voice', socket.id);
    }
    console.log(`❌ Déconnecté : ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Serveur Socket.IO sur le port ${PORT}`);
  console.log(`📡 Origines CORS autorisées :`, allowedOrigins);
});