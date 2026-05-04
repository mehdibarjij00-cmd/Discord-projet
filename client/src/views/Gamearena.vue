<script setup>
import { ref, nextTick, onMounted, onUnmounted, computed, watch } from 'vue';
import { io } from 'socket.io-client';
import Uno from './Uno.vue';

const Swal = window.Swal;

// -------------------------------------------------------
// PSEUDO & PROFIL JOUEUR
// -------------------------------------------------------
const localPlayer = ref({ name: '', avatar: '', elo: 1000, wins: 0, losses: 0, history: [] });
const showProfileSetup = ref(false);
const pseudoInput = ref('');
const avatarSeed = ref(Math.random().toString(36).substring(2, 8));

const AVATAR_STYLES = ['avataaars', 'bottts', 'pixel-art', 'lorelei', 'adventurer'];
const selectedAvatarStyle = ref('avataaars');

const avatarUrl = computed(() =>
  `https://api.dicebear.com/7.x/${selectedAvatarStyle.value}/svg?seed=${avatarSeed.value}`
);

// ✅ initPlayer : charge d'abord depuis 'user' (compte connecté), puis 'arenalink_player'
const initPlayer = () => {
  // Priorité 1 : compte connecté (localStorage 'user')
  const storedUser = JSON.parse(localStorage.getItem('user') || 'null');
  if (storedUser && storedUser.name) {
    const saved = JSON.parse(localStorage.getItem('arenalink_player') || 'null');
    if (saved && saved.name === storedUser.name) {
      // Fusionner : prendre les stats locales mais l'avatar du compte
      localPlayer.value = {
        ...saved,
        avatar: storedUser.avatar || saved.avatar,
        name:   storedUser.name,
      };
    } else {
      // Premier lancement avec ce compte : créer un profil arène
      localPlayer.value = {
        name:    storedUser.name,
        avatar:  storedUser.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${storedUser.name}`,
        elo:     1000,
        wins:    0,
        losses:  0,
        history: [],
      };
      localStorage.setItem('arenalink_player', JSON.stringify(localPlayer.value));
    }
    showProfileSetup.value = false;
    return;
  }

  // Priorité 2 : profil arène seul (pas de compte)
  const saved = localStorage.getItem('arenalink_player');
  if (saved) {
    localPlayer.value = JSON.parse(saved);
    showProfileSetup.value = false;
  } else {
    showProfileSetup.value = true;
  }
};

const saveProfile = () => {
  if (!pseudoInput.value.trim()) return;
  localPlayer.value = {
    name:    pseudoInput.value.trim(),
    avatar:  avatarUrl.value,
    elo:     1000,
    wins:    0,
    losses:  0,
    history: [],
  };
  localStorage.setItem('arenalink_player', JSON.stringify(localPlayer.value));
  showProfileSetup.value = false;
};

const savePlayerLocal = () => {
  localStorage.setItem('arenalink_player', JSON.stringify(localPlayer.value));
};

//  DECONNEXION
const logout = () => {
  Swal.fire({
    icon: 'question',
    title: 'Se déconnecter ?',
    text: 'Tes stats locales seront conservées.',
    background: '#111827',
    color: '#f9fafb',
    confirmButtonColor: '#ef4444',
    confirmButtonText: '🚪 Déconnexion',
    showCancelButton: true,
    cancelButtonText: 'Annuler',
  }).then((res) => {
    if (res.isConfirmed) {
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      // Rediriger vers la page de connexion
      window.location.href = '/';
    }
  });
};

// ELO calculation
const calcElo = (myElo, oppElo, won) => {
  const K = 32;
  const expected = 1 / (1 + Math.pow(10, (oppElo - myElo) / 400));
  const score = won ? 1 : 0;
  return Math.round(myElo + K * (score - expected));
};

const recordResult = (won, game, score) => {
  const oppElo = 1000;
  const newElo = calcElo(localPlayer.value.elo, oppElo, won);
  const eloDiff = newElo - localPlayer.value.elo;
  localPlayer.value.elo = newElo;
  if (won) localPlayer.value.wins++;
  else localPlayer.value.losses++;
  localPlayer.value.history.unshift({
    game,
    result: won ? 'Victoire' : 'Défaite',
    score,
    elo: newElo,
    eloDiff,
    date: new Date().toLocaleDateString('fr-FR'),
  });
  if (localPlayer.value.history.length > 20) localPlayer.value.history.pop();
  savePlayerLocal();
};

// -------------------------------------------------------
// ÉTATS PRINCIPAUX
// -------------------------------------------------------
const currentStep  = ref('selection');
const selectedGame = ref(null);
const roomCode     = ref('');
const isSpectator  = ref(false);

const games = [
  { id: 'pong',  name: 'Neon Pong',   icon: '🏓', color: 'from-blue-500 to-indigo-600',   desc: '2 joueurs • Classique' },
  { id: 'xo',   name: 'Tic-Tac-Toe', icon: '❌',  color: 'from-pink-500 to-rose-600',     desc: '2 joueurs • Tactique'  },
  { id: 'snake', name: 'Cyber Snake', icon: '🐍', color: 'from-green-500 to-emerald-600', desc: '1 joueur • Solo'       },
  { id: 'uno',   name: 'UNO',         icon: '🎴', color: 'from-red-500 via-yellow-500 to-blue-500', desc: '2-4 joueurs • Cartes' },
];

const currentRoom = ref({ code: '', players: [], spectators: [], isSolo: false });

// -------------------------------------------------------
// SYNCHRO LANCEMENT DE PARTIE (les 2 joueurs doivent cliquer)
// -------------------------------------------------------
const localReady    = ref(false); // moi, j'ai cliqué sur "Lancer la partie"
const opponentReady = ref(false); // l'adversaire a cliqué

// -------------------------------------------------------
// NOTIFICATIONS
// -------------------------------------------------------
const notifications = ref([]);
let notifId = 0;

const pushNotif = (msg, type = 'info', duration = 3500) => {
  const id = notifId++;
  notifications.value.unshift({ id, msg, type });
  setTimeout(() => {
    notifications.value = notifications.value.filter(n => n.id !== id);
  }, duration);
};

const notifIcon = (type) => ({ info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌', invite: '🎮', elo: '📈' }[type] || 'ℹ️');

// -------------------------------------------------------
// ROOMS PUBLIQUES
// -------------------------------------------------------
const publicRooms = ref([]);
const showPublicRooms = ref(false);

const refreshPublicRooms = () => {
  if (socket) socket.emit('list-public-rooms');
};

// -------------------------------------------------------
// RÉACTIONS EMOJI
// -------------------------------------------------------
const EMOJIS = ['🔥', '😱', '🤝', '👏', '💀', '😂', '🏆', '⚡', '🫏', '🤟', '👎', '🖕', '👿'];
const showEmojiPicker = ref(false);
const floatingEmojis = ref([]);
let emojiId = 0;

const sendReaction = (emoji) => {
  showEmojiPicker.value = false;
  addFloatingEmoji(emoji);
  if (socket && !currentRoom.value.isSolo) {
    socket.emit('game-action', {
      roomCode: currentRoom.value.code,
      game: 'reaction',
      action: 'emoji',
      emoji,
      from: localPlayer.value.name,
    });
  }
};

const addFloatingEmoji = (emoji) => {
  const id = emojiId++;
  const x = 20 + Math.random() * 60;
  floatingEmojis.value.push({ id, emoji, x });
  setTimeout(() => {
    floatingEmojis.value = floatingEmojis.value.filter(e => e.id !== id);
  }, 2000);
};

// -------------------------------------------------------
// SIDEBAR — CHANNELS & NAVIGATION
// -------------------------------------------------------
const sidebarOpen    = ref(true);
const activeChannel  = ref('general');
const activeSideTab  = ref('channels');

const channels = [
  { id: 'general',     label: 'général',      icon: '💬' },
  { id: 'games',       label: 'jeux',         icon: '🎮' },
  { id: 'spectators',  label: 'spectateurs',  icon: '👁'  },
  { id: 'leaderboard', label: 'classement',   icon: '🏆' },
];

const channelMessages = ref({
  general:     [],
  games:       [],
  spectators:  [],
  leaderboard: [],
});
const channelInput = ref('');

const sendChannelMessage = () => {
  const text = channelInput.value.trim();
  if (!text) return;
  channelMessages.value[activeChannel.value].push({
    sender: localPlayer.value.name || 'Moi',
    avatar: localPlayer.value.avatar,
    text,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    self: true,
  });
  if (socket) {
    socket.emit('channel-message', {
      channel: activeChannel.value,
      message: {
        sender: localPlayer.value.name || 'Joueur',
        avatar: localPlayer.value.avatar,
        text,
      },
    });
  }
  channelInput.value = '';
  nextTick(() => {
    const box = document.getElementById(`ch-box-${activeChannel.value}`);
    if (box) box.scrollTop = box.scrollHeight;
  });
};

// -------------------------------------------------------
// CHAT EN JEU (room)
// -------------------------------------------------------
const chatMessage  = ref('');
const roomMessages = ref([]);

const sendRoomMessage = () => {
  const text = chatMessage.value.trim();
  if (!text) return;
  const msgObj = {
    sender: localPlayer.value.name || 'Moi',
    avatar: localPlayer.value.avatar,
    text,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    self: true,
  };
  roomMessages.value.push(msgObj);
  if (socket && !currentRoom.value.isSolo) {
    socket.emit('game-action', {
      roomCode: currentRoom.value.code,
      game: 'chat',
      action: 'message',
      message: { ...msgObj, self: false },
    });
  }
  chatMessage.value = '';
  nextTick(() => {
    const box = document.getElementById('arena-chat-box');
    if (box) box.scrollTop = box.scrollHeight;
  });
};

// -------------------------------------------------------
// LEADERBOARD
// -------------------------------------------------------
const globalLeaderboard = ref([]);

const updateLeaderboard = () => {
  if (socket) {
    socket.emit('update-leaderboard', {
      name:   localPlayer.value.name,
      avatar: localPlayer.value.avatar,
      elo:    localPlayer.value.elo,
      wins:   localPlayer.value.wins,
      losses: localPlayer.value.losses,
    });
  }
};

const eloRank = (elo) => {
  if (elo >= 1400) return { label: 'Diamant 💎', color: 'text-cyan-400' };
  if (elo >= 1200) return { label: 'Platine 🔷', color: 'text-blue-400' };
  if (elo >= 1100) return { label: 'Or 🥇', color: 'text-yellow-400' };
  if (elo >= 1000) return { label: 'Argent 🥈', color: 'text-gray-300' };
  return { label: 'Bronze 🥉', color: 'text-orange-400' };
};

// -------------------------------------------------------
// SOCKET.IO
// -------------------------------------------------------
let socket = null;

onMounted(() => {
  initPlayer();
socket = io(import.meta.env.VITE_API_URL);

  socket.on('game-status', (data) => {
    if (data.status === 'ready') {
      if (currentRoom.value.players.length === 1) {
        currentRoom.value.players.push({
          name:   data.playerName || 'Adversaire',
          role:   'Joueur 2',
          avatar: data.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=Guest`,
          elo:    data.elo || 1000,
        });
        pushNotif(`${data.playerName || 'Un joueur'} a rejoint la salle !`, 'success');
      }
    } else if (data.status === 'error') {
      Swal.fire({ icon: 'error', title: 'Erreur', text: data.message, background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1' });
      goBack();
    }
  });

  socket.on('game-start', () => { launchGameNow(); });

  // L'adversaire a cliqué sur "Lancer la partie"
  socket.on('opponent-ready', (data) => {
    opponentReady.value = true;
    pushNotif(`🎯 ${data?.playerName || 'Ton adversaire'} est prêt !`, 'info');
  });

  // Quelqu'un quitte la salle → reset des "ready"
  socket.on('player-left', () => {
    localReady.value    = false;
    opponentReady.value = false;
  });

  socket.on('channel-message', (data) => {
    if (channelMessages.value[data.channel]) {
      channelMessages.value[data.channel].push({
        sender: data.message.sender,
        avatar: data.message.avatar,
        text:   data.message.text,
        time:   new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        self:   false,
      });
    }
  });

  socket.on('room-invite', (data) => {
    pushNotif(`🎮 ${data.from} t'invite à rejoindre ${data.roomCode} !`, 'invite', 6000);
    Swal.fire({
      icon: 'info',
      title: `🎮 Invitation de ${data.from}`,
      text: `Rejoindre la salle ${data.roomCode} (${data.game}) ?`,
      background: '#111827', color: '#f9fafb',
      confirmButtonColor: '#6366f1', confirmButtonText: 'Rejoindre !',
      showCancelButton: true, cancelButtonText: 'Refuser',
    }).then((res) => {
      if (res.isConfirmed) {
        roomCode.value = data.roomCode;
        const g = games.find(g => g.id === data.gameId) || games[0];
        selectedGame.value = g;
        joinRoom();
      }
    });
  });

  socket.on('public-rooms-list', (data) => {
    publicRooms.value = data.rooms || [];
  });

  socket.on('leaderboard-update', (data) => {
    globalLeaderboard.value = data.players || [];
  });

  socket.on('spectator-joined', (data) => {
    pushNotif(`👁 ${data.name} regarde la partie`, 'info');
    if (!currentRoom.value.spectators.find(s => s.name === data.name)) {
      currentRoom.value.spectators.push({ name: data.name, avatar: data.avatar });
    }
  });

  socket.on('opponent-action', (data) => {
    if (data.game === 'chat' && data.action === 'message') {
      roomMessages.value.push({ ...data.message, self: false });
      nextTick(() => {
        const box = document.getElementById('arena-chat-box');
        if (box) box.scrollTop = box.scrollHeight;
      });
    }

    if (data.game === 'reaction' && data.action === 'emoji') {
      addFloatingEmoji(data.emoji);
      pushNotif(`${data.from} réagit ${data.emoji}`, 'info', 2000);
    }

    if (data.game === 'xo') {
      if (data.action === 'play')  xoPlay(data.idx, true);
      if (data.action === 'reset') xoReset(true);
    }

    if (data.game === 'pong') {
      if (data.action === 'host-update') {
        pBall.x = data.ball.x; pBall.y = data.ball.y;
        pBall.dx = data.ball.dx; pBall.dy = data.ball.dy;
        pPad1.y = data.pad1Y;
        pongScore.value = data.score;
      }
      if (data.action === 'guest-update') { pPad2.y = data.pad2Y; }
      if (data.action === 'pong-win')     { triggerPongWin(data.winner, true); }
      if (data.action === 'pong-reset') {
        pongScore.value = { p1: 0, p2: 0 };
        nextTick(() => initNeonPong());
      }
    }
  });

  setInterval(() => { if (socket) socket.emit('get-leaderboard'); }, 10000);
  socket.emit('get-leaderboard');
});

