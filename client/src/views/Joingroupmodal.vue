<script setup>
import { ref } from 'vue';

const props = defineProps({
  currentUserId: { type: [Number, String], required: true },
});
const emit = defineEmits(['close', 'joined']);

const Swal = window.Swal;
const API  = 'http://localhost:3001';

const code    = ref('');
const joining = ref(false);
const errMsg  = ref('');

const handleJoin = async () => {
  const trimmed = code.value.trim().toUpperCase();
  if (trimmed.length !== 6) {
    errMsg.value = 'Le code doit contenir 6 caractères.';
    return;
  }
  errMsg.value = '';
  joining.value = true;
  try {
    const res = await fetch(`${API}/api/groups/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: trimmed, userId: props.currentUserId }),
    });
    const data = await res.json();
    if (!res.ok) {
      errMsg.value = data.error || 'Code invalide.';
      return;
    }
    if (data.already) {
      Swal?.fire({
        icon: 'info', title: 'Tu es déjà membre', timer: 1200, showConfirmButton: false,
        background: '#111827', color: '#f9fafb',
      });
    } else {
      Swal?.fire({
        icon: 'success', title: `Bienvenue dans ${data.group.name} !`,
        timer: 1500, showConfirmButton: false,
        background: '#111827', color: '#f9fafb',
      });
    }
    emit('joined', data.group);
  } catch {
    errMsg.value = 'Serveur inaccessible.';
  } finally {
    joining.value = false;
  }
};
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">

      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950">
        <h2 class="text-lg font-bold text-white">Rejoindre un groupe</h2>
        <button @click="emit('close')" class="text-gray-400 hover:text-white text-xl">✕</button>
      </div>

      <div class="p-6 flex flex-col gap-5">
        <p class="text-sm text-gray-400">
          Entre le code d'invitation que t'a partagé un membre du groupe.
        </p>

        <div>
          <label class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
            Code d'invitation
          </label>
          <input
            v-model="code"
            @keyup.enter="handleJoin"
            type="text"
            placeholder="ABCD23"
            maxlength="6"
            class="w-full bg-gray-800 border-2 border-gray-700 rounded-xl px-4 py-4 text-white text-center font-mono text-2xl uppercase tracking-widest focus:outline-none focus:border-indigo-500 transition-colors"
          />
          <p v-if="errMsg" class="text-xs text-red-400 mt-2 text-center">{{ errMsg }}</p>
        </div>
      </div>

      <div class="flex justify-end gap-3 px-6 pb-6">
        <button
          @click="emit('close')"
          class="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-semibold text-sm transition-colors"
        >
          Annuler
        </button>
        <button
          @click="handleJoin"
          :disabled="joining || code.trim().length !== 6"
          class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-sm transition-colors flex items-center gap-2"
        >
          <span v-if="joining" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
          {{ joining ? 'Connexion…' : '🚀 Rejoindre' }}
        </button>
      </div>
    </div>
  </div>
</template>