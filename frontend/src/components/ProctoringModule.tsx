import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from 'react';
import { Camera, AlertTriangle, ShieldCheck, EyeOff, Maximize2, Loader2, RefreshCw } from 'lucide-react';
import { ProctorLog, ProctoringEventRecord } from '../types';

export type CameraPermissionState =
  | 'IDLE'
  | 'REQUESTING'
  | 'GRANTED'
  | 'ACTIVE'
  | 'DENIED'
  | 'UNAVAILABLE'
  | 'ERROR'
  | 'STOPPED';

interface ProctoringProps {
  onViolation: (log: ProctorLog) => void;
  onProctoringEvent?: (
    eventType: ProctoringEventRecord['eventType'],
    severity: ProctoringEventRecord['severity'],
    details: string
  ) => void;
  onScreenshotDetected?: (details: string) => void;
  isExamActive: boolean;
  warningCount?: number;
  maxWarnings?: number;
}

export interface ProctoringHandle {
  stopMediaStream: () => void;
}

export const ProctoringModule = forwardRef<ProctoringHandle, ProctoringProps>(({
  onViolation,
  onProctoringEvent,
  onScreenshotDetected,
  isExamActive,
  warningCount = 0,
  maxWarnings = 5
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const streamRequestIdRef = useRef(0);
  const faceDetectionIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isExamActiveRef = useRef(isExamActive);
  isExamActiveRef.current = isExamActive;
  const [cameraState, setCameraState] = useState<CameraPermissionState>('IDLE');
  const [hasActiveLiveFeed, setHasActiveLiveFeed] = useState<boolean>(false);
  const [cameraErrorMessage, setCameraErrorMessage] = useState<string>('');
  const [status, setStatus] = useState<'SECURE' | 'WARNING' | 'CRITICAL'>('SECURE');
  const [warningMessage, setWarningMessage] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(Boolean(document.fullscreenElement));

  const lastViolationTimeRef = useRef<number>(0);
  const lastScreenshotTimeRef = useRef<number>(0);

  const onViolationRef = useRef(onViolation);
  onViolationRef.current = onViolation;
  const onProctoringEventRef = useRef(onProctoringEvent);
  onProctoringEventRef.current = onProctoringEvent;
  const onScreenshotDetectedRef = useRef(onScreenshotDetected);
  onScreenshotDetectedRef.current = onScreenshotDetected;

  const triggerEvent = useCallback(
    (
      eventType: ProctoringEventRecord['eventType'],
      severity: ProctoringEventRecord['severity'],
      message: string
    ) => {
      const now = Date.now();
      // Enforce sustained cooldown (minimum 4 seconds between proctoring warning counter increments)
      if (now - lastViolationTimeRef.current < 4000) {
        return;
      }
      lastViolationTimeRef.current = now;

      setStatus(severity === 'CRITICAL' || severity === 'HIGH' ? 'CRITICAL' : 'WARNING');
      setWarningMessage(message);

      if (onViolationRef.current) {
        onViolationRef.current({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: new Date().toLocaleTimeString(),
          type: severity === 'CRITICAL' || severity === 'HIGH' ? 'CRITICAL' : 'WARNING',
          message
        });
      }

      if (onProctoringEventRef.current) {
        onProctoringEventRef.current(eventType, severity, message);
      }

      setTimeout(() => {
        setStatus('SECURE');
        setWarningMessage('');
      }, 4000);
    },
    []
  );

  const handleScreenshotEvent = useCallback(
    (details: string) => {
      const now = Date.now();
      if (now - lastScreenshotTimeRef.current < 2500) {
        return;
      }
      lastScreenshotTimeRef.current = now;

      // EXCLUDED from proctoring warning counter: Informational only
      if (onScreenshotDetectedRef.current) {
        onScreenshotDetectedRef.current(details);
      }
      if (onProctoringEventRef.current) {
        onProctoringEventRef.current('SCREENSHOT_ATTEMPT', 'LOW', details);
      }
    },
    []
  );

  const stopMediaStream = useCallback(() => {
    streamRequestIdRef.current += 1;

    if (faceDetectionIntervalRef.current !== null) {
      clearInterval(faceDetectionIntervalRef.current);
      faceDetectionIntervalRef.current = null;
    }

    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => {
      track.onmute = null;
      track.onunmute = null;
      track.onended = null;
      track.stop();
    });

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setHasActiveLiveFeed(false);
    setCameraState('STOPPED');
  }, []);

  useImperativeHandle(ref, () => ({ stopMediaStream }), [stopMediaStream]);

  const attachStreamToVideo = useCallback((video: HTMLVideoElement | null, stream: MediaStream | null) => {
    if (!video || !stream) return;
    try {
      video.muted = true;
      video.defaultMuted = true;
      video.playsInline = true;
      video.setAttribute('muted', 'true');
      video.setAttribute('playsinline', 'true');
      video.setAttribute('autoplay', 'true');

      if (video.srcObject !== stream) {
        video.srcObject = stream;
      }

      const tracks = stream.getVideoTracks();
      if (tracks && tracks.length > 0 && tracks[0].readyState === 'live') {
        const playPromise = video.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              if (
                stream === streamRef.current &&
                isExamActiveRef.current &&
                stream.getVideoTracks().some((track) => track.readyState === 'live')
              ) {
                setHasActiveLiveFeed(true);
                setCameraState('ACTIVE');
              }
            })
            .catch(() => {
              // Browser may await loadedmetadata or user interaction
            });
        }
      }
    } catch (err) {
      console.warn('Camera stream attachment warning:', err);
    }
  }, []);

  // Setup Real Browser Camera with stable references
  const startWebcam = useCallback(async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraState('UNAVAILABLE');
      setCameraErrorMessage('Your browser environment does not support mediaDevices.getUserMedia.');
      triggerEvent(
        'CAMERA_OFF',
        'HIGH',
        'Camera API is not supported in this browser context.'
      );
      return;
    }

    // If stream is already healthy and live, re-bind if needed and keep running
    if (
      streamRef.current &&
      streamRef.current.getVideoTracks().some((t) => t.readyState === 'live')
    ) {
      if (videoRef.current) {
        attachStreamToVideo(videoRef.current, streamRef.current);
      }
      setHasActiveLiveFeed(true);
      setCameraState('ACTIVE');
      return;
    }

    // Clean up any dead stream before starting fresh
    if (streamRef.current) {
      stopMediaStream();
    }
    const requestId = ++streamRequestIdRef.current;
    setHasActiveLiveFeed(false);
    setCameraState('REQUESTING');
    setCameraErrorMessage('');

    let acquiredStream: MediaStream | null = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user'
        },
        audio: false
      });
      acquiredStream = stream;

      if (requestId !== streamRequestIdRef.current || !isExamActiveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;

      const videoTracks = stream.getVideoTracks();
      if (!videoTracks || videoTracks.length === 0) {
        throw new Error('No live video track returned from camera.');
      }

      setCameraState('GRANTED');

      if (videoRef.current) {
        attachStreamToVideo(videoRef.current, stream);
      }

      const videoTrack = videoTracks[0];
      videoTrack.onmute = () => {
        if (streamRef.current !== stream || !isExamActiveRef.current) return;
        setHasActiveLiveFeed(false);
        triggerEvent('CAMERA_BLOCKED', 'HIGH', 'Camera feed muted or blocked during active examination');
      };
      videoTrack.onunmute = () => {
        if (streamRef.current !== stream || !isExamActiveRef.current) return;
        setHasActiveLiveFeed(true);
        setCameraState('ACTIVE');
      };
      videoTrack.onended = () => {
        if (streamRef.current !== stream || !isExamActiveRef.current) return;
        setHasActiveLiveFeed(false);
        setCameraState('STOPPED');
        triggerEvent('CAMERA_OFF', 'HIGH', 'Camera feed disconnected during active examination');
      };
    } catch (err: any) {
      if (acquiredStream && streamRef.current === acquiredStream) {
        stopMediaStream();
      } else if (acquiredStream) {
        acquiredStream.getTracks().forEach((track) => track.stop());
      }
      setHasActiveLiveFeed(false);
      const errorName = err?.name || '';
      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        setCameraState('DENIED');
        setCameraErrorMessage('Camera access is required for this proctored exam. Please allow camera permissions in your browser settings.');
        triggerEvent(
          'CAMERA_BLOCKED',
          'HIGH',
          'Camera access is required for this proctored exam. Permission was denied in browser.'
        );
      } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        setCameraState('UNAVAILABLE');
        setCameraErrorMessage('No camera hardware was detected on this device. A camera is required.');
        triggerEvent(
          'CAMERA_OFF',
          'HIGH',
          'No camera device found on the system.'
        );
      } else {
        setCameraState('ERROR');
        setCameraErrorMessage(err?.message || 'Failed to initialize live camera feed.');
        triggerEvent(
          'CAMERA_OFF',
          'HIGH',
          'Camera stream unavailable or failed to initialize.'
        );
      }
    }
  }, [triggerEvent, attachStreamToVideo, stopMediaStream]);

  // Lifecycle Management: Camera starts ONLY when isExamActive is true, stops completely when false
  useEffect(() => {
    if (isExamActive) {
      startWebcam();
    } else {
      stopMediaStream();
    }

    return () => {
      stopMediaStream();
    };
  }, [isExamActive, startWebcam, stopMediaStream]);

  // Synchronize stream attachment when video element finishes loading metadata
  const handleVideoLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    video.muted = true;
    video.play().then(() => {
      if (
        streamRef.current &&
        isExamActiveRef.current &&
        streamRef.current.getVideoTracks().some((track) => track.readyState === 'live')
      ) {
        setHasActiveLiveFeed(true);
        setCameraState('ACTIVE');
      }
    }).catch(() => {});
  };

  const handleVideoCanPlay = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    video.muted = true;
    video.play().then(() => {
      if (
        streamRef.current &&
        isExamActiveRef.current &&
        streamRef.current.getVideoTracks().some((track) => track.readyState === 'live')
      ) {
        setHasActiveLiveFeed(true);
        setCameraState('ACTIVE');
      }
    }).catch(() => {});
  };

  const handleVideoPlaying = () => {
    if (
      isExamActiveRef.current &&
      streamRef.current &&
      streamRef.current.getVideoTracks().some((track) => track.readyState === 'live')
    ) {
      setHasActiveLiveFeed(true);
      setCameraState('ACTIVE');
    }
  };

  // Re-verify stream attachment whenever camera state changes
  useEffect(() => {
    if ((cameraState === 'ACTIVE' || cameraState === 'GRANTED') && streamRef.current && videoRef.current) {
      attachStreamToVideo(videoRef.current, streamRef.current);
    }
  }, [cameraState, attachStreamToVideo]);

  // Monitor Fullscreen, Tab Switching, Copy/Paste, Print, Context Menu, and Screenshot Keys
  useEffect(() => {
    if (!isExamActive) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        triggerEvent('TAB_SWITCH', 'HIGH', 'Tab switch or browser minimization detected');
      }
    };

    const handleFullscreenChange = () => {
      const activeFs = Boolean(document.fullscreenElement);
      setIsFullscreen(activeFs);
      if (!activeFs) {
        triggerEvent('FULLSCREEN_EXIT', 'MEDIUM', 'Exited fullscreen examination mode');
      }
    };

    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      triggerEvent('COPY_PASTE_ATTEMPT', 'MEDIUM', 'Clipboard copy action blocked during examination');
    };

    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      triggerEvent('COPY_PASTE_ATTEMPT', 'MEDIUM', 'Clipboard paste action blocked during examination');
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    // Screenshot & Capture Key Handler (NEVER increments proctoring warning counter)
    const handleKeyDown = (e: KeyboardEvent) => {
      // PrintScreen key (PrintScreen / Snapshot / keyCode 44)
      if (e.key === 'PrintScreen' || e.code === 'PrintScreen' || e.keyCode === 44) {
        e.preventDefault();
        handleScreenshotEvent('PrintScreen capture attempt detected');
        return;
      }

      // Print shortcut (Ctrl+P or Cmd+P)
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        handleScreenshotEvent('Browser print command detected');
        return;
      }

      // OS-level screenshot shortcuts where browser-interceptable
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        ['s', 'S', '3', '4', '5'].includes(e.key)
      ) {
        e.preventDefault();
        handleScreenshotEvent('Screen capture key combination detected');
        return;
      }
    };

    // Browser Print Flow (beforeprint)
    const handleBeforePrint = (e: Event) => {
      e.preventDefault();
      handleScreenshotEvent('Browser print flow initiated');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('copy', handleCopy);
    document.addEventListener('paste', handlePaste);
    document.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('beforeprint', handleBeforePrint);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('copy', handleCopy);
      document.removeEventListener('paste', handlePaste);
      document.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('beforeprint', handleBeforePrint);
    };
  }, [isExamActive, triggerEvent, handleScreenshotEvent]);

  // Periodic Face Tracking (sustained cooldown, active only when camera is ACTIVE)
  useEffect(() => {
    if (!isExamActive || cameraState !== 'ACTIVE') return;

    let consecutiveNoFaceCount = 0;
    const stream = streamRef.current;
    if (!stream) return;

    const interval = setInterval(async () => {
      if (!videoRef.current || videoRef.current.readyState < 2) return;

      try {
        if (typeof (window as any).FaceDetector !== 'undefined') {
          const detector = new (window as any).FaceDetector({ maxDetectedFaces: 5, fastMode: true });
          const faces = await detector.detect(videoRef.current);
          if (stream !== streamRef.current || !isExamActiveRef.current) return;
          if (faces.length === 0) {
            consecutiveNoFaceCount++;
            if (consecutiveNoFaceCount >= 3) {
              triggerEvent('NO_FACE', 'HIGH', 'Candidate face not detected in camera frame');
            }
          } else if (faces.length > 1) {
            consecutiveNoFaceCount = 0;
            triggerEvent('MULTIPLE_FACES', 'CRITICAL', `Multiple faces (${faces.length}) detected in camera view`);
          } else {
            consecutiveNoFaceCount = 0;
          }
        }
      } catch {
        // Face detection non-critical fallback
      }
    }, 4500);
    faceDetectionIntervalRef.current = interval;

    return () => {
      clearInterval(interval);
      if (faceDetectionIntervalRef.current === interval) {
        faceDetectionIntervalRef.current = null;
      }
    };
  }, [isExamActive, cameraState, triggerEvent]);

  const requestExamFullscreen = async () => {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      }
    } catch {
      // Ignore if blocked by sandbox permissions
    }
  };

  return (
    <div className="bg-slate-900 text-white p-4 sm:p-5 rounded-xl shadow-lg border border-slate-700 w-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Camera className="w-4 h-4 text-blue-400" />
          <span className="font-semibold text-[14px]">Live Proctoring</span>
        </div>
        <div
          className={`flex items-center space-x-1 px-2.5 py-0.5 rounded-md text-[12px] font-medium ${
            status === 'SECURE'
              ? 'bg-green-900/80 text-green-300'
              : status === 'WARNING'
                ? 'bg-amber-900/80 text-amber-300'
                : 'bg-red-900/80 text-red-300'
          }`}
        >
          {status === 'SECURE' ? (
            <ShieldCheck className="w-3.5 h-3.5 mr-1" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 mr-1" />
          )}
          {status}
        </div>
      </div>

      <div className="relative aspect-video bg-slate-950 rounded-lg overflow-hidden border border-slate-800 mb-3 flex items-center justify-center">
        {/* Real Video Element is ALWAYS present in DOM and receives active stream immediately */}
        <video
          ref={(el) => {
            videoRef.current = el;
            if (el && streamRef.current) {
              attachStreamToVideo(el, streamRef.current);
            }
          }}
          autoPlay
          muted
          playsInline
          onLoadedMetadata={handleVideoLoadedMetadata}
          onCanPlay={handleVideoCanPlay}
          onPlaying={handleVideoPlaying}
          className={`absolute inset-0 w-full h-full object-cover transform scale-x-[-1] transition-opacity duration-200 ${
            cameraState === 'ACTIVE' || cameraState === 'GRANTED' ? 'opacity-100 z-10' : 'opacity-0 pointer-events-none z-0'
          }`}
        />

        {/* State Overlays for Non-Active Camera */}
        {cameraState === 'REQUESTING' && (
          <div className="relative z-20 flex flex-col items-center justify-center h-full text-slate-300 px-4 text-center bg-slate-900/90 w-full">
            <Loader2 className="w-6 h-6 mb-2 text-blue-400 animate-spin" />
            <span className="text-[13px] font-medium">Requesting camera access...</span>
            <span className="text-[11.5px] text-slate-400 mt-1">Please allow camera permissions if prompted</span>
          </div>
        )}

        {cameraState === 'DENIED' && (
          <div className="relative z-20 flex flex-col items-center justify-center h-full text-slate-300 px-4 text-center bg-slate-900/95 w-full">
            <AlertTriangle className="w-6 h-6 mb-2 text-amber-400" />
            <span className="text-[13px] font-semibold text-amber-300">Camera access is required</span>
            <span className="text-[11.5px] text-slate-400 mt-1 leading-snug">
              Camera access was denied. Please allow camera access in your browser settings.
            </span>
            <button
              type="button"
              onClick={startWebcam}
              className="mt-2.5 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Retry Permission
            </button>
          </div>
        )}

        {cameraState === 'UNAVAILABLE' && (
          <div className="relative z-20 flex flex-col items-center justify-center h-full text-slate-300 px-4 text-center bg-slate-900/95 w-full">
            <EyeOff className="w-6 h-6 mb-2 text-slate-500" />
            <span className="text-[13px] font-semibold text-slate-300">No camera detected</span>
            <span className="text-[11.5px] text-slate-400 mt-1 leading-snug">
              A working camera is required for this proctored examination.
            </span>
            <button
              type="button"
              onClick={startWebcam}
              className="mt-2.5 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> Check Hardware
            </button>
          </div>
        )}

        {(cameraState === 'ERROR' || cameraState === 'STOPPED' || cameraState === 'IDLE') && (
          <div className="relative z-20 flex flex-col items-center justify-center h-full text-slate-400 px-4 text-center bg-slate-900/95 w-full">
            <EyeOff className="w-6 h-6 mb-2 text-slate-500" />
            <span className="text-[13px] font-medium text-slate-300">
              {cameraState === 'STOPPED'
                ? 'Camera feed stopped'
                : cameraErrorMessage || 'Camera feed paused'}
            </span>
            {cameraState === 'ERROR' && (
              <button
                type="button"
                onClick={startWebcam}
                className="mt-2.5 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[12px] font-medium inline-flex items-center gap-1.5 transition-colors"
              >
                <RefreshCw className="w-3 h-3" /> Retry Camera
              </button>
            )}
          </div>
        )}

        {(cameraState === 'ACTIVE' || cameraState === 'GRANTED') && (
          <div className="absolute inset-0 z-20 pointer-events-none border-2 border-blue-500/20 rounded-lg">
            <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded text-[11px] font-mono text-emerald-400">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              LIVE FEED
            </div>
          </div>
        )}
      </div>

      {!isFullscreen && (
        <button
          type="button"
          onClick={requestExamFullscreen}
          className="w-full h-9 mb-2.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[13px] font-medium flex items-center justify-center gap-2 border border-slate-700 transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5 text-blue-400" />
          Enable Fullscreen Lock
        </button>
      )}

      {warningMessage && (
        <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-2.5 text-[12.5px] text-red-200 flex items-start space-x-2 animate-pulse mb-2.5">
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{warningMessage}</span>
        </div>
      )}

      <div className="mt-2 text-[12.5px] text-slate-400 flex justify-between items-center">
        <span>Security Guard: Active</span>
        <span className="tabular-nums font-semibold text-amber-400">
          Warnings {warningCount} / {maxWarnings}
        </span>
      </div>
    </div>
  );
});

ProctoringModule.displayName = 'ProctoringModule';