// -------------------------------------------------------
// MODE SPECTATEUR
// -------------------------------------------------------
const guardSpectator = (callback) => {
  if (isSpectator.value) {
    Swal.fire({
      icon: 'info', title: '👁 Spectateur',
      text: 'Tu es en mode spectateur, tu ne peux pas interagir.',
      background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
      timer: 1800, showConfirmButton: false,
    });
    return;
  }
  callback();
};

// -------------------------------------------------------
// NAVIGATION & SALLES
// -------------------------------------------------------
const selectGame = (game) => {
  selectedGame.value = game;
  currentStep.value  = 'join';
};

const createRoom = (isPublic = false) => {
  const code = `${selectedGame.value.id.toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  currentRoom.value = {
    code,
    isPublic,
    isSolo: false,
    players: [{
      name:   localPlayer.value.name || 'Toi',
      role:   'Joueur 1',
      avatar: localPlayer.value.avatar,
      elo:    localPlayer.value.elo,
    }],
    spectators: [],
  };
  isSpectator.value = false;
  currentStep.value  = 'lobby';
  roomMessages.value = [];
  if (socket) socket.emit('join-game-room', {
    code,
    isPublic,
    gameId:     selectedGame.value.id,
    gameName:   selectedGame.value.name,
    playerName: localPlayer.value.name,
    avatar:     localPlayer.value.avatar,
    elo:        localPlayer.value.elo,
  });
  pushNotif(`Salle ${code} créée !`, 'success');
};

// ✅ MODE SOLO : créer une room locale avec un bot, sans socket
const createSoloRoom = () => {
  if (!selectedGame.value) return;
  const gameId = selectedGame.value.id;

  // Snake est déjà solo, pas besoin de cette fonction
  if (gameId === 'snake') {
    currentRoom.value = { code: 'SOLO', isSolo: true, players: [{ name: localPlayer.value.name, role: 'Joueur 1', avatar: localPlayer.value.avatar, elo: localPlayer.value.elo }], spectators: [] };
    isSpectator.value = false;
    roomMessages.value = [];
    localReady.value    = false;
    opponentReady.value = false;
    startGame();
    return;
  }

  currentRoom.value = {
    code:    'SOLO',
    isSolo:  true,
    isPublic: false,
    players: [
      { name: localPlayer.value.name || 'Toi',  role: 'Joueur 1', avatar: localPlayer.value.avatar, elo: localPlayer.value.elo },
      { name: '🤖 Bot',                          role: 'Joueur 2', avatar: 'https://api.dicebear.com/7.x/bottts/svg?seed=AIBot', elo: 1000 },
    ],
    spectators: [],
  };
  isSpectator.value  = false;
  roomMessages.value = [];
  currentStep.value  = 'playing';

  nextTick(() => {
    if (gameId === 'pong')  initNeonPong();
    if (gameId === 'xo')    xoReset(true); // reset propre, prêt à jouer
  });

  pushNotif(`Mode Solo activé — Affronte le 🤖 Bot !`, 'info');
};

const joinRoom = () => {
  const code = roomCode.value.trim().toUpperCase();
  if (!code) {
    Swal.fire({ icon: 'warning', title: 'Code manquant', text: 'Entre un code de salle valide.', background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1' });
    return;
  }
  currentRoom.value.code = code;
  currentRoom.value.isSolo = false;
  currentRoom.value.players = [
    { name: 'Hôte', role: 'Joueur 1', avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=Host`, elo: 1000 },
    { name: localPlayer.value.name || 'Toi', role: 'Joueur 2', avatar: localPlayer.value.avatar, elo: localPlayer.value.elo },
  ];
  isSpectator.value  = false;
  currentStep.value  = 'lobby';
  roomMessages.value = [];
  if (socket) socket.emit('join-game-room', {
    code,
    playerName: localPlayer.value.name,
    avatar:     localPlayer.value.avatar,
    elo:        localPlayer.value.elo,
  });
};

const joinPublicRoom = (room) => {
  showPublicRooms.value = false;
  roomCode.value = room.code;
  const g = games.find(g => g.id === room.gameId) || games[0];
  selectedGame.value = g;
  joinRoom();
};

const joinAsSpectator = () => {
  const code = roomCode.value.trim().toUpperCase();
  if (!code) {
    Swal.fire({
      title: '👁 Rejoindre en spectateur',
      input: 'text',
      inputPlaceholder: 'Code de la salle',
      inputAttributes: { style: 'text-transform:uppercase; font-family:monospace;' },
      background: '#111827', color: '#f9fafb', confirmButtonColor: '#eab308',
      confirmButtonText: 'Rejoindre', showCancelButton: true, cancelButtonText: 'Annuler',
      preConfirm: (val) => {
        if (!val.trim()) Swal.showValidationMessage('Entre un code valide');
        return val.trim().toUpperCase();
      },
    }).then((res) => {
      if (res.isConfirmed && res.value) {
        roomCode.value = res.value;
        _doJoinSpectator(res.value);
      }
    });
    return;
  }
  _doJoinSpectator(code);
};

