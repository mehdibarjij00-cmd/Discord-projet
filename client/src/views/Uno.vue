<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { io } from 'socket.io-client';

const Swal = window.Swal;

// ============================================================
// PROPS / EMITS
// ============================================================
const props = defineProps({
  roomCode:    { type: String,  required: true },
  localPlayer: { type: Object,  required: true }, // { name, avatar, elo }
  isHost:      { type: Boolean, default: false }, // true = J1 (créateur)
  isSpectator: { type: Boolean, default: false },
  socket:      { type: Object,  default: null },  // optionnel : socket externe
});
const emit = defineEmits(['quit', 'win', 'loss']);

// ============================================================
// SOCKET (interne si pas fourni)
// ============================================================
let socket = props.socket;
let ownsSocket = false;
if (!socket) {
socket = io(import.meta.env.VITE_API_URL);
  ownsSocket = true;
}

// ============================================================
// CONSTANTES UNO
// ============================================================
const COLORS = ['red', 'yellow', 'green', 'blue'];
const COLOR_HEX = {
  red:    '#ef4444',
  yellow: '#eab308',
  green:  '#22c55e',
  blue:   '#3b82f6',
  black:  '#1f2937',
};
const COLOR_GLOW = {
  red:    'rgba(239,68,68,.6)',
  yellow: 'rgba(234,179,8,.6)',
  green:  'rgba(34,197,94,.6)',
  blue:   'rgba(59,130,246,.6)',
  black:  'rgba(99,102,241,.6)',
};

// Génère le deck officiel UNO (108 cartes)
const buildDeck = () => {
  const deck = [];
  let id = 0;
  COLORS.forEach((color) => {
    // 1x "0"
    deck.push({ id: id++, color, value: '0', type: 'number' });
    // 2x [1..9]
    for (let n = 1; n <= 9; n++) {
      deck.push({ id: id++, color, value: String(n), type: 'number' });
      deck.push({ id: id++, color, value: String(n), type: 'number' });
    }
    // 2x Skip, Reverse, +2
    ['skip', 'reverse', 'draw2'].forEach((sp) => {
      deck.push({ id: id++, color, value: sp, type: 'action' });
      deck.push({ id: id++, color, value: sp, type: 'action' });
    });
  });
  // 4x Wild + 4x Wild+4
  for (let i = 0; i < 4; i++) {
    deck.push({ id: id++, color: 'black', value: 'wild',  type: 'wild' });
    deck.push({ id: id++, color: 'black', value: 'wild4', type: 'wild' });
  }
  return deck;
};

// Mélange Fisher-Yates
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// ============================================================
// ÉTAT DU JEU
// ============================================================
const deck         = ref([]);              // Pioche
const discard      = ref([]);              // Défausse (top = dernière)
const myHand       = ref([]);              // Mes cartes
const oppHandCount = ref(0);               // Nb cartes adversaire (on cache leur main)
const currentTurn  = ref('host');          // 'host' | 'guest'
const activeColor  = ref('red');           // Couleur active (utile après wild)
const direction    = ref(1);               // 1 ou -1 (peu utile en 1v1, mais conservé)
const gameStarted  = ref(false);
const gameOver     = ref(false);
const winner       = ref(null);
const announcedUno = ref({ host: false, guest: false });
const oppName      = ref('Adversaire');
const oppAvatar    = ref('https://api.dicebear.com/7.x/avataaars/svg?seed=Guest');
const lastAction   = ref('');              // Message d'action récent

const myRole       = computed(() => (props.isHost ? 'host' : 'guest'));
const isMyTurn     = computed(() => !props.isSpectator && currentTurn.value === myRole.value && gameStarted.value && !gameOver.value);
const topCard      = computed(() => discard.value[discard.value.length - 1] || null);

