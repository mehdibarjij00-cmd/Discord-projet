<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { io } from 'socket.io-client';
import GameArena         from './views/Gamearena.vue';
import Connexion         from './views/Connexion.vue';
import ProfileModal      from './views/ProfileModal.vue';
import CreateGroupModal  from './views/CreateGroupModal.vue';
import GroupSettingsModal from './views/GroupSettingsModal.vue';
import JoinGroupModal    from './views/Joingroupmodal.vue';
import Tournaments       from './views/Tournaments.vue';

const Swal = window.Swal;
// const API = import.meta.env.VITE_API_URL;

const API = import.meta.env.VITE_API_URL
  || (window.location.hostname === 'arenalink-client.onrender.com'
      ? 'https://arenalink-server.onrender.com'
      : 'http://localhost:3001');



// ============================================================
// SOCKET.IO
// ============================================================
const socket = io(API, { autoConnect: false });

// ============================================================
// ÉTATS GLOBAUX
// ============================================================
const view              = ref('chat'); // chat | arena | tournaments
const isAuthenticated   = ref(false);
const showProfileModal  = ref(false);
const showCreateGroup   = ref(false);
const showJoinGroup     = ref(false);
const showGroupSettings = ref(false);
const sidebarOpen       = ref(true); // 🔑 Sidebar de navigation ouverte/réduite

//deconnection
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




const currentUser = ref({
  id:          null,
  name:        '',
  bio:         '',
  status:      'online',
  avatar:      '',
  avatarStyle: 'avataaars',
  avatarSeed:  '',
});

// ============================================================
// GROUPES (réels, depuis le serveur)
// ============================================================
const groups       = ref([]);
const activeGroupId = ref(null);
const groupMessages = ref([]);
const newMessage    = ref('');
const sending       = ref(false);

// ============================================================
// DIRECT MESSAGES (DM)
// ============================================================
const dmConversations = ref([]); // [{ otherId, otherName, otherAvatar, lastMessage, unread }]
const activeDmUserId  = ref(null); // l'autre user avec qui on discute (null = pas en mode DM)
const dmMessages      = ref([]); // historique de la conversation active
const activeDmOther   = ref(null); // { id, username, avatar }

// On est en mode DM si activeDmUserId est défini
const isDmMode = computed(() => activeDmUserId.value !== null);

const activeDm = computed(() =>
  dmConversations.value.find(c => String(c.otherId) === String(activeDmUserId.value)) || null
);

const activeGroup = computed(() =>
  groups.value.find(g => g.id === activeGroupId.value) || null
);

const isAdminOfActive = computed(() => {
  if (!activeGroup.value) return false;
  return activeGroup.value.admins?.map(String).includes(String(currentUser.value.id));
});

const chatLocked = computed(() => activeGroup.value?.chatLocked && !isAdminOfActive.value);

// ── Chargement initial ──
const loadGroups = async () => {
  if (!currentUser.value.id) return;
  try {
    const res  = await fetch(`${API}/api/groups/user/${currentUser.value.id}`);
    const data = await res.json();
    groups.value = data.groups || [];
    if (groups.value.length && !activeGroupId.value && !activeDmUserId.value) {
      selectGroup(groups.value[0]);
    }
  } catch {
    groups.value = [];
  }
};

// ── Chargement DMs ──
const loadDmConversations = async () => {
  if (!currentUser.value.id) return;
  try {
    const res  = await fetch(`${API}/api/dms/${currentUser.value.id}`);
    const data = await res.json();
    dmConversations.value = data.conversations || [];
  } catch {
    dmConversations.value = [];
  }
};

const openDm = async (otherUser) => {
  if (!otherUser?.id) return;
  // Empêcher de s'envoyer des messages à soi-même
  if (String(otherUser.id) === String(currentUser.value.id)) return;

  // Désélectionner le groupe actif
  if (activeGroupId.value) {
    socket.emit('group-unsubscribe', { groupId: activeGroupId.value });
    activeGroupId.value = null;
    groupMessages.value = [];
  }

  activeDmUserId.value = otherUser.id;
  activeDmOther.value = {
    id: otherUser.id,
    username: otherUser.username || otherUser.name,
    avatar: otherUser.avatar,
  };

  // Charger l'historique
  try {
    const res  = await fetch(`${API}/api/dms/${currentUser.value.id}/${otherUser.id}`);
    const data = await res.json();
    dmMessages.value = (data.messages || []).map(m => ({
      ...m,
      time: m.time ? new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
    }));
    if (data.other) activeDmOther.value = data.other;
  } catch {
    dmMessages.value = [];
  }
  scrollChatToBottom();

  // Si la conversation n'est pas encore dans la liste (premier message), on l'ajoute
  if (!dmConversations.value.find(c => String(c.otherId) === String(otherUser.id))) {
    dmConversations.value.unshift({
      otherId: otherUser.id,
      otherName: activeDmOther.value.username,
      otherAvatar: activeDmOther.value.avatar,
      lastMessage: null,
      unread: 0,
    });
  } else {
    // Reset le compteur de non lus quand on ouvre la conversation
    const conv = dmConversations.value.find(c => String(c.otherId) === String(otherUser.id));
    if (conv) conv.unread = 0;
  }
};

