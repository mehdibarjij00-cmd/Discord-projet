<script setup>
import { ref, computed } from 'vue';

const props = defineProps({
  user: { type: Object, required: true }
});
const emit = defineEmits(['close', 'save']);

const AVATAR_STYLES = [
  { id: 'avataaars',   label: 'Avataaars' },
  { id: 'bottts',      label: 'Robots'    },
  { id: 'pixel-art',   label: 'Pixel Art' },
  { id: 'lorelei',     label: 'Lorelei'   },
  { id: 'fun-emoji',   label: 'Emoji'     },
  { id: 'adventurer',  label: 'Aventurier'},
  { id: 'micah',       label: 'Micah'     },
  { id: 'thumbs',      label: 'Thumbs'    },
  { id: 'croodles',    label: 'Croodles'  },
  { id: 'identicon',   label: 'Identicon' },
];

const SEEDS = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot','Gamma','Hotel','India','Juliet','Kilo','Lima'];

const editName  = ref(props.user.name  ?? '');
const editBio   = ref(props.user.bio   ?? '');
const selStyle  = ref(props.user.avatarStyle ?? 'avataaars');
const selSeed   = ref(props.user.avatarSeed  ?? props.user.name ?? 'Alpha');
const activeTab = ref('avatar');
const saving    = ref(false);
const saveError = ref('');

const previewUrl = computed(() =>
  `https://api.dicebear.com/7.x/${selStyle.value}/svg?seed=${encodeURIComponent(selSeed.value)}`
);

const gridAvatars = computed(() =>
  SEEDS.map(seed => ({
    seed,
    url: `https://api.dicebear.com/7.x/${selStyle.value}/svg?seed=${encodeURIComponent(seed)}`
  }))
);