// ============================================================
// DÉMARRAGE / SETUP
// ============================================================
const initGame = () => {
  if (!props.isHost) return; // Seul l'hôte initialise
  let d = shuffle(buildDeck());

  // Pose la 1re carte (doit être un nombre, pas une wild)
  let first;
  do {
    first = d.shift();
    if (first.type !== 'number') d.push(first); // si action/wild → on remet en bas
  } while (first.type !== 'number');

  const hostHand  = d.splice(0, 7);
  const guestHand = d.splice(0, 7);

  const initState = {
    deck: d,
    discard: [first],
    hostHand,
    guestHand,
    currentTurn: 'host',
    activeColor: first.color,
    direction: 1,
  };

  // Applique localement
  applyInitState(initState);

  // Envoie à l'adversaire
  socket.emit('game-action', {
    roomCode: props.roomCode,
    game: 'uno',
    action: 'init',
    state: initState,
  });
};

const applyInitState = (s) => {
  deck.value        = s.deck;
  discard.value     = s.discard;
  myHand.value      = props.isHost ? s.hostHand : s.guestHand;
  oppHandCount.value = props.isHost ? s.guestHand.length : s.hostHand.length;
  currentTurn.value = s.currentTurn;
  activeColor.value = s.activeColor;
  direction.value   = s.direction;
  gameStarted.value = true;
  gameOver.value    = false;
  winner.value      = null;
  lastAction.value  = '🎲 Partie démarrée !';
};

// ============================================================
// VALIDATION : peut-on jouer cette carte ?
// ============================================================
const canPlay = (card) => {
  if (!topCard.value) return true;
  if (card.type === 'wild') return true; // wild jouable toujours
  if (card.color === activeColor.value) return true;
  if (card.value === topCard.value.value && topCard.value.type !== 'wild') return true;
  return false;
};

const hasPlayable = computed(() => myHand.value.some(canPlay));

// ============================================================
// JOUER UNE CARTE
// ============================================================
const playCard = async (cardIdx) => {
  if (!isMyTurn.value || gameOver.value) return;
  const card = myHand.value[cardIdx];
  if (!card || !canPlay(card)) {
    Swal?.fire({
      icon: 'warning', title: 'Coup invalide',
      text: 'Cette carte ne peut pas être jouée.',
      background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
      timer: 1400, showConfirmButton: false,
    });
    return;
  }

  // Si Wild ou Wild+4 → demander la couleur
  let chosenColor = card.color;
  if (card.type === 'wild') {
    const result = await Swal.fire({
      title: 'Choisis une couleur',
      background: '#111827', color: '#f9fafb',
      showConfirmButton: false,
      html: `
        <div style="display:flex;gap:12px;justify-content:center;margin-top:8px;">
          <button id="c-red"    style="width:64px;height:64px;border-radius:16px;background:#ef4444;border:none;cursor:pointer;font-size:28px;">🟥</button>
          <button id="c-yellow" style="width:64px;height:64px;border-radius:16px;background:#eab308;border:none;cursor:pointer;font-size:28px;">🟨</button>
          <button id="c-green"  style="width:64px;height:64px;border-radius:16px;background:#22c55e;border:none;cursor:pointer;font-size:28px;">🟩</button>
          <button id="c-blue"   style="width:64px;height:64px;border-radius:16px;background:#3b82f6;border:none;cursor:pointer;font-size:28px;">🟦</button>
        </div>`,
      didOpen: () => {
        ['red', 'yellow', 'green', 'blue'].forEach((c) => {
          document.getElementById(`c-${c}`).addEventListener('click', () => {
            Swal.close({ value: c });
            Swal.getPopup().__chosen = c;
          });
        });
      },
      preConfirm: () => Swal.getPopup().__chosen,
    });
    chosenColor = result.value || result?.value || 'red';
    // fallback robuste
    if (!COLORS.includes(chosenColor)) {
      chosenColor = ['red', 'yellow', 'green', 'blue'][Math.floor(Math.random() * 4)];
    }
  }

  // Retire la carte de la main
  myHand.value.splice(cardIdx, 1);
  // Pose sur la défausse
  discard.value.push(card);
  activeColor.value = chosenColor;

  // Effets de la carte
  let nextTurn = currentTurn.value === 'host' ? 'guest' : 'host';
  let drawCount = 0;
  let actionMsg = '';

  if (card.value === 'skip') {
    nextTurn = currentTurn.value;          // on rejoue
    actionMsg = '⏭ Tour sauté !';
  } else if (card.value === 'reverse') {
    direction.value *= -1;
    nextTurn = currentTurn.value;          // en 1v1 = skip
    actionMsg = '🔄 Sens inversé !';
  } else if (card.value === 'draw2') {
    drawCount = 2;
    actionMsg = '+2 cartes pour l’adversaire !';
  } else if (card.value === 'wild4') {
    drawCount = 4;
    actionMsg = '+4 cartes pour l’adversaire !';
  } else if (card.value === 'wild') {
    actionMsg = `🎨 Couleur changée → ${chosenColor}`;
  }

  // L'adversaire pioche si +2 / +4
  if (drawCount > 0) {
    socket.emit('game-action', {
      roomCode: props.roomCode, game: 'uno', action: 'force-draw',
      target: nextTurn, count: drawCount,
    });
    nextTurn = currentTurn.value;          // celui qui a pris saute son tour
  }

  lastAction.value = actionMsg || `✅ ${cardLabel(card)}`;

  // Vérifier UNO non annoncé (1 carte mais pas annoncé)
  if (myHand.value.length === 1 && !announcedUno.value[myRole.value]) {
    // Pénalité légère : pioche 2 cartes (option simplifiée)
    pushNotif('⚠️ Tu as oublié de dire UNO ! +2 cartes', 'warning');
    drawCardsLocal(2);
  }

  // Vérifier victoire
  if (myHand.value.length === 0) {
    gameOver.value = true;
    winner.value = myRole.value;
    socket.emit('game-action', {
      roomCode: props.roomCode, game: 'uno', action: 'win', winner: myRole.value,
    });
    showWinDialog(true);
    return;
  }

  // Émettre l'action vers l'adversaire
  socket.emit('game-action', {
    roomCode: props.roomCode, game: 'uno', action: 'play',
    card, chosenColor, nextTurn, direction: direction.value,
    handCount: myHand.value.length, role: myRole.value,
  });

  currentTurn.value = nextTurn;
};

