<script setup>
import { ref } from 'vue';

const props = defineProps({
  currentUserId: { type: [Number, String], default: null }
});
const emit = defineEmits(['close', 'created']);

const groupName    = ref('');
const groupType    = ref('public'); // 'public' | 'private'
const creating     = ref(false);
const errorMsg     = ref('');

const getInitials = (name) =>
  name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || 'SRV';

const handleCreate = async () => {
  if (!groupName.value.trim()) {
    errorMsg.value = 'Le nom du groupe ne peut pas être vide.';
    return;
  }
  errorMsg.value = '';
  creating.value = true;

  try {
    const response = await fetch('http://localhost:3001/api/groups/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:      groupName.value.trim(),
        type:      groupType.value,
        creatorId: props.currentUserId,
        friendIds: []
      })
    });

    const data = await response.json();

    if (response.ok) {
      emit('created', {
        id:       data.group.id ?? Date.now(),
        name:     data.group.name,
        type:     groupType.value,
        initials: getInitials(data.group.name),
        active:   false
      });
    } else {
      // Backend down ? On crée quand même en local
      emit('created', {
        id:       Date.now(),
        name:     groupName.value.trim(),
        type:     groupType.value,
        initials: getInitials(groupName.value.trim()),
        active:   false
      });
    }
  } catch {
    // Pas de backend : création locale
    emit('created', {
      id:       Date.now(),
      name:     groupName.value.trim(),
      type:     groupType.value,
      initials: getInitials(groupName.value.trim()),
      active:   false
    });
  } finally {
    creating.value = false;
  }
};
</script>

<template>
  <!-- Overlay -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">

      <!-- Header -->
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950">
        <h2 class="text-lg font-bold text-white">Créer un groupe</h2>
        <button @click="emit('close')" class="text-gray-400 hover:text-white transition-colors text-xl">✕</button>
      </div>

      <!-- Body -->
      <div class="p-6 flex flex-col gap-5">

        <!-- Nom du groupe -->
        <div>
          <label class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">Nom du groupe</label>
          <input
            v-model="groupName"
            @keyup.enter="handleCreate"
            type="text"
            placeholder="Ex: Équipe Tournoi FST"
            maxlength="50"
            class="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-colors"
          />
          <p v-if="errorMsg" class="text-xs text-red-400 mt-1">{{ errorMsg }}</p>
        </div>

        <!-- Type de groupe -->
        <div>
          <label class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 block">Type de groupe</label>
          <div class="grid grid-cols-2 gap-3">

            <!-- Public -->
            <button
              @click="groupType = 'public'"
              class="flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all"
              :class="groupType === 'public'
                ? 'border-green-500 bg-green-500/10'
                : 'border-gray-700 bg-gray-800 hover:border-gray-500'"
            >
              <span class="text-3xl">🌍</span>
              <span class="font-bold text-sm" :class="groupType === 'public' ? 'text-green-400' : 'text-gray-300'">Public</span>
              <span class="text-xs text-gray-500 text-center">Visible par tout le monde, rejoignable librement</span>
            </button>

            <!-- Privé -->
            <button
              @click="groupType = 'private'"
              class="flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all"
              :class="groupType === 'private'
                ? 'border-indigo-500 bg-indigo-500/10'
                : 'border-gray-700 bg-gray-800 hover:border-gray-500'"
            >
              <span class="text-3xl">🔒</span>
              <span class="font-bold text-sm" :class="groupType === 'private' ? 'text-indigo-400' : 'text-gray-300'">Privé</span>
              <span class="text-xs text-gray-500 text-center">Sur invitation uniquement, code requis</span>
            </button>
          </div>
        </div>

        <!-- Aperçu -->
        <div v-if="groupName.trim()" class="flex items-center gap-3 p-3 bg-gray-800 rounded-xl border border-gray-700">
          <div
            class="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
            :class="groupType === 'public' ? 'bg-green-600' : 'bg-indigo-600'"
          >
            {{ groupName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() }}
          </div>
          <div>
            <p class="font-semibold text-white text-sm">{{ groupName }}</p>
            <p class="text-xs" :class="groupType === 'public' ? 'text-green-400' : 'text-indigo-400'">
              {{ groupType === 'public' ? '🌍 Groupe public' : '🔒 Groupe privé' }}
            </p>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="flex justify-end gap-3 px-6 pb-6">
        <button
          @click="emit('close')"
          class="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-semibold text-sm transition-colors"
        >
          Annuler
        </button>
        <button
          @click="handleCreate"
          :disabled="creating || !groupName.trim()"
          class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-sm transition-colors flex items-center gap-2"
        >
          <span v-if="creating" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
          {{ creating ? 'Création…' : '✅ Créer le groupe' }}
        </button>
      </div>
    </div>
  </div>
</template>