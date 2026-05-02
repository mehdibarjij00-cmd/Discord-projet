<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  currentUser: { type: Object, required: true },
  userGroups:  { type: Array,  default: () => [] },
  socket:      { type: Object, required: true },
});
const emit = defineEmits(['close', 'play-match']);

const Swal = window.Swal;
const API  = 'http://localhost:3001';

// ── State ──
const tournaments = ref([]);
const loading = ref(false);
const selectedTournament = ref(null);
const showCreateModal = ref(false);

const tab = ref('open');  // open | mine | running | finished

// ── Form de création ──
const form = ref({
  name: '', gameId: 'pong', format: 'elimination', maxPlayers: 8, groupId: '',
});

const GAMES = [
  { id: 'pong',      label: '🏓 Pong'        },
  { id: 'tictactoe', label: '⭕ Tic-Tac-Toe' },
  { id: 'snake',     label: '🐍 Snake'       },
  { id: 'penalty',   label: '⚽ Penalty'     },
  { id: 'sniper',    label: '🎯 Sniper Elite'},
];

// ── Loading ──
const loadTournaments = async () => {
  loading.value = true;
  try {
    const res  = await fetch(`${API}/api/tournaments?userId=${props.currentUser.id}`);
    const data = await res.json();
    tournaments.value = data.tournaments || [];
  } catch { tournaments.value = []; }
  finally { loading.value = false; }
};

// ── Filtres ──
const filtered = computed(() => {
  const me = String(props.currentUser.id);
  switch (tab.value) {
    case 'open':     return tournaments.value.filter(t => t.status === 'open');
    case 'running':  return tournaments.value.filter(t => t.status === 'running');
    case 'finished': return tournaments.value.filter(t => t.status === 'finished');
    case 'mine':     return tournaments.value.filter(t =>
      String(t.organizerId) === me ||
      t.participants.some(p => String(p.id) === me)
    );
  }
  return tournaments.value;
});

// ── Création ──
const openCreate = () => {
  form.value = { name:'', gameId:'pong', format:'elimination', maxPlayers:8, groupId:'' };
  showCreateModal.value = true;
};