// ============================================================
// PIOCHER UNE CARTE
// ============================================================
const drawCard = () => {
  if (!isMyTurn.value || gameOver.value) return;
  if (hasPlayable.value) {
    Swal?.fire({
      icon: 'info', title: 'Tu as une carte jouable !',
      background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
      timer: 1200, showConfirmButton: false,
    });
    return;
  }
  drawCardsLocal(1);

  // Passe le tour à l'adversaire
  const nextTurn = currentTurn.value === 'host' ? 'guest' : 'host';
  socket.emit('game-action', {
    roomCode: props.roomCode, game: 'uno', action: 'draw',
    nextTurn, handCount: myHand.value.length, role: myRole.value,
  });
  currentTurn.value = nextTurn;
  lastAction.value = '🃏 Tu as pioché une carte';
};

const drawCardsLocal = (n) => {
  for (let i = 0; i < n; i++) {
    if (deck.value.length === 0) reshuffleDeck();
    if (deck.value.length === 0) break;
    myHand.value.push(deck.value.shift());
  }
  // Reset l'annonce UNO si on a > 1 carte
  if (myHand.value.length > 1) announcedUno.value[myRole.value] = false;
};

const reshuffleDeck = () => {
  if (discard.value.length <= 1) return;
  const top = discard.value.pop();
  const rest = shuffle(discard.value);
  deck.value = rest;
  discard.value = [top];
  pushNotif('🔄 Pioche remélangée !', 'info');
};

// ============================================================
// BOUTON "UNO !"
// ============================================================
const sayUno = () => {
  if (myHand.value.length !== 1 && myHand.value.length !== 2) {
    pushNotif('Tu peux dire UNO seulement avec 1 ou 2 cartes !', 'warning');
    return;
  }
  announcedUno.value[myRole.value] = true;
  pushNotif('🔔 UNO annoncé !', 'success');
  socket.emit('game-action', {
    roomCode: props.roomCode, game: 'uno', action: 'uno-call', role: myRole.value,
  });
};

