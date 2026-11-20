import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api, { getApiErrorMessage } from '../../services/api.js';
import useConsultationSocket from '../../hooks/useConsultationSocket.js';
import { addIceCandidateOrQueue, applyPendingIceCandidates } from './webrtcSignaling.js';

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

export default function ConsultationCallRoom({ request, role, onClose }) {
  const { t } = useTranslation();
  const socket = useConsultationSocket();
  const localVideo = useRef(null);
  const remoteVideo = useRef(null);
  const peer = useRef(null);
  const localStream = useRef(null);
  const dataChannel = useRef(null);
  const pendingPhoto = useRef(null);
  const photoUrl = useRef('');
  const onCloseRef = useRef(onClose);
  const [phase, setPhase] = useState('connecting');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [lowBandwidth, setLowBandwidth] = useState(false);
  const [sharingScreen, setSharingScreen] = useState(false);
  const [turnAvailable, setTurnAvailable] = useState(false);
  const [network, setNetwork] = useState('checking');
  const [startedAt, setStartedAt] = useState(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [messages, setMessages] = useState([]);
  const [message, setMessage] = useState('');
  const [sharedPhoto, setSharedPhoto] = useState('');
  const [sharedPhotoUrl, setSharedPhotoUrl] = useState('');

  const appendMessage = useCallback((item) => {
    setMessages((current) => [...current.slice(-49), item]);
  }, []);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!startedAt) return undefined;
    const update = () =>
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  useEffect(() => {
    let active = true;
    let channel = null;
    let roomToken = '';
    let joinInProgress = false;
    const pendingIceCandidates = [];
    const closeMedia = () => {
      peer.current?.close();
      peer.current = null;
      localStream.current?.getTracks().forEach((track) => track.stop());
      localStream.current = null;
      if (remoteVideo.current) remoteVideo.current.srcObject = null;
      if (localVideo.current) localVideo.current.srcObject = null;
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
    };

    function handleChannelData(event) {
      if (typeof event.data === 'string') {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'chat' && typeof payload.text === 'string') {
            appendMessage({
              text: payload.text,
              senderRole: role === 'doctor' ? 'patient' : 'doctor',
            });
          } else if (payload.type === 'photo-start' && typeof payload.name === 'string') {
            pendingPhoto.current = { ...payload, chunks: [] };
            setSharedPhoto(payload.name);
          }
        } catch {
          appendMessage({ text: event.data, senderRole: role === 'doctor' ? 'patient' : 'doctor' });
        }
      } else if (pendingPhoto.current && event.data instanceof ArrayBuffer) {
        pendingPhoto.current.chunks.push(event.data);
        if (pendingPhoto.current.chunks.length >= pendingPhoto.current.totalChunks) {
          const image = new Blob(pendingPhoto.current.chunks, {
            type: pendingPhoto.current.mime || 'image/jpeg',
          });
          const url = URL.createObjectURL(image);
          if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
          photoUrl.current = url;
          setSharedPhotoUrl(url);
          pendingPhoto.current = null;
        }
      }
    }

    async function initialize() {
      try {
        const response = await api.post(`/calls/requests/${request._id}/token`);
        roomToken = response.data.details.roomToken;
        const iceServers = response.data.details.iceServers || [];
        setTurnAvailable(
          iceServers.some((server) =>
            [].concat(server.urls || []).some((url) => /^turns?:/i.test(url)),
          ),
        );
        const media = await navigator.mediaDevices
          .getUserMedia({ audio: true, video: true })
          .catch(async (cameraError) => {
            setCameraOff(true);
            setLowBandwidth(true);
            if (!cameraError) return null;
            return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          });
        if (!active) {
          media?.getTracks().forEach((track) => track.stop());
          return;
        }
        localStream.current = media;
        if (localVideo.current && media) localVideo.current.srcObject = media;
        const connection = new RTCPeerConnection({
          iceServers,
          iceCandidatePoolSize: 2,
        });
        peer.current = connection;
        media?.getTracks().forEach((track) => connection.addTrack(track, media));
        connection.ontrack = (event) => {
          if (remoteVideo.current) remoteVideo.current.srcObject = event.streams[0];
        };
        connection.onicecandidate = (event) => {
          if (event.candidate) {
            socket?.emit('consultation:signal', {
              kind: 'ice',
              payload: event.candidate.toJSON(),
            });
          }
        };
        connection.ondatachannel = (event) => {
          dataChannel.current = event.channel;
          event.channel.binaryType = 'arraybuffer';
          event.channel.onmessage = handleChannelData;
        };
        connection.onconnectionstatechange = () => {
          const state = connection.connectionState;
          if (state === 'connected') {
            setPhase('connected');
            setNetwork('good');
          } else if (state === 'failed' || state === 'disconnected') {
            setPhase('reconnecting');
            setNetwork('weak');
            if (role === 'doctor') {
              window.setTimeout(async () => {
                if (!active || connection.connectionState === 'connected') return;
                try {
                  const refreshedToken = await api.post(`/calls/requests/${request._id}/token`);
                  connection.setConfiguration({
                    iceServers: refreshedToken.data.details.iceServers,
                    iceCandidatePoolSize: 2,
                  });
                  connection.restartIce();
                  const offer = await connection.createOffer({ iceRestart: true });
                  await connection.setLocalDescription(offer);
                  socket?.emit('consultation:signal', { kind: 'restart', payload: offer });
                } catch {
                  if (active) setError(t('consultation.reconnectError'));
                }
              }, 1500);
            }
          }
        };
        if (role === 'doctor') {
          channel = connection.createDataChannel('consultation-chat', { ordered: true });
          channel.binaryType = 'arraybuffer';
          dataChannel.current = channel;
          channel.onmessage = handleChannelData;
        }
        socket.on('connect', joinRoom);
        socket.on('connect_error', onSocketError);
        socket.on('disconnect', onSocketDisconnect);
        socket?.on('consultation:call-started', onCallStarted);
        socket?.on('consultation:signal', onSignal);
        socket?.on('consultation:participant-joined', onParticipantJoined);
        socket?.on('consultation:chat', (item) => appendMessage(item));
        socket.on('consultation:call-ended', onCallEnded);
        if (socket.connected) await joinRoom();
        setBusy(false);
      } catch (requestError) {
        if (active) {
          setError(getApiErrorMessage(requestError, t('consultation.connectError')));
          setBusy(false);
          setPhase('error');
        }
      }
    }

    function onParticipantJoined() {
      setPhase('waiting');
    }

    function onSocketError() {
      if (active) {
        setError(t('consultation.signalingUnavailable'));
        setPhase('reconnecting');
      }
    }

    function onSocketDisconnect() {
      if (active) {
        setError(t('consultation.signalingReconnecting'));
        setPhase('reconnecting');
      }
    }

    function onCallEnded() {
      setPhase('ended');
      onCloseRef.current();
    }

    async function onCallStarted(event) {
      setStartedAt(new Date(event.startedAt).getTime());
      setPhase('connecting');
      if (role !== 'doctor' || !peer.current || peer.current.localDescription) return;
      try {
        const offer = await peer.current.createOffer();
        await peer.current.setLocalDescription(offer);
        socket.emit('consultation:signal', { kind: 'offer', payload: offer });
      } catch {
        setError(t('consultation.connectError'));
      }
    }

    async function onSignal(messageEvent) {
      const connection = peer.current;
      if (!connection) return;
      try {
        if (['offer', 'restart'].includes(messageEvent.kind)) {
          await connection.setRemoteDescription(messageEvent.payload);
          await applyPendingIceCandidates(connection, pendingIceCandidates);
          const answer = await connection.createAnswer();
          await connection.setLocalDescription(answer);
          socket.emit('consultation:signal', { kind: 'answer', payload: answer });
        } else if (messageEvent.kind === 'answer') {
          await connection.setRemoteDescription(messageEvent.payload);
          await applyPendingIceCandidates(connection, pendingIceCandidates);
        } else if (messageEvent.kind === 'ice' && messageEvent.payload) {
          await addIceCandidateOrQueue(connection, messageEvent.payload, pendingIceCandidates);
        }
      } catch {
        setError(t('consultation.signalError'));
      }
    }

    function joinRoom() {
      if (joinInProgress || !socket.connected) return;
      joinInProgress = true;
      const getRoomToken = roomToken
        ? Promise.resolve(roomToken)
        : api
            .post(`/calls/requests/${request._id}/token`)
            .then((response) => response.data.details.roomToken);
      roomToken = '';
      getRoomToken
        .then(
          (freshToken) =>
            new Promise((resolve) => {
              socket.emit(
                'consultation:join',
                { requestId: request._id, roomToken: freshToken },
                (result) => {
                  if (!result?.success) {
                    setError(t('consultation.joinDenied'));
                    setPhase('error');
                  } else {
                    setError('');
                    setPhase('waiting');
                  }
                  resolve();
                },
              );
            }),
        )
        .catch((joinError) => {
          setError(getApiErrorMessage(joinError, t('consultation.joinDenied')));
          setPhase('error');
        })
        .finally(() => {
          joinInProgress = false;
        });
    }

    if (!socket) {
      setBusy(true);
      return () => {
        active = false;
      };
    }
    initialize();
    return () => {
      active = false;
      socket?.emit('consultation:leave');
      socket?.off('connect', joinRoom);
      socket?.off('connect_error', onSocketError);
      socket?.off('disconnect', onSocketDisconnect);
      socket?.off('consultation:call-started', onCallStarted);
      socket?.off('consultation:signal', onSignal);
      socket?.off('consultation:participant-joined', onParticipantJoined);
      socket?.off('consultation:chat');
      socket?.off('consultation:call-ended', onCallEnded);
      channel?.close();
      closeMedia();
    };
  }, [appendMessage, request._id, role, socket, t]);

  useEffect(() => {
    if (!peer.current) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const stats = await peer.current?.getStats();
        let rtt = 0;
        stats?.forEach((report) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded') {
            rtt = report.currentRoundTripTime || 0;
          }
        });
        setNetwork(rtt > 0.7 ? 'weak' : rtt > 0.35 ? 'fair' : 'good');
      } catch {
        setNetwork('unknown');
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [phase]);

  async function toggleMicrophone() {
    const next = !muted;
    localStream.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  }

  function toggleCamera() {
    const next = !cameraOff;
    localStream.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setCameraOff(next);
  }

  async function switchCamera() {
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: cameraOff ? 'user' : 'environment' },
      });
      const nextTrack = nextStream.getVideoTracks()[0];
      const sender = peer.current?.getSenders().find((item) => item.track?.kind === 'video');
      if (!sender || !nextTrack) throw new Error(t('consultation.cameraSwitchError'));
      await sender.replaceTrack(nextTrack);
      localStream.current?.getVideoTracks().forEach((track) => {
        track.stop();
        localStream.current.removeTrack(track);
      });
      localStream.current?.addTrack(nextTrack);
      if (localVideo.current) localVideo.current.srcObject = localStream.current;
      setCameraOff(false);
    } catch (cameraError) {
      setError(cameraError.message || t('consultation.cameraSwitchError'));
    }
  }

  async function shareScreen() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = stream.getVideoTracks()[0];
      const sender = peer.current?.getSenders().find((item) => item.track?.kind === 'video');
      if (!sender || !screenTrack) throw new Error(t('consultation.screenShareError'));
      await sender.replaceTrack(screenTrack);
      setSharingScreen(true);
      screenTrack.onended = async () => {
        const cameraTrack = localStream.current?.getVideoTracks()[0];
        if (cameraTrack) await sender.replaceTrack(cameraTrack);
        setSharingScreen(false);
      };
    } catch (shareError) {
      setError(shareError.message || t('consultation.screenShareError'));
    }
  }

  async function setAudioOnly(enabled) {
    setLowBandwidth(enabled);
    localStream.current?.getVideoTracks().forEach((track) => {
      track.enabled = !enabled;
    });
    setCameraOff(enabled);
    if (enabled) {
      const sender = peer.current?.getSenders().find((item) => item.track?.kind === 'video');
      if (sender) {
        const parameters = sender.getParameters();
        if (parameters.encodings?.length) {
          parameters.encodings[0].maxBitrate = 180_000;
          await sender.setParameters(parameters);
        }
      }
    }
  }

  function sendChat(event) {
    event.preventDefault();
    const text = message.trim().slice(0, 2000);
    if (!text) return;
    const item = { text, senderRole: role };
    appendMessage(item);
    if (dataChannel.current?.readyState === 'open') {
      dataChannel.current.send(JSON.stringify({ type: 'chat', text }));
    } else {
      socket?.emit('consultation:chat', { text });
    }
    setMessage('');
  }

  async function sharePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size < 1 || file.size > 1_000_000) {
      setError(t('consultation.photoLimit'));
      return;
    }
    if (dataChannel.current?.readyState !== 'open') {
      setError(t('consultation.photoChannelUnavailable'));
      return;
    }
    const bytes = await file.arrayBuffer();
    const chunkSize = 16 * 1024;
    const totalChunks = Math.ceil(bytes.byteLength / chunkSize);
    dataChannel.current.send(
      JSON.stringify({ type: 'photo-start', name: file.name, mime: file.type, totalChunks }),
    );
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      dataChannel.current.send(bytes.slice(offset, offset + chunkSize));
    }
  }

  async function endCall() {
    setBusy(true);
    setError('');
    try {
      await api.post(`/calls/requests/${request._id}/end`);
      setPhase('ended');
      onClose();
    } catch (endError) {
      setError(getApiErrorMessage(endError, t('consultation.endError')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label={t('consultation.callRoom')}
      className="space-y-4 rounded-3xl border border-teal-200 bg-white p-4 shadow-lg sm:p-6"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-950">{t('consultation.callRoom')}</h2>
          <p aria-live="polite" className="text-sm text-slate-700">
            {busy ? t('consultation.connecting') : t(`consultation.phase.${phase}`)}
            {startedAt ? ` · ${formatDuration(elapsedSeconds)}` : ''}
          </p>
        </div>
        <p className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold">
          {t('consultation.network')}:{' '}
          {t(`consultation.networkQuality.${network}`, { defaultValue: network })}
        </p>
      </header>
      {!turnAvailable ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          {t('consultation.turnNotice')}
        </p>
      ) : null}
      {request.urgent ? (
        <a
          className="inline-flex min-h-touch items-center rounded-xl bg-rose-700 px-5 font-bold text-white"
          href="tel:112"
        >
          {t('consultation.call112')}
        </a>
      ) : null}
      {error ? (
        <p className="rounded-xl bg-rose-50 p-3 text-rose-900" role="alert">
          {error}
        </p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <figure className="relative min-h-56 overflow-hidden rounded-2xl bg-slate-950">
          <video
            autoPlay
            className="h-full min-h-56 w-full object-cover"
            muted
            playsInline
            ref={remoteVideo}
          />
          <figcaption className="absolute bottom-2 left-2 rounded-lg bg-black/70 px-3 py-1 text-sm text-white">
            {role === 'doctor' ? request.patientName : request.doctorName}
          </figcaption>
        </figure>
        <figure className="relative min-h-56 overflow-hidden rounded-2xl bg-slate-950">
          <video
            autoPlay
            className="h-full min-h-56 w-full object-cover"
            muted
            playsInline
            ref={localVideo}
          />
          <figcaption className="absolute bottom-2 left-2 rounded-lg bg-black/70 px-3 py-1 text-sm text-white">
            {t('consultation.you')}
          </figcaption>
        </figure>
      </div>
      {sharedPhotoUrl ? (
        <figure className="rounded-xl border border-teal-200 p-3">
          <figcaption className="mb-2 font-semibold">
            {t('consultation.sharedPhoto')}: {sharedPhoto}
          </figcaption>
          <img
            alt={t('consultation.sharedPhoto')}
            className="max-h-72 rounded-lg object-contain"
            src={sharedPhotoUrl}
          />
        </figure>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          className="min-h-touch rounded-xl border px-3 font-semibold"
          onClick={toggleMicrophone}
          type="button"
        >
          {muted ? t('consultation.unmute') : t('consultation.mute')}
        </button>
        <button
          className="min-h-touch rounded-xl border px-3 font-semibold"
          onClick={toggleCamera}
          type="button"
        >
          {cameraOff ? t('consultation.cameraOn') : t('consultation.cameraOff')}
        </button>
        <button
          className="min-h-touch rounded-xl border px-3 font-semibold"
          onClick={switchCamera}
          type="button"
        >
          {t('consultation.switchCamera')}
        </button>
        <button
          className="min-h-touch rounded-xl border px-3 font-semibold"
          onClick={shareScreen}
          type="button"
        >
          {sharingScreen ? t('consultation.sharingScreen') : t('consultation.shareScreen')}
        </button>
        <button
          className="min-h-touch rounded-xl border px-3 font-semibold"
          onClick={() => setAudioOnly(!lowBandwidth)}
          type="button"
        >
          {lowBandwidth ? t('consultation.videoMode') : t('consultation.audioOnly')}
        </button>
        <label className="inline-flex min-h-touch cursor-pointer items-center rounded-xl border px-3 font-semibold">
          {t('consultation.sharePhoto')}
          <input accept="image/*" className="sr-only" onChange={sharePhoto} type="file" />
        </label>
      </div>
      <section className="rounded-2xl border border-slate-200 p-3">
        <h3 className="font-bold">{t('consultation.chat')}</h3>
        <ul aria-live="polite" className="my-2 max-h-32 space-y-1 overflow-y-auto text-sm">
          {messages.map((item, index) => (
            <li key={`${item.sentAt || index}-${index}`}>
              <span className="font-semibold">
                {item.senderRole === role
                  ? t('consultation.you')
                  : t('consultation.otherParticipant')}
                :
              </span>{' '}
              {item.text}
            </li>
          ))}
        </ul>
        <form className="flex gap-2" onSubmit={sendChat}>
          <input
            aria-label={t('consultation.chatMessage')}
            className="min-h-touch min-w-0 flex-1 rounded-xl border border-slate-300 px-3"
            maxLength={2000}
            onChange={(event) => setMessage(event.target.value)}
            value={message}
          />
          <button
            className="min-h-touch rounded-xl bg-teal-800 px-4 font-semibold text-white"
            type="submit"
          >
            {t('consultation.send')}
          </button>
        </form>
      </section>
      <p className="text-sm text-slate-600">{t('consultation.recordingOff')}</p>
      <button
        className="min-h-touch rounded-xl bg-rose-700 px-5 font-bold text-white disabled:opacity-50"
        disabled={busy || phase === 'ended'}
        onClick={endCall}
        type="button"
      >
        {t('consultation.endCall')}
      </button>
    </section>
  );
}
