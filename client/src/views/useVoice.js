import { ref } from 'vue';

const ICE_SERVERS = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

export function useVoice(socket, currentUser) {
  const localStream = ref(null);
  const peers = {};

  // — Crée un RTCPeerConnection avec un pair distant
  const createPeerConnection = (remoteSocketId) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peers[remoteSocketId] = pc;

    // Ajouter les pistes audio locales
    localStream.value?.getTracks().forEach(t => pc.addTrack(t, localStream.value));

    // Envoyer les candidats ICE via le serveur de signaling
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit('webrtc-ice', { to: remoteSocketId, candidate });
    };

    // Jouer l'audio reçu du pair distant
    pc.ontrack = ({ streams }) => {
      const audio = new Audio();
      audio.srcObject = streams[0];
      audio.dataset.remote = remoteSocketId;
      audio.play().catch(console.warn);
    };

    return pc;
  };

  // — Rejoindre un salon vocal
  const joinVoiceRoom = async (roomId) => {
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
        console.warn('ICE error:', e);
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

    // Retirer les listeners pour éviter les doublons si on rejoint plus tard
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