const _doJoinSpectator = (code) => {
  const prefix = code.split('-')[0].toLowerCase();
  const matchedGame = games.find(g => g.id === prefix) || games[0];
  selectedGame.value = matchedGame;
  currentRoom.value = {
    code,
    isSolo: false,
    players: [
      { name: 'Joueur 1 (Hôte)', role: 'Joueur 1', avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=Host`, elo: 1000 },
      { name: 'Joueur 2',        role: 'Joueur 2', avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=Guest`, elo: 1000 },
    ],
    spectators: [{ name: localPlayer.value.name || 'Spectateur', avatar: localPlayer.value.avatar }],
  };
  isSpectator.value  = true;
  currentStep.value  = 'lobby';
  roomMessages.value = [];
  if (socket) socket.emit('join-game-room', {
    code, spectator: true,
    playerName: localPlayer.value.name,
    avatar:     localPlayer.value.avatar,
  });
  pushNotif(`Tu regardes la salle ${code}`, 'info');
};

const copyInviteLink = () => {
  const link = `${window.location.origin}?join=${currentRoom.value.code}`;
  navigator.clipboard.writeText(link);
  pushNotif('Lien d\'invitation copié !', 'success');
};

const sendSocketInvite = (targetName) => {
  if (!socket) return;
  socket.emit('send-invite', {
    to:       targetName,
    from:     localPlayer.value.name,
    roomCode: currentRoom.value.code,
    gameId:   selectedGame.value?.id,
    game:     selectedGame.value?.name,
  });
  pushNotif(`Invitation envoyée à ${targetName}`, 'success');
};

const copyCode = () => {
  navigator.clipboard.writeText(currentRoom.value.code);
  pushNotif('Code copié !', 'success');
};

// 👉 Appelée quand JE clique sur "Lancer la partie".
//    Ne lance PAS la partie tout de suite — signale juste qu'on est prêt.
//    La partie ne démarre QUE quand les 2 joueurs sont prêts (event 'game-start' du serveur).
const startGame = () => {
  // Cas spectateur : on suit la partie, pas besoin d'attendre
  if (isSpectator.value) {
    launchGameNow();
    return;
  }

  // Cas solo : pas d'adversaire à attendre, on lance direct
  if (currentRoom.value.isSolo) {
    launchGameNow();
    return;
  }

  // Cas multi : si on est seul dans la salle, on bloque
  if (currentRoom.value.players.length < 2) {
    pushNotif("⏳ En attente d'un second joueur dans la salle…", 'warning');
    return;
  }

  // Évite de spammer le bouton
  if (localReady.value) return;

  localReady.value = true;
  pushNotif("✅ Tu es prêt ! En attente de l'adversaire…", 'info');

  if (socket) {
    socket.emit('player-ready', {
      code:       currentRoom.value.code,
      playerName: localPlayer.value.name,
    });
  }
};

// 👉 Lance VRAIMENT la partie (appelée seulement quand TOUT le monde est prêt,
//    ou en mode solo / spectateur).
const launchGameNow = () => {
  currentStep.value = 'playing';
  // reset pour la prochaine partie
  localReady.value    = false;
  opponentReady.value = false;
  nextTick(() => {
    if (selectedGame.value.id === 'pong')  initNeonPong();
    if (selectedGame.value.id === 'snake') initSnake();
  });
};

const quitGame = () => {
  stopAllGames();
  currentStep.value = 'lobby';
  localReady.value    = false;
  opponentReady.value = false;
};

const goBack = () => {
  stopAllGames();
  currentStep.value  = 'selection';
  selectedGame.value = null;
  roomCode.value     = '';
  isSpectator.value  = false;
  currentRoom.value  = { code: '', players: [], spectators: [], isSolo: false };
  roomMessages.value = [];
  localReady.value    = false;
  opponentReady.value = false;
};

let pongAnimId    = null;
let snakeInterval = null;

const stopAllGames = () => {
  if (pongAnimId)    { cancelAnimationFrame(pongAnimId); pongAnimId = null; }
  if (snakeInterval) { clearInterval(snakeInterval); snakeInterval = null; }
  if (window.__pongCleanup)  { window.__pongCleanup();  delete window.__pongCleanup; }
  if (window.__snakeCleanup) { window.__snakeCleanup(); delete window.__snakeCleanup; }
  xoReset(true);
};

onUnmounted(() => { stopAllGames(); if (socket) socket.disconnect(); });

// -------------------------------------------------------
// PONG (avec IA bot pour le mode solo)
// -------------------------------------------------------
const canvasRef = ref(null);
const pongScore = ref({ p1: 0, p2: 0 });
const MAX_SCORE = 7;
let pBall = { x: 400, y: 225, r: 10, dx: 5, dy: 3.5 };
let pPad1 = { x: 20,  y: 180 };
let pPad2 = { x: 768, y: 180 };

const initNeonPong = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 800, H = 450;
  canvas.width = W; canvas.height = H;
  const PADDLE_W = 12, PADDLE_H = 90, SPEED_INC = 0.4;

  const isSolo  = currentRoom.value.isSolo;
  const isHost  = isSolo || currentRoom.value.players[0]?.name === localPlayer.value.name;
  const isGuest = !isSolo && currentRoom.value.players[1]?.name === localPlayer.value.name;

  pPad1 = { x: 20, y: H / 2 - PADDLE_H / 2 };
  pPad2 = { x: W - 32, y: H / 2 - PADDLE_H / 2 };

  const keys = {};
  canvas.setAttribute('tabindex', '0');
  canvas.style.outline = 'none';
  if (!isSpectator.value) canvas.focus();

  const PONG_KEYS = ['w', 'W', 's', 'S', 'ArrowUp', 'ArrowDown'];
  const onKey = (e) => {
    if (['INPUT', 'TEXTAREA'].includes(e.target?.tagName)) return;
    if (isSpectator.value) return;
    if (PONG_KEYS.includes(e.key)) e.preventDefault();
    keys[e.key] = e.type === 'keydown';
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup',   onKey);

  if (isHost) {
    pBall = { x: W/2, y: H/2, r: 10, dx: (4+Math.random()), dy: (3+Math.random()*2)*(Math.random()>0.5?1:-1) };
  }

  if (pongAnimId) { cancelAnimationFrame(pongAnimId); pongAnimId = null; }

  const draw = () => {
    ctx.fillStyle = 'rgba(15,23,42,0.92)';
    ctx.fillRect(0, 0, W, H);
    ctx.setLineDash([14,10]);
    ctx.beginPath(); ctx.moveTo(W/2,0); ctx.lineTo(W/2,H);
    ctx.strokeStyle='#1e293b'; ctx.lineWidth=2; ctx.stroke();
    ctx.setLineDash([]);

    const drawPaddle = (x,y,color,glow) => {
      ctx.shadowBlur=18; ctx.shadowColor=glow; ctx.fillStyle=color;
      ctx.beginPath(); ctx.roundRect(x,y,PADDLE_W,PADDLE_H,6); ctx.fill();
      ctx.shadowBlur=0;
    };
    drawPaddle(pPad1.x,pPad1.y,'#818cf8','#6366f1');
    drawPaddle(pPad2.x,pPad2.y,'#fb7185','#f43f5e');

    ctx.shadowBlur=20; ctx.shadowColor='#ffffff'; ctx.fillStyle='#ffffff';
    ctx.beginPath(); ctx.arc(pBall.x,pBall.y,pBall.r,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur=0;

    ctx.font='bold 40px monospace';
    ctx.fillStyle='#818cf8'; ctx.fillText(pongScore.value.p1,W/2-70,60);
    ctx.fillStyle='#fb7185'; ctx.fillText(pongScore.value.p2,W/2+30,60);

    if (!isSpectator.value) {
      if (isHost) {
        // Contrôle joueur 1
        if ((keys['w']||keys['W']||keys['ArrowUp'])   && pPad1.y>0)           pPad1.y-=7;
        if ((keys['s']||keys['S']||keys['ArrowDown']) && pPad1.y+PADDLE_H<H)  pPad1.y+=7;

        // ✅ IA bot pour le paddle 2 en mode solo
        if (isSolo) {
          const botSpeed = 4.5;
          const botCenter = pPad2.y + PADDLE_H / 2;
          if (botCenter < pBall.y - 10 && pPad2.y + PADDLE_H < H) pPad2.y += botSpeed;
          if (botCenter > pBall.y + 10 && pPad2.y > 0)            pPad2.y -= botSpeed;
        }

        // Physique balle
        pBall.x+=pBall.dx; pBall.y+=pBall.dy;
        if (pBall.y-pBall.r<0)  { pBall.y=pBall.r;     pBall.dy= Math.abs(pBall.dy); }
        if (pBall.y+pBall.r>H)  { pBall.y=H-pBall.r;   pBall.dy=-Math.abs(pBall.dy); }

        // Collision paddle 1
        if (pBall.x-pBall.r<pPad1.x+PADDLE_W && pBall.y>pPad1.y && pBall.y<pPad1.y+PADDLE_H && pBall.dx<0) {
          pBall.dx=Math.abs(pBall.dx)+SPEED_INC;
          pBall.dy=((pBall.y-(pPad1.y+PADDLE_H/2))/(PADDLE_H/2))*6;
        }
        // Collision paddle 2
        if (pBall.x+pBall.r>pPad2.x && pBall.y>pPad2.y && pBall.y<pPad2.y+PADDLE_H && pBall.dx>0) {
          pBall.dx=-(Math.abs(pBall.dx)+SPEED_INC);
          pBall.dy=((pBall.y-(pPad2.y+PADDLE_H/2))/(PADDLE_H/2))*6;
        }

        if (pBall.x<0) { pongScore.value.p2++; cancelAnimationFrame(pongAnimId); pongAnimId=null; checkPongWinner(-1); return; }
        if (pBall.x>W) { pongScore.value.p1++; cancelAnimationFrame(pongAnimId); pongAnimId=null; checkPongWinner(1);  return; }

        // En mode multijoueur, envoyer l'état au guest
        if (!isSolo && socket) socket.emit('game-action', {
          roomCode: currentRoom.value.code, game:'pong', action:'host-update',
          ball:{x:pBall.x,y:pBall.y,dx:pBall.dx,dy:pBall.dy},
          pad1Y:pPad1.y, score:pongScore.value,
        });

      } else if (isGuest) {
        if ((keys['w']||keys['W']||keys['ArrowUp'])   && pPad2.y>0)           pPad2.y-=7;
        if ((keys['s']||keys['S']||keys['ArrowDown']) && pPad2.y+PADDLE_H<H)  pPad2.y+=7;
        pBall.x+=pBall.dx; pBall.y+=pBall.dy;
        if (socket) socket.emit('game-action', {
          roomCode: currentRoom.value.code, game:'pong', action:'guest-update', pad2Y:pPad2.y,
        });
      }
    }
    pongAnimId = requestAnimationFrame(draw);
  };
  draw();

  window.__pongCleanup = () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup',   onKey);
  };
};

