<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { io } from 'socket.io-client';
import GameArena      from './views/Gamearena.vue';
import Connexion      from './views/Connexion.vue';
import ProfileModal   from './views/ProfileModal.vue';
import CreateGroupModal from './views/CreateGroupModal.vue';

// ============================================================
// SOCKET.IO
// ============================================================
const socket = io('http://localhost:3001', { autoConnect: false });

// ============================================================
// ÉTATS GLOBAUX
// ============================================================
const showArena         = ref(false);
const isAuthenticated   = ref(false);
const showProfileModal  = ref(false);
const showCreateGroup   = ref(false);

const currentUser = ref({
  id:          null,
  name:        'Mehdi',
  bio:         '',
  status:      'online',
  avatar:      'https://api.dicebear.com/7.x/avataaars/svg?seed=Mehdi',
  avatarStyle: 'avataaars',
  avatarSeed:  'Mehdi',
});

// ============================================================
// SERVEURS / GROUPES
// ============================================================
const servers = ref([
  { id: 1, name: 'ArenaLink Officiel', initials: 'AL', active: true,  type: 'public'  },
  { id: 2, name: 'Tournoi FST',        initials: 'FST', active: false, type: 'public'  },
  { id: 3, name: 'Guilde Dev',         initials: 'DEV', active: false, type: 'private' },
]);

const activeServer = ref(servers.value[0]);

const switchServer = (server) => {
  servers.value.forEach(s => s.active = s.id === server.id);
  activeServer.value = server;
  // Réinitialiser les canaux selon le serveur (simplifié : même canaux pour tous)
};

const onGroupCreated = (newGroup) => {
  servers.value.push(newGroup);
  showCreateGroup.value = false;
};

// ============================================================
// CANAUX
// ============================================================
const textChannels = ref([
  { id: '101', name: 'général',           active: true  },
  { id: '102', name: 'recherche-joueurs', active: false },
  { id: '103', name: 'dev-backend',       active: false },
]);

const voiceChannels = ref([
  { id: 'V-8829', name: 'Lobby Principal',            users: [] },
  { id: 'V-4412', name: "Salle d'attente (Tournoi)",  users: [] },
]);

// ============================================================
// CHAT
// ============================================================
const messages      = ref([]);
const newMessage    = ref('');
const activeChannel = ref('101');

const loadChannel = async (channelId) => {
  socket.emit('leave-channel', activeChannel.value);
  socket.emit('join-channel',  channelId);
  try {
    const res  = await fetch(`http://localhost:3001/api/messages/${channelId}`);
    messages.value = await res.json();
  } catch {
    messages.value = [];
  }
};

const switchChannel = (channel) => {
  textChannels.value.forEach(c => c.active = c.id === channel.id);
  activeChannel.value = channel.id;
};

watch(activeChannel, (id) => loadChannel(id));

socket.on('new-message', (msg) => { messages.value.push(msg); });

const sendMessage = () => {
  if (!newMessage.value.trim()) return;
  socket.emit('send-message', {
    channelId: activeChannel.value,
    userId:    currentUser.value.id,
    username:  currentUser.value.name,
    avatar:    currentUser.value.avatar,
    text:      newMessage.value.trim(),
  });
  newMessage.value = '';
};

// ============================================================
// VOCAL (WebRTC)
// ============================================================
const connectedVoice  = ref(null);
const isMicMuted      = ref(false);
const isDeafened      = ref(false);

let localStream       = null;
const peerConnections = {};

const ICE_SERVERS = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

const joinVoiceChannel = async (channelId) => {
  if (connectedVoice.value?.id === channelId) {
    await disconnectVoice();
    return;
  }
  if (connectedVoice.value) await disconnectVoice();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch {
    alert('Accès au microphone refusé. Vérifie les permissions.');
    return;
  }

  localStream.getAudioTracks().forEach(t => t.enabled = !isMicMuted.value);

  const channel = voiceChannels.value.find(c => c.id === channelId);
  connectedVoice.value = channel ?? { id: channelId, name: 'Salon vocal', users: [] };

  socket.emit('join-voice', {
    roomId:   channelId,
    userId:   currentUser.value.id,
    username: currentUser.value.name,
  });

  if (channel) {
    if (!channel.users.find(u => u.name === currentUser.value.name)) {
      channel.users.push({ name: currentUser.value.name, isSpeaking: false, isMuted: isMicMuted.value });
    }
  }
};

const disconnectVoice = async () => {
  if (!connectedVoice.value) return;
  localStream?.getTracks().forEach(t => t.stop());
  localStream = null;
  Object.values(peerConnections).forEach(pc => pc.close());
  Object.keys(peerConnections).forEach(k => delete peerConnections[k]);
  const channel = voiceChannels.value.find(c => c.id === connectedVoice.value.id);
  if (channel) channel.users = channel.users.filter(u => u.name !== currentUser.value.name);
  socket.emit('leave-voice', { roomId: connectedVoice.value.id });
  connectedVoice.value = null;
};