const closeDm = () => {
  activeDmUserId.value = null;
  activeDmOther.value = null;
  dmMessages.value = [];
};

const sendDm = () => {
  const text = newMessage.value.trim();
  if (!text || !activeDmUserId.value) return;
  sending.value = true;
  socket.emit('dm-send', {
    fromId:     currentUser.value.id,
    toId:       activeDmUserId.value,
    fromName:   currentUser.value.name,
    fromAvatar: currentUser.value.avatar,
    text,
  });
  newMessage.value = '';
  setTimeout(() => sending.value = false, 200);
};

const onDmMessage = ({ message }) => {
  // Vérifier si ce message me concerne
  const meId    = String(currentUser.value.id);
  const fromId  = String(message.from);
  const toId    = String(message.to);
  if (fromId !== meId && toId !== meId) return;

  const otherId = fromId === meId ? toId : fromId;

  // Mettre à jour l'aperçu dans la liste des conversations
  let conv = dmConversations.value.find(c => String(c.otherId) === otherId);
  if (!conv) {
    // Nouvelle conversation reçue
    conv = {
      otherId,
      otherName:   fromId === meId ? '' : message.fromName,
      otherAvatar: fromId === meId ? '' : message.fromAvatar,
      lastMessage: null,
      unread: 0,
    };
    dmConversations.value.unshift(conv);
    // Si on n'a pas le nom (cas où on a envoyé en premier), recharger
    if (!conv.otherName) loadDmConversations();
  }
  conv.lastMessage = { text: message.text, time: message.time, from: message.from };

  // Remonter cette conversation en tête de liste
  dmConversations.value = [
    conv,
    ...dmConversations.value.filter(c => String(c.otherId) !== otherId),
  ];

  // Si la conversation est active → afficher le message
  if (String(activeDmUserId.value) === otherId) {
    dmMessages.value.push({
      ...message,
      time: message.time ? new Date(message.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
    });
    scrollChatToBottom();
  } else if (fromId !== meId) {
    // Notification si message reçu sur une conversation non active
    conv.unread = (conv.unread || 0) + 1;
  }
};

const selectGroup = async (group) => {
  if (!group) return;
  // Fermer un DM actif s'il y en a un
  if (activeDmUserId.value) {
    activeDmUserId.value = null;
    activeDmOther.value = null;
    dmMessages.value = [];
  }
  // Désabonner de l'ancien
  if (activeGroupId.value && activeGroupId.value !== group.id) {
    socket.emit('group-unsubscribe', { groupId: activeGroupId.value });
  }
  activeGroupId.value = group.id;
  socket.emit('group-subscribe', { groupId: group.id });

  // Charger les messages persistés
  try {
    const res  = await fetch(`${API}/api/groups/${group.id}/messages`);
    const data = await res.json();
    groupMessages.value = (data.messages || []).map(m => ({
      ...m,
      time: m.time ? new Date(m.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
    }));
  } catch {
    groupMessages.value = [];
  }
  scrollChatToBottom();
};

const scrollChatToBottom = () => {
  nextTick(() => {
    const box = document.getElementById('chat-box');
    if (box) box.scrollTop = box.scrollHeight;
  });
};

// ── Envoi de message ──
const sendMessage = () => {
  // Si on est en mode DM → utiliser sendDm
  if (isDmMode.value) {
    sendDm();
    return;
  }
  const text = newMessage.value.trim();
  if (!text || !activeGroupId.value) return;
  if (chatLocked.value) {
    Swal?.fire({
      icon: 'warning', title: '🔒 Chat verrouillé',
      text: 'Seuls les admins peuvent écrire ici.',
      background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
      timer: 1500, showConfirmButton: false,
    });
    return;
  }
  sending.value = true;
  socket.emit('group-message', {
    groupId: activeGroupId.value,
    userId:  currentUser.value.id,
    username: currentUser.value.name,
    avatar:  currentUser.value.avatar,
    text,
  });
  newMessage.value = '';
  setTimeout(() => sending.value = false, 200);
};

// ── Listeners socket ──
const onGroupMessage = ({ groupId, message }) => {
  if (groupId !== activeGroupId.value) return;
  groupMessages.value.push({
    ...message,
    time: message.time ? new Date(message.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
  });
  scrollChatToBottom();
};

const onGroupSystemMessage = ({ groupId, text }) => {
  if (groupId !== activeGroupId.value) return;
  groupMessages.value.push({
    id: `sys-${Date.now()}-${Math.random()}`,
    system: true, text,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  });
  scrollChatToBottom();
};

const onGroupUpdated = ({ group }) => {
  const idx = groups.value.findIndex(g => g.id === group.id);
  if (idx >= 0) groups.value[idx] = { ...groups.value[idx], ...group };
  else          groups.value.push(group);
};

const onGroupDeleted = ({ groupId, name }) => {
  const wasActive = activeGroupId.value === groupId;
  groups.value = groups.value.filter(g => g.id !== groupId);
  if (wasActive) {
    activeGroupId.value = null;
    groupMessages.value = [];
    if (groups.value.length) selectGroup(groups.value[0]);
  }
  if (name) {
    Swal?.fire({
      icon: 'info', title: `Le groupe "${name}" a été supprimé`,
      timer: 2000, showConfirmButton: false,
      background: '#111827', color: '#f9fafb',
    });
  }
};

const onGroupKicked = ({ groupId, groupName }) => {
  groups.value = groups.value.filter(g => g.id !== groupId);
  if (activeGroupId.value === groupId) {
    activeGroupId.value = null;
    groupMessages.value = [];
    if (groups.value.length) selectGroup(groups.value[0]);
  }
  Swal?.fire({
    icon: 'warning', title: `Tu as été exclu de ${groupName}`,
    background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
  });
};

const onGroupBanned = ({ groupId, groupName }) => {
  groups.value = groups.value.filter(g => g.id !== groupId);
  if (activeGroupId.value === groupId) {
    activeGroupId.value = null;
    groupMessages.value = [];
    if (groups.value.length) selectGroup(groups.value[0]);
  }
  Swal?.fire({
    icon: 'error', title: `Tu as été banni de ${groupName}`,
    background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
  });
};

const onGroupJoined = ({ group }) => {
  if (!groups.value.find(g => g.id === group.id)) {
    groups.value.push(group);
  }
};

const onMessageError = ({ error }) => {
  Swal?.fire({
    icon: 'warning', title: error, timer: 1500, showConfirmButton: false,
    background: '#111827', color: '#f9fafb',
  });
};

// ── Actions sur groupes ──
const onGroupCreated = async ({ id } = {}) => {
  showCreateGroup.value = false;
  // Le modal n'envoie que { id } → on recharge depuis le serveur pour avoir l'objet COMPLET
  // (avec members, admins, inviteCode, etc.)
  await loadGroups();
  if (id) {
    const created = groups.value.find(g => g.id === id);
    if (created) selectGroup(created);
  }
};

const onGroupJoinedManual = (group) => {
  if (!groups.value.find(g => g.id === group.id)) {
    groups.value.push(group);
  }
  showJoinGroup.value = false;
  selectGroup(group);
};

const onSettingsUpdated = (updated) => {
  const idx = groups.value.findIndex(g => g.id === updated.id);
  if (idx >= 0) groups.value[idx] = updated;
};

const onSettingsLeft = (groupId) => {
  groups.value = groups.value.filter(g => g.id !== groupId);
  if (activeGroupId.value === groupId) {
    activeGroupId.value = null;
    groupMessages.value = [];
    if (groups.value.length) selectGroup(groups.value[0]);
  }
  showGroupSettings.value = false;
};

const onSettingsDeleted = (groupId) => {
  onGroupDeleted({ groupId });
  showGroupSettings.value = false;
};

// ============================================================
// VOCAL (WebRTC) — repris de la version d'origine
// ============================================================
const voiceChannels = ref([
  { id: 'V-8829', name: 'Lobby Principal',           users: [] },
  { id: 'V-4412', name: "Salle d'attente (Tournoi)", users: [] },
]);

const connectedVoice = ref(null);
const isMicMuted     = ref(false);
const isDeafened     = ref(false);

let localStream       = null;
const peerConnections = {};
// STUN + TURN — STUN seul suffit en local mais ~15-30% des connexions
// échouent entre 2 utilisateurs distants (NATs symétriques, 4G, etc.)
// Le TURN sert de relais quand le P2P direct ne passe pas.
// Open Relay Project = TURN gratuit pour le dev/démo.
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
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
    Swal?.fire({
      icon: 'error', title: 'Micro inaccessible',
      text: 'Vérifie les permissions du navigateur.',
      background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
    });
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
      channel.users.push({
        name: currentUser.value.name,
        isSpeaking: false, isMuted: isMicMuted.value,
      });
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
  pc.oniceconnectionstatechange = () => console.log(`🧊 ICE [${remoteSocketId.slice(0,6)}]:`, pc.iceConnectionState);
  pc.onconnectionstatechange = () => console.log(`🔗 CONN [${remoteSocketId.slice(0,6)}]:`, pc.connectionState);
  pc.onsignalingstatechange = () => console.log(`📡 SIG [${remoteSocketId.slice(0,6)}]:`, pc.signalingState);
  localStream?.getTracks().forEach(t => pc.addTrack(t, localStream));
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) socket.emit('webrtc-ice', { to: remoteSocketId, candidate });
  };
  pc.ontrack = ({ streams }) => {
    console.log(`🔊 ONTRACK reçu de ${remoteSocketId.slice(0,6)}, streams:`, streams);
    const audio = new Audio();
    audio.srcObject = streams[0];
    audio.setAttribute('data-remote', remoteSocketId);
    audio.muted = isDeafened.value;
    document.body.appendChild(audio);
    audio.play().catch(() => {});
  };
  return pc;
};