const checkPongWinner = (dir) => {
  if (pongScore.value.p1>=MAX_SCORE || pongScore.value.p2>=MAX_SCORE) {
    const winner = pongScore.value.p1>=MAX_SCORE ? 'Joueur 1' : 'Joueur 2';
    const isSolo = currentRoom.value.isSolo;
    const iWon = isSolo
      ? winner === 'Joueur 1'
      : (winner==='Joueur 1' && currentRoom.value.players[0]?.name===localPlayer.value.name)
     || (winner==='Joueur 2' && currentRoom.value.players[1]?.name===localPlayer.value.name);

    if (!isSpectator.value) recordResult(iWon, 'Neon Pong', `${pongScore.value.p1}-${pongScore.value.p2}`);
    if (!isSolo && socket) socket.emit('game-action', { roomCode:currentRoom.value.code, game:'pong', action:'pong-win', winner });
    triggerPongWin(winner);
  } else {
    pBall = { x:400, y:225, r:10, dx:(4+Math.random())*dir, dy:(3+Math.random()*2)*(Math.random()>0.5?1:-1) };
    nextTick(()=>initNeonPong());
  }
};

const triggerPongWin = (winner, isFromOpponent=false) => {
  cancelAnimationFrame(pongAnimId); pongAnimId=null;
  updateLeaderboard();
  Swal.fire({
    icon:'success', title:`🏆 ${winner} gagne !`,
    html:`Score final : <b>${pongScore.value.p1}</b> – <b>${pongScore.value.p2}</b>`,
    background:'#0f172a', color:'#f9fafb', confirmButtonColor:'#6366f1',
    confirmButtonText: isSpectator.value ? 'Retour' : 'Rejouer',
  }).then(()=>{
    if (!isSpectator.value) {
      if (!isFromOpponent && !currentRoom.value.isSolo && socket) socket.emit('game-action',{roomCode:currentRoom.value.code,game:'pong',action:'pong-reset'});
      pongScore.value={p1:0,p2:0};
      nextTick(()=>initNeonPong());
    } else { currentStep.value='lobby'; }
  });
};

// -------------------------------------------------------
// SNAKE (solo uniquement, inchangé)
// -------------------------------------------------------
const snakeCanvasRef = ref(null);
const snakeScore     = ref(0);
const snakeBest      = ref(0);
const snakeRunning   = ref(false);
const CELL=20, COLS=30, ROWS=22;

const initSnake = () => {
  const canvas = snakeCanvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width=COLS*CELL; canvas.height=ROWS*CELL;
  snakeScore.value=0; snakeRunning.value=true;
  let snake=[{x:15,y:11},{x:14,y:11},{x:13,y:11}];
  let dir={x:1,y:0}, next={x:1,y:0};
  let food=randomFood(snake), alive=true;

  const onKey=(e)=>{
    if (['INPUT','TEXTAREA'].includes(e.target?.tagName)) return;
    const map={ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},w:{x:0,y:-1},s:{x:0,y:1},a:{x:-1,y:0},d:{x:1,y:0}};
    if (map[e.key] && !(map[e.key].x===-dir.x && map[e.key].y===-dir.y)) next=map[e.key];
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
  };
  window.addEventListener('keydown',onKey);

  const tick=()=>{
    if (!alive) return;
    dir=next;
    const head={x:snake[0].x+dir.x,y:snake[0].y+dir.y};
    if (head.x<0||head.x>=COLS||head.y<0||head.y>=ROWS){gameOver();return;}
    if (snake.some(s=>s.x===head.x&&s.y===head.y)){gameOver();return;}
    snake.unshift(head);
    if (head.x===food.x&&head.y===food.y){
      snakeScore.value++;
      if (snakeScore.value>snakeBest.value) snakeBest.value=snakeScore.value;
      food=randomFood(snake);
    } else { snake.pop(); }
    render();
  };

  const render=()=>{
    ctx.fillStyle='#0f172a'; ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.strokeStyle='#1e293b'; ctx.lineWidth=0.5;
    for(let x=0;x<=COLS;x++){ctx.beginPath();ctx.moveTo(x*CELL,0);ctx.lineTo(x*CELL,canvas.height);ctx.stroke();}
    for(let y=0;y<=ROWS;y++){ctx.beginPath();ctx.moveTo(0,y*CELL);ctx.lineTo(canvas.width,y*CELL);ctx.stroke();}
    snake.forEach((seg,i)=>{
      const ratio=i/snake.length;
      ctx.shadowBlur=i===0?16:0; ctx.shadowColor='#4ade80';
      ctx.fillStyle=i===0?'#86efac':`hsl(${145-ratio*30},70%,${55-ratio*20}%)`;
      ctx.beginPath(); ctx.roundRect(seg.x*CELL+2,seg.y*CELL+2,CELL-4,CELL-4,i===0?6:3); ctx.fill();
    });
    ctx.shadowBlur=0;
    ctx.shadowBlur=14; ctx.shadowColor='#f87171'; ctx.fillStyle='#fca5a5';
    ctx.beginPath(); ctx.arc(food.x*CELL+CELL/2,food.y*CELL+CELL/2,CELL/2-3,0,Math.PI*2); ctx.fill();
    ctx.shadowBlur=0;
  };

  const gameOver=()=>{
    alive=false; snakeRunning.value=false;
    clearInterval(snakeInterval); window.removeEventListener('keydown',onKey);
    recordResult(false,'Cyber Snake',`Score ${snakeScore.value}`);
    updateLeaderboard();
    Swal.fire({
      icon:'error', title:'💀 Game Over !',
      html:`Score : <b>${snakeScore.value}</b>&nbsp;&nbsp;|&nbsp;&nbsp;Meilleur : <b>${snakeBest.value}</b>`,
      background:'#0f172a', color:'#f9fafb', confirmButtonColor:'#22c55e',
      confirmButtonText:'Rejouer', showCancelButton:true, cancelButtonText:'Quitter',
    }).then((res)=>{
      if (res.isConfirmed) nextTick(()=>initSnake());
      else currentStep.value='lobby';
    });
  };

  render();
  if (snakeInterval) clearInterval(snakeInterval);
  snakeInterval=setInterval(tick,120);
  window.__snakeCleanup=()=>window.removeEventListener('keydown',onKey);
};

const randomFood=(snake)=>{
  let pos;
  do { pos={x:Math.floor(Math.random()*COLS),y:Math.floor(Math.random()*ROWS)}; }
  while(snake.some(s=>s.x===pos.x&&s.y===pos.y));
  return pos;
};

// -------------------------------------------------------
// TIC-TAC-TOE (avec IA bot pour le mode solo)
// -------------------------------------------------------
const xoBoard=ref(Array(9).fill(null));
const xoCurrentPlayer=ref('X');
const xoWinner=ref(null);
const xoDraw=ref(false);
const xoScore=ref({X:0,O:0});
const WINS=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

// ✅ IA simple pour Tic-Tac-Toe
const xoBotPlay = () => {
  if (xoWinner.value || xoDraw.value) return;

  // 1. Gagner si possible
  for (const [a,b,c] of WINS) {
    const cells = [xoBoard.value[a], xoBoard.value[b], xoBoard.value[c]];
    if (cells.filter(v=>v==='O').length===2 && cells.includes(null)) {
      const idx = [a,b,c][cells.indexOf(null)];
      xoPlay(idx, true); return;
    }
  }
  // 2. Bloquer le joueur
  for (const [a,b,c] of WINS) {
    const cells = [xoBoard.value[a], xoBoard.value[b], xoBoard.value[c]];
    if (cells.filter(v=>v==='X').length===2 && cells.includes(null)) {
      const idx = [a,b,c][cells.indexOf(null)];
      xoPlay(idx, true); return;
    }
  }
  // 3. Centre, coins, bords
  const priority = [4, 0, 2, 6, 8, 1, 3, 5, 7];
  const move = priority.find(i => !xoBoard.value[i]);
  if (move !== undefined) xoPlay(move, true);
};

