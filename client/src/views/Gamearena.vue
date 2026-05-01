<script setup>
import { ref, nextTick, onMounted, onUnmounted, computed } from 'vue';
import { io } from 'socket.io-client';

const Swal = window.Swal;

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
];

const currentRoom = ref({ code: '', players: [], spectators: [] });

// -------------------------------------------------------
// SOCKET.IO — CONNEXION MULTIJOUEUR
// -------------------------------------------------------
let socket = null;

onMounted(() => {
  socket = io('http://localhost:3001');

  socket.on('game-status', (data) => {
    if (data.status === 'ready') {
      if (currentRoom.value.players.length === 1) {
        currentRoom.value.players.push({ name: 'Adversaire', role: 'Joueur 2', avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=Guest` });
      }
    } else if (data.status === 'error') {
      Swal.fire({ icon: 'error', title: 'Erreur', text: data.message, background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1' });
      goBack();
    }
  });

  socket.on('game-start', () => { startGame(); });

  socket.on('opponent-action', (data) => {
    // === TIC-TAC-TOE ===
    if (data.game === 'xo') {
      if (data.action === 'play') xoPlay(data.idx, true);
      if (data.action === 'reset') xoReset(true);
    }
    // === NEON PONG ===
    if (data.game === 'pong') {
      if (data.action === 'host-update') {
        pBall.x = data.ball.x;
        pBall.y = data.ball.y;
        // 🔴 NOUVEAU : On récupère aussi la VITESSE de la balle
        pBall.dx = data.ball.dx; 
        pBall.dy = data.ball.dy;
        
        pPad1.y = data.pad1Y;
        pongScore.value = data.score;
      }
      if (data.action === 'guest-update') {
        pPad2.y = data.pad2Y;
      }
      if (data.action === 'pong-win') {
        triggerPongWin(data.winner, true);
      }
      if (data.action === 'pong-reset') {
        pongScore.value = { p1: 0, p2: 0 };
        nextTick(() => initNeonPong());
      }
    }
  });
});

// -------------------------------------------------------
// MODE SPECTATEUR
// -------------------------------------------------------
const spectatorBanner = computed(() => isSpectator.value
  ? { show: true, msg: '👁 Mode Spectateur — tu regardes sans pouvoir jouer' }
  : { show: false, msg: '' }
);

const guardSpectator = (callback) => {
  if (isSpectator.value) {
    Swal.fire({ icon: 'info', title: '👁 Spectateur', text: 'Tu es en mode spectateur, tu ne peux pas interagir.', background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1', timer: 1800, showConfirmButton: false });
    return;
  }
  callback();
};

// -------------------------------------------------------
// NAVIGATION & SALLES
// -------------------------------------------------------
const selectGame = (game) => { selectedGame.value = game; currentStep.value  = 'join'; };

const createRoom = () => {
  const code = `${selectedGame.value.id.toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  currentRoom.value = { code, players: [{ name: 'Toi', role: 'Joueur 1', avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=Host` }], spectators: [] };
  isSpectator.value = false; currentStep.value = 'lobby';
  if (socket) socket.emit('join-game-room', code);
};

const joinRoom = () => {
  const code = roomCode.value.trim().toUpperCase();
  if (!code) { Swal.fire({ icon: 'warning', title: 'Code manquant', text: 'Entre un code de salle valide.', background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1' }); return; }
  currentRoom.value.code = code;
  currentRoom.value.players = [
    { name: 'Adversaire (Hôte)', role: 'Joueur 1', avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=Host` },
    { name: 'Toi', role: 'Joueur 2', avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=Guest` }
  ];
  isSpectator.value = false; currentStep.value = 'lobby';
  if (socket) socket.emit('join-game-room', code);
};

const joinAsSpectator = () => {
  const code = roomCode.value.trim().toUpperCase();
  if (!code) return;
  currentRoom.value.code = code;
  currentRoom.value.spectators.push({ name: 'Toi (Spectateur)', avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=Watcher` });
  isSpectator.value = true; currentStep.value = 'lobby';
  if (socket) socket.emit('join-game-room', code);
};

const copyCode = () => {
  navigator.clipboard.writeText(currentRoom.value.code);
  Swal.fire({ icon: 'success', title: 'Code copié !', text: currentRoom.value.code, background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1', timer: 1500, showConfirmButton: false });
};

const startGame = () => {
  currentStep.value = 'playing';
  nextTick(() => {
    if (selectedGame.value.id === 'pong')  initNeonPong();
    if (selectedGame.value.id === 'snake') initSnake();
  });
};

const quitGame = () => { stopAllGames(); currentStep.value = 'lobby'; };

const goBack = () => {
  stopAllGames(); currentStep.value  = 'selection'; selectedGame.value = null; roomCode.value = ''; isSpectator.value  = false;
  currentRoom.value  = { code: '', players: [], spectators: [] };
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
// PONG — 🔴 RÉÉCRIT EN MULTIJOUEUR AUTORITAIRE
// -------------------------------------------------------
const canvasRef = ref(null);
const pongScore = ref({ p1: 0, p2: 0 });
const MAX_SCORE = 7;

// Variables physiques globales (pour être modifiées par le réseau)
let pBall = { x: 400, y: 225, r: 10, dx: 5, dy: 3.5 };
let pPad1 = { x: 20, y: 180 };
let pPad2 = { x: 768, y: 180 };

const initNeonPong = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = 800, H = 450;
  canvas.width  = W; canvas.height = H;
  const PADDLE_W = 12, PADDLE_H = 90, SPEED_INC = 0.4;

  // Déterminer qui est qui (Hôte = Joueur 1, Guest = Joueur 2)
  const isHost = currentRoom.value.players[0]?.name === 'Toi';
  const isGuest = currentRoom.value.players[1]?.name === 'Toi';

  pPad1 = { x: 20, y: H / 2 - PADDLE_H / 2 };
  pPad2 = { x: W - 32, y: H / 2 - PADDLE_H / 2 };
  const keys  = {};

  canvas.setAttribute('tabindex', '0'); canvas.style.outline = 'none';
  if (!isSpectator.value) canvas.focus();

  const PONG_KEYS = ['w','W','s','S','ArrowUp','ArrowDown'];
  const onKey = (e) => {
    if (isSpectator.value) return;
    if (PONG_KEYS.includes(e.key)) e.preventDefault();
    keys[e.key] = e.type === 'keydown';
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup',   onKey);

  const resetBall = (dir = 1) => {
    pBall = { x: W / 2, y: H / 2, r: 10, dx: (4 + Math.random()) * dir, dy: (3 + Math.random() * 2) * (Math.random() > 0.5 ? 1 : -1) };
  };
  if (isHost) resetBall(1); // Seul l'hôte relance la balle pour éviter les désynchronisations

  const draw = () => {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)'; ctx.fillRect(0, 0, W, H);
    ctx.setLineDash([14, 10]); ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);

    if (isSpectator.value) { /* Texte Overlay caché ici pour nettoyer */ }

    const drawPaddle = (x, y, color, glow) => {
      ctx.shadowBlur = 18; ctx.shadowColor = glow; ctx.fillStyle = color;
      ctx.beginPath(); ctx.roundRect(x, y, PADDLE_W, PADDLE_H, 6); ctx.fill(); ctx.shadowBlur = 0;
    };
    drawPaddle(pPad1.x, pPad1.y, '#818cf8', '#6366f1');
    drawPaddle(pPad2.x, pPad2.y, '#fb7185', '#f43f5e');

    ctx.shadowBlur = 20; ctx.shadowColor = '#ffffff'; ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(pBall.x, pBall.y, pBall.r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;

    ctx.font = 'bold 40px monospace';
    ctx.fillStyle = '#818cf8'; ctx.fillText(pongScore.value.p1, W / 2 - 70, 60);
    ctx.fillStyle = '#fb7185'; ctx.fillText(pongScore.value.p2, W / 2 + 30, 60);

    // LOGIQUE DE JEU EN RÉSEAU
    if (!isSpectator.value) {
      if (isHost) {
        // --- CERVEAU (JOUEUR 1) ---
        if ((keys['w'] || keys['W'] || keys['ArrowUp']) && pPad1.y > 0) pPad1.y -= 7;
        if ((keys['s'] || keys['S'] || keys['ArrowDown']) && pPad1.y + PADDLE_H < H) pPad1.y += 7;

        pBall.x += pBall.dx; pBall.y += pBall.dy;
        if (pBall.y - pBall.r < 0)  { pBall.y = pBall.r;     pBall.dy =  Math.abs(pBall.dy); }
        if (pBall.y + pBall.r > H)  { pBall.y = H - pBall.r; pBall.dy = -Math.abs(pBall.dy); }

        if (pBall.x - pBall.r < pPad1.x + PADDLE_W && pBall.y > pPad1.y && pBall.y < pPad1.y + PADDLE_H && pBall.dx < 0) {
          pBall.dx = Math.abs(pBall.dx) + SPEED_INC; pBall.dy = ((pBall.y - (pPad1.y + PADDLE_H / 2)) / (PADDLE_H / 2)) * 6;
        }
        if (pBall.x + pBall.r > pPad2.x && pBall.y > pPad2.y && pBall.y < pPad2.y + PADDLE_H && pBall.dx > 0) {
          pBall.dx = -(Math.abs(pBall.dx) + SPEED_INC); pBall.dy = ((pBall.y - (pPad2.y + PADDLE_H / 2)) / (PADDLE_H / 2)) * 6;
        }

        if (pBall.x < 0) { pongScore.value.p2++; checkPongWinner(-1); return; }
        if (pBall.x > W) { pongScore.value.p1++; checkPongWinner(1); return; }

        // 🔴 ENVOI : On envoie aussi dx et dy !
        if (socket) socket.emit('game-action', { 
          roomCode: currentRoom.value.code, game: 'pong', action: 'host-update', 
          ball: { x: pBall.x, y: pBall.y, dx: pBall.dx, dy: pBall.dy }, 
          pad1Y: pPad1.y, score: pongScore.value 
        });

      } else if (isGuest) {
        // --- CLIENT (JOUEUR 2) ---
        if ((keys['w'] || keys['W'] || keys['ArrowUp']) && pPad2.y > 0) pPad2.y -= 7;
        if ((keys['s'] || keys['S'] || keys['ArrowDown']) && pPad2.y + PADDLE_H < H) pPad2.y += 7;

        // 🔴 ASTUCE PRO : Le Joueur 2 fait avancer la balle de son côté pour éviter les saccades !
        pBall.x += pBall.dx; 
        pBall.y += pBall.dy;

        // Envoi de sa raquette au Joueur 1
        if (socket) socket.emit('game-action', { roomCode: currentRoom.value.code, game: 'pong', action: 'guest-update', pad2Y: pPad2.y });
      }
    }

    pongAnimId = requestAnimationFrame(draw);
  };

  draw();
  window.__pongCleanup = () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKey); };
};

const checkPongWinner = (dir) => {
  if (pongScore.value.p1 >= MAX_SCORE || pongScore.value.p2 >= MAX_SCORE) {
    const winner = pongScore.value.p1 >= MAX_SCORE ? 'Joueur 1' : 'Joueur 2';
    if (socket) socket.emit('game-action', { roomCode: currentRoom.value.code, game: 'pong', action: 'pong-win', winner });
    triggerPongWin(winner);
  } else {
    // Si la partie continue, on recentre la balle et on relance
    pBall = { x: 400, y: 225, r: 10, dx: (4 + Math.random()) * dir, dy: (3 + Math.random() * 2) * (Math.random() > 0.5 ? 1 : -1) };
    nextTick(() => initNeonPong());
  }
};

const triggerPongWin = (winner, isFromOpponent = false) => {
  cancelAnimationFrame(pongAnimId); pongAnimId = null;
  Swal.fire({
    icon: 'success', title: `🏆 ${winner} gagne !`,
    html: `Score final : <b>${pongScore.value.p1}</b> – <b>${pongScore.value.p2}</b>`,
    background: '#0f172a', color: '#f9fafb', confirmButtonColor: '#6366f1',
    confirmButtonText: isSpectator.value ? 'Retour' : 'Rejouer',
  }).then(() => {
    if (!isSpectator.value) {
      if (!isFromOpponent && socket) socket.emit('game-action', { roomCode: currentRoom.value.code, game: 'pong', action: 'pong-reset' });
      pongScore.value = { p1: 0, p2: 0 };
      nextTick(() => initNeonPong());
    } else {
      currentStep.value = 'lobby';
    }
  });
};

// -------------------------------------------------------
// SNAKE (Solo uniquement pour le moment)
// -------------------------------------------------------
const snakeCanvasRef = ref(null);
const snakeScore     = ref(0);
const snakeBest      = ref(0);
const snakeRunning   = ref(false);

const CELL = 20, COLS = 30, ROWS = 22;

const initSnake = () => {
  const canvas = snakeCanvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width  = COLS * CELL;
  canvas.height = ROWS * CELL;
  snakeScore.value = 0; snakeRunning.value = true;

  let snake = [{ x: 15, y: 11 }, { x: 14, y: 11 }, { x: 13, y: 11 }];
  let dir = { x: 1, y: 0 }, next = { x: 1, y: 0 };
  let food = randomFood(snake), alive = true;

  const onKey = (e) => {
    if (isSpectator.value) return;
    const map = {
      ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 },
      ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 },
      w: { x: 0, y: -1 }, s: { x: 0, y: 1 }, a: { x: -1, y: 0 }, d: { x: 1, y: 0 },
    };
    if (map[e.key] && !(map[e.key].x === -dir.x && map[e.key].y === -dir.y)) next = map[e.key];
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);

  const tick = () => {
    if (!alive) return;
    dir = next;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) { gameOver(); return; }
    if (snake.some(s => s.x === head.x && s.y === head.y)) { gameOver(); return; }
    snake.unshift(head);
    if (head.x === food.x && head.y === food.y) {
      snakeScore.value++;
      if (snakeScore.value > snakeBest.value) snakeBest.value = snakeScore.value;
      food = randomFood(snake);
    } else { snake.pop(); }
    render();
  };

  const render = () => {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 0.5;
    for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x*CELL,0); ctx.lineTo(x*CELL,canvas.height); ctx.stroke(); }
    for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0,y*CELL); ctx.lineTo(canvas.width,y*CELL); ctx.stroke(); }

    snake.forEach((seg, i) => {
      const ratio = i / snake.length;
      ctx.shadowBlur = i === 0 ? 16 : 0; ctx.shadowColor = '#4ade80';
      ctx.fillStyle = i === 0 ? '#86efac' : `hsl(${145 - ratio*30}, 70%, ${55 - ratio*20}%)`;
      ctx.beginPath(); ctx.roundRect(seg.x*CELL+2, seg.y*CELL+2, CELL-4, CELL-4, i===0?6:3); ctx.fill();
    });
    ctx.shadowBlur = 0;

    ctx.shadowBlur = 14; ctx.shadowColor = '#f87171'; ctx.fillStyle = '#fca5a5';
    ctx.beginPath(); ctx.arc(food.x*CELL+CELL/2, food.y*CELL+CELL/2, CELL/2-3, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
  };

  const gameOver = () => {
    alive = false; snakeRunning.value = false;
    clearInterval(snakeInterval); window.removeEventListener('keydown', onKey);
    Swal.fire({
      icon: 'error', title: '💀 Game Over !',
      html: `Score : <b>${snakeScore.value}</b>&nbsp;&nbsp;|&nbsp;&nbsp;Meilleur : <b>${snakeBest.value}</b>`,
      background: '#0f172a', color: '#f9fafb', confirmButtonColor: '#22c55e',
      confirmButtonText: isSpectator.value ? 'Retour' : 'Rejouer',
      showCancelButton: !isSpectator.value, cancelButtonText: 'Quitter',
    }).then((res) => {
      if (!isSpectator.value && res.isConfirmed) nextTick(() => initSnake());
      else currentStep.value = 'lobby';
    });
  };

  render();
  if (snakeInterval) clearInterval(snakeInterval);
  snakeInterval = setInterval(tick, 120);
  window.__snakeCleanup = () => window.removeEventListener('keydown', onKey);
};

const randomFood = (snake) => {
  let pos;
  do { pos = { x: Math.floor(Math.random()*COLS), y: Math.floor(Math.random()*ROWS) }; }
  while (snake.some(s => s.x===pos.x && s.y===pos.y));
  return pos;
};

const changeSnakeDir = (dx, dy) => {
  if (isSpectator.value) return; 
  const map = [['ArrowUp',0,-1],['ArrowDown',0,1],['ArrowLeft',-1,0],['ArrowRight',1,0]];
  const entry = map.find(([,x,y]) => x===dx && y===dy);
  if (entry) window.dispatchEvent(new KeyboardEvent('keydown', { key: entry[0] }));
};

// -------------------------------------------------------
// TIC-TAC-TOE — MULTIJOUEUR AVEC VERROU
// -------------------------------------------------------
const xoBoard         = ref(Array(9).fill(null));
const xoCurrentPlayer = ref('X');
const xoWinner        = ref(null);
const xoDraw          = ref(false);
const xoScore         = ref({ X: 0, O: 0 });
const WINS = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

const xoPlay = (idx, isFromOpponent = false) => {
  if (xoBoard.value[idx] || xoWinner.value || xoDraw.value) return;
  
  if (!isFromOpponent) {
    if (currentRoom.value.players[0].name === 'Toi' && xoCurrentPlayer.value !== 'X') return;
    if (currentRoom.value.players[1]?.name === 'Toi' && xoCurrentPlayer.value !== 'O') return;
  }

  guardSpectator(() => {
    xoBoard.value[idx] = xoCurrentPlayer.value;

    if (!isFromOpponent && socket) {
      socket.emit('game-action', { roomCode: currentRoom.value.code, game: 'xo', action: 'play', idx: idx });
    }

    const win = WINS.find(([a,b,c]) => xoBoard.value[a] && xoBoard.value[a]===xoBoard.value[b] && xoBoard.value[a]===xoBoard.value[c]);
    if (win) {
      xoWinner.value = xoCurrentPlayer.value;
      xoScore.value[xoCurrentPlayer.value]++;
      if(!isFromOpponent) {
          Swal.fire({
            icon: 'success', title: `🏆 Joueur ${xoWinner.value} gagne !`,
            background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1', confirmButtonText: 'Rejouer',
          }).then(() => xoReset());
      }
      return;
    }
    if (xoBoard.value.every(c => c !== null)) {
      xoDraw.value = true;
      if(!isFromOpponent){
          Swal.fire({ icon: 'info', title: '🤝 Match nul !', background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1', confirmButtonText: 'Rejouer' }).then(() => xoReset());
      }
      return;
    }
    xoCurrentPlayer.value = xoCurrentPlayer.value === 'X' ? 'O' : 'X';
  });
};

const xoReset = (isFromOpponent = false) => {
  xoBoard.value = Array(9).fill(null);
  xoCurrentPlayer.value = 'X'; xoWinner.value = null; xoDraw.value = false;
  if (!isFromOpponent && socket) socket.emit('game-action', { roomCode: currentRoom.value.code, game: 'xo', action: 'reset' });
};

const xoWinCells = () => {
  const win = WINS.find(([a,b,c]) => xoBoard.value[a] && xoBoard.value[a]===xoBoard.value[b] && xoBoard.value[a]===xoBoard.value[c]);
  return win || [];
};
</script>

<template>
  <div class="flex-1 flex flex-col items-center justify-center text-white min-h-full p-6 font-sans">

    <!-- ── Sélection de jeu ── -->
    <Transition name="fade">
    <div v-if="currentStep === 'selection'" class="w-full max-w-4xl">
      <div class="text-center mb-12">
        <h1 class="text-5xl font-black tracking-tight mb-3 bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">ArenaLink Arcade</h1>
        <p class="text-gray-400 text-lg">Choisis un mini-jeu et défie tes amis</p>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div
          v-for="game in games" :key="game.id"
          @click="selectGame(game)"
          class="relative p-[2px] rounded-2xl cursor-pointer group hover:scale-[1.03] transition-all duration-300 shadow-xl"
          :class="`bg-gradient-to-br ${game.color}`"
        >
          <div class="bg-gray-900 rounded-[14px] h-full p-8 flex flex-col items-center text-center gap-4 hover:bg-gray-800 transition-colors">
            <span class="text-7xl drop-shadow-lg">{{ game.icon }}</span>
            <h3 class="text-xl font-bold text-white">{{ game.name }}</h3>
            <span class="px-3 py-1 bg-gray-800 rounded-full text-xs text-gray-400 font-mono border border-gray-700">{{ game.desc }}</span>
            <div class="mt-2 px-5 py-2 rounded-xl font-bold text-sm text-white opacity-0 group-hover:opacity-100 transition-opacity" :class="`bg-gradient-to-r ${game.color}`">Jouer →</div>
          </div>
        </div>
      </div>
    </div>
    </Transition>

    <!-- ── Rejoindre / créer ── -->
    <Transition name="fade">
    <div v-if="currentStep === 'join'" class="w-full max-w-md">
      <button @click="goBack" class="text-gray-400 hover:text-white mb-6 flex items-center gap-1 text-sm transition-colors">← Retour aux jeux</button>
      <div class="bg-gray-800/70 backdrop-blur p-8 rounded-2xl shadow-2xl border border-gray-700">
        <div class="flex items-center justify-center text-6xl mb-4">{{ selectedGame.icon }}</div>
        <h2 class="text-2xl font-bold text-center mb-8">{{ selectedGame.name }}</h2>
        <div class="space-y-5">
          <button @click="createRoom" class="w-full py-4 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold text-lg transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2">
            🏠 Créer une salle (Joueur 1)
          </button>
          <div class="flex items-center gap-4 text-gray-500 text-sm">
            <div class="flex-1 h-px bg-gray-700"></div>OU<div class="flex-1 h-px bg-gray-700"></div>
          </div>
          <div class="flex gap-2">
            <input
              v-model="roomCode" @keyup.enter="joinRoom"
              placeholder="Code de la salle"
              class="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 text-center uppercase tracking-widest font-mono focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <button @click="joinRoom" class="px-5 bg-gray-700 hover:bg-indigo-600 rounded-xl font-bold transition-all">Rejoindre</button>
          </div>
          <!-- Bouton spectateur volontaire -->
          <button
            @click="joinAsSpectator"
            class="w-full py-2.5 border border-yellow-500/40 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2"
          >
            👁 Rejoindre en spectateur
          </button>
        </div>
      </div>
    </div>
    </Transition>

    <!-- ── Lobby ── -->
    <Transition name="fade">
    <div v-if="currentStep === 'lobby'" class="w-full max-w-3xl flex flex-col gap-6">

      <!-- Bannière spectateur bien visible -->
      <div v-if="isSpectator" class="flex items-center gap-3 p-4 bg-yellow-500/10 border-2 border-yellow-500/50 rounded-2xl text-yellow-300 animate-pulse">
        <span class="text-2xl">👁</span>
        <div>
          <p class="font-bold">Mode Spectateur actif</p>
          <p class="text-sm text-yellow-400/80">Tu pourras regarder la partie mais aucune interaction ne sera possible.</p>
        </div>
      </div>

      <div class="bg-gray-800/70 backdrop-blur p-6 rounded-2xl border border-gray-700 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div>
          <h2 class="text-2xl font-bold flex items-center gap-2">{{ selectedGame.icon }} {{ selectedGame.name }}</h2>
          <p class="text-gray-400 text-sm mt-1">Salle d'attente</p>
        </div>
        <div class="bg-gray-900 px-5 py-2.5 rounded-xl border border-gray-700 flex items-center gap-4">
          <span class="text-2xl font-mono text-indigo-400 tracking-widest font-bold">{{ currentRoom.code }}</span>
          <button @click="copyCode" class="p-2 bg-gray-800 hover:bg-indigo-600 rounded-lg transition-colors" title="Copier le code">📋</button>
        </div>
      </div>

      <div class="bg-gray-800/70 backdrop-blur p-6 rounded-2xl border border-gray-700">
        <h3 class="text-sm font-semibold text-indigo-400 uppercase tracking-wider mb-4">👥 Joueurs</h3>
        <div class="flex gap-4 flex-wrap">
          <div v-for="(player, i) in currentRoom.players" :key="i"
            class="flex-1 min-w-[160px] bg-gray-900 border border-indigo-500/40 p-4 rounded-xl flex items-center gap-3">
            <img :src="player.avatar" class="w-12 h-12 rounded-full bg-gray-700 ring-2 ring-indigo-500/50" />
            <div>
              <p class="font-bold text-white text-sm">{{ player.name }}</p>
              <p class="text-xs text-indigo-400 mt-0.5">{{ player.role }}</p>
            </div>
          </div>
          <div v-if="currentRoom.players.length < 2"
            class="flex-1 min-w-[160px] bg-gray-900/50 border border-dashed border-gray-600 p-4 rounded-xl flex items-center justify-center text-gray-500 text-sm gap-2">
            <span class="animate-pulse">⏳</span> En attente du Joueur 2…
          </div>
        </div>

        <div v-if="currentRoom.spectators.length > 0" class="mt-4">
          <h3 class="text-sm font-semibold text-yellow-400 uppercase tracking-wider mb-2">👁 Spectateurs ({{ currentRoom.spectators.length }})</h3>
          <div class="flex gap-2 flex-wrap">
            <div v-for="(spec, i) in currentRoom.spectators" :key="i"
              class="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/30 px-3 py-1.5 rounded-full text-xs text-yellow-300">
              <img :src="spec.avatar" class="w-5 h-5 rounded-full" />
              {{ spec.name }}
            </div>
          </div>
        </div>

        <div class="mt-6 flex justify-between items-center">
          <button @click="goBack" class="px-5 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-xl text-sm font-semibold transition-all">← Retour</button>
          <button @click="startGame" class="px-8 py-3 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400 rounded-xl font-bold text-white shadow-lg shadow-green-600/20 transition-all">
            {{ isSpectator ? '👁 Regarder la partie' : '🚀 Lancer la partie !' }}
          </button>
        </div>
      </div>
    </div>
    </Transition>

    <!-- ── Jeu en cours ── -->
    <Transition name="fade">
    <div v-if="currentStep === 'playing'" class="w-full flex flex-col items-center gap-4">

      <div v-if="isSpectator" class="w-full max-w-4xl flex items-center gap-3 px-4 py-2.5 bg-yellow-500/10 border border-yellow-500/40 rounded-xl text-yellow-300 text-sm font-semibold">
        <span>👁</span> Mode Spectateur — Toutes les interactions sont désactivées
      </div>

      <!-- PONG -->
      <template v-if="selectedGame.id === 'pong'">
        <div class="flex justify-between w-full max-w-4xl px-2 mb-2">
          <div class="flex flex-col items-center">
            <span class="text-xs text-gray-400 uppercase tracking-wider">{{ currentRoom.players[0]?.name === 'Toi' ? 'Toi (J1)' : isSpectator ? 'Joueur 1' : 'Hôte' }}</span>
            <span class="text-4xl font-black text-indigo-400 font-mono">{{ pongScore.p1 }}</span>
          </div>
          <div class="flex flex-col items-center text-center">
            <span class="text-xs text-gray-400">{{ isSpectator ? 'Regarder' : 'W/S ou ↑↓' }}</span>
            <span class="text-sm text-gray-500">Premier à {{ MAX_SCORE }} points</span>
          </div>
          <div class="flex flex-col items-center">
            <span class="text-xs text-gray-400 uppercase tracking-wider">{{ currentRoom.players[1]?.name === 'Toi' ? 'Toi (J2)' : isSpectator ? 'Joueur 2' : 'Invité' }}</span>
            <span class="text-4xl font-black text-rose-400 font-mono">{{ pongScore.p2 }}</span>
          </div>
        </div>
        <canvas ref="canvasRef" :tabindex="isSpectator ? -1 : 0" @click="!isSpectator && $event.target.focus()" class="border-2 border-gray-700 rounded-2xl shadow-2xl outline-none" :class="isSpectator ? 'cursor-default opacity-90' : 'cursor-pointer'" style="max-width:100%;"></canvas>
      </template>

      <!-- SNAKE -->
      <template v-if="selectedGame.id === 'snake'">
        <div class="flex justify-between w-full max-w-2xl px-2 mb-2">
          <div class="flex flex-col items-center">
            <span class="text-xs text-gray-400 uppercase tracking-wider">Score</span>
            <span class="text-4xl font-black text-green-400 font-mono">{{ snakeScore }}</span>
          </div>
          <div class="flex flex-col items-center text-center">
            <span class="text-xs text-gray-400">{{ isSpectator ? '👁 Spectateur' : 'Flèches ou WASD' }}</span>
          </div>
          <div class="flex flex-col items-center">
            <span class="text-xs text-gray-400 uppercase tracking-wider">Meilleur</span>
            <span class="text-4xl font-black text-yellow-400 font-mono">{{ snakeBest }}</span>
          </div>
        </div>
        <canvas ref="snakeCanvasRef" class="border-2 border-gray-700 rounded-2xl shadow-2xl" style="max-width:100%;"></canvas>
      </template>

      <!-- TIC-TAC-TOE -->
      <template v-if="selectedGame.id === 'xo'">
        <div class="flex gap-12 mb-4">
          <div class="flex flex-col items-center">
            <span class="text-xs text-gray-400 uppercase tracking-wider">Joueur X</span>
            <span class="text-4xl font-black text-pink-400 font-mono">{{ xoScore.X }}</span>
          </div>
          <div class="flex flex-col items-center justify-center">
            <span class="text-sm text-gray-500">
              {{ xoWinner ? `🏆 Joueur ${xoWinner} gagne !` : xoDraw ? '🤝 Match nul !' : `Tour : Joueur ${xoCurrentPlayer}` }}
            </span>
          </div>
          <div class="flex flex-col items-center">
            <span class="text-xs text-gray-400 uppercase tracking-wider">Joueur O</span>
            <span class="text-4xl font-black text-indigo-400 font-mono">{{ xoScore.O }}</span>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-3" style="width:300px;" :class="isSpectator ? 'pointer-events-none opacity-80' : ''">
          <button v-for="(cell, i) in xoBoard" :key="i" @click="xoPlay(i)"
            :class="[
              'w-24 h-24 rounded-2xl font-black text-4xl border-2 transition-all duration-200',
              xoWinCells().includes(i) ? 'border-yellow-400 bg-yellow-400/10 scale-105' : 'border-gray-700 bg-gray-800/80 hover:bg-gray-700 hover:border-gray-500',
              cell === 'X' ? 'text-pink-400' : 'text-indigo-400',
            ]">
            {{ cell || '' }}
          </button>
        </div>

        <div class="flex gap-4 mt-6">
          <button v-if="!isSpectator" @click="xoReset" class="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 rounded-xl font-semibold text-sm transition-all">🔄 Nouvelle partie</button>
        </div>
      </template>

      <button @click="quitGame" class="mt-4 px-6 py-2 bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white rounded-xl font-bold transition-all text-sm">
        ← {{ isSpectator ? 'Quitter le spectacle' : 'Quitter le match' }}
      </button>
    </div>
    </Transition>

  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s, transform 0.25s; }
.fade-enter-from { opacity: 0; transform: translateY(12px); }
.fade-leave-to   { opacity: 0; transform: translateY(-8px); }
</style>