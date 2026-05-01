require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// --- CONFIGURATION PRISMA (V7 avec adaptateur pg) ---
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// --- INIT EXPRESS ---
const app = express();
const SECRET_KEY = "ton_secret_super_securise_pour_jwt";

app.use(cors());
app.use(express.json());

// --- INIT HTTP & SOCKET.IO ---
const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173", // Autorise ton frontend Vue.js
    methods: ["GET", "POST"]
  }
});

// ============================================================
// ROUTES API (HTTP Classique)
// ============================================================

// 1. Inscription
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const existingUser = await prisma.user.findFirst({
      where: { OR: [{ email }, { username }] }
    });
    if (existingUser) return res.status(400).json({ error: "Email ou pseudo déjà utilisé." });

    const hashedPassword = await bcrypt.hash(password, 10);
    await prisma.user.create({
      data: {
        username,
        email,
        password: hashedPassword,
        avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${username}`
      }
    });
    res.status(201).json({ message: "Compte créé avec succès !" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// 2. Connexion
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: "Utilisateur introuvable." });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Mot de passe incorrect." });

    const token = jwt.sign({ id: user.id, username: user.username }, SECRET_KEY, { expiresIn: '24h' });
    res.json({ 
      message: "Connexion réussie", 
      token, 
      user: { id: user.id, name: user.username, avatar: user.avatar } 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur serveur." });
  }
});

// 3. Récupérer l'historique des messages
app.get('/api/messages/:channelId', (req, res) => {
  res.json([]); 
});

// ============================================================
// ROUTES : AMIS & GROUPES
// ============================================================

app.get('/api/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({ select: { id: true, username: true, avatar: true } });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Impossible de récupérer les utilisateurs." });
  }
});

app.post('/api/friends/add', async (req, res) => {
  const { currentUserId, friendId } = req.body;
  try {
    await prisma.user.update({
      where: { id: currentUserId },
      data: { friends: { connect: { id: friendId } } }
    });
    res.json({ message: "Ami ajouté avec succès !" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur lors de l'ajout de l'ami." });
  }
});

app.post('/api/groups/create', async (req, res) => {
  const { name, creatorId, friendIds } = req.body;
  try {
    const allMembers = [{ id: creatorId }];
    if (friendIds && friendIds.length > 0) {
      friendIds.forEach(id => allMembers.push({ id }));
    }
    const newGroup = await prisma.group.create({
      data: { name: name, members: { connect: allMembers } }
    });
    res.status(201).json({ message: "Groupe créé !", group: newGroup });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Erreur création groupe." });
  }
});

app.get('/api/users/:userId/groups', async (req, res) => {
  const userId = parseInt(req.params.userId);
  try {
    const userGroups = await prisma.group.findMany({
      where: { members: { some: { id: userId } } },
      include: { members: true }
    });
    res.json(userGroups);
  } catch (error) {
    res.status(500).json({ error: "Impossible de récupérer tes groupes." });
  }
});

// ============================================================
// LOGIQUE TEMPS RÉEL (SOCKET.IO, WEBRTC & MINI-JEUX)
// ============================================================

let voiceChannels = [
  { id: 'V-8829', name: 'Lobby Principal', users: [] },
  { id: 'V-4412', name: "Salle d'attente (Tournoi)", users: [] }
];

io.on('connection', (socket) => {
  console.log(`🟢 Nouveau joueur connecté : ${socket.id}`);

  socket.emit('update-voice-channels', voiceChannels);

  // --- CHAT TEXTUEL ---
  socket.on('join-channel', (channelId) => {
    socket.join(`text-${channelId}`);
  });

  socket.on('leave-channel', (channelId) => {
    socket.leave(`text-${channelId}`);
  });

  socket.on('send-message', (data) => {
    const messageComplet = { ...data, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
    io.to(`text-${data.channelId}`).emit('new-message', messageComplet);
  });

  // --- SALONS VOCAUX (WebRTC) ---
  socket.on('join-voice', ({ roomId, userId, username }) => {
    socket.join(roomId);

    voiceChannels.forEach(channel => {
      channel.users = channel.users.filter(u => u.socketId !== socket.id);
    });

    const channel = voiceChannels.find(c => c.id === roomId);
    if (channel) {
      channel.users.push({
        socketId: socket.id, userId: userId, name: username, isSpeaking: false, isMuted: false
      });
    }

    io.emit('update-voice-channels', voiceChannels);
    socket.to(roomId).emit('user-joined-voice', { userId, socketId: socket.id });
  });

  socket.on('leave-voice', ({ roomId }) => {
    socket.leave(roomId);
    voiceChannels.forEach(channel => {
      channel.users = channel.users.filter(u => u.socketId !== socket.id);
    });
    io.emit('update-voice-channels', voiceChannels);
    socket.to(roomId).emit('user-left-voice', socket.id);
  });

  // --- SIGNALING WEBRTC ---
  socket.on('webrtc-offer', ({ to, offer }) => {
    socket.to(to).emit('webrtc-offer', { from: socket.id, offer });
  });

  socket.on('webrtc-answer', ({ to, answer }) => {
    socket.to(to).emit('webrtc-answer', { from: socket.id, answer });
  });

  socket.on('webrtc-ice', ({ to, candidate }) => {
    socket.to(to).emit('webrtc-ice', { from: socket.id, candidate });
  });

  // ============================================================
  // --- MINI-JEUX (GAME ARENA) ---
  // ============================================================
  socket.on('join-game-room', (roomCode) => {
    socket.join(`game-${roomCode}`);
    
    const room = io.sockets.adapter.rooms.get(`game-${roomCode}`);
    const numPlayers = room ? room.size : 0;

    console.log(`🎮 Joueur ${socket.id} a rejoint la salle de jeu : ${roomCode} (${numPlayers} joueur(s))`);

    if (numPlayers === 1) {
      socket.emit('game-status', { status: 'waiting', message: "En attente d'un adversaire..." });
    } 
    else if (numPlayers === 2) {
      io.to(`game-${roomCode}`).emit('game-status', { status: 'ready', message: "La partie commence !" });
      io.to(`game-${roomCode}`).emit('game-start', { roomCode: roomCode });
    } 
    else {
      socket.leave(`game-${roomCode}`);
      socket.emit('game-status', { status: 'error', message: "La salle est déjà pleine !" });
    }
  });

  socket.on('game-action', (data) => {
    socket.to(`game-${data.roomCode}`).emit('opponent-action', data);
  });

  // --- DÉCONNEXION ---
  socket.on('disconnect', () => {
    console.log(`🔴 Joueur déconnecté : ${socket.id}`);
    voiceChannels.forEach(channel => {
      channel.users = channel.users.filter(u => u.socketId !== socket.id);
    });
    io.emit('update-voice-channels', voiceChannels);
    io.emit('user-left-voice', socket.id);
  });
});

// ============================================================
// LANCEMENT DU SERVEUR
// ============================================================
const PORT = 3001;
server.listen(PORT, () => {
  console.log(`🚀 Serveur API & WebSocket démarré sur http://localhost:${PORT}`);
});