const toggleMic = () => {
  isMicMuted.value = !isMicMuted.value;
  localStream?.getAudioTracks().forEach(t => t.enabled = !isMicMuted.value);
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
  // 🔑 Mettre à jour le localStorage pour que les changements survivent au refresh
  localStorage.setItem('user', JSON.stringify(currentUser.value));
};

// ============================================================
// LOGIN & CYCLE DE VIE
// ============================================================
const handleLogin = async (userData) => {
  currentUser.value.id     = userData.id ?? null;
  currentUser.value.name   = userData.name;
  currentUser.value.avatar = userData.avatar;
  currentUser.value.avatarSeed = userData.name;
  // Conserver tout ce que le serveur a renvoyé (bio, avatarStyle, elo, etc.)
  if (userData.bio         !== undefined) currentUser.value.bio         = userData.bio;
  if (userData.avatarStyle !== undefined) currentUser.value.avatarStyle = userData.avatarStyle;
  if (userData.avatarSeed  !== undefined) currentUser.value.avatarSeed  = userData.avatarSeed;
  isAuthenticated.value    = true;

  // 🔑 Persister la session pour survivre à un refresh
  localStorage.setItem('user', JSON.stringify(currentUser.value));

  socket.connect();
  socket.emit('identify', {
    userId:   currentUser.value.id,
    username: currentUser.value.name,
  });

  await loadGroups();
  await loadDmConversations();
};