const xoPlay=(idx, isFromOpponent=false)=>{
  if (xoBoard.value[idx]||xoWinner.value||xoDraw.value) return;

  const isSolo = currentRoom.value.isSolo;

  if (!isFromOpponent && !isSolo) {
    if (currentRoom.value.players[0]?.name===localPlayer.value.name && xoCurrentPlayer.value!=='X') return;
    if (currentRoom.value.players[1]?.name===localPlayer.value.name && xoCurrentPlayer.value!=='O') return;
  }

  // En mode solo : le joueur joue toujours X, ne pas jouer quand c'est le tour du bot
  if (!isFromOpponent && isSolo && xoCurrentPlayer.value !== 'X') return;

  guardSpectator(()=>{
    xoBoard.value[idx]=xoCurrentPlayer.value;

    // Envoyer au socket en mode multijoueur uniquement
    if (!isFromOpponent && !isSolo && socket)
      socket.emit('game-action',{roomCode:currentRoom.value.code,game:'xo',action:'play',idx});

    const win=WINS.find(([a,b,c])=>xoBoard.value[a]&&xoBoard.value[a]===xoBoard.value[b]&&xoBoard.value[a]===xoBoard.value[c]);
    if (win){
      xoWinner.value=xoCurrentPlayer.value;
      xoScore.value[xoCurrentPlayer.value]++;
      const iWon = isSolo
        ? xoCurrentPlayer.value === 'X'
        : (xoCurrentPlayer.value==='X'&&currentRoom.value.players[0]?.name===localPlayer.value.name)
       || (xoCurrentPlayer.value==='O'&&currentRoom.value.players[1]?.name===localPlayer.value.name);

      if (!isFromOpponent){
        recordResult(iWon,'Tic-Tac-Toe',`Joueur ${xoCurrentPlayer.value} gagne`);
        updateLeaderboard();
        Swal.fire({
          icon: iWon ? 'success' : 'error',
          title: iWon ? `🏆 Tu gagnes !` : `🤖 Le Bot gagne !`,
          background:'#111827',color:'#f9fafb',confirmButtonColor:'#6366f1',confirmButtonText:'Rejouer'
        }).then(()=>xoReset());
      }
      return;
    }

    if (xoBoard.value.every(c=>c!==null)){
      xoDraw.value=true;
      if (!isFromOpponent)
        Swal.fire({icon:'info',title:'🤝 Match nul !',background:'#111827',color:'#f9fafb',confirmButtonColor:'#6366f1',confirmButtonText:'Rejouer'}).then(()=>xoReset());
      return;
    }

    xoCurrentPlayer.value=xoCurrentPlayer.value==='X'?'O':'X';

    // ✅ En mode solo, faire jouer le bot après un délai
    if (isSolo && xoCurrentPlayer.value === 'O' && !xoWinner.value && !xoDraw.value) {
      setTimeout(() => xoBotPlay(), 450);
    }
  });
};

const xoReset=(isFromOpponent=false)=>{
  xoBoard.value=Array(9).fill(null);
  xoCurrentPlayer.value='X'; xoWinner.value=null; xoDraw.value=false;
  if (!isFromOpponent && !currentRoom.value.isSolo && socket)
    socket.emit('game-action',{roomCode:currentRoom.value.code,game:'xo',action:'reset'});
};

const xoWinCells=()=>{
  const win=WINS.find(([a,b,c])=>xoBoard.value[a]&&xoBoard.value[a]===xoBoard.value[b]&&xoBoard.value[a]===xoBoard.value[c]);
  return win||[];
};

// -------------------------------------------------------
// STATS PANEL
// -------------------------------------------------------
const showStats = ref(false);
const winRate = computed(()=>{
  const total = localPlayer.value.wins + localPlayer.value.losses;
  if (total===0) return 0;
  return Math.round((localPlayer.value.wins/total)*100);
});

// UNO handlers
const onUnoWin  = () => { recordResult(true,  'UNO', 'Victoire'); updateLeaderboard(); };
const onUnoLoss = () => { recordResult(false, 'UNO', 'Défaite');  updateLeaderboard(); };
</script>

