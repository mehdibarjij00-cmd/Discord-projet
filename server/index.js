const express = require('express');
const app = express();
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log(`Utilisateur connecté : ${socket.id}`);

  //  Écouter quand un utilisateur veut rejoindre un salon
  socket.on('join_room', (roomName) => {
    socket.join(roomName);
    console.log(`L'utilisateur ${socket.id} a rejoint le salon : ${roomName}`);
  });

  // Recevoir un message et l'envoyer uniquement dans le bon salon
  socket.on('send_message', (data) => {
    //
    io.to(data.room).emit('receive_message', data);
  });

  socket.on('disconnect', () => {
    console.log(`Utilisateur déconnecté : ${socket.id}`);
  });
});