const save = async () => {
  if (!editName.value.trim()) return;
  saving.value = true;
  saveError.value = '';

  const profileData = {
    name:        editName.value.trim(),
    bio:         editBio.value.trim(),
    avatar:      previewUrl.value,
    avatarStyle: selStyle.value,
    avatarSeed:  selSeed.value,
  };

  try {
    const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
    const userId = storedUser.id;
    console.log('[Profil] Sauvegarde, userId =', userId, profileData);

    if (userId) {
      const res = await fetch('http://localhost:3001/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          name:        profileData.name,
          avatar:      profileData.avatar,
          avatarStyle: profileData.avatarStyle,
          avatarSeed:  profileData.avatarSeed,
          bio:         profileData.bio,
        }),
      });

      console.log('[Profil] Réponse status =', res.status);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        saveError.value = err.error || `Erreur ${res.status}`;
        saving.value = false;
        return;
      }

      const result = await res.json();
      console.log('[Profil] Réponse body =', result);

      const updatedUser = {
        ...storedUser,
        name:        result.user.name,
        username:    result.user.username,
        avatar:      result.user.avatar,
        avatarStyle: result.user.avatarStyle ?? profileData.avatarStyle,
        avatarSeed:  result.user.avatarSeed  ?? profileData.avatarSeed,
        bio:         result.user.bio         ?? profileData.bio,
      };
      localStorage.setItem('user', JSON.stringify(updatedUser));
    }

    const arenaPlayer = JSON.parse(localStorage.getItem('arenalink_player') || 'null');
    if (arenaPlayer) {
      localStorage.setItem('arenalink_player', JSON.stringify({
        ...arenaPlayer,
        name:        profileData.name,
        avatar:      profileData.avatar,
        avatarStyle: profileData.avatarStyle,
        avatarSeed:  profileData.avatarSeed,
      }));
    }

    emit('save', profileData);
  } catch (error) {
    console.error('[Profil] Erreur réseau:', error);
    saveError.value = 'Impossible de joindre le serveur.';
    const storedUser = JSON.parse(localStorage.getItem('user') || '{}');
    localStorage.setItem('user', JSON.stringify({ ...storedUser, ...profileData }));
    emit('save', profileData);
  }

  saving.value = false;
};
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-2xl bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
         style="max-height:90vh;">

      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-gray-950">
        <h2 class="text-lg font-bold text-white">Mon Profil</h2>
        <button @click="emit('close')" class="text-gray-400 hover:text-white transition-colors text-xl">✕</button>
      </div>

      <div class="flex border-b border-gray-800 bg-gray-950">
        <button
          v-for="tab in [{id:'avatar',label:'🎨 Avatar'},{id:'profile',label:'📝 Profil'}]"
          :key="tab.id"
          @click="activeTab = tab.id"
          class="flex-1 py-3 text-sm font-semibold transition-colors"
          :class="activeTab === tab.id
            ? 'text-indigo-400 border-b-2 border-indigo-500'
            : 'text-gray-400 hover:text-gray-200'"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-6 scrollbar-hide">

        <div v-if="activeTab === 'avatar'" class="flex flex-col gap-6">
          <div class="flex flex-col items-center gap-3">
            <div class="relative">
              <img :src="previewUrl" :key="previewUrl"
                class="w-28 h-28 rounded-full bg-gray-700 ring-4 ring-indigo-500/50 shadow-xl" />
              <div class="absolute -bottom-1 -right-1 w-7 h-7 bg-green-500 rounded-full border-2 border-gray-900"></div>
            </div>
            <p class="text-gray-400 text-sm">Aperçu de ton avatar</p>
          </div>

          <div>
            <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Style d'avatar</p>
            <div class="grid grid-cols-5 gap-2">
              <button
                v-for="style in AVATAR_STYLES"
                :key="style.id"
                @click="selStyle = style.id"
                class="flex flex-col items-center gap-1 p-2 rounded-xl border transition-all text-xs font-medium"
                :class="selStyle === style.id
                  ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                  : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500 hover:text-gray-200'"
              >
                <img :src="`https://api.dicebear.com/7.x/${style.id}/svg?seed=${encodeURIComponent(selSeed)}`"
                  class="w-10 h-10 rounded-lg bg-gray-700" />
                {{ style.label }}
              </button>
            </div>
          </div>

          <div>
            <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Choisis un personnage</p>
            <div class="grid grid-cols-6 gap-3">
              <button
                v-for="av in gridAvatars"
                :key="av.seed"
                @click="selSeed = av.seed"
                class="p-1.5 rounded-xl border-2 transition-all"
                :class="selSeed === av.seed
                  ? 'border-indigo-500 bg-indigo-500/10 scale-110'
                  : 'border-transparent bg-gray-800 hover:border-gray-500 hover:scale-105'"
              >
                <img :src="av.url" :key="av.url" class="w-full aspect-square rounded-lg bg-gray-700" />
              </button>
            </div>
          </div>

          <div>
            <p class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Seed personnalisée (optionnel)</p>
            <input v-model="selSeed" type="text" placeholder="Entre n'importe quel texte…"
              class="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors" />
            <p class="text-xs text-gray-500 mt-1">Chaque texte génère un avatar unique !</p>
          </div>
        </div>

        <div v-if="activeTab === 'profile'" class="flex flex-col gap-6">
          <div class="flex items-center gap-4 p-4 bg-gray-800 rounded-xl">
            <img :src="previewUrl" :key="previewUrl" class="w-16 h-16 rounded-full bg-gray-700 ring-2 ring-indigo-500/50" />
            <div>
              <p class="font-bold text-white">{{ editName || 'Ton pseudo' }}</p>
              <p class="text-sm text-gray-400">{{ editBio || "Aucune bio pour l'instant" }}</p>
            </div>
          </div>

          <div>
            <label class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">Pseudo</label>
            <input v-model="editName" type="text" placeholder="Ton nom de joueur" maxlength="32"
              class="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-indigo-500 transition-colors" />
            <p class="text-xs text-gray-500 mt-1">{{ editName.length }}/32 caractères</p>
          </div>

          <div>
            <label class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">Bio</label>
            <textarea v-model="editBio" placeholder="Parle un peu de toi…" maxlength="160" rows="4"
              class="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white resize-none focus:outline-none focus:border-indigo-500 transition-colors"></textarea>
            <p class="text-xs text-gray-500 mt-1">{{ editBio.length }}/160 caractères</p>
          </div>
        </div>
      </div>

      <div v-if="saveError" class="px-6 py-2 bg-red-500/10 border-t border-red-500/30 text-red-400 text-sm text-center">
        ⚠️ {{ saveError }}
      </div>

      <div class="flex justify-end gap-3 px-6 py-4 border-t border-gray-800 bg-gray-950">
        <button @click="emit('close')"
          class="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl font-semibold text-sm transition-colors">
          Annuler
        </button>
        <button @click="save" :disabled="saving || !editName.trim()"
          class="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-sm transition-colors flex items-center gap-2">
          <span v-if="saving" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
          {{ saving ? 'Sauvegarde…' : '💾 Sauvegarder' }}
        </button>
      </div>
    </div>
  </div>
</template>