onMounted(async () => {
  // 🔑 Restaurer la session si l'utilisateur s'était déjà connecté
  const saved = localStorage.getItem('user');
  if (saved) {
    try {
      const userData = JSON.parse(saved);
      if (userData?.id) {
        currentUser.value = { ...currentUser.value, ...userData };
        isAuthenticated.value = true;
        socket.connect();
        socket.emit('identify', {
          userId:   currentUser.value.id,
          username: currentUser.value.name,
        });
        await loadGroups();
        await loadDmConversations();
      }
    } catch {
      localStorage.removeItem('user');
    }
  }

  // Tous les listeners socket pour les groupes
  socket.on('group-message',         onGroupMessage);
  socket.on('group-system-message',  onGroupSystemMessage);
  socket.on('group-updated',         onGroupUpdated);
  socket.on('group-deleted',         onGroupDeleted);
  socket.on('group-kicked',          onGroupKicked);
  socket.on('group-banned',          onGroupBanned);
  socket.on('group-joined',          onGroupJoined);
  socket.on('group-message-error',   onMessageError);

  // Direct Messages
  socket.on('dm-message', onDmMessage);

  // WebRTC (déclenché par le voice)
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
    catch {}
  });
  socket.on('user-left-voice', (socketId) => {
    peerConnections[socketId]?.close();
    delete peerConnections[socketId];
    document.querySelector(`audio[data-remote="${socketId}"]`)?.remove();
  });
});

