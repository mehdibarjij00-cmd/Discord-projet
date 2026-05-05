const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();

// Origines autorisées pour le CORS.
// En prod, Render fournit CLIENT_URL via les variables d'environnement.
// On accepte aussi localhost pour le dev en local.
const allowedOrigins = [
  process.env.CLIENT_URL,
  'https://arenalink-client.onrender.com',
  'http://localhost:5173',
].filter(Boolean);

app.use(cors({ origin: allowedOrigins, credentials: true }));

// Endpoint santé (utile pour Render et pour vérifier que le serveur tourne)
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

  // ============================================================
  // CHAT TEXTE
  // ============================================================
  socket.on('join_room', (roomName) => {
    socket.join(roomName);
    console.log(`💬 ${socket.id} → salon ${roomName}`);
  });

  socket.on('send_message', (data) => {
    io.to(data.room).emit('receive_message', data);
  });

  // ============================================================
  // VOCAL — SIGNALING WebRTC
  // ============================================================
  // Events utilisés par App.vue :
  //   join-voice, leave-voice
  //   webrtc-offer, webrtc-answer, webrtc-ice
  //   user-joined-voice, user-left-voice
  // ------------------------------------------------------------

  socket.on('join-voice', ({ roomId, userId, username }) => {
    const voiceRoom = `voice-${roomId}`;

    // 1) Prévenir les utilisateurs DÉJÀ présents qu'un nouveau arrive.
    //    Ce sont eux qui enverront l'offer (ils ont déjà leur localStream).
    socket.to(voiceRoom).emit('user-joined-voice', {
      socketId: socket.id,
      userId,
      username,
    });

    // 2) Le nouveau rejoint la room Socket.IO
    socket.join(voiceRoom);
    socket.data.voiceRoom = voiceRoom;

    console.log(`🎤 ${username ?? socket.id} a rejoint ${voiceRoom}`);
  });

  // Relais de l'offer entre 2 pairs
  socket.on('webrtc-offer', ({ to, offer }) => {
    io.to(to).emit('webrtc-offer', { from: socket.id, offer });
  });

  // Relais de l'answer entre 2 pairs
  socket.on('webrtc-answer', ({ to, answer }) => {
    io.to(to).emit('webrtc-answer', { from: socket.id, answer });
  });

  // Relais des ICE candidates entre 2 pairs
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

  // ============================================================
  // DECONNEXION — nettoyer les salons vocaux
  // ============================================================
  socket.on('disconnect', () => {
    if (socket.data.voiceRoom) {
      socket.to(socket.data.voiceRoom).emit('user-left-voice', socket.id);
    }
    console.log(`❌ Déconnecté : ${socket.id}`);
  });
});

// ============================================================
// DEMARRAGE — Render fournit le PORT via une env var
// ============================================================
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Serveur Socket.IO sur le port ${PORT}`);
  console.log(`📡 Origines CORS autorisées :`, allowedOrigins);
});