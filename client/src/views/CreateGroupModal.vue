<script setup>
import { ref } from 'vue';

const props = defineProps({
  currentUserId: { type: [Number, String], default: null }
});
const emit = defineEmits(['close', 'created']);

const groupName = ref('');
const groupType = ref('public');
const creating  = ref(false);
const errorMsg  = ref('');

const Swal = window.Swal;

const handleCreate = async () => {
  console.log('[CreateGroup] click', { name: groupName.value, type: groupType.value, userId: props.currentUserId });

  if (!groupName.value.trim()) {
    errorMsg.value = 'Le nom du groupe ne peut pas être vide.';
    return;
  }
  if (!props.currentUserId) {
    errorMsg.value = 'Tu dois être connecté.';
    return;
  }
  errorMsg.value = '';
  creating.value = true;

  try {
    console.log('[CreateGroup] fetch start');
    const response = await fetch(`${import.meta.env.VITE_API_URL}/api/groups/create`, {
    method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:      groupName.value.trim(),
        type:      groupType.value,
        creatorId: props.currentUserId,
      })
    });
    console.log('[CreateGroup] response status', response.status);

    const data = await response.json().catch(() => ({}));
    console.log('[CreateGroup] response body', data);

    if (!response.ok) {
      errorMsg.value = data.error || `Erreur ${response.status}`;
      return;
    }

    Swal?.fire({
      icon: 'success',
      title: 'Groupe créé !',
      html: `Code d'invitation : <b class="font-mono text-indigo-400">${data.group.inviteCode}</b>`,
      background: '#111827', color: '#f9fafb', confirmButtonColor: '#6366f1',
      timer: 2200, showConfirmButton: false,
    });

    emit('created', { id: data.group.id });
    emit('close'); // 🔑 On ferme la modale nous-mêmes au cas où le parent oublie
  } catch (e) {
    console.error('[CreateGroup] fetch error', e);
    errorMsg.value = 'Serveur inaccessible (?). ' + (e?.message || '');
  } finally {
    creating.value = false;
  }
};
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" @click.self="emit('close')">
    <div class="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">

      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950">
        <h2 class="text-lg font-bold text-white">Créer un groupe</h2>
        <button @click="emit('close')" class="text-gray-400 hover:text-white transition-colors text-xl">✕</button>
      </div>

      <div class="p-6 flex flex-col gap-5">
        <div>
          <label class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">Nom du groupe</label>
          <input v-model="groupName" @keyup.enter="handleCreate" type="text"
            placeholder="Ex: Équipe Tournoi FST" maxlength="50"
            class="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-colors" />
          <p v-if="errorMsg" class="text-xs text-red-400 mt-1">{{ errorMsg }}</p>
        </div>

        <div>
          <label class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 block">Type de groupe</label>
          <div class="grid grid-cols-2 gap-3">
            <button @click="groupType='public'"
              class="flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all"
              :class="groupType==='public' ? 'border-green-500 bg-green-500/10' : 'border-gray-700 bg-gray-800 hover:border-gray-500'">
              <span class="text-3xl">🌍</span>
              <span class="font-bold text-sm" :class="groupType==='public'?'text-green-400':'text-gray-300'">Public</span>
              <span class="text-xs text-gray-500 text-center">Visible, rejoint avec le code</span>
            </button>
            <button @click="groupType='private'"
              class="flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all"
              :class="groupType==='private' ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-700 bg-gray-800 hover:border-gray-500'">
              <span class="text-3xl">🔒</span>
              <span class="font-bold text-sm" :class="groupType==='private'?'text-indigo-400':'text-gray-300'">Privé</span>
              <span class="text-xs text-gray-500 text-center">Sur invitation uniquement</span>
            </button>
          </div>
        </div>

        <div v-if="groupName.trim()" class="flex items-center gap-3 p-3 bg-gray-800 rounded-xl border border-gray-700">
          <div class="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
            :class="groupType==='public' ? 'bg-green-600' : 'bg-indigo-600'">
            {{ groupName.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase() }}
          </div>
          <div>
            <p class="font-semibold text-white text-sm">{{ groupName }}</p>
            <p class="text-xs" :class="groupType==='public' ? 'text-green-400' : 'text-indigo-400'">
              {{ groupType==='public' ? '🌍 Groupe public' : '🔒 Groupe privé' }}
            </p>
          </div>
        </div>
      </div>

      <div class="flex justify-end gap-3 px-6 pb-6">
        <button @click="emit('close')" class="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-semibold text-sm transition-colors">Annuler</button>
        <button @click="handleCreate" :disabled="creating || !groupName.trim()"
          class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-sm transition-colors flex items-center gap-2">
          <span v-if="creating" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
          {{ creating ? 'Création…' : '✅ Créer le groupe' }}
        </button>
      </div>
    </div>
  </div>
</template>