// ============================================================
// SOCKET HANDLERS (réception)
// ============================================================
const onSocketAction = (data) => {
  if (data.game !== 'uno') return;

  if (data.action === 'init') {
    applyInitState(data.state);
    return;
  }

  if (data.action === 'play') {
    // L'adversaire a joué une carte
    discard.value.push(data.card);
    activeColor.value = data.chosenColor;
    direction.value = data.direction;
    oppHandCount.value = data.handCount;
    currentTurn.value = data.nextTurn;
    lastAction.value = `${oppName.value} a joué ${cardLabel(data.card)}`;
    if (data.card.type === 'wild') {
      lastAction.value += ` → couleur ${data.chosenColor}`;
    }
    // Reset son annonce si +1 carte (pas applicable ici, mais sécu)
    if (oppHandCount.value > 1) announcedUno.value.host = false; // safe reset
    return;
  }

  if (data.action === 'draw') {
    oppHandCount.value = data.handCount;
    currentTurn.value = data.nextTurn;
    lastAction.value = `${oppName.value} a pioché une carte`;
    return;
  }

  if (data.action === 'force-draw') {
    if (data.target === myRole.value) {
      drawCardsLocal(data.count);
      pushNotif(`Tu pioches ${data.count} cartes !`, 'warning');
    } else {
      oppHandCount.value += data.count;
    }
    return;
  }

  if (data.action === 'uno-call') {
    pushNotif(`🔔 ${oppName.value} dit UNO !`, 'info');
    return;
  }

  if (data.action === 'win') {
    gameOver.value = true;
    winner.value = data.winner;
    showWinDialog(data.winner === myRole.value);
    return;
  }
};

// ============================================================
// FIN DE PARTIE
// ============================================================
const showWinDialog = (iWon) => {
  Swal.fire({
    icon: iWon ? 'success' : 'info',
    title: iWon ? '🏆 Tu as gagné !' : `😢 ${oppName.value} a gagné`,
    background: '#0f172a', color: '#f9fafb',
    confirmButtonColor: '#6366f1',
    confirmButtonText: 'Retour',
  }).then(() => {
    emit(iWon ? 'win' : 'loss', { game: 'UNO' });
    emit('quit');
  });
};

// ============================================================
// HELPERS UI
// ============================================================
const cardLabel = (c) => {
  if (!c) return '';
  if (c.type === 'wild') return c.value === 'wild4' ? '+4 (Wild)' : 'Wild';
  if (c.value === 'skip')    return `${c.color} ⏭`;
  if (c.value === 'reverse') return `${c.color} 🔄`;
  if (c.value === 'draw2')   return `${c.color} +2`;
  return `${c.color} ${c.value}`;
};

const cardSymbol = (c) => {
  if (!c) return '';
  if (c.value === 'skip')    return '⊘';
  if (c.value === 'reverse') return '⇄';
  if (c.value === 'draw2')   return '+2';
  if (c.value === 'wild')    return '★';
  if (c.value === 'wild4')   return '+4';
  return c.value;
};

// ============================================================
// NOTIFS
// ============================================================
const notifications = ref([]);
let notifId = 0;
const pushNotif = (msg, type = 'info', duration = 2800) => {
  const id = notifId++;
  notifications.value.unshift({ id, msg, type });
  setTimeout(() => {
    notifications.value = notifications.value.filter(n => n.id !== id);
  }, duration);
};

// ============================================================
// LIFECYCLE
// ============================================================
onMounted(() => {
  // Récupérer le nom de l'adversaire si broadcast
  socket.on('opponent-action', onSocketAction);
  socket.on('game-action',     onSocketAction); // double sécurité

  socket.on('opponent-info', (data) => {
    oppName.value   = data.name   || 'Adversaire';
    oppAvatar.value = data.avatar || oppAvatar.value;
  });

  // Annonce sa présence
  socket.emit('player-info', {
    roomCode: props.roomCode,
    name: props.localPlayer.name,
    avatar: props.localPlayer.avatar,
  });

  // L'hôte initie après un petit délai pour laisser l'autre joindre
  setTimeout(() => {
    if (props.isHost && !gameStarted.value) initGame();
  }, 800);
});

onUnmounted(() => {
  socket.off('opponent-action', onSocketAction);
  socket.off('game-action',     onSocketAction);
  if (ownsSocket) socket.disconnect();
});

const handleQuit = async () => {
  const r = await Swal.fire({
    icon: 'warning', title: 'Quitter la partie ?',
    text: 'Tu vas perdre la partie en cours.',
    background: '#111827', color: '#f9fafb',
    showCancelButton: true, confirmButtonText: 'Quitter',
    cancelButtonText: 'Annuler', confirmButtonColor: '#ef4444',
  });
  if (r.isConfirmed) emit('quit');
};
</script>

