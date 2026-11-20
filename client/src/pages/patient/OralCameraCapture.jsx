import { useCallback, useEffect, useRef, useState } from 'react';
import { getCameraErrorKey } from './cameraCaptureUtils.js';

export default function OralCameraCapture({ disabled, onCapture, t }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [cameraError, setCameraError] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async (mode = facingMode) => {
    stopTracks();
    setCameraError('');
    setCameraReady(false);
    setTorchSupported(false);
    setTorchOn(false);
    setStarting(true);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        window.isSecureContext
          ? t('screening.cameraUnavailable')
          : t('screening.cameraInsecureContext'),
      );
      setStarting(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: mode },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 960, max: 1080 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stopTracks();
        return;
      }
      video.srcObject = stream;
      await video.play();
      setCameraStarted(true);
      if (video.videoWidth > 0 && video.videoHeight > 0) setCameraReady(true);
      const track = stream.getVideoTracks()[0];
      setTorchSupported(Boolean(track?.getCapabilities?.().torch));
      track?.addEventListener('ended', () => {
        setCameraReady(false);
        setCameraStarted(false);
        setCameraError(t('screening.cameraStopped'));
      }, { once: true });
    } catch (error) {
      stopTracks();
      setCameraStarted(false);
      setCameraError(t(`screening.${getCameraErrorKey(error)}`));
    } finally {
      setStarting(false);
    }
  }, [facingMode, stopTracks, t]);

  useEffect(() => {
    return stopTracks;
  }, [stopTracks]);

  function switchCamera() {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    startCamera(nextMode);
  }

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchSupported) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setCameraError(t('screening.torchUnavailable'));
    }
  }

  async function capture() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video?.videoHeight || disabled || capturing) return;
    setCapturing(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error(t('screening.photoQualityError'));
      context.drawImage(video, 0, 0);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error(t('screening.photoQualityError')))),
          'image/jpeg',
          0.92,
        );
      });
      await onCapture(new File([blob], `oral-screening-${Date.now()}.jpg`, { type: 'image/jpeg' }));
    } catch (error) {
      setCameraError(error.message || t('screening.photoQualityError'));
    } finally {
      setCapturing(false);
    }
  }

  return (
    <div className="space-y-3">
      {cameraError ? (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-950" role="status">
          {cameraError} {t('screening.fileUploadFallback')}
        </p>
      ) : null}
      <div className="relative mx-auto aspect-[4/3] w-full max-w-2xl overflow-hidden rounded-2xl bg-slate-950">
        <video
          ref={videoRef}
          aria-label={t('screening.liveCameraPreview')}
          className={`h-full w-full object-cover ${facingMode === 'user' ? '-scale-x-100' : ''}`}
          playsInline
          muted
          onLoadedMetadata={(event) => {
            if (event.currentTarget.videoWidth > 0) setCameraReady(true);
          }}
        />
        {!cameraReady ? (
          <div className="absolute inset-0 grid place-items-center p-5 text-center text-white">
            <p>{starting ? t('screening.cameraStarting') : t('screening.cameraPreviewWaiting')}</p>
          </div>
        ) : null}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="h-[44%] w-[72%] rounded-[50%] border-4 border-dashed border-white shadow-[0_0_0_999px_rgba(15,23,42,0.28)]" />
        </div>
        <p className="absolute bottom-3 left-3 right-3 rounded-lg bg-black/65 p-2 text-center text-sm font-semibold text-white">
          {t('screening.cameraGuide')}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {!cameraReady ? (
          <button
            className="min-h-touch rounded-xl bg-teal-800 px-5 font-bold text-white disabled:opacity-50"
            disabled={disabled || starting}
            onClick={() => startCamera()}
            type="button"
          >
            {starting ? t('screening.cameraStarting') : cameraStarted ? t('screening.retryCamera') : t('screening.startCamera')}
          </button>
        ) : null}
        <button
          className="min-h-touch rounded-xl border border-slate-300 px-4 font-semibold"
          disabled={disabled || starting || !cameraReady}
          onClick={switchCamera}
          type="button"
        >
          {t('screening.switchCamera')}
        </button>
        {torchSupported ? (
          <button
            aria-pressed={torchOn}
            className="min-h-touch rounded-xl border border-slate-300 px-4 font-semibold aria-pressed:bg-amber-100"
            disabled={disabled || starting || !cameraReady}
            onClick={toggleTorch}
            type="button"
          >
            {torchOn ? t('screening.turnTorchOff') : t('screening.turnTorchOn')}
          </button>
        ) : null}
        <button
          className="min-h-touch rounded-xl bg-teal-800 px-5 font-bold text-white disabled:opacity-50"
          disabled={disabled || starting || capturing || !cameraReady}
          onClick={capture}
          type="button"
        >
          {capturing ? t('screening.capturing') : t('screening.capturePhoto')}
        </button>
      </div>
    </div>
  );
}
