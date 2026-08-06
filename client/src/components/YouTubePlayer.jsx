import { useEffect, useRef } from 'react';
import { stopNarration } from '../utils/narrationController.js';

// ── The ONE playing video ───────────────────────────────────────────────────
// Module scope, like narrationController's playback state and for the identical
// reason: ownership per component means nothing can stop "whatever is playing now".
// Claiming pauses the previous player.
let currentPlayer = null;
function claimVideoPlayback(player) {
  if (currentPlayer && currentPlayer !== player) {
    try { currentPlayer.pauseVideo?.(); } catch { /* already destroyed */ }
  }
  currentPlayer = player;
}
function releaseVideoPlayback(player) {
  if (currentPlayer === player) currentPlayer = null;
}

// Phase 2: loads the YouTube IFrame Player API once (returns a shared promise),
// so multiple players on a page don't each inject the script.
let ytApiPromise = null;
function loadYouTubeAPI() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev();
      resolve(window.YT);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

// Renders a tracked YouTube player. Calls onProgress({ videoId, watchedSeconds,
// durationSeconds }) every ~10s while playing and immediately on pause/end.
// Purely a reporting surface — it never decides "watched"; the server does.
// Mounted lazily (only after the student activates the card), so instantiating
// it implies the video is meant to play → autoplay defaults on.
export default function YouTubePlayer({ videoId, onProgress, autoplay = true }) {
  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const pollRef = useRef(null);
  const onProgressRef = useRef(onProgress);

  // Keep the latest callback without re-initialising the player.
  useEffect(() => { onProgressRef.current = onProgress; }, [onProgress]);

  useEffect(() => {
    let cancelled = false;
    if (!videoId || !hostRef.current) return undefined;

    // `final` marks pause/end reports — the parent always persists those, but
    // throttles the frequent (1s) ticks so the bar can move smoothly on screen
    // without hammering the server on every tick.
    const report = (final = false) => {
      const p = playerRef.current;
      if (!p || typeof p.getCurrentTime !== 'function') return;
      const watchedSeconds = Math.floor(p.getCurrentTime() || 0);
      const durationSeconds = Math.floor((typeof p.getDuration === 'function' ? p.getDuration() : 0) || 0);
      if (onProgressRef.current) {
        onProgressRef.current({ videoId, watchedSeconds, durationSeconds, final });
      }
    };

    const stopPolling = () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
    const startPolling = () => {
      stopPolling();
      pollRef.current = setInterval(() => report(false), 1000);
    };

    loadYouTubeAPI()
      .then((YT) => {
        if (cancelled || !hostRef.current) return;
        playerRef.current = new YT.Player(hostRef.current, {
          videoId,
          // `origin` + `enablejsapi` silence the dev-mode postMessage origin warning.
          playerVars: {
            rel: 0,
            modestbranding: 1,
            autoplay: autoplay ? 1 : 0,
            enablejsapi: 1,
            origin: window.location.origin
          },
          events: {
            onReady: (e) => {
              if (autoplay && e.target && typeof e.target.playVideo === 'function') {
                e.target.playVideo();
              }
            },
            onStateChange: (e) => {
              const state = window.YT?.PlayerState;
              if (!state) return;
              if (e.data === state.PLAYING) {
                // ── ONE PLAYING VIDEO, AND IT SILENCES THE MENTOR ──────────
                //
                // Design Rule 10's shape, applied to video. Playback was owned
                // per-player, so nothing could stop "whatever is playing right now" —
                // and on the device several videos played at once, over each other and
                // over the mentor.
                //
                // Registering the CURRENT player at module scope and stopping the
                // previous one makes two simultaneous videos structurally impossible
                // rather than merely discouraged, exactly as narrationController does
                // for audio.
                //
                // Stopping narration too is not a nicety: the mentor and a video talking
                // over each other is the same defect one layer up, and a child cannot
                // separate two voices to work out which one is instructing them.
                claimVideoPlayback(playerRef.current);
                stopNarration();
                startPolling();
              } else if (e.data === state.PAUSED || e.data === state.ENDED) {
                stopPolling();
                report(true);
              }
            }
          }
        });
      })
      .catch((err) => console.warn('YouTube IFrame API failed to load:', err?.message));

    return () => {
      cancelled = true;
      stopPolling();
      releaseVideoPlayback(playerRef.current);
      const p = playerRef.current;
      if (p && typeof p.destroy === 'function') {
        try { p.destroy(); } catch { /* player already gone */ }
      }
      playerRef.current = null;
    };
  }, [videoId, autoplay]);

  // YT.Player replaces this div with its iframe; React only owns the wrapper.
  return <div ref={hostRef}></div>;
}
