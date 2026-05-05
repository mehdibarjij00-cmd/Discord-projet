import { ref } from 'vue';

// ─── Serveurs ICE : STUN alternatifs + TURN sur port 443 TCP ─────────────────
// Port 443 TCP passe partout (même derrière des firewalls stricts).
// On évite stun.l.google.com qui est souvent bloqué (erreur 701).
const ICE_SERVERS = {
  iceServers: [
    // STUN alternatifs (pas Google, plus fiables sur réseaux restrictifs)
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:stun.stunprotocol.org:3478' },
    // TURN Metered — UDP port 80 (fallback rapide)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    // TURN Metered — TCP port 443 (passe tous les firewalls)
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    // TURN Metered — TLS port 443 (relay chiffré, dernier recours)
    {
      urls: 'turns:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
};

export function useVoice(socket, currentUser) {
  const localStream = ref(null);
  const peers = {};

  // — Crée un RTCPeerConnection avec un pair distant
  const createPeerConnection = (remoteSocketId) => {
    // Fermer l'ancienne connexion si elle existe déjà (évite les doublons)
    if (peers[remoteSocketId]) {
      peers[remoteSocketId].close();
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    peers[remoteSocketId] = pc;

    // Ajouter les pistes audio locales
    localStream.value?.getTracks().forEach(t => pc.addTrack(t, localStream.value));

    // Envoyer les candidats ICE via le serveur de signaling
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit('webrtc-ice', { to: remoteSocketId, candidate });
    };

    // Log utile pour déboguer les problèmes de connexion
    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC] ICE state avec ${remoteSocketId}: ${pc.iceConnectionState}`);
    };

    // Jouer l'audio reçu du pair distant
    pc.ontrack = ({ streams }) => {
      // Supprimer l'ancien élément audio si existant
      document.querySelector(`audio[data-remote="${remoteSocketId}"]`)?.remove();

      const audio = new Audio();
      audio.srcObject = streams[0];
      audio.dataset.remote = remoteSocketId;
      // autoplay nécessite une interaction utilisateur préalable (déjà le cas via joinVoiceRoom)
      audio.play().catch(err => console.warn('[WebRTC] audio.play() bloqué:', err));
      document.body.appendChild(audio); // IMPORTANT : l'élément doit être dans le DOM
    };

    return pc;
  };

  // — Rejoindre un salon vocal
  const joinVoiceRoom = async (roomId) => {
    // Retirer les anciens listeners avant d'en ajouter de nouveaux (évite les doublons)
    socket.off('user-joined-voice');
    socket.off('webrtc-offer');
    socket.off('webrtc-answer');
    socket.off('webrtc-ice');
    socket.off('user-left-voice');

    try {
      localStream.value = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      alert('Accès au microphone refusé. Vérifie les permissions de ton navigateur.');
      return;
    }

    socket.emit('join-voice', { roomId, userId: currentUser.value.id });

    // Quelqu'un nous rejoint → on est l'initiateur (on envoie l'offer)
    socket.on('user-joined-voice', async ({ socketId }) => {
      const pc    = createPeerConnection(socketId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc-offer', { to: socketId, offer });
    });

    // On reçoit une offer → on répond avec une answer
    socket.on('webrtc-offer', async ({ from, offer }) => {
      const pc = createPeerConnection(from);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc-answer', { to: from, answer });
    });

    // On reçoit la answer → on finalise la connexion
    socket.on('webrtc-answer', async ({ from, answer }) => {
      await peers[from]?.setRemoteDescription(new RTCSessionDescription(answer));
    });

    // Candidats ICE entrants
    socket.on('webrtc-ice', async ({ from, candidate }) => {
      try {
        await peers[from]?.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('[WebRTC] ICE candidate error:', e);
      }
    });

    // Un pair quitte le salon
    socket.on('user-left-voice', (socketId) => {
      peers[socketId]?.close();
      delete peers[socketId];
      document.querySelector(`audio[data-remote="${socketId}"]`)?.remove();
    });
  };

  // — Quitter un salon vocal
  const leaveVoiceRoom = (roomId) => {
    localStream.value?.getTracks().forEach(t => t.stop());
    localStream.value = null;

    Object.entries(peers).forEach(([id, pc]) => {
      pc.close();
      document.querySelector(`audio[data-remote="${id}"]`)?.remove();
      delete peers[id];
    });

    socket.emit('leave-voice', { roomId });

    // Retirer les listeners
    socket.off('user-joined-voice');
    socket.off('webrtc-offer');
    socket.off('webrtc-answer');
    socket.off('webrtc-ice');
    socket.off('user-left-voice');
  };

  // — Mute / unmute le micro local
  const setMicMuted = (muted) => {
    localStream.value?.getAudioTracks().forEach(t => t.enabled = !muted);
  };

  return { localStream, joinVoiceRoom, leaveVoiceRoom, setMicMuted };
}