onUnmounted(async () => {
  await disconnectVoice();
  socket.off('group-message',         onGroupMessage);
  socket.off('group-system-message',  onGroupSystemMessage);
  socket.off('group-updated',         onGroupUpdated);
  socket.off('group-deleted',         onGroupDeleted);
  socket.off('group-kicked',          onGroupKicked);
  socket.off('group-banned',          onGroupBanned);
  socket.off('group-joined',          onGroupJoined);
  socket.off('group-message-error',   onMessageError);
  socket.disconnect();
});

watch(activeGroupId, () => scrollChatToBottom());
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
  <JoinGroupModal
    v-if="showJoinGroup"
    :current-user-id="currentUser.id"
    @close="showJoinGroup = false"
    @joined="onGroupJoinedManual"
  />
  <GroupSettingsModal
    v-if="showGroupSettings && activeGroup"
    :group="activeGroup"
    :current-user="currentUser"
    @close="showGroupSettings = false"
    @updated="onSettingsUpdated"
    @left="onSettingsLeft"
    @deleted="onSettingsDeleted"
  />

  <div v-if="isAuthenticated" class="flex h-screen w-full bg-gray-900 text-gray-100 font-sans overflow-hidden">

    <!-- ═══ BARRE DE GROUPES (gauche) ═══ -->
    <nav class="w-[72px] bg-gray-950 flex flex-col items-center py-4 gap-3 z-20 shadow-xl overflow-y-auto scrollbar-hide">

      <!-- Logo / Home → chat -->
      <button
        @click="view = 'chat'"
        class="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center cursor-pointer hover:rounded-xl transition-all duration-300 shadow-lg shadow-indigo-500/30 flex-shrink-0"
        :class="{ 'rounded-xl': view === 'chat' }"
        title="Chat"
      >
        <span class="text-white font-bold text-xl">🎮</span>
      </button>

      <!-- Tournois -->
      <button
        @click="view = 'tournaments'"
        class="w-12 h-12 bg-gray-800 rounded-full flex items-center justify-center cursor-pointer hover:bg-yellow-600 hover:rounded-xl transition-all duration-300 flex-shrink-0"
        :class="{ 'bg-yellow-600 rounded-xl': view === 'tournaments' }"
        title="Tournois"
      >
        <span class="text-xl">🏆</span>
      </button>

      <div class="w-8 h-[2px] bg-gray-800 rounded-full flex-shrink-0"></div>

      <!-- Mes groupes -->
      <button
        v-for="group in groups"
        :key="group.id"
        @click="selectGroup(group); view = 'chat'"
        class="relative w-12 h-12 rounded-full flex items-center justify-center cursor-pointer hover:bg-indigo-500 hover:rounded-xl transition-all duration-300 text-xs font-bold text-gray-300 hover:text-white flex-shrink-0"
        :class="activeGroupId === group.id && view === 'chat'
          ? (group.type === 'private' ? 'bg-indigo-600 rounded-xl text-white' : 'bg-green-600 rounded-xl text-white')
          : 'bg-gray-800'"
        :title="group.name"
      >
        <img v-if="group.logo" :src="group.logo" class="w-full h-full rounded-inherit object-cover" />
        <span v-else>{{ group.initials }}</span>
        <span
          class="absolute -bottom-0.5 -right-0.5 text-[9px] w-4 h-4 rounded-full flex items-center justify-center"
          :class="group.type === 'private' ? 'bg-indigo-800 text-indigo-300' : 'bg-green-800 text-green-300'"
        >
          {{ group.type === 'private' ? '🔒' : '🌍' }}
        </span>
      </button>

      <div class="w-8 h-[2px] bg-gray-800 rounded-full flex-shrink-0"></div>

      <!-- Créer groupe -->
      <button
        @click="showCreateGroup = true"
        class="w-12 h-12 bg-gray-800 text-green-500 rounded-full flex items-center justify-center cursor-pointer hover:bg-green-500 hover:text-white hover:rounded-xl transition-all duration-300 flex-shrink-0"
        title="Créer un groupe"
      >
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
      </button>

      <!-- Rejoindre groupe -->
      <button
        @click="showJoinGroup = true"
        class="w-12 h-12 bg-gray-800 text-indigo-400 rounded-full flex items-center justify-center cursor-pointer hover:bg-indigo-500 hover:text-white hover:rounded-xl transition-all duration-300 flex-shrink-0"
        title="Rejoindre avec un code"
      >
        <span class="text-lg">🔑</span>
      </button>