<template>
  <div class="w-full min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-indigo-950 text-white relative overflow-hidden">
    <!-- Header -->
    <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-black/40 backdrop-blur">
      <div class="flex items-center gap-3">
        <span class="text-3xl">🎴</span>
        <div>
          <h1 class="text-2xl font-black bg-gradient-to-r from-red-400 via-yellow-400 to-blue-400 bg-clip-text text-transparent">UNO</h1>
          <p class="text-xs text-gray-400">Salle {{ roomCode }}</p>
        </div>
      </div>
      <button @click="handleQuit"
        class="px-4 py-2 bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/40 rounded-xl text-sm font-bold transition">
        Quitter
      </button>
    </div>

    <!-- Spectateur banner -->
    <div v-if="isSpectator"
      class="mx-6 mt-4 px-4 py-2 bg-yellow-500/10 border border-yellow-500/40 rounded-xl text-yellow-300 text-sm font-semibold flex items-center gap-2">
      👁 Mode Spectateur — tu ne peux pas jouer
    </div>

    <!-- Notifications -->
    <div class="fixed top-20 right-6 z-40 space-y-2 max-w-xs">
      <transition-group name="notif">
        <div v-for="n in notifications" :key="n.id"
          class="px-4 py-2.5 rounded-xl shadow-lg backdrop-blur-md text-sm font-semibold border"
          :class="{
            'bg-blue-500/20 border-blue-500/50 text-blue-200':    n.type==='info',
            'bg-green-500/20 border-green-500/50 text-green-200': n.type==='success',
            'bg-yellow-500/20 border-yellow-500/50 text-yellow-200': n.type==='warning',
            'bg-red-500/20 border-red-500/50 text-red-200':       n.type==='error',
          }">
          {{ n.msg }}
        </div>
      </transition-group>
    </div>

    <!-- Loader avant départ -->
    <div v-if="!gameStarted" class="flex flex-col items-center justify-center py-32 gap-6">
      <div class="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      <p class="text-gray-400 text-lg">En attente du démarrage de la partie...</p>
      <p v-if="isHost" class="text-xs text-gray-600">(Tu es l'hôte, distribution en cours)</p>
    </div>

    <!-- Jeu -->
    <div v-else class="px-6 py-6 flex flex-col gap-6 max-w-6xl mx-auto">

      <!-- Adversaire (haut) -->
      <div class="flex items-center justify-between bg-gray-800/60 rounded-2xl p-4 border"
        :class="currentTurn !== myRole ? 'border-indigo-500 shadow-lg shadow-indigo-500/30' : 'border-gray-700'">
        <div class="flex items-center gap-3">
          <img :src="oppAvatar" class="w-12 h-12 rounded-full ring-2 ring-rose-500/50 bg-gray-700" />
          <div>
            <p class="font-bold">{{ oppName }}</p>
            <p class="text-xs" :class="currentTurn !== myRole ? 'text-indigo-400 animate-pulse' : 'text-gray-500'">
              {{ currentTurn !== myRole ? '⏳ À son tour' : 'En attente' }}
            </p>
          </div>
        </div>
        <div class="flex gap-1">
          <div v-for="i in Math.min(oppHandCount, 12)" :key="i"
            class="w-8 h-12 rounded-md bg-gradient-to-br from-rose-700 to-rose-900 border border-rose-500/50 shadow-md"
            :style="`transform: rotate(${(i-6)*2}deg); margin-left:${i>1?'-12px':'0'};`"></div>
          <span v-if="oppHandCount > 12" class="ml-2 self-center text-xs text-gray-400">+{{ oppHandCount - 12 }}</span>
        </div>
      </div>

      <!-- Centre : pioche + défausse -->
      <div class="flex justify-center items-center gap-8 py-4">

        <!-- Pioche -->
        <button @click="drawCard" :disabled="!isMyTurn"
          class="relative group"
          :class="isMyTurn ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'">
          <div class="w-24 h-36 rounded-xl bg-gradient-to-br from-gray-700 to-gray-900 border-2 border-gray-600 shadow-2xl flex items-center justify-center text-3xl font-black transition-all"
            :class="isMyTurn ? 'group-hover:scale-110 group-hover:border-indigo-400 group-hover:shadow-indigo-500/50' : ''">
            🎴
          </div>
          <p class="text-center text-xs text-gray-400 mt-2">Pioche ({{ deck.length }})</p>
        </button>

        <!-- Défausse (carte du dessus) -->
        <div class="flex flex-col items-center">
          <div class="w-24 h-36 rounded-xl flex items-center justify-center text-4xl font-black border-2 shadow-2xl transition-all"
            :style="`background:${COLOR_HEX[topCard?.color || 'black']}; border-color:${COLOR_HEX[topCard?.color || 'black']}; box-shadow:0 0 30px ${COLOR_GLOW[topCard?.color || 'black']};`">
            <span class="text-white drop-shadow-lg">{{ cardSymbol(topCard) }}</span>
          </div>
          <p class="text-center text-xs text-gray-400 mt-2">Défausse</p>
          <div v-if="topCard?.type === 'wild'" class="mt-1 px-2 py-0.5 rounded-full text-xs font-bold"
            :style="`background:${COLOR_HEX[activeColor]}; color:white;`">
            Couleur : {{ activeColor }}
          </div>
        </div>
      </div>

      <!-- Action / état -->
      <div class="text-center">
        <p class="text-sm text-gray-400 italic min-h-[20px]">{{ lastAction }}</p>
        <p class="mt-2 text-lg font-bold" :class="isMyTurn ? 'text-green-400' : 'text-gray-500'">
          {{ isMyTurn ? '🎯 À toi de jouer !' : `⏳ Tour de ${oppName}` }}
        </p>
      </div>

      <!-- Ma main -->
      <div class="bg-gray-800/60 rounded-2xl p-4 border border-gray-700">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-3">
            <img :src="localPlayer.avatar" class="w-10 h-10 rounded-full ring-2 ring-indigo-500/50" />
            <div>
              <p class="font-bold text-sm">{{ localPlayer.name }} (toi)</p>
              <p class="text-xs text-gray-500">{{ myHand.length }} carte{{ myHand.length>1?'s':'' }}</p>
            </div>
          </div>
          <button v-if="myHand.length <= 2 && !announcedUno[myRole]"
            @click="sayUno"
            class="px-5 py-2 bg-gradient-to-r from-yellow-500 to-orange-500 hover:from-yellow-400 hover:to-orange-400 rounded-xl font-black text-white shadow-lg shadow-yellow-500/40 animate-pulse">
            🔔 UNO !
          </button>
          <span v-else-if="announcedUno[myRole]"
            class="px-3 py-1 bg-green-500/20 border border-green-500/50 text-green-300 rounded-full text-xs font-bold">
            UNO annoncé ✓
          </span>
        </div>

        <div class="flex gap-2 flex-wrap justify-center min-h-[140px]">
          <button v-for="(c, i) in myHand" :key="c.id"
            @click="playCard(i)"
            :disabled="!isMyTurn || !canPlay(c)"
            class="relative w-20 h-32 rounded-xl flex items-center justify-center text-3xl font-black border-2 transition-all duration-200 shadow-lg"
            :style="`background:${COLOR_HEX[c.color]}; border-color:${canPlay(c)&&isMyTurn?'#fff':COLOR_HEX[c.color]};`"
            :class="[
              isMyTurn && canPlay(c) ? 'hover:-translate-y-3 hover:scale-110 cursor-pointer hover:shadow-2xl' : 'opacity-50 cursor-not-allowed',
              isMyTurn && canPlay(c) ? 'ring-2 ring-white/30' : '',
            ]">
            <span class="text-white drop-shadow-lg">{{ cardSymbol(c) }}</span>
            <span v-if="c.type==='wild'" class="absolute top-1 right-1 text-xs">🌈</span>
          </button>
          <div v-if="myHand.length === 0" class="text-gray-500 italic flex items-center">
            Aucune carte — tu as gagné !
          </div>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.notif-enter-active, .notif-leave-active { transition: all .3s ease; }
.notif-enter-from { opacity: 0; transform: translateX(20px); }
.notif-leave-to   { opacity: 0; transform: translateX(20px); }
</style>