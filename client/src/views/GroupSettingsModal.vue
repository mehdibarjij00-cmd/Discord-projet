<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  group:        { type: Object, required: true },
  currentUser:  { type: Object, required: true },
});
const emit = defineEmits(['close', 'updated', 'left', 'deleted']);

const Swal = window.Swal;
const API  = 'http://localhost:3001';

const tab = ref('general'); // general | members | bans

// ── Helpers ──
const isOwner = computed(() =>
  String(props.group.ownerId) === String(props.currentUser.id)
);
const isAdmin = computed(() =>
  props.group.admins?.map(String).includes(String(props.currentUser.id))
);
const isAdminOf = (id) => props.group.admins?.map(String).includes(String(id));

// ── Édition générale ──
const editName  = ref(props.group.name);
const chatLock  = ref(!!props.group.chatLocked);
const saving    = ref(false);

const saveGeneral = async () => {
  if (!isAdmin.value) return;
  saving.value = true;
  try {
    const res = await fetch(`${API}/api/groups/${props.group.id}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: props.currentUser.id,
        name: editName.value,
        chatLocked: chatLock.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur');
    emit('updated', data.group);
    Swal?.fire({
      icon: 'success', title: 'Paramètres enregistrés', timer: 1200, showConfirmButton: false,
      background: '#111827', color: '#f9fafb',
    });
  } catch (e) {
    Swal?.fire({
      icon: 'error', title: 'Erreur', text: e.message,
      background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
    });
  } finally {
    saving.value = false;
  }
};

// ── Code d'invitation ──
const copyCode = () => {
  navigator.clipboard?.writeText(props.group.inviteCode);
  Swal?.fire({
    icon: 'success', title: 'Code copié !', timer: 1000, showConfirmButton: false,
    background: '#111827', color: '#f9fafb',
  });
};

const regenerateCode = async () => {
  const r = await Swal.fire({
    icon: 'warning',
    title: 'Régénérer le code ?',
    text: 'L\'ancien code ne fonctionnera plus.',
    showCancelButton: true,
    confirmButtonText: 'Régénérer',
    cancelButtonText: 'Annuler',
    background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
  });
  if (!r.isConfirmed) return;
  try {
    const res = await fetch(`${API}/api/groups/${props.group.id}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: props.currentUser.id,
        regenerateCode: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    emit('updated', data.group);
  } catch (e) {
    Swal?.fire({
      icon: 'error', title: 'Erreur', text: e.message,
      background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
    });
  }
};

// ── Membres : kick / ban / promote / demote ──
const kickMember = async (member) => {
  const r = await Swal.fire({
    icon: 'warning',
    title: `Exclure ${member.username} ?`,
    text: 'Il pourra rejoindre à nouveau s\'il a le code.',
    showCancelButton: true,
    confirmButtonText: 'Exclure',
    cancelButtonText: 'Annuler',
    background: '#111827', color: '#f9fafb', confirmButtonColor: '#dc2626',
  });
  if (!r.isConfirmed) return;
  try {
    const res = await fetch(`${API}/api/groups/${props.group.id}/kick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminId: props.currentUser.id, targetId: member.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    emit('updated', data.group);
  } catch (e) {
    Swal?.fire({
      icon: 'error', title: 'Erreur', text: e.message,
      background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
    });
  }
};

const banMember = async (member) => {
  const r = await Swal.fire({
    icon: 'warning',
    title: `Bannir ${member.username} ?`,
    text: 'Il ne pourra plus jamais rejoindre ce groupe.',
    showCancelButton: true,
    confirmButtonText: 'Bannir',
    cancelButtonText: 'Annuler',
    background: '#111827', color: '#f9fafb', confirmButtonColor: '#dc2626',
  });
  if (!r.isConfirmed) return;
  try {
    const res = await fetch(`${API}/api/groups/${props.group.id}/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminId: props.currentUser.id, targetId: member.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    emit('updated', data.group);
  } catch (e) {
    Swal?.fire({
      icon: 'error', title: 'Erreur', text: e.message,
      background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
    });
  }
};

const unbanUser = async (userId) => {
  try {
    const res = await fetch(`${API}/api/groups/${props.group.id}/unban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminId: props.currentUser.id, targetId: userId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    emit('updated', data.group);
  } catch (e) {
    Swal?.fire({
      icon: 'error', title: 'Erreur', text: e.message,
      background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
    });
  }
};

const promote = async (member) => {
  try {
    const res = await fetch(`${API}/api/groups/${props.group.id}/promote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId: props.currentUser.id, targetId: member.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    emit('updated', data.group);
  } catch (e) {
    Swal?.fire({
      icon: 'error', title: 'Erreur', text: e.message,
      background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
    });
  }
};

const demote = async (member) => {
  try {
    const res = await fetch(`${API}/api/groups/${props.group.id}/demote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId: props.currentUser.id, targetId: member.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    emit('updated', data.group);
  } catch (e) {
    Swal?.fire({
      icon: 'error', title: 'Erreur', text: e.message,
      background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
    });
  }
};

// ── Quitter / Supprimer ──
const leaveGroup = async () => {
  const r = await Swal.fire({
    icon: 'warning',
    title: `Quitter ${props.group.name} ?`,
    showCancelButton: true,
    confirmButtonText: 'Quitter',
    cancelButtonText: 'Annuler',
    background: '#111827', color: '#f9fafb', confirmButtonColor: '#dc2626',
  });
  if (!r.isConfirmed) return;
  try {
    const res = await fetch(`${API}/api/groups/${props.group.id}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: props.currentUser.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    emit('left', props.group.id);
  } catch (e) {
    Swal?.fire({
      icon: 'error', title: 'Erreur', text: e.message,
      background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
    });
  }
};

const deleteGroup = async () => {
  const r = await Swal.fire({
    icon: 'warning',
    title: `Supprimer ${props.group.name} ?`,
    text: 'Cette action est irréversible.',
    showCancelButton: true,
    confirmButtonText: 'Supprimer',
    cancelButtonText: 'Annuler',
    background: '#111827', color: '#f9fafb', confirmButtonColor: '#dc2626',
  });
  if (!r.isConfirmed) return;
  try {
    const res = await fetch(`${API}/api/groups/${props.group.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: props.currentUser.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    emit('deleted', props.group.id);
  } catch (e) {
    Swal?.fire({
      icon: 'error', title: 'Erreur', text: e.message,
      background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
    });
  }
};
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">

      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950 flex-shrink-0">
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white"
            :class="group.type === 'public' ? 'bg-green-600' : 'bg-indigo-600'"
          >
            {{ group.initials }}
          </div>
          <div>
            <h2 class="text-lg font-bold text-white">{{ group.name }}</h2>
            <p class="text-xs" :class="group.type === 'public' ? 'text-green-400' : 'text-indigo-400'">
              {{ group.type === 'public' ? '🌍 Public' : '🔒 Privé' }} ·
              {{ group.members.length }} membre{{ group.members.length > 1 ? 's' : '' }}
            </p>
          </div>
        </div>
        <button @click="emit('close')" class="text-gray-400 hover:text-white text-xl">✕</button>
      </div>

      <!-- Onglets -->
      <div class="flex border-b border-gray-800 bg-gray-900 px-2 flex-shrink-0">
        <button
          v-for="t in [
            { id:'general',  label:'⚙️ Général' },
            { id:'members',  label:'👥 Membres' },
            { id:'bans',     label:'🚫 Bannis' },
          ]"
          :key="t.id"
          @click="tab = t.id"
          class="px-4 py-3 text-sm font-medium transition-colors border-b-2"
          :class="tab === t.id
            ? 'text-white border-indigo-500'
            : 'text-gray-400 border-transparent hover:text-gray-200'"
        >
          {{ t.label }}
        </button>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-y-auto p-6">

        <!-- ═══ GÉNÉRAL ═══ -->
        <div v-if="tab === 'general'" class="space-y-6">

          <!-- Code d'invitation -->
          <div>
            <label class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
              Code d'invitation
            </label>
            <div class="flex gap-2">
              <div class="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 font-mono text-2xl font-bold text-indigo-400 tracking-widest text-center select-all">
                {{ group.inviteCode }}
              </div>
              <button
                @click="copyCode"
                class="px-4 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-sm font-semibold transition-colors"
                title="Copier"
              >
                📋
              </button>
              <button
                v-if="isAdmin"
                @click="regenerateCode"
                class="px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-colors"
                title="Régénérer"
              >
                🔄
              </button>
            </div>
            <p class="text-xs text-gray-500 mt-2">
              Partage ce code pour inviter d'autres joueurs.
            </p>
          </div>

          <!-- Édition admin -->
          <div v-if="isAdmin" class="space-y-4 pt-4 border-t border-gray-800">
            <div>
              <label class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
                Nom du groupe
              </label>
              <input
                v-model="editName"
                type="text"
                maxlength="50"
                class="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            <!-- Chat lock -->
            <div class="flex items-center justify-between bg-gray-800 border border-gray-700 rounded-xl px-4 py-3">
              <div>
                <p class="text-sm font-semibold text-white">Verrouiller le chat</p>
                <p class="text-xs text-gray-400 mt-0.5">Seuls les admins pourront écrire.</p>
              </div>
              <button
                @click="chatLock = !chatLock"
                class="w-12 h-6 rounded-full transition-colors relative"
                :class="chatLock ? 'bg-indigo-600' : 'bg-gray-700'"
              >
                <div
                  class="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all"
                  :class="chatLock ? 'left-6' : 'left-0.5'"
                ></div>
              </button>
            </div>

            <button
              @click="saveGeneral"
              :disabled="saving"
              class="w-full px-6 py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
            >
              <span v-if="saving" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
              {{ saving ? 'Enregistrement…' : '💾 Enregistrer' }}
            </button>
          </div>

          <!-- Actions dangereuses -->
          <div class="pt-4 border-t border-gray-800 space-y-2">
            <button
              v-if="!isOwner"
              @click="leaveGroup"
              class="w-full px-6 py-3 bg-red-900/30 hover:bg-red-900/60 text-red-400 rounded-xl font-semibold text-sm transition-colors"
            >
              👋 Quitter le groupe
            </button>
            <button
              v-if="isOwner"
              @click="deleteGroup"
              class="w-full px-6 py-3 bg-red-900/30 hover:bg-red-900/60 text-red-400 rounded-xl font-semibold text-sm transition-colors"
            >
              🗑️ Supprimer le groupe
            </button>
          </div>
        </div>

        <!-- ═══ MEMBRES ═══ -->
        <div v-else-if="tab === 'members'" class="space-y-2">
          <div
            v-for="m in group.members"
            :key="m.id"
            class="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-xl p-3"
          >
            <img
              :src="m.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${m.username}`"
              class="w-10 h-10 rounded-full bg-gray-700 flex-shrink-0"
            />
            <div class="flex-1 min-w-0">
              <p class="font-semibold text-white text-sm truncate flex items-center gap-2">
                {{ m.username }}
                <span v-if="String(group.ownerId) === String(m.id)" class="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">👑 OWNER</span>
                <span v-else-if="isAdminOf(m.id)" class="text-[10px] bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded">⭐ ADMIN</span>
              </p>
              <p v-if="String(m.id) === String(currentUser.id)" class="text-xs text-gray-400">C'est toi</p>
            </div>

            <!-- Actions admin -->
            <div v-if="isAdmin && String(m.id) !== String(currentUser.id) && String(group.ownerId) !== String(m.id)" class="flex gap-1">
              <button
                v-if="isOwner && !isAdminOf(m.id)"
                @click="promote(m)"
                title="Promouvoir admin"
                class="w-8 h-8 rounded-lg bg-gray-900 hover:bg-indigo-600 text-indigo-400 hover:text-white text-sm transition-colors"
              >
                ⭐
              </button>
              <button
                v-if="isOwner && isAdminOf(m.id)"
                @click="demote(m)"
                title="Retirer admin"
                class="w-8 h-8 rounded-lg bg-gray-900 hover:bg-yellow-600 text-yellow-400 hover:text-white text-sm transition-colors"
              >
                ⬇️
              </button>
              <button
                @click="kickMember(m)"
                title="Exclure"
                class="w-8 h-8 rounded-lg bg-gray-900 hover:bg-orange-600 text-orange-400 hover:text-white text-sm transition-colors"
              >
                👢
              </button>
              <button
                @click="banMember(m)"
                title="Bannir"
                class="w-8 h-8 rounded-lg bg-gray-900 hover:bg-red-600 text-red-400 hover:text-white text-sm transition-colors"
              >
                🚫
              </button>
            </div>
          </div>
        </div>

        <!-- ═══ BANNIS ═══ -->
        <div v-else-if="tab === 'bans'" class="space-y-2">
          <p v-if="!group.bannedUsers || group.bannedUsers.length === 0" class="text-center text-gray-500 py-8">
            Aucun utilisateur banni.
          </p>
          <div
            v-for="userId in (group.bannedUsers || [])"
            :key="userId"
            class="flex items-center gap-3 bg-gray-800 border border-red-900/30 rounded-xl p-3"
          >
            <div class="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center">🚫</div>
            <div class="flex-1 min-w-0">
              <p class="font-mono text-sm text-gray-300">user #{{ userId }}</p>
              <p class="text-xs text-red-400">Banni</p>
            </div>
            <button
              v-if="isAdmin"
              @click="unbanUser(userId)"
              class="px-3 py-1.5 rounded-lg bg-gray-900 hover:bg-green-600 text-green-400 hover:text-white text-xs font-semibold transition-colors"
            >
              Débannir
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>