<!-- BOUTON DÉCONNEXION -->
      <div class="px-2 py-3 border-t border-gray-800">
        <button
          @click="logout"
          :class="['flex items-center gap-3 rounded-xl transition-colors font-semibold text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300',
            sidebarOpen ? 'w-full px-3 py-2.5' : 'w-10 h-10 justify-center mx-auto']"
          :title="sidebarOpen ? '' : 'Déconnexion'"
        >
          <span class="text-lg shrink-0">➜]</span>
          <!-- <span v-if="sidebarOpen">Déconnexion</span> -->
        </button>
      </div>



    </nav>

    <!-- ═══ SIDEBAR (groupe actif) ═══ -->
    <aside v-if="view === 'chat'" class="w-64 bg-gray-900 flex flex-col border-r border-gray-800 relative z-10">

      <header
        v-if="activeGroup"
        class="h-14 px-4 flex items-center gap-2 border-b border-gray-800 shadow-sm bg-gray-900 cursor-pointer hover:bg-gray-800/50 transition-colors"
        @click="showGroupSettings = true"
      >
        <div
          class="w-7 h-7 rounded-lg text-[10px] font-bold flex items-center justify-center flex-shrink-0 text-white"
          :class="activeGroup.type === 'private' ? 'bg-indigo-600' : 'bg-green-600'"
        >
          {{ activeGroup.initials }}
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="font-bold text-white text-sm truncate">{{ activeGroup.name }}</h2>
          <p class="text-[10px] flex items-center gap-1" :class="activeGroup.type === 'private' ? 'text-indigo-400' : 'text-green-400'">
            {{ activeGroup.type === 'private' ? '🔒 Privé' : '🌍 Public' }}
            <span v-if="activeGroup.chatLocked" class="text-yellow-400 ml-1">· 🔒 Verrouillé</span>
          </p>
        </div>
        <span class="text-gray-500 text-xs">⚙️</span>
      </header>

      <header v-else class="h-14 px-4 flex items-center border-b border-gray-800 bg-gray-900">
        <p class="text-sm text-gray-500">Aucun groupe</p>
      </header>

      <div class="flex-1 overflow-y-auto p-3 scrollbar-hide flex flex-col gap-5">

        <!-- Membres du groupe -->
        <div v-if="activeGroup">
          <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1 flex items-center justify-between">
            <span>Membres</span>
            <span class="text-gray-500 normal-case">{{ activeGroup.members?.length || 0 }}</span>
          </h3>
          <ul class="space-y-1">
            <li
              v-for="m in (activeGroup.members || [])"
              :key="m.id"
              @click="String(m.id) !== String(currentUser.id) && openDm(m)"
              :class="[
                'px-2 py-1.5 rounded flex items-center gap-2 text-sm transition-colors',
                String(m.id) === String(currentUser.id)
                  ? 'cursor-default'
                  : 'hover:bg-gray-800 cursor-pointer'
              ]"
              :title="String(m.id) !== String(currentUser.id) ? `Envoyer un message privé à ${m.username}` : ''"
            >
              <img
                :src="m.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${m.username}`"
                class="w-6 h-6 rounded-full bg-gray-700 flex-shrink-0"
              />
              <span class="truncate flex-1" :class="String(m.id) === String(currentUser.id) ? 'text-indigo-400 font-medium' : 'text-gray-300'">
                {{ m.username }}
              </span>
              <span v-if="String(activeGroup.ownerId) === String(m.id)" class="text-xs">👑</span>
              <span v-else-if="activeGroup.admins?.map(String).includes(String(m.id))" class="text-xs">⭐</span>
            </li>
          </ul>
        </div>

        <!-- Messages privés (DMs) -->
        <div v-if="dmConversations.length || isDmMode">
          <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1 flex items-center justify-between">
            <span>💬 Messages Privés</span>
            <span class="text-gray-500 normal-case">{{ dmConversations.length }}</span>
          </h3>
          <ul class="space-y-1">
            <li
              v-for="conv in dmConversations"
              :key="conv.otherId"
              @click="openDm({ id: conv.otherId, username: conv.otherName, avatar: conv.otherAvatar })"
              :class="[
                'px-2 py-1.5 rounded flex items-center gap-2 text-sm transition-colors cursor-pointer',
                String(activeDmUserId) === String(conv.otherId)
                  ? 'bg-indigo-500/20 text-white'
                  : 'hover:bg-gray-800 text-gray-300'
              ]"
            >
              <img
                :src="conv.otherAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${conv.otherName}`"
                class="w-7 h-7 rounded-full bg-gray-700 flex-shrink-0"
              />
              <div class="flex-1 min-w-0">
                <p class="truncate text-sm font-medium">{{ conv.otherName }}</p>
                <p v-if="conv.lastMessage" class="text-[11px] text-gray-500 truncate">
                  <span v-if="String(conv.lastMessage.from) === String(currentUser.id)" class="text-gray-600">Toi : </span>
                  {{ conv.lastMessage.text }}
                </p>
              </div>
              <span
                v-if="conv.unread > 0"
                class="bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 min-w-[18px] h-[18px] flex items-center justify-center flex-shrink-0"
              >
                {{ conv.unread > 9 ? '9+' : conv.unread }}
              </span>
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
            </li>
          </ul>
        </div>
      </div>

      <!-- User bar -->
      <div class="h-16 bg-gray-950 px-2 py-2 flex items-center justify-between border-t border-gray-800 gap-1">
        <div
          @click="showProfileModal = true"
          class="flex items-center gap-2 p-1.5 rounded cursor-pointer hover:bg-gray-800 transition-colors flex-1 min-w-0"
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

    <!-- TOURNOIS -->
    <main v-if="view === 'tournaments'" class="flex-1 flex flex-col bg-gray-950 overflow-hidden">
      <Tournaments
        :current-user="currentUser"
        :user-groups="groups"
        :socket="socket"
        @close="view = 'chat'"
      />
    </main>

    <!-- ARENA (mini-jeux) -->
    <main v-else-if="view === 'arena'" class="flex-1 flex flex-col bg-gray-900 overflow-hidden">
      <header class="h-14 px-6 flex items-center justify-between border-b border-gray-800 shadow-sm bg-gray-950 z-10">
        <h2 class="font-bold text-indigo-400">🎮 Game Arena</h2>
        <button
          @click="view = 'chat'"
          class="px-3 py-1.5 bg-red-500/20 text-red-400 hover:bg-red-500 hover:text-white text-xs rounded-lg font-bold transition-all"
        >
          Retour au Chat
        </button>
      </header>
      <div class="flex-1 overflow-y-auto">
        <GameArena />
      </div>
    </main>

    <!-- CHAT -->
    <main v-else class="flex-1 flex flex-col bg-gray-800 relative">

      <header class="h-14 px-6 flex items-center justify-between border-b border-gray-900 shadow-sm bg-gray-800 z-10">
        <!-- Header en mode DM -->
        <div v-if="isDmMode" class="flex items-center gap-2 min-w-0">
          <span class="text-2xl">@</span>
          <img
            :src="activeDmOther?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${activeDmOther?.username}`"
            class="w-7 h-7 rounded-full bg-gray-700"
          />
          <h2 class="font-bold text-white truncate">{{ activeDmOther?.username }}</h2>
          <span class="text-xs text-gray-500">· Message privé</span>
        </div>
        <!-- Header en mode groupe -->
        <div v-else class="flex items-center gap-2 min-w-0">
          <span class="text-2xl text-gray-500">#</span>
          <h2 class="font-bold text-white truncate">{{ activeGroup?.name || 'Pas de groupe' }}</h2>
          <span v-if="activeGroup?.chatLocked" class="text-xs text-yellow-400">🔒 Verrouillé</span>
        </div>
        <div class="flex items-center gap-2">
          <button
            v-if="isDmMode"
            @click="closeDm"
            class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg font-bold transition-all"
            title="Fermer la conversation"
          >
            ✕
          </button>
          <button
            v-if="activeGroup && !isDmMode"
            @click="showGroupSettings = true"
            class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs rounded-lg font-bold transition-all"
            title="Paramètres du groupe"
          >
            ⚙️
          </button>
          <button
            @click="view = 'arena'"
            class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-lg font-bold flex items-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/20 transition-all"
          >
            <span>🕹️</span> Mini-Jeux
          </button>
        </div>
      </header>

      <!-- Messages -->
      <div v-if="activeGroup && !isDmMode" id="chat-box" class="flex-1 overflow-y-auto p-6 flex flex-col gap-3">
        <div v-if="!groupMessages.length" class="text-center text-gray-500 mt-10">
          <p class="text-4xl mb-2">💬</p>
          <p class="text-sm">Pas de messages. Sois le premier à écrire !</p>
        </div>

        <template v-for="msg in groupMessages" :key="msg.id">
          <!-- Message système -->
          <div v-if="msg.system" class="text-center text-xs text-gray-500 italic py-1">
            {{ msg.text }} <span class="text-gray-600">· {{ msg.time }}</span>
          </div>

          <!-- Message normal -->
          <div v-else class="flex gap-3 hover:bg-gray-900/40 p-2 -mx-2 rounded transition-colors">
            <img
              :src="msg.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${msg.username}`"
              class="w-10 h-10 rounded-full bg-gray-700 mt-0.5 flex-shrink-0"
            />
            <div class="flex flex-col min-w-0">
              <div class="flex items-baseline gap-2">
                <span class="font-medium text-white">{{ msg.username }}</span>
                <span class="text-xs text-gray-500">{{ msg.time }}</span>
              </div>
              <p class="text-gray-300 mt-0.5 leading-relaxed break-words">{{ msg.text }}</p>
              <img
                v-if="msg.media?.type === 'image'"
                :src="`${API}${msg.media.url}`"
                class="mt-2 max-w-xs rounded-lg border border-gray-700"
              />
            </div>
          </div>
        </template>
      </div>

      <!-- Messages DM -->
      <div v-else-if="isDmMode" id="chat-box" class="flex-1 overflow-y-auto p-6 flex flex-col gap-3">
        <div v-if="!dmMessages.length" class="text-center text-gray-500 mt-10">
          <p class="text-4xl mb-2">💬</p>
          <p class="text-sm">Début de votre conversation avec <b class="text-indigo-400">{{ activeDmOther?.username }}</b></p>
          <p class="text-xs mt-1">Envoie le premier message !</p>
        </div>
        <div
          v-for="msg in dmMessages"
          :key="msg.id"
          class="flex gap-3 hover:bg-gray-900/40 p-2 -mx-2 rounded transition-colors"
        >
          <img
            :src="msg.fromAvatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${msg.fromName}`"
            class="w-10 h-10 rounded-full bg-gray-700 mt-0.5 flex-shrink-0"
          />
          <div class="flex flex-col min-w-0">
            <div class="flex items-baseline gap-2">
              <span
                class="font-medium"
                :class="String(msg.from) === String(currentUser.id) ? 'text-indigo-400' : 'text-white'"
              >
                {{ String(msg.from) === String(currentUser.id) ? 'Toi' : msg.fromName }}
              </span>
              <span class="text-xs text-gray-500">{{ msg.time }}</span>
            </div>
            <p class="text-gray-300 mt-0.5 leading-relaxed break-words">{{ msg.text }}</p>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-else class="flex-1 flex flex-col items-center justify-center text-center p-8">
        <div class="text-6xl mb-4">🎮</div>
        <h3 class="text-2xl font-bold text-white mb-2">Bienvenue sur ArenaLink</h3>
        <p class="text-gray-400 mb-6 max-w-md">
          Tu n'es membre d'aucun groupe pour l'instant. Crée le tien ou rejoins-en un avec un code.
        </p>
        <div class="flex gap-3">
          <button
            @click="showCreateGroup = true"
            class="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-semibold text-sm transition-colors"
          >
            ➕ Créer un groupe
          </button>
          <button
            @click="showJoinGroup = true"
            class="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-semibold text-sm transition-colors"
          >
            🔑 Rejoindre
          </button>
        </div>
      </div>

      <!-- Input chat -->
      <div v-if="activeGroup && !isDmMode" class="px-6 pb-6 pt-2">
        <div
          class="rounded-xl flex items-center px-4 py-3 gap-3 transition-colors"
          :class="chatLocked ? 'bg-gray-800 opacity-60' : 'bg-gray-700'"
        >
          <input
            v-model="newMessage"
            @keyup.enter="sendMessage"
            type="text"
            :disabled="chatLocked"
            :placeholder="chatLocked
              ? '🔒 Le chat est verrouillé par un admin'
              : `Envoyer un message dans #${activeGroup.name}…`"
            class="flex-1 bg-transparent text-white focus:outline-none placeholder-gray-400 disabled:cursor-not-allowed"
          />
          <button
            @click="sendMessage"
            :disabled="chatLocked || !newMessage.trim()"
            class="text-indigo-400 font-bold hover:text-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Envoyer
          </button>
        </div>
      </div>

      <!-- Input DM -->
      <div v-if="isDmMode" class="px-6 pb-6 pt-2">
        <div class="rounded-xl flex items-center px-4 py-3 gap-3 bg-gray-700">
          <input
            v-model="newMessage"
            @keyup.enter="sendMessage"
            type="text"
            :placeholder="`Envoyer un message à @${activeDmOther?.username}…`"
            class="flex-1 bg-transparent text-white focus:outline-none placeholder-gray-400"
          />
          <button
            @click="sendMessage"
            :disabled="!newMessage.trim()"
            class="text-indigo-400 font-bold hover:text-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Envoyer
          </button>
        </div>
      </div>
    </main>

  </div>
  
</template>

<style>
.scrollbar-hide::-webkit-scrollbar { display: none; }
.scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
</style>