const submitCreate = async () => {
  if (!form.value.name.trim()) return;
  try {
    const body = {
      name: form.value.name,
      gameId: form.value.gameId,
      format: form.value.format,
      maxPlayers: parseInt(form.value.maxPlayers, 10),
      organizerId: props.currentUser.id,
      groupId: form.value.groupId || null,
    };
    const res = await fetch(`${API}/api/tournaments/create`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showCreateModal.value = false;
    await loadTournaments();
    selectedTournament.value = data.tournament;
    Swal?.fire({ icon:'success', title:'Tournoi créé !', timer:1500, showConfirmButton:false, background:'#111827', color:'#f9fafb' });
  } catch (e) {
    Swal?.fire({ icon:'error', title:'Erreur', text:e.message || 'Impossible de créer', background:'#111827', color:'#f9fafb', confirmButtonColor:'#6366f1' });
  }
};

// ── Inscription / désinscription ──
const isParticipant = (t) => t.participants.some(p => String(p.id) === String(props.currentUser.id));
const isOrganizer   = (t) => String(t.organizerId) === String(props.currentUser.id);

const joinTournament = async (t) => {
  try {
    const res = await fetch(`${API}/api/tournaments/${t.id}/join`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ userId: props.currentUser.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    Object.assign(t, data.tournament);
    if (selectedTournament.value?.id === t.id) selectedTournament.value = data.tournament;
  } catch (e) {
    Swal?.fire({ icon:'error', title:'Erreur', text:e.message, background:'#111827', color:'#f9fafb', confirmButtonColor:'#6366f1' });
  }
};

const leaveTournament = async (t) => {
  try {
    const res = await fetch(`${API}/api/tournaments/${t.id}/leave`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ userId: props.currentUser.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    Object.assign(t, data.tournament);
    if (selectedTournament.value?.id === t.id) selectedTournament.value = data.tournament;
  } catch (e) {
    Swal?.fire({ icon:'error', title:'Erreur', text:e.message, background:'#111827', color:'#f9fafb', confirmButtonColor:'#6366f1' });
  }
};

const startTournament = async (t) => {
  if (t.participants.length < 3) {
    Swal?.fire({ icon:'warning', title:'Minimum 3 joueurs', background:'#111827', color:'#f9fafb', confirmButtonColor:'#6366f1' });
    return;
  }
  const r = await Swal.fire({
    icon:'question', title:`Démarrer ${t.name} ?`, text:`${t.participants.length} joueurs · ${t.format==='elimination'?'Élimination directe':'Round-robin'}`,
    showCancelButton:true, confirmButtonText:'Démarrer', cancelButtonText:'Annuler',
    background:'#111827', color:'#f9fafb', confirmButtonColor:'#6366f1',
  });
  if (!r.isConfirmed) return;
  try {
    const res = await fetch(`${API}/api/tournaments/${t.id}/start`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ userId: props.currentUser.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    Object.assign(t, data.tournament);
    selectedTournament.value = data.tournament;
    tab.value = 'running';
  } catch (e) {
    Swal?.fire({ icon:'error', title:'Erreur', text:e.message, background:'#111827', color:'#f9fafb', confirmButtonColor:'#6366f1' });
  }
};

const deleteTournament = async (t) => {
  const r = await Swal.fire({
    icon:'warning', title:`Supprimer ${t.name} ?`, text:'Action irréversible.',
    showCancelButton:true, confirmButtonText:'Supprimer', cancelButtonText:'Annuler',
    background:'#111827', color:'#f9fafb', confirmButtonColor:'#dc2626',
  });
  if (!r.isConfirmed) return;
  try {
    const res = await fetch(`${API}/api/tournaments/${t.id}`, {
      method:'DELETE', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ userId: props.currentUser.id }),
    });
    if (!res.ok) throw new Error();
    if (selectedTournament.value?.id === t.id) selectedTournament.value = null;
    await loadTournaments();
  } catch {
    Swal?.fire({ icon:'error', title:'Erreur', background:'#111827', color:'#f9fafb', confirmButtonColor:'#6366f1' });
  }
};

// ── Soumettre un résultat de match ──
const submitResult = async (match, winnerId, score1, score2) => {
  try {
    const res = await fetch(`${API}/api/tournaments/${selectedTournament.value.id}/result`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        userId: props.currentUser.id,
        matchId: match.id,
        winnerId,
        score1: score1 ?? null,
        score2: score2 ?? null,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    selectedTournament.value = data.tournament;
  } catch (e) {
    Swal?.fire({ icon:'error', title:'Erreur', text:e.message, background:'#111827', color:'#f9fafb', confirmButtonColor:'#6366f1' });
  }
};

const reportMatchResult = async (match) => {
  if (!match.p1 || !match.p2) return;
  const { value: choice } = await Swal.fire({
    title: `Résultat — ${match.p1.username} vs ${match.p2.username}`,
    background: '#111827', color: '#f9fafb',
    input: 'select',
    inputOptions: { p1:`✅ ${match.p1.username} a gagné`, p2:`✅ ${match.p2.username} a gagné` },
    inputPlaceholder: 'Qui a gagné ?',
    showCancelButton: true, confirmButtonColor: '#6366f1', cancelButtonText: 'Annuler',
  });
  if (!choice) return;
  const winnerId = choice === 'p1' ? match.p1.id : match.p2.id;
  await submitResult(match, winnerId);
};

// ── Lancer le match (ouvrir la salle de jeu) ──
const playMatch = (match) => {
  if (!match.p1 || !match.p2) return;
  const myId = String(props.currentUser.id);
  if (String(match.p1.id) !== myId && String(match.p2.id) !== myId) {
    Swal?.fire({ icon:'info', title:'Tu n\'es pas dans ce match', background:'#111827', color:'#f9fafb', confirmButtonColor:'#6366f1', timer:1500, showConfirmButton:false });
    return;
  }
  emit('play-match', {
    tournamentId: selectedTournament.value.id,
    matchId: match.id,
    gameId: selectedTournament.value.gameId,
    opponent: String(match.p1.id) === myId ? match.p2 : match.p1,
  });
};

// ── Helper rounds elim ──
const eliminationRoundLabel = (idx, total) => {
  const remaining = total - idx;
  if (remaining === 1) return '🏆 Finale';
  if (remaining === 2) return '🥈 Demi-finale';
  if (remaining === 3) return '🥉 Quart de finale';
  if (remaining === 4) return '1/8 de finale';
  return `Round ${idx + 1}`;
};

// ── Socket listeners ──
const onTournamentCreated = ({ tournament }) => {
  if (!tournaments.value.find(t => t.id === tournament.id)) tournaments.value.unshift(tournament);
};
const onTournamentUpdated = ({ tournament }) => {
  const idx = tournaments.value.findIndex(t => t.id === tournament.id);
  if (idx >= 0) tournaments.value[idx] = tournament;
  else tournaments.value.unshift(tournament);
  if (selectedTournament.value?.id === tournament.id) selectedTournament.value = tournament;
};
const onTournamentDeleted = ({ id }) => {
  tournaments.value = tournaments.value.filter(t => t.id !== id);
  if (selectedTournament.value?.id === id) selectedTournament.value = null;
};

onMounted(() => {
  loadTournaments();
  props.socket.on('tournament-created', onTournamentCreated);
  props.socket.on('tournament-updated', onTournamentUpdated);
  props.socket.on('tournament-deleted', onTournamentDeleted);
});
onUnmounted(() => {
  props.socket.off('tournament-created', onTournamentCreated);
  props.socket.off('tournament-updated', onTournamentUpdated);
  props.socket.off('tournament-deleted', onTournamentDeleted);
});
</script>

<template>
  <div class="h-full flex flex-col bg-gradient-to-br from-gray-900 via-purple-900/20 to-gray-900 text-white">

    <!-- Header -->
    <header class="flex items-center justify-between px-6 py-4 border-b border-purple-900/40 bg-gray-950/80 backdrop-blur">
      <div class="flex items-center gap-3">
        <span class="text-3xl">🏆</span>
        <div>
          <h1 class="text-xl font-bold">Tournois inter-campus</h1>
          <p class="text-xs text-purple-300">Compétitions officielles ArenaLink</p>
        </div>
      </div>
      <div class="flex gap-2">
        <button @click="openCreate" class="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-xl font-bold text-sm flex items-center gap-2">+ Créer un tournoi</button>
        <button @click="emit('close')" class="px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-sm">✕</button>
      </div>
    </header>

    <!-- Tabs -->
    <div class="flex gap-2 px-6 py-3 border-b border-gray-800">
      <button v-for="t in [{k:'open',l:'🟢 Ouverts'},{k:'running',l:'⚔️ En cours'},{k:'mine',l:'⭐ Mes tournois'},{k:'finished',l:'🏁 Terminés'}]"
        :key="t.k" @click="tab=t.k"
        class="px-4 py-1.5 rounded-lg text-sm font-semibold transition"
        :class="tab===t.k ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'">
        {{ t.l }}
      </button>
    </div>

    <!-- Layout : liste + détail -->
    <div class="flex-1 flex overflow-hidden">

      <!-- Liste -->
      <div class="w-96 border-r border-gray-800 overflow-y-auto p-4 space-y-3 scrollbar-hide">
        <div v-if="loading" class="text-center text-gray-500 py-8">Chargement…</div>
        <div v-else-if="filtered.length===0" class="text-center text-gray-500 py-8 text-sm">
          Aucun tournoi {{ tab==='open'?'ouvert':tab==='running'?'en cours':tab==='mine'?'pour toi':'terminé' }}.
        </div>
        <div v-for="t in filtered" :key="t.id"
          @click="selectedTournament = t"
          class="bg-gray-800/60 hover:bg-gray-800 border rounded-xl p-3 cursor-pointer transition"
          :class="selectedTournament?.id===t.id ? 'border-purple-500' : 'border-gray-700'">
          <div class="flex items-start justify-between mb-2">
            <h3 class="font-bold text-sm text-white truncate flex-1">{{ t.name }}</h3>
            <span class="text-[10px] px-2 py-0.5 rounded-full font-bold flex-shrink-0 ml-2"
              :class="t.status==='open'?'bg-green-500/20 text-green-400':t.status==='running'?'bg-yellow-500/20 text-yellow-400':'bg-gray-700 text-gray-400'">
              {{ t.status==='open'?'Ouvert':t.status==='running'?'En cours':'Terminé' }}
            </span>
          </div>
          <div class="flex items-center gap-2 text-xs text-gray-400 mb-1.5">
            <span>{{ GAMES.find(g => g.id===t.gameId)?.label || t.gameId }}</span>
            <span>·</span>
            <span>{{ t.format==='elimination'?'🏟 Bracket':'🔄 Round-robin' }}</span>
          </div>
          <div class="flex items-center justify-between text-xs">
            <span class="text-purple-400">👥 {{ t.participants.length }}/{{ t.maxPlayers }}</span>
            <span v-if="t.groupName" class="text-indigo-400 truncate ml-2">🏠 {{ t.groupName }}</span>
          </div>
          <div v-if="t.winner" class="mt-2 flex items-center gap-1 text-xs text-yellow-400 font-bold">
            🏆 {{ t.winner.username }}
          </div>
        </div>
      </div>

      <!-- Détail -->
      <div class="flex-1 overflow-y-auto scrollbar-hide">
        <div v-if="!selectedTournament" class="h-full flex items-center justify-center text-gray-500 text-sm">
          ← Sélectionne un tournoi pour voir le détail
        </div>

        <div v-else class="p-6 space-y-6">
          <!-- En-tête détail -->
          <div class="bg-gradient-to-r from-purple-900/40 to-indigo-900/40 border border-purple-700/50 rounded-2xl p-5">
            <div class="flex items-start justify-between gap-4 mb-3">
              <div class="flex-1">
                <h2 class="text-2xl font-bold text-white">{{ selectedTournament.name }}</h2>
                <div class="flex flex-wrap gap-2 mt-2 text-xs">
                  <span class="px-2 py-1 bg-black/30 rounded">{{ GAMES.find(g => g.id===selectedTournament.gameId)?.label }}</span>
                  <span class="px-2 py-1 bg-black/30 rounded">{{ selectedTournament.format==='elimination'?'🏟 Élimination directe':'🔄 Round-robin' }}</span>
                  <span class="px-2 py-1 bg-black/30 rounded">👥 {{ selectedTournament.participants.length }}/{{ selectedTournament.maxPlayers }}</span>
                  <span v-if="selectedTournament.groupName" class="px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded">🏠 {{ selectedTournament.groupName }}</span>
                </div>
                <p class="text-xs text-gray-400 mt-2">Organisé par <b class="text-purple-300">{{ selectedTournament.organizerName }}</b></p>
              </div>
              <span class="text-xs px-3 py-1 rounded-full font-bold flex-shrink-0"
                :class="selectedTournament.status==='open'?'bg-green-500/20 text-green-400':selectedTournament.status==='running'?'bg-yellow-500/20 text-yellow-400':'bg-gray-700 text-gray-400'">
                {{ selectedTournament.status==='open'?'INSCRIPTIONS':selectedTournament.status==='running'?'EN COURS':'TERMINÉ' }}
              </span>
            </div>

            <!-- Actions -->
            <div class="flex flex-wrap gap-2">
              <button v-if="selectedTournament.status==='open' && !isParticipant(selectedTournament)"
                @click="joinTournament(selectedTournament)"
                class="px-4 py-2 bg-green-600 hover:bg-green-500 rounded-xl text-sm font-bold">✅ S'inscrire</button>
              <button v-if="selectedTournament.status==='open' && isParticipant(selectedTournament) && !isOrganizer(selectedTournament)"
                @click="leaveTournament(selectedTournament)"
                class="px-4 py-2 bg-red-500/20 hover:bg-red-500/40 text-red-400 rounded-xl text-sm font-bold">Se désinscrire</button>
              <button v-if="selectedTournament.status==='open' && isOrganizer(selectedTournament)"
                @click="startTournament(selectedTournament)"
                class="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-xl text-sm font-bold">🚀 Démarrer</button>
              <button v-if="isOrganizer(selectedTournament)"
                @click="deleteTournament(selectedTournament)"
                class="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl text-xs">🗑 Supprimer</button>
            </div>
          </div>

          <!-- Vainqueur (si terminé) -->
          <div v-if="selectedTournament.status==='finished' && selectedTournament.winner"
            class="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 border-2 border-yellow-500/50 rounded-2xl p-6 text-center">
            <p class="text-xs text-yellow-300 mb-1">🏆 VAINQUEUR</p>
            <img :src="selectedTournament.winner.avatar" class="w-20 h-20 rounded-full mx-auto bg-gray-700 mb-2" />
            <h3 class="text-xl font-bold text-yellow-300">{{ selectedTournament.winner.username }}</h3>
          </div>

          <!-- Inscrits (si pas encore lancé) -->
          <div v-if="selectedTournament.status==='open'">
            <h3 class="text-sm font-bold text-purple-300 uppercase tracking-wider mb-3">Participants ({{ selectedTournament.participants.length }})</h3>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-2">
              <div v-for="p in selectedTournament.participants" :key="p.id"
                class="flex items-center gap-2 bg-gray-800 rounded-xl p-2">
                <img :src="p.avatar" class="w-8 h-8 rounded-full bg-gray-700" />
                <span class="text-sm truncate">{{ p.username }}</span>
                <span v-if="String(p.id)===String(selectedTournament.organizerId)" class="text-xs">👑</span>
              </div>
            </div>
          </div>

          <!-- Bracket élimination -->
          <div v-if="selectedTournament.bracket?.type==='elimination'">
            <h3 class="text-sm font-bold text-purple-300 uppercase tracking-wider mb-3">Bracket</h3>
            <div class="overflow-x-auto pb-3">
              <div class="flex gap-6 min-w-max">
                <div v-for="(round, rIdx) in selectedTournament.bracket.rounds" :key="rIdx" class="flex flex-col gap-2 min-w-[220px]">
                  <p class="text-xs font-bold text-purple-400 text-center mb-1">{{ eliminationRoundLabel(rIdx, selectedTournament.bracket.rounds.length) }}</p>
                  <div v-for="match in round" :key="match.id"
                    class="bg-gray-800/80 border rounded-xl p-2 text-xs"
                    :class="match.status==='done' ? 'border-green-700/50' : match.status==='pending' ? 'border-yellow-700/50' : 'border-gray-700'">

                    <div v-for="(p, i) in [match.p1, match.p2]" :key="i"
                      class="flex items-center gap-2 p-1.5 rounded"
                      :class="match.winner && p && String(match.winner.id)===String(p.id) ? 'bg-green-500/20 text-green-300 font-bold' : 'text-gray-300'">
                      <img v-if="p" :src="p.avatar" class="w-5 h-5 rounded-full bg-gray-700" />
                      <div v-else class="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-[8px] text-gray-500">?</div>
                      <span class="flex-1 truncate">{{ p ? p.username : '— En attente —' }}</span>
                      <span v-if="match.winner && p && String(match.winner.id)===String(p.id)">✓</span>
                    </div>

                    <div v-if="match.status==='pending' && match.p1 && match.p2" class="mt-2 flex gap-1">
                    <button v-if="match.p1 && match.p2 && (String(match.p1.id)===String(props.currentUser.id) || String(match.p2.id)===String(props.currentUser.id))"

                        @click="playMatch(match)"
                        class="flex-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-[10px] font-bold">▶ Jouer</button>
                      <button @click="reportMatchResult(match)"
                        class="flex-1 px-2 py-1 bg-purple-600/40 hover:bg-purple-600/60 text-purple-300 rounded text-[10px] font-bold">📝 Résultat</button>
                    </div>
                    <div v-else-if="match.status==='waiting'" class="mt-1 text-center text-[10px] text-gray-600">⏳ En attente</div>
                    <div v-else-if="match.status==='done' && match.score1!==null" class="mt-1 text-center text-[10px] text-gray-400">{{ match.score1 }} - {{ match.score2 }}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Round-robin -->
          <div v-if="selectedTournament.bracket?.type==='round-robin'">
            <h3 class="text-sm font-bold text-purple-300 uppercase tracking-wider mb-3">Classement</h3>
            <div class="bg-gray-800 rounded-xl overflow-hidden mb-4">
              <div class="grid grid-cols-[40px_1fr_60px_60px_60px] px-3 py-2 text-[10px] font-bold text-gray-500 uppercase border-b border-gray-700">
                <span>#</span><span>Joueur</span><span class="text-center">J</span><span class="text-center">V</span><span class="text-center">D</span>
              </div>
              <div v-for="(p, i) in selectedTournament.standings" :key="p.id"
                class="grid grid-cols-[40px_1fr_60px_60px_60px] px-3 py-2 items-center text-sm border-b border-gray-700/50 last:border-0"
                :class="i===0 ? 'bg-yellow-500/10' : ''">
                <span class="font-bold" :class="i===0?'text-yellow-400':i===1?'text-gray-300':i===2?'text-orange-400':'text-gray-500'">
                  {{ i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1 }}
                </span>
                <div class="flex items-center gap-2 min-w-0">
                  <img :src="p.avatar" class="w-6 h-6 rounded-full bg-gray-700" />
                  <span class="truncate">{{ p.username }}</span>
                </div>
                <span class="text-center text-gray-400">{{ p.played }}</span>
                <span class="text-center text-green-400 font-bold">{{ p.wins }}</span>
                <span class="text-center text-red-400">{{ p.losses }}</span>
              </div>
            </div>

            <h3 class="text-sm font-bold text-purple-300 uppercase tracking-wider mb-3">Matchs</h3>
            <div class="grid md:grid-cols-2 gap-2">
              <div v-for="match in selectedTournament.bracket.matches" :key="match.id"
                class="bg-gray-800 border rounded-xl p-3 text-xs"
                :class="match.status==='done' ? 'border-green-700/50' : 'border-gray-700'">
                <div class="flex items-center justify-between gap-2">
                  <div class="flex items-center gap-2 flex-1 min-w-0"
                    :class="match.winner && String(match.winner.id)===String(match.p1.id) ? 'text-green-300 font-bold' : ''">
                    <img :src="match.p1.avatar" class="w-6 h-6 rounded-full bg-gray-700" />
                    <span class="truncate">{{ match.p1.username }}</span>
                  </div>
                  <span class="text-gray-500 px-1">vs</span>
                  <div class="flex items-center gap-2 flex-1 min-w-0 justify-end"
                    :class="match.winner && String(match.winner.id)===String(match.p2.id) ? 'text-green-300 font-bold' : ''">
                    <span class="truncate">{{ match.p2.username }}</span>
                    <img :src="match.p2.avatar" class="w-6 h-6 rounded-full bg-gray-700" />
                  </div>
                </div>
                <div v-if="match.status==='pending'" class="mt-2 flex gap-1">
                  <button v-if="String(match.p1.id)===String(props.currentUser.id) || String(match.p2.id)===String(props.currentUser.id)"                    @click="playMatch(match)"
                    class="flex-1 px-2 py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-[10px] font-bold">▶ Jouer</button>
                  <button @click="reportMatchResult(match)"
                    class="flex-1 px-2 py-1 bg-purple-600/40 hover:bg-purple-600/60 text-purple-300 rounded text-[10px] font-bold">📝 Résultat</button>
                </div>
                <div v-else-if="match.status==='done' && match.winner" class="mt-1 text-center text-[10px] text-green-400">
                  ✓ {{ match.winner.username }} gagne
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ Modal Création ═══ -->
    <div v-if="showCreateModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" @click.self="showCreateModal=false">
      <div class="w-full max-w-lg bg-gray-900 border border-purple-700/50 rounded-2xl shadow-2xl overflow-hidden">
        <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gradient-to-r from-purple-900/40 to-indigo-900/40">
          <h2 class="text-lg font-bold">🏆 Créer un tournoi</h2>
          <button @click="showCreateModal=false" class="text-gray-400 hover:text-white text-xl">✕</button>
        </div>
        <div class="p-6 space-y-4">

          <div>
            <label class="text-xs font-bold text-purple-300 uppercase tracking-wider mb-2 block">Nom</label>
            <input v-model="form.name" maxlength="60" placeholder="Ex: Coupe inter-campus FST"
              class="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 focus:outline-none focus:border-purple-500" />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="text-xs font-bold text-purple-300 uppercase tracking-wider mb-2 block">Jeu</label>
              <select v-model="form.gameId" class="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 focus:outline-none focus:border-purple-500">
                <option v-for="g in GAMES" :key="g.id" :value="g.id">{{ g.label }}</option>
              </select>
            </div>
            <div>
              <label class="text-xs font-bold text-purple-300 uppercase tracking-wider mb-2 block">Joueurs max</label>
              <input v-model.number="form.maxPlayers" type="number" min="3" max="64"
                class="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 focus:outline-none focus:border-purple-500" />
            </div>
          </div>

          <div>
            <label class="text-xs font-bold text-purple-300 uppercase tracking-wider mb-2 block">Format</label>
            <div class="grid grid-cols-2 gap-2">
              <button @click="form.format='elimination'" type="button"
                class="p-3 rounded-xl border-2 text-left transition"
                :class="form.format==='elimination' ? 'border-purple-500 bg-purple-500/10' : 'border-gray-700 bg-gray-800'">
                <div class="text-lg mb-1">🏟</div>
                <div class="text-sm font-bold">Élimination</div>
                <div class="text-[10px] text-gray-500">Tu perds, t'es out</div>
              </button>
              <button @click="form.format='round-robin'" type="button"
                class="p-3 rounded-xl border-2 text-left transition"
                :class="form.format==='round-robin' ? 'border-purple-500 bg-purple-500/10' : 'border-gray-700 bg-gray-800'">
                <div class="text-lg mb-1">🔄</div>
                <div class="text-sm font-bold">Round-robin</div>
                <div class="text-[10px] text-gray-500">Tous contre tous</div>
              </button>
            </div>
          </div>

          <div v-if="userGroups.length > 0">
            <label class="text-xs font-bold text-purple-300 uppercase tracking-wider mb-2 block">Hébergé dans (optionnel)</label>
            <select v-model="form.groupId" class="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-3 focus:outline-none focus:border-purple-500">
              <option value="">🌍 Public (tous les utilisateurs)</option>
              <option v-for="g in userGroups.filter(g => g.admins?.map(String).includes(String(currentUser.id)))"
                :key="g.id" :value="g.id">🏠 {{ g.name }}</option>
            </select>
            <p class="text-[10px] text-gray-500 mt-1">Tu ne peux héberger un tournoi que dans les groupes où tu es admin.</p>
          </div>
        </div>
        <div class="flex justify-end gap-2 px-6 py-4 border-t border-gray-800 bg-gray-950/40">
          <button @click="showCreateModal=false" class="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-sm">Annuler</button>
          <button @click="submitCreate" :disabled="!form.name.trim()"
            class="px-5 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-xl text-sm font-bold">Créer</button>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.scrollbar-hide::-webkit-scrollbar { display: none; }
.scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
</style>