const createPeerConnection = (remoteSocketId) => {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  peerConnections[remoteSocketId] = pc;
  localStream?.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('webrtc-ice', { to: remoteSocketId, candidate });
  };
  pc.ontrack = ({ streams }) => {
    const audio = new Audio();
    audio.srcObject = streams[0];
    audio.setAttribute('data-remote', remoteSocketId);
    audio.muted = isDeafened.value;
    document.body.appendChild(audio);
    audio.play().catch(console.warn);
  };
  return pc;
};

socket.on('user-joined-voice', async ({ socketId }) => {
  const pc    = createPeerConnection(socketId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit('webrtc-offer', { to: socketId, offer });
});

socket.on('webrtc-offer', async ({ from, offer }) => {
  const pc = createPeerConnection(from);
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit('webrtc-answer', { to: from, answer });
});

socket.on('webrtc-answer', async ({ from, answer }) => {
  await peerConnections[from]?.setRemoteDescription(new RTCSessionDescription(answer));
});

socket.on('webrtc-ice', async ({ from, candidate }) => {
  try { await peerConnections[from]?.addIceCandidate(new RTCIceCandidate(candidate)); }
  catch (e) { console.warn('ICE error:', e); }
});

socket.on('user-left-voice', (socketId) => {
  peerConnections[socketId]?.close();
  delete peerConnections[socketId];
  document.querySelector(`audio[data-remote="${socketId}"]`)?.remove();
});

const toggleMic = () => {
  isMicMuted.value = !isMicMuted.value;
  localStream?.getAudioTracks().forEach(t => t.enabled = !isMicMuted.value);
  if (connectedVoice.value) {
    const ch = voiceChannels.value.find(c => c.id === connectedVoice.value.id);
    const me = ch?.users.find(u => u.name === currentUser.value.name);
    if (me) me.isMuted = isMicMuted.value;
  }
};

const toggleDeafen = () => {
  isDeafened.value = !isDeafened.value;
  document.querySelectorAll('audio[data-remote]').forEach(a => { a.muted = isDeafened.value; });
};

// ============================================================
// PROFIL
// ============================================================
const saveProfile = (data) => {
  currentUser.value.name        = data.name;
  currentUser.value.bio         = data.bio;
  currentUser.value.avatar      = data.avatar;
  currentUser.value.avatarStyle = data.avatarStyle;
  currentUser.value.avatarSeed  = data.avatarSeed;
  showProfileModal.value        = false;
};

// ============================================================
// CYCLE DE VIE
// ============================================================
onMounted(() => {
  socket.on('update-voice-channels', (channels) => {
    voiceChannels.value = channels;
  });
});

const handleLogin = (userData) => {
  currentUser.value.id     = userData.id ?? null;
  currentUser.value.name   = userData.name;
  currentUser.value.avatar = userData.avatar;
  isAuthenticated.value    = true;
  socket.connect();
  loadChannel(activeChannel.value);
};

onUnmounted(async () => {
  await disconnectVoice();
  socket.disconnect();
});
</script>

<template>
  <Connexion v-if="!isAuthenticated" @login-success="handleLogin" />

  <!-- Modals -->
  <ProfileModal
    v-if="showProfileModal"
    :user="currentUser"
    @close="showProfileModal = false"
    @save="saveProfile"
  />
  <CreateGroupModal
    v-if="showCreateGroup"
    :current-user-id="currentUser.id"
    @close="showCreateGroup = false"
    @created="onGroupCreated"
  />

  <div v-if="isAuthenticated" class="flex h-screen w-full bg-gray-900 text-gray-100 font-sans overflow-hidden">

    <!-- ═══ BARRE DE SERVEURS (gauche) ═══ -->
    <nav class="w-[72px] bg-gray-950 flex flex-col items-center py-4 gap-3 z-20 shadow-xl">

      <!-- Logo -->
      <div class="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center cursor-pointer hover:rounded-xl transition-all duration-300 shadow-lg shadow-indigo-500/30">
        <span class="text-white font-bold text-xl">🎮</span>
      </div>

      <div class="w-8 h-[2px] bg-gray-800 rounded-full"></div>

      <!-- Serveurs -->
      <div
        v-for="server in servers"
        :key="server.id"
        @click="switchServer(server)"
        class="relative w-12 h-12 rounded-full flex items-center justify-center cursor-pointer hover:bg-indigo-500 hover:rounded-xl transition-all duration-300 text-xs font-bold text-gray-300 hover:text-white flex-shrink-0"
        :class="server.active ? 'bg-indigo-600 rounded-xl text-white' : 'bg-gray-800'"
        :title="server.name"
      >
        {{ server.initials }}
        <!-- Badge privé/public -->
        <span
          class="absolute -bottom-0.5 -right-0.5 text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-bold"
          :class="server.type === 'private' ? 'bg-indigo-800 text-indigo-300' : 'bg-green-800 text-green-300'"
        >
          {{ server.type === 'private' ? '🔒' : '🌍' }}
        </span>
      </div>

      <!-- Séparateur -->
      <div class="w-8 h-[2px] bg-gray-800 rounded-full"></div>

      <!-- Bouton + créer groupe -->
      <button
        @click="showCreateGroup = true"
        class="w-12 h-12 bg-gray-800 text-green-500 rounded-full flex items-center justify-center cursor-pointer hover:bg-green-500 hover:text-white hover:rounded-xl transition-all duration-300"
        title="Créer un groupe"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
      </button>
    </nav>

    <!-- ═══ SIDEBAR CANAUX ═══ -->
    <aside class="w-64 bg-gray-900 flex flex-col border-r border-gray-800 relative z-10">

      <!-- Header serveur actif -->
      <header class="h-14 px-4 flex items-center gap-2 border-b border-gray-800 shadow-sm bg-gray-900">
        <div
          class="w-7 h-7 rounded-lg text-[10px] font-bold flex items-center justify-center flex-shrink-0"
          :class="activeServer.type === 'private' ? 'bg-indigo-600' : 'bg-green-600'"
        >
          {{ activeServer.initials }}
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="font-bold text-white text-sm truncate">{{ activeServer.name }}</h2>
          <p class="text-[10px]" :class="activeServer.type === 'private' ? 'text-indigo-400' : 'text-green-400'">
            {{ activeServer.type === 'private' ? '🔒 Privé' : '🌍 Public' }}
          </p>
        </div>
      </header>

      <div class="flex-1 overflow-y-auto p-3 scrollbar-hide flex flex-col gap-5">

        <!-- Salons textuels -->
        <div>
          <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">Salons Textuels</h3>
          <ul class="space-y-[2px]">
            <li
              v-for="channel in textChannels"
              :key="channel.id"
              @click="switchChannel(channel)"
              class="px-2 py-1.5 rounded flex items-center text-gray-400 cursor-pointer hover:bg-gray-800 hover:text-gray-200 transition-colors"
              :class="{ 'bg-gray-800 text-white font-medium': channel.active }"
            >
              <span class="text-lg mr-2 text-gray-500">#</span>{{ channel.name }}
            </li>
          </ul>
        </div>

        <!-- Salons vocaux -->
        <div>
          <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">Salons Vocaux</h3>
          <ul class="space-y-2">
            <li v-for="voice in voiceChannels" :key="voice.id">
              <div
                @click="joinVoiceChannel(voice.id)"
                class="px-2 py-1.5 rounded flex items-center justify-between text-gray-400 cursor-pointer hover:bg-gray-800 hover:text-gray-200 transition-colors"
                :class="{ 'bg-gray-800 text-white font-medium': connectedVoice?.id === voice.id }"
              >
                <div class="flex items-center">
                  <svg class="w-4 h-4 mr-2 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                  </svg>
                  <span class="text-sm truncate">{{ voice.name }}</span>
                </div>
                <span v-if="connectedVoice?.id === voice.id" class="text-[10px] text-green-400 font-bold ml-1 flex-shrink-0">● LIVE</span>
              </div>
              <ul v-if="voice.users?.length" class="mt-1 pl-6 space-y-1">
                <li v-for="u in voice.users" :key="u.name" class="flex items-center gap-2 text-xs text-gray-400">
                  <img
                    :src="`https://api.dicebear.com/7.x/avataaars/svg?seed=${u.name}`"
                    class="w-5 h-5 rounded-full flex-shrink-0"
                    :class="{ 'ring-2 ring-green-400': u.isSpeaking }"
                  />
                  <span :class="{ 'text-green-400': u.isSpeaking }">{{ u.name }}</span>
                  <span v-if="u.isMuted" class="text-[10px]">🔇</span>
                </li>
              </ul>
            </li>
          </ul>
        </div>
      </div>

      <!-- Zone utilisateur en bas -->
      <div class="h-16 bg-gray-950 px-2 py-2 flex items-center justify-between border-t border-gray-800 gap-1">
        <!-- Avatar cliquable → profil -->
        <div
          @click="showProfileModal = true"
          class="flex items-center gap-2 p-1.5 rounded cursor-pointer hover:bg-gray-800 transition-colors flex-1 min-w-0"
          title="Modifier mon profil"
        >
          <div class="relative flex-shrink-0">
            <img :src="currentUser.avatar" alt="Avatar" class="w-8 h-8 rounded-full bg-gray-700" />
            <div class="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-gray-950"></div>
          </div>
          <div class="flex flex-col truncate">
            <span class="text-sm font-bold text-white truncate">{{ currentUser.name }}</span>
            <span class="text-[10px] truncate" :class="connectedVoice ? 'text-green-400' : 'text-gray-400'">
              {{ connectedVoice ? `🔴 ${connectedVoice.name}` : 'En ligne' }}
            </span>
          </div>
        </div>

        <!-- Micro -->
        <button
          @click="toggleMic"
          :title="isMicMuted ? 'Activer le micro' : 'Couper le micro'"
          class="w-8 h-8 rounded flex items-center justify-center transition-colors flex-shrink-0"
          :class="isMicMuted ? 'bg-red-900/60 text-red-400 hover:bg-red-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path v-if="!isMicMuted" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 3a4 4 0 014 4v4a4 4 0 01-8 0V7a4 4 0 014-4z" />
            <path v-else stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15zM17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
        </button>

        <!-- Son -->
        <button
          @click="toggleDeafen"
          :title="isDeafened ? 'Réactiver le son' : 'Couper le son'"
          class="w-8 h-8 rounded flex items-center justify-center transition-colors flex-shrink-0"
          :class="isDeafened ? 'bg-red-900/60 text-red-400 hover:bg-red-900' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M15.536 8.464a5 5 0 010 7.072M12 6v12m0-12C9.791 6 8 7.791 8 10v4c0 2.209 1.791 4 4 4m0-12c2.209 0 4 1.791 4 4v4c0 2.209-1.791 4-4 4" />
          </svg>
        </button>
      </div>
    </aside>

    <!-- ═══ ZONE PRINCIPALE ═══ -->
    <!-- Chat -->
    <main v-if="!showArena" class="flex-1 flex flex-col bg-gray-800 relative">
      <header class="h-14 px-6 flex items-center justify-between border-b border-gray-900 shadow-sm bg-gray-800 z-10">
        <div class="flex items-center gap-2">
          <span class="text-2xl text-gray-500">#</span>
          <h2 class="font-bold text-white">
            {{ textChannels.find(c => c.active)?.name ?? 'général' }}
          </h2>
        </div>
        <button
          @click="showArena = true"
          class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg font-bold flex items-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/20 transition-all"
        >
          <span>🕹️</span> Lancer un Mini-Jeu
        </button>
      </header>

      <div class="flex-1 overflow-y-auto p-6 flex flex-col gap-4">
        <div
          v-for="msg in messages"
          :key="msg.id ?? msg.time"
          class="flex gap-4 hover:bg-gray-900/40 p-2 -mx-2 rounded transition-colors"
        >
          <img
            :src="msg.avatar ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${msg.username ?? msg.user?.username ?? msg.user}`"
            class="w-10 h-10 rounded-full bg-gray-700 mt-0.5 flex-shrink-0"
          />
          <div class="flex flex-col">
            <div class="flex items-baseline gap-2">
              <span class="font-medium text-white">{{ msg.username ?? msg.user?.username ?? msg.user }}</span>
              <span class="text-xs text-gray-500">{{ msg.time ?? new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }}</span>
            </div>
            <p class="text-gray-300 mt-0.5 leading-relaxed">{{ msg.text }}</p>
          </div>
        </div>
      </div>

      <div class="px-6 pb-6 pt-2">
        <div class="bg-gray-700 rounded-xl flex items-center px-4 py-3 gap-3">
          <input
            v-model="newMessage"
            @keyup.enter="sendMessage"
            type="text"
            :placeholder="`Envoyer un message dans #${textChannels.find(c => c.active)?.name ?? 'général'}…`"
            class="flex-1 bg-transparent text-white focus:outline-none placeholder-gray-400"
          />
          <button @click="sendMessage" class="text-indigo-400 font-bold hover:text-indigo-300 transition-colors">
            Envoyer
          </button>
        </div>
      </div>
    </main>

    <!-- Arena -->
    <div v-else class="flex-1 flex flex-col bg-gray-900 relative h-full">
      <header class="h-14 px-6 flex items-center justify-between border-b border-gray-800 shadow-sm bg-gray-950 z-10">
        <h2 class="font-bold text-indigo-400">🎮 Game Arena</h2>
        <button
          @click="showArena = false"
          class="px-3 py-1.5 bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white text-xs rounded-lg font-bold transition-all"
        >
          Retour au Chat
        </button>
      </header>
      <div class="flex-1 overflow-y-auto">
        <GameArena />
      </div>
    </div>

  </div>
</template>

<style>
.scrollbar-hide::-webkit-scrollbar { display: none; }
.scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
</style>