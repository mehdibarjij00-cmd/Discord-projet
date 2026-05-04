<script setup>
import { ref, reactive } from 'vue';

// SweetAlert2 chargé via CDN dans index.html
const Swal = window.Swal;

const emit = defineEmits(['login-success']);

const isLoginMode = ref(true);
const isLoading   = ref(false);

const form = reactive({
  username:        '',
  email:           '',
  password:        '',
  confirmPassword: '',
});

const toggleMode = () => {
  isLoginMode.value = !isLoginMode.value;
  form.password        = '';
  form.confirmPassword = '';
};

const handleSubmit = async () => {
  isLoading.value = true;
  try {
    if (isLoginMode.value) {
      // ── CONNEXION ──────────────────────────────────────
      // const response = await fetch(`${import.meta.env.VITE_API_URL}/api/groups/${id}`, { ... });
          const res = await fetch(`${import.meta.env.VITE_API_URL}/api/login`, 
        { method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: form.email, password: form.password }),
      });
      const data = await res.json();

      if (!res.ok) {
        Swal.fire({
          icon:               'error',
          title:              'Connexion échouée',
          text:               data.error || 'Email ou mot de passe incorrect.',
          background:         '#111827',
          color:              '#f9fafb',
          confirmButtonColor: '#6366f1',
        });
        return;
      }

      Swal.fire({
        icon:               'success',
        title:              `Bienvenue, ${data.user.name || data.user.username} ! 👋`,
        background:         '#111827',
        color:              '#f9fafb',
        confirmButtonColor: '#6366f1',
        timer:              1400,
        showConfirmButton:  false,
      }).then(() => emit('login-success', data.user));

    } else {
      // ── INSCRIPTION ────────────────────────────────────
      if (form.password !== form.confirmPassword) {
        Swal.fire({
          icon:               'warning',
          title:              'Mots de passe différents',
          text:               'Les deux mots de passe ne correspondent pas.',
          background:         '#111827',
          color:              '#f9fafb',
          confirmButtonColor: '#6366f1',
        });
        return;
      }

      const res = await fetch(`${import.meta.env.VITE_API_URL}/api/register`, 
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username: form.username, email: form.email, password: form.password }),
      });
      const data = await res.json();

      if (!res.ok) {
        Swal.fire({
          icon:               'error',
          title:              'Inscription échouée',
          text:               data.error || 'Ce pseudo ou cet email est déjà utilisé.',
          background:         '#111827',
          color:              '#f9fafb',
          confirmButtonColor: '#6366f1',
        });
        return;
      }

      Swal.fire({
        icon:               'success',
        title:              'Compte créé ! 🎉',
        text:               'Tu peux maintenant te connecter.',
        background:         '#111827',
        color:              '#f9fafb',
        confirmButtonColor: '#6366f1',
      }).then(() => toggleMode());
    }
  } catch {
    Swal.fire({
      icon:               'error',
      title:              'Serveur inaccessible',
      html:               'Vérifie que ton backend Node.js tourne bien  </b>.',
      background:         '#111827',
      color:              '#f9fafb',
      confirmButtonColor: '#6366f1',
    });
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-950 text-white font-sans relative overflow-hidden">

    <!-- Effets de lumière -->
    <div class="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/15 rounded-full blur-[120px] pointer-events-none"></div>
    <div class="absolute bottom-1/4 right-1/4 w-80 h-80 bg-pink-500/10 rounded-full blur-[100px] pointer-events-none"></div>

    <div class="w-full max-w-md bg-gray-900/80 backdrop-blur-xl border border-gray-800 rounded-2xl shadow-2xl p-8 relative z-10 animate-fade-in">

      <!-- En-tête -->
      <div class="text-center mb-8">
        <div class="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/30">
          <span class="text-3xl">🎮</span>
        </div>
        <h1 class="text-3xl font-black tracking-tight">ArenaLink</h1>
        <p class="text-gray-400 text-sm mt-2">
          {{ isLoginMode ? 'Bon retour parmi nous !' : 'Rejoins la communauté.' }}
        </p>
      </div>

      <!-- Formulaire -->
      <form @submit.prevent="handleSubmit" class="space-y-4">

        <!-- Pseudo (inscription seulement) -->
        <Transition name="field">
          <div v-if="!isLoginMode" class="space-y-1">
            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Pseudo</label>
            <input
              v-model="form.username"
              type="text"
              required
              placeholder="Ton nom de joueur"
              class="w-full px-4 py-3 bg-gray-950 border border-gray-700 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all text-gray-100 placeholder-gray-600 text-sm"
            />
          </div>
        </Transition>

        <!-- Email -->
        <div class="space-y-1">
          <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Email</label>
          <input
            v-model="form.email"
            type="email"
            required
            placeholder="joueur@email.com"
            class="w-full px-4 py-3 bg-gray-950 border border-gray-700 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all text-gray-100 placeholder-gray-600 text-sm"
          />
        </div>

        <!-- Mot de passe -->
        <div class="space-y-1">
          <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Mot de passe</label>
          <input
            v-model="form.password"
            type="password"
            required
            placeholder="••••••••"
            class="w-full px-4 py-3 bg-gray-950 border border-gray-700 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all text-gray-100 placeholder-gray-600 text-sm"
          />
        </div>

        <!-- Confirmation (inscription seulement) -->
        <Transition name="field">
          <div v-if="!isLoginMode" class="space-y-1">
            <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Confirmer le mot de passe</label>
            <input
              v-model="form.confirmPassword"
              type="password"
              required
              placeholder="••••••••"
              class="w-full px-4 py-3 bg-gray-950 border border-gray-700 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50 transition-all text-gray-100 placeholder-gray-600 text-sm"
            />
          </div>
        </Transition>

        <!-- Bouton submit -->
        <button
          type="submit"
          :disabled="isLoading"
          class="w-full py-3 mt-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2"
        >
          <svg v-if="isLoading" class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          {{ isLoading ? 'Chargement…' : (isLoginMode ? 'Se connecter' : 'Créer mon compte') }}
        </button>
      </form>

      <!-- Bascule connexion / inscription -->
      <div class="mt-6 text-center text-sm text-gray-400">
        {{ isLoginMode ? "Pas encore de compte ?" : "Tu as déjà un compte ?" }}
        <button @click="toggleMode" class="text-indigo-400 hover:text-indigo-300 font-bold ml-1 transition-colors">
          {{ isLoginMode ? "S'inscrire" : "Se connecter" }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.animate-fade-in {
  animation: fadeIn 0.35s ease-out forwards;
}
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0);    }
}
.field-enter-active, .field-leave-active { transition: all 0.25s ease; overflow: hidden; }
.field-enter-from, .field-leave-to       { opacity: 0; max-height: 0; margin: 0; }
.field-enter-to,   .field-leave-from     { opacity: 1; max-height: 120px; }
</style>