<template>
  <!-- ══ Setup profil ══ -->
  <Transition name="fade">
  <div v-if="showProfileSetup" class="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/95 backdrop-blur-md">
    <div class="w-full max-w-md p-8 bg-gray-900 rounded-3xl border border-gray-700 shadow-2xl">
      <h2 class="text-3xl font-black text-center mb-2 bg-gradient-to-r from-indigo-400 to-pink-400 bg-clip-text text-transparent">Bienvenue sur ArenaLink</h2>
      <p class="text-gray-400 text-center text-sm mb-8">Crée ton profil pour commencer</p>

      <div class="flex flex-col items-center gap-4 mb-6">
        <div class="relative">
          <img :src="avatarUrl" class="w-24 h-24 rounded-full ring-4 ring-indigo-500/50 bg-gray-800" />
          <button @click="avatarSeed = Math.random().toString(36).substring(2,8)"
            class="absolute -bottom-1 -right-1 w-7 h-7 bg-indigo-600 rounded-full flex items-center justify-center text-xs hover:bg-indigo-500 transition">🎲</button>
        </div>
        <div class="flex gap-2 flex-wrap justify-center">
          <button v-for="style in AVATAR_STYLES" :key="style"
            @click="selectedAvatarStyle = style"
            :class="['px-2 py-1 rounded-lg text-xs font-mono transition', selectedAvatarStyle===style ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700']">
            {{ style }}
          </button>
        </div>
      </div>

      <input v-model="pseudoInput" @keyup.enter="saveProfile"
        placeholder="Ton pseudo (ex: ShadowPing)"
        maxlength="20"
        class="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-center text-white font-bold tracking-wide focus:outline-none focus:border-indigo-500 transition mb-4" />

      <button @click="saveProfile"
        :disabled="!pseudoInput.trim()"
        class="w-full py-3 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl font-bold text-white transition-all">
        Entrer dans l'arène 🚀
      </button>
    </div>
  </div>
  </Transition>

  <!-- ══ Notifications flottantes ══ -->
  <div class="fixed top-4 right-4 z-40 flex flex-col gap-2 pointer-events-none" style="max-width:300px;">
    <Transition name="notif" v-for="n in notifications" :key="n.id">
      <div class="flex items-center gap-2 px-4 py-2.5 bg-gray-800/95 border border-gray-700 rounded-xl shadow-xl text-sm text-white backdrop-blur-sm pointer-events-auto">
        <span>{{ notifIcon(n.type) }}</span>
        <span class="flex-1">{{ n.msg }}</span>
      </div>
    </Transition>
  </div>

  <!-- ══ Layout global ══ -->
  <div class="flex h-screen bg-gray-950 text-white overflow-hidden" style="font-family: 'Segoe UI', system-ui, sans-serif;">

    <!-- ══ SIDEBAR ══ -->
    <aside class="flex flex-col bg-gray-900 border-r border-gray-800 transition-all duration-300 shrink-0"
      :class="sidebarOpen ? 'w-64' : 'w-14'">

      <!-- Logo / toggle -->
      <div class="flex items-center gap-3 px-3 py-4 border-b border-gray-800">
        <button @click="sidebarOpen = !sidebarOpen"
          class="w-8 h-8 flex items-center justify-center rounded-lg bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 transition-colors shrink-0">
          <span class="text-lg">{{ sidebarOpen ? '◀' : '▶' }}</span>
        </button>
        <span v-if="sidebarOpen" class="font-black text-indigo-400 tracking-widest text-sm uppercase truncate">ArenaLink</span>
      </div>

      <!-- Tabs -->
      <div v-if="sidebarOpen" class="flex border-b border-gray-800">
        <button v-for="tab in [{id:'channels',icon:'💬'},{id:'profile',icon:'👤'},{id:'leaderboard',icon:'🏆'}]" :key="tab.id"
          @click="activeSideTab = tab.id"
          :class="['flex-1 py-2 text-xs font-semibold transition', activeSideTab===tab.id ? 'text-indigo-400 border-b-2 border-indigo-500' : 'text-gray-500 hover:text-gray-300']">
          {{ tab.icon }}
        </button>
      </div>

      <!-- TAB: Channels -->
      <nav v-if="activeSideTab==='channels' || !sidebarOpen" class="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        <p v-if="sidebarOpen" class="px-2 mb-2 text-[10px] font-bold text-gray-500 uppercase tracking-widest">Channels</p>
        <button v-for="ch in channels" :key="ch.id"
          @click="activeChannel = ch.id; activeSideTab='channels'"
          :class="['w-full flex items-center gap-3 px-2 py-2.5 rounded-lg text-sm font-medium transition-all',
            activeChannel===ch.id && activeSideTab==='channels' ? 'bg-indigo-600/25 text-indigo-300 ring-1 ring-indigo-500/40' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200']">
          <span class="text-lg shrink-0">{{ ch.icon }}</span>
          <span v-if="sidebarOpen" class="truncate"># {{ ch.label }}</span>
        </button>
      </nav>

      <!-- TAB: Profil -->
      <div v-if="activeSideTab==='profile' && sidebarOpen" class="flex-1 overflow-y-auto p-4 space-y-4">
        <div class="flex items-center gap-3">
          <img :src="localPlayer.avatar" class="w-12 h-12 rounded-full ring-2 ring-indigo-500/50 bg-gray-800" />
          <div class="flex-1 min-w-0">
            <p class="font-bold text-white truncate">{{ localPlayer.name }}</p>
            <p :class="['text-xs font-semibold', eloRank(localPlayer.elo).color]">{{ eloRank(localPlayer.elo).label }}</p>
          </div>
          <button @click="showStats = !showStats" class="text-gray-400 hover:text-white text-xs">📊</button>
        </div>

        <!-- ELO bar -->
        <div>
          <div class="flex justify-between text-xs text-gray-400 mb-1">
            <span>ELO</span><span class="font-mono font-bold text-indigo-400">{{ localPlayer.elo }}</span>
          </div>
          <div class="h-2 bg-gray-800 rounded-full overflow-hidden">
            <div class="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all duration-500"
              :style="`width:${Math.min(100, ((localPlayer.elo-800)/800)*100)}%`"></div>
          </div>
        </div>

        <!-- W/L -->
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="bg-green-500/10 border border-green-500/30 rounded-xl p-2">
            <p class="text-xl font-black text-green-400">{{ localPlayer.wins }}</p>
            <p class="text-[10px] text-gray-400">Victoires</p>
          </div>
          <div class="bg-gray-800 border border-gray-700 rounded-xl p-2">
            <p class="text-xl font-black text-indigo-400">{{ winRate }}%</p>
            <p class="text-[10px] text-gray-400">Win rate</p>
          </div>
          <div class="bg-red-500/10 border border-red-500/30 rounded-xl p-2">
            <p class="text-xl font-black text-red-400">{{ localPlayer.losses }}</p>
            <p class="text-[10px] text-gray-400">Défaites</p>
          </div>
        </div>

        <!-- Historique -->
        <div>
          <p class="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2">Historique récent</p>
          <div class="space-y-1.5 max-h-48 overflow-y-auto scrollbar-thin">
            <div v-if="localPlayer.history.length===0" class="text-xs text-gray-600 text-center py-4">Aucune partie jouée</div>
            <div v-for="(h,i) in localPlayer.history" :key="i"
              class="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-gray-800/60 text-xs">
              <span :class="h.result==='Victoire' ? 'text-green-400' : 'text-red-400'">{{ h.result==='Victoire' ? '✅' : '❌' }}</span>
              <span class="flex-1 truncate text-gray-300">{{ h.game }}</span>
              <span :class="['font-mono font-bold', h.eloDiff>=0 ? 'text-green-400' : 'text-red-400']">
                {{ h.eloDiff>=0 ? '+' : '' }}{{ h.eloDiff }}
              </span>
            </div>
          </div>
        </div>

        <button @click="showProfileSetup=true; pseudoInput=localPlayer.name"
          class="w-full py-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-xs text-gray-400 transition">
          ✏️ Modifier le profil
        </button>
      </div>

      <!-- TAB: Leaderboard global -->
      <div v-if="activeSideTab==='leaderboard' && sidebarOpen" class="flex-1 overflow-y-auto p-3">
        <div class="flex items-center justify-between mb-3">
          <p class="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Classement global</p>
          <button @click="updateLeaderboard(); socket && socket.emit('get-leaderboard')"
            class="text-gray-500 hover:text-gray-300 text-xs">🔄</button>
        </div>
        <div class="space-y-2">
          <div v-if="globalLeaderboard.length===0" class="text-xs text-gray-600 text-center py-6">
            Aucun joueur classé.<br>Joue une partie !
          </div>
          <div v-for="(p,i) in globalLeaderboard.slice(0,10)" :key="p.name"
            :class="['flex items-center gap-2 px-2 py-2 rounded-xl text-xs transition',
              p.name===localPlayer.name ? 'bg-indigo-600/20 border border-indigo-500/40' : 'bg-gray-800/60']">
            <span class="w-5 text-center font-black"
              :class="i===0?'text-yellow-400':i===1?'text-gray-300':i===2?'text-orange-400':'text-gray-500'">
              {{ i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1 }}
            </span>
            <img :src="p.avatar" class="w-6 h-6 rounded-full bg-gray-700" />
            <span class="flex-1 truncate font-semibold text-gray-200">{{ p.name }}</span>
            <span class="font-mono font-bold text-indigo-400">{{ p.elo }}</span>
          </div>
        </div>
      </div>

      <!-- Statut salle -->
      <div v-if="sidebarOpen" class="px-3 py-3 border-t border-gray-800">
        <div v-if="currentRoom.code" class="flex items-center gap-2 text-xs text-green-400">
          <span class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></span>
          <span class="font-mono truncate">{{ currentRoom.isSolo ? '🤖 SOLO' : currentRoom.code }}</span>
        </div>
        <div v-else class="flex items-center gap-2 text-xs text-gray-600">
          <span class="w-2 h-2 rounded-full bg-gray-600"></span>
          <span>Hors salle</span>
        </div>
      </div>

      <!-- ✅ BOUTON DÉCONNEXION -->
      <div class="px-2 py-3 border-t border-gray-800">
        <button
          @click="logout"
          :class="['flex items-center gap-3 rounded-xl transition-colors font-semibold text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300',
            sidebarOpen ? 'w-full px-3 py-2.5' : 'w-10 h-10 justify-center mx-auto']"
          :title="sidebarOpen ? '' : 'Déconnexion'"
        >
          <span class="text-lg shrink-0">🚪</span>
          <span v-if="sidebarOpen">Déconnexion</span>
        </button>
      </div>

      <!-- Chat channel intégré -->
      <div v-if="sidebarOpen && activeSideTab==='channels'" class="flex flex-col border-t border-gray-800" style="height:240px;">
        <div class="px-4 py-2 flex items-center gap-2 text-xs font-semibold text-gray-400 border-b border-gray-800/60">
          <span>{{ channels.find(c=>c.id===activeChannel)?.icon }}</span>
          <span># {{ channels.find(c=>c.id===activeChannel)?.label }}</span>
        </div>
        <div :id="`ch-box-${activeChannel}`" class="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin">
          <div v-if="channelMessages[activeChannel].length===0" class="text-center text-gray-600 text-xs mt-4">
            Aucun message. Sois le premier !
          </div>
          <div v-for="(msg,i) in channelMessages[activeChannel]" :key="i"
            class="flex flex-col" :class="msg.self?'items-end':'items-start'">
            <div class="flex items-center gap-1 mb-0.5">
              <img v-if="msg.avatar" :src="msg.avatar" class="w-3.5 h-3.5 rounded-full" />
              <span class="text-[10px] text-gray-500">{{ msg.sender }} · {{ msg.time }}</span>
            </div>
            <div class="px-3 py-1.5 rounded-xl text-xs max-w-[90%] break-words"
              :class="msg.self ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-gray-800 text-gray-200 rounded-bl-none'">
              {{ msg.text }}
            </div>
          </div>
        </div>
        <div class="px-3 py-2 border-t border-gray-800 flex gap-2">
          <input v-model="channelInput" @keyup.enter="sendChannelMessage"
            :placeholder="`#${channels.find(c=>c.id===activeChannel)?.label}…`"
            class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors" />
          <button @click="sendChannelMessage"
            class="px-2 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-xs font-bold transition-colors">↑</button>
        </div>
      </div>
    </aside>

    <!-- ══ ZONE PRINCIPALE ══ -->
    <div class="flex-1 flex flex-col overflow-auto relative">

      <!-- Orbes décoratifs -->
      <div class="pointer-events-none fixed inset-0 overflow-hidden -z-10">
        <div class="orb orb-1"></div><div class="orb orb-2"></div><div class="orb orb-3"></div>
        <div class="grid-bg"></div>
      </div>

      <div class="flex-1 flex flex-col items-center justify-center p-6">

        <!-- ══ Sélection ══ -->
        <Transition name="fade">
        <div v-if="currentStep==='selection'" class="w-full max-w-4xl">
          <div class="text-center mb-10">
            <div class="inline-flex items-center gap-2 px-3 py-1 bg-indigo-500/10 border border-indigo-500/30 rounded-full text-indigo-400 text-xs font-mono mb-5 tracking-widest uppercase">
              <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
              Online Multiplayer
            </div>
            <h1 class="text-5xl font-black tracking-tight mb-3 bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent" style="filter:drop-shadow(0 0 40px rgba(139,92,246,.35))">
              ArenaLink Arcade
            </h1>
            <p class="text-gray-400 text-lg">Bonjour <span class="text-indigo-400 font-bold">{{ localPlayer.name }}</span> — Choisis un jeu !</p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <div v-for="game in games" :key="game.id"
              @click="selectGame(game)"
              class="relative p-[2px] rounded-2xl cursor-pointer group hover:scale-[1.04] transition-all duration-300 shadow-xl"
              :class="`bg-gradient-to-br ${game.color}`">
              <div class="bg-gray-900 rounded-[14px] h-full p-8 flex flex-col items-center text-center gap-4 hover:bg-gray-800/90 transition-colors">
                <span class="text-7xl drop-shadow-lg">{{ game.icon }}</span>
                <h3 class="text-xl font-bold text-white">{{ game.name }}</h3>
                <span class="px-3 py-1 bg-gray-800 rounded-full text-xs text-gray-400 font-mono border border-gray-700">{{ game.desc }}</span>
                <div class="mt-2 px-5 py-2 rounded-xl font-bold text-sm text-white opacity-0 group-hover:opacity-100 transition-all" :class="`bg-gradient-to-r ${game.color}`">Jouer →</div>
              </div>
            </div>
          </div>

          <!-- Actions rapides -->
          <div class="flex flex-wrap gap-3 justify-center">
            <button @click="showPublicRooms=true; refreshPublicRooms()"
              class="inline-flex items-center gap-2 px-5 py-2.5 border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-xl font-semibold text-sm transition-all">
              🌍 Salles publiques
            </button>
            <button @click="joinAsSpectator"
              class="inline-flex items-center gap-2 px-5 py-2.5 border border-yellow-500/40 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 rounded-xl font-semibold text-sm transition-all">
              👁 Rejoindre en spectateur
            </button>
          </div>
        </div>
        </Transition>

        <!-- ══ Modal salles publiques ══ -->
        <Transition name="fade">
        <div v-if="showPublicRooms" class="fixed inset-0 z-30 flex items-center justify-center bg-gray-950/80 backdrop-blur-sm">
          <div class="w-full max-w-md bg-gray-900 rounded-2xl border border-gray-700 shadow-2xl overflow-hidden">
            <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h3 class="font-bold text-white">🌍 Salles publiques</h3>
              <button @click="showPublicRooms=false" class="text-gray-400 hover:text-white">✕</button>
            </div>
            <div class="p-4 space-y-3 max-h-80 overflow-y-auto">
              <div v-if="publicRooms.length===0" class="text-center text-gray-500 text-sm py-8">
                Aucune salle publique disponible.<br>Crée-en une !
              </div>
              <div v-for="room in publicRooms" :key="room.code"
                class="flex items-center gap-3 p-3 bg-gray-800 hover:bg-gray-700 rounded-xl cursor-pointer transition"
                @click="joinPublicRoom(room)">
                <span class="text-2xl">{{ games.find(g=>g.id===room.gameId)?.icon || '🎮' }}</span>
                <div class="flex-1">
                  <p class="font-bold text-white text-sm">{{ room.gameName }}</p>
                  <p class="text-xs text-gray-400 font-mono">{{ room.code }} · {{ room.players }}/2 joueurs</p>
                </div>
                <span class="px-3 py-1 bg-indigo-600 text-white text-xs rounded-lg font-bold">Rejoindre</span>
              </div>
            </div>
            <div class="px-6 py-3 border-t border-gray-800">
              <button @click="refreshPublicRooms" class="text-xs text-gray-400 hover:text-white">🔄 Rafraîchir</button>
            </div>
          </div>
        </div>
        </Transition>

        <!-- ══ Rejoindre / créer ══ -->
        <Transition name="fade">
        <div v-if="currentStep==='join'" class="w-full max-w-md">
          <button @click="goBack" class="text-gray-400 hover:text-white mb-6 flex items-center gap-1 text-sm transition-colors">← Retour aux jeux</button>
          <div class="bg-gray-800/70 backdrop-blur-md p-8 rounded-2xl shadow-2xl border border-gray-700/80 ring-1 ring-white/5">
            <div class="flex items-center justify-center text-6xl mb-4">{{ selectedGame.icon }}</div>
            <h2 class="text-2xl font-bold text-center mb-8">{{ selectedGame.name }}</h2>
            <div class="space-y-4">
              <button @click="createRoom(false)"
                class="w-full py-3.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold text-lg transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2">
                🏠 Salle privée (Joueur 1)
              </button>
              <button @click="createRoom(true)"
                class="w-full py-3.5 bg-purple-600/80 hover:bg-purple-500 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2">
                🌍 Salle publique (Joueur 1)
              </button>

              <!-- ✅ BOUTON SOLO (affiché pour Pong, XO et Snake) -->
              <button
                v-if="selectedGame.id === 'pong' || selectedGame.id === 'xo' || selectedGame.id === 'snake'"
                @click="createSoloRoom"
                class="w-full py-3.5 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20">
                🤖 Jouer contre le Bot (Solo)
              </button>

              <div class="flex items-center gap-4 text-gray-500 text-sm">
                <div class="flex-1 h-px bg-gray-700"></div>OU<div class="flex-1 h-px bg-gray-700"></div>
              </div>
              <div class="flex gap-2">
                <input v-model="roomCode" @keyup.enter="joinRoom"
                  placeholder="Code de la salle"
                  class="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-center uppercase tracking-widest font-mono focus:outline-none focus:border-indigo-500 transition-colors" />
                <button @click="joinRoom" class="px-5 bg-gray-700 hover:bg-indigo-600 rounded-xl font-bold transition-all">Rejoindre</button>
              </div>
              <button @click="joinAsSpectator"
                class="w-full py-2.5 border border-yellow-500/40 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2">
                👁 Rejoindre en spectateur
              </button>
            </div>
          </div>
        </div>
        </Transition>

        <!-- ══ Lobby ══ -->
        <Transition name="fade">
        <div v-if="currentStep==='lobby'" class="w-full max-w-3xl flex flex-col gap-5">

          <div v-if="isSpectator" class="flex items-center gap-3 p-4 bg-yellow-500/10 border-2 border-yellow-500/50 rounded-2xl text-yellow-300">
            <span class="text-2xl">👁</span>
            <div><p class="font-bold">Mode Spectateur actif</p><p class="text-sm text-yellow-400/80">Tu regarderas sans pouvoir interagir.</p></div>
          </div>

          <div class="bg-gray-800/70 backdrop-blur-md p-6 rounded-2xl border border-gray-700/80 flex flex-col sm:flex-row justify-between items-center gap-4">
            <div>
              <h2 class="text-2xl font-bold flex items-center gap-2">{{ selectedGame.icon }} {{ selectedGame.name }}</h2>
              <div class="flex items-center gap-2 mt-1">
                <span class="text-gray-400 text-sm">Salle d'attente</span>
                <span v-if="currentRoom.isPublic" class="px-2 py-0.5 bg-purple-600/30 text-purple-400 rounded-full text-xs font-bold border border-purple-500/40">🌍 Publique</span>
              </div>
            </div>
            <div class="flex items-center gap-2 flex-wrap justify-end">
              <div class="bg-gray-900 px-5 py-2.5 rounded-xl border border-gray-700 flex items-center gap-3">
                <span class="text-2xl font-mono text-indigo-400 tracking-widest font-bold">{{ currentRoom.code }}</span>
                <button @click="copyCode" class="p-1.5 bg-gray-800 hover:bg-indigo-600 rounded-lg transition-colors text-sm" title="Copier le code">📋</button>
                <button @click="copyInviteLink" class="p-1.5 bg-gray-800 hover:bg-purple-600 rounded-lg transition-colors text-sm" title="Copier le lien d'invitation">🔗</button>
              </div>
            </div>
          </div>

          <!-- Joueurs -->
          <div class="bg-gray-800/70 backdrop-blur-md p-6 rounded-2xl border border-gray-700/80">
            <h3 class="text-sm font-semibold text-indigo-400 uppercase tracking-wider mb-4">👥 Joueurs</h3>
            <div class="flex gap-4 flex-wrap">
              <div v-for="(player, i) in currentRoom.players" :key="i"
                class="flex-1 min-w-[180px] bg-gray-900 border border-indigo-500/40 p-4 rounded-xl">
                <div class="flex items-center gap-3 mb-2">
                  <img :src="player.avatar" class="w-12 h-12 rounded-full bg-gray-700 ring-2 ring-indigo-500/50" />
                  <div>
                    <p class="font-bold text-white text-sm">{{ player.name }}</p>
                    <p class="text-xs text-indigo-400">{{ player.role }}</p>
                  </div>
                </div>
                <div class="flex items-center justify-between">
                  <span :class="['text-xs font-bold', eloRank(player.elo||1000).color]">{{ eloRank(player.elo||1000).label }}</span>
                  <span class="font-mono text-xs text-gray-400">{{ player.elo || 1000 }} ELO</span>
                </div>
                <button v-if="i===1 && !isSpectator && player.name!==localPlayer.name && !currentRoom.isSolo"
                  @click="sendSocketInvite(player.name)"
                  class="mt-2 w-full py-1 bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-400 rounded-lg text-xs font-semibold transition">
                  📨 Inviter
                </button>
              </div>
              <div v-if="currentRoom.players.length < 2"
                class="flex-1 min-w-[180px] bg-gray-900/50 border border-dashed border-gray-600 p-4 rounded-xl flex items-center justify-center text-gray-500 text-sm gap-2">
                <span class="animate-pulse">⏳</span> En attente du Joueur 2…
              </div>
            </div>

            <!-- Spectateurs -->
            <div v-if="currentRoom.spectators.length > 0" class="mt-4">
              <h3 class="text-sm font-semibold text-yellow-400 uppercase tracking-wider mb-2">👁 Spectateurs ({{ currentRoom.spectators.length }})</h3>
              <div class="flex gap-2 flex-wrap">
                <div v-for="(spec, i) in currentRoom.spectators" :key="i"
                  class="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 px-3 py-1.5 rounded-full text-xs text-yellow-300">
                  <img :src="spec.avatar" class="w-5 h-5 rounded-full" />{{ spec.name }}
                </div>
              </div>
            </div>

            <div class="mt-6 flex justify-between items-center">
              <button @click="goBack" class="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-xl text-sm font-semibold transition-all">← Retour</button>
              <button @click="startGame"
                :disabled="!isSpectator && !currentRoom.isSolo && (localReady || currentRoom.players.length < 2)"
                :class="[
                  'px-8 py-3 rounded-xl font-bold text-white shadow-lg transition-all',
                  (!isSpectator && !currentRoom.isSolo && (localReady || currentRoom.players.length < 2))
                    ? 'bg-gray-600 cursor-not-allowed opacity-70'
                    : 'bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 hover:scale-105 shadow-green-600/20'
                ]">
                <template v-if="isSpectator">👁 Regarder la partie</template>
                <template v-else-if="currentRoom.isSolo">🚀 Lancer la partie !</template>
                <template v-else-if="currentRoom.players.length < 2">⏳ En attente du Joueur 2…</template>
                <template v-else-if="localReady && opponentReady">🎮 Lancement…</template>
                <template v-else-if="localReady">⏳ En attente de l'adversaire…</template>
                <template v-else-if="opponentReady">✅ Adversaire prêt — Clique pour lancer !</template>
                <template v-else>🚀 Lancer la partie !</template>
              </button>
            </div>
          </div>
        </div>
        </Transition>

        <!-- ══ Jeu en cours ══ -->
        <Transition name="fade">
        <div v-if="currentStep==='playing'" class="w-full flex flex-col items-center gap-4 relative">

          <!-- Emojis flottants -->
          <div class="pointer-events-none fixed inset-0 z-20 overflow-hidden">
            <Transition name="float" v-for="e in floatingEmojis" :key="e.id">
              <span class="absolute text-3xl float-emoji" :style="`left:${e.x}%; bottom: 30%;`">{{ e.emoji }}</span>
            </Transition>
          </div>

          <div v-if="isSpectator"
            class="w-full max-w-4xl flex items-center gap-3 px-4 py-2.5 bg-yellow-500/10 border border-yellow-500/40 rounded-xl text-yellow-300 text-sm font-semibold">
            <span>👁</span> Mode Spectateur — Interactions désactivées
          </div>

          <!-- ✅ Badge mode solo -->
          <div v-if="currentRoom.isSolo"
            class="w-full max-w-4xl flex items-center gap-3 px-4 py-2.5 bg-emerald-500/10 border border-emerald-500/40 rounded-xl text-emerald-300 text-sm font-semibold">
            <span>🤖</span> Mode Solo — Tu joues contre le Bot
          </div>

          <!-- PONG -->
          <template v-if="selectedGame.id==='pong'">
            <div class="flex justify-between w-full max-w-4xl px-2 mb-2">
              <div class="flex flex-col items-center">
                <span class="text-xs text-gray-400 uppercase">{{ currentRoom.players[0]?.name }}</span>
                <span class="text-4xl font-black text-indigo-400 font-mono">{{ pongScore.p1 }}</span>
              </div>
              <div class="flex flex-col items-center text-center">
                <span class="text-xs text-gray-400">{{ isSpectator ? 'Regarder' : 'W/S ou ↑↓' }}</span>
                <span class="text-sm text-gray-500">Premier à {{ MAX_SCORE }} points</span>
              </div>
              <div class="flex flex-col items-center">
                <span class="text-xs text-gray-400 uppercase">{{ currentRoom.players[1]?.name }}</span>
                <span class="text-4xl font-black text-rose-400 font-mono">{{ pongScore.p2 }}</span>
              </div>
            </div>
            <canvas ref="canvasRef" :tabindex="isSpectator?-1:0"
              @click="!isSpectator && $event.target.focus()"
              class="border-2 border-gray-700 rounded-2xl shadow-2xl outline-none"
              style="max-width:100%; box-shadow:0 0 40px rgba(99,102,241,.15),0 16px 48px rgba(0,0,0,.5);"
              :class="isSpectator?'cursor-default opacity-90':'cursor-pointer'"></canvas>
          </template>

          <!-- SNAKE -->
          <template v-if="selectedGame.id==='snake'">
            <div class="flex justify-between w-full max-w-2xl px-2 mb-2">
              <div class="flex flex-col items-center">
                <span class="text-xs text-gray-400 uppercase">Score</span>
                <span class="text-4xl font-black text-green-400 font-mono">{{ snakeScore }}</span>
              </div>
              <div class="flex flex-col items-center text-center">
                <span class="text-xs text-gray-400">Flèches ou WASD</span>
              </div>
              <div class="flex flex-col items-center">
                <span class="text-xs text-gray-400 uppercase">Meilleur</span>
                <span class="text-4xl font-black text-yellow-400 font-mono">{{ snakeBest }}</span>
              </div>
            </div>
            <canvas ref="snakeCanvasRef" class="border-2 border-gray-700 rounded-2xl shadow-2xl"
              style="max-width:100%; box-shadow:0 0 40px rgba(34,197,94,.12),0 16px 48px rgba(0,0,0,.5);"></canvas>
          </template>

          <!-- TIC-TAC-TOE -->
          <template v-if="selectedGame.id==='xo'">
            <div class="flex gap-12 mb-4">
              <div class="flex flex-col items-center">
                <span class="text-xs text-gray-400 uppercase">{{ currentRoom.isSolo ? 'Toi (X)' : 'Joueur X' }}</span>
                <span class="text-4xl font-black text-pink-400 font-mono">{{ xoScore.X }}</span>
              </div>
              <div class="flex flex-col items-center justify-center">
                <span class="text-sm text-gray-500">
                  {{ xoWinner ? `🏆 ${currentRoom.isSolo && xoWinner==='X' ? 'Tu gagnes !' : currentRoom.isSolo && xoWinner==='O' ? '🤖 Bot gagne !' : `Joueur ${xoWinner} gagne !`}` : xoDraw ? '🤝 Match nul !' : currentRoom.isSolo ? (xoCurrentPlayer==='X' ? '🎯 Ton tour !' : '🤖 Bot réfléchit…') : `Tour : Joueur ${xoCurrentPlayer}` }}
                </span>
              </div>
              <div class="flex flex-col items-center">
                <span class="text-xs text-gray-400 uppercase">{{ currentRoom.isSolo ? '🤖 Bot (O)' : 'Joueur O' }}</span>
                <span class="text-4xl font-black text-indigo-400 font-mono">{{ xoScore.O }}</span>
              </div>
            </div>
            <div class="grid grid-cols-3 gap-3" style="width:300px;" :class="isSpectator || (currentRoom.isSolo && xoCurrentPlayer==='O') ?'pointer-events-none opacity-80':''">
              <button v-for="(cell, i) in xoBoard" :key="i" @click="xoPlay(i)"
                :class="['w-24 h-24 rounded-2xl font-black text-4xl border-2 transition-all duration-200',
                  xoWinCells().includes(i)?'border-yellow-400 bg-yellow-400/10 scale-105':'border-gray-700 bg-gray-800/80 hover:bg-gray-700 hover:border-gray-500 hover:scale-105',
                  cell==='X'?'text-pink-400':'text-indigo-400']">
                {{ cell || '' }}
              </button>
            </div>
            <div class="flex gap-4 mt-6">
              <button v-if="!isSpectator" @click="xoReset" class="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-xl font-semibold text-sm transition-all">🔄 Nouvelle partie</button>
            </div>
          </template>

          <!-- UNO -->
          <template v-if="selectedGame.id === 'uno'">
            <Uno
              :room-code="currentRoom.code"
              :local-player="localPlayer"
              :is-host="currentRoom.players[0]?.name === localPlayer.name"
              :is-spectator="isSpectator"
              :socket="socket"
              @quit="goBack"
              @win="onUnoWin"
              @loss="onUnoLoss"
            />
          </template>

          <!-- ── Barre actions en jeu ── -->
          <div class="w-full max-w-4xl flex items-center gap-3">
            <div class="relative">
              <button @click="showEmojiPicker=!showEmojiPicker"
                class="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-xl text-sm font-bold transition">
                😄 Réagir
              </button>
              <div v-if="showEmojiPicker"
                class="absolute bottom-12 left-0 bg-gray-800 border border-gray-700 rounded-2xl p-3 flex gap-2 flex-wrap shadow-2xl z-20" style="width:200px;">
                <button v-for="emoji in EMOJIS" :key="emoji"
                  @click="sendReaction(emoji)"
                  class="text-2xl hover:scale-125 transition-transform">{{ emoji }}</button>
              </div>
            </div>

            <div class="flex-1"></div>

            <button @click="quitGame"
              class="px-5 py-2 bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white rounded-xl font-bold transition-all text-sm">
              ← {{ isSpectator ? 'Quitter le spectacle' : 'Quitter le match' }}
            </button>
          </div>

          <!-- Chat en jeu -->
          <div class="w-full max-w-4xl bg-gray-900/80 border border-gray-700/60 rounded-2xl overflow-hidden">
            <div class="px-4 py-2 border-b border-gray-700/60 flex items-center gap-2 text-xs font-semibold text-gray-400">
              💬 Chat de la salle
              <span v-if="currentRoom.isSolo" class="ml-auto text-emerald-500/80">🤖 Solo</span>
              <span v-else-if="isSpectator" class="ml-auto text-yellow-500/80">👁 spectateur</span>
            </div>
            <div id="arena-chat-box" class="h-28 overflow-y-auto p-3 space-y-1.5 scrollbar-thin">
              <div v-if="roomMessages.length===0" class="text-center text-gray-600 text-xs mt-4">Aucun message…</div>
              <div v-for="(msg,i) in roomMessages" :key="i"
                class="flex flex-col" :class="msg.self?'items-end':'items-start'">
                <div class="flex items-center gap-1 mb-0.5">
                  <img v-if="msg.avatar" :src="msg.avatar" class="w-3.5 h-3.5 rounded-full" />
                  <span class="text-[10px] text-gray-500">{{ msg.sender }} · {{ msg.time }}</span>
                </div>
                <div class="px-3 py-1 rounded-xl text-sm max-w-[80%] break-words"
                  :class="msg.self?'bg-indigo-600 text-white':'bg-gray-800 text-gray-200'">
                  {{ msg.text }}
                </div>
              </div>
            </div>
            <div class="px-3 py-2 border-t border-gray-700/60 flex gap-2">
              <input v-model="chatMessage" @keyup.enter="sendRoomMessage"
                placeholder="Écris un message…"
                class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors" />
              <button @click="sendRoomMessage"
                class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-bold transition-colors">↑</button>
            </div>
          </div>

        </div>
        </Transition>

      </div>
    </div>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s, transform 0.25s; }
.fade-enter-from { opacity: 0; transform: translateY(12px); }
.fade-leave-to   { opacity: 0; transform: translateY(-8px); }

.notif-enter-active, .notif-leave-active { transition: all 0.3s; }
.notif-enter-from { opacity: 0; transform: translateX(40px); }
.notif-leave-to   { opacity: 0; transform: translateX(40px); }

.float-emoji {
  animation: floatUp 2s ease-out forwards;
  font-size: 2rem;
}
@keyframes floatUp {
  0%   { opacity: 1; transform: translateY(0) scale(1); }
  80%  { opacity: 1; }
  100% { opacity: 0; transform: translateY(-120px) scale(1.4); }
}

.orb { position:absolute; border-radius:50%; filter:blur(80px); opacity:.10; animation:drift 20s ease-in-out infinite alternate; }
.orb-1 { width:500px; height:500px; background:radial-gradient(circle,#6366f1,transparent); top:-100px; left:-100px; animation-duration:25s; }
.orb-2 { width:400px; height:400px; background:radial-gradient(circle,#ec4899,transparent); bottom:-80px; right:-80px; animation-duration:18s; animation-delay:-8s; }
.orb-3 { width:300px; height:300px; background:radial-gradient(circle,#22c55e,transparent); top:50%; left:50%; transform:translate(-50%,-50%); animation-duration:30s; animation-delay:-14s; }
@keyframes drift {
  0%   { transform:translate(0,0) scale(1); }
  50%  { transform:translate(40px,-30px) scale(1.1); }
  100% { transform:translate(-20px,20px) scale(.95); }
}

.grid-bg {
  position:absolute; inset:0;
  background-image:linear-gradient(rgba(99,102,241,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,.04) 1px,transparent 1px);
  background-size:48px 48px;
}

.scrollbar-thin::-webkit-scrollbar { width:4px; }
.scrollbar-thin::-webkit-scrollbar-track { background:transparent; }
.scrollbar-thin::-webkit-scrollbar-thumb { background:#374151; border-radius:2px; }
</style>