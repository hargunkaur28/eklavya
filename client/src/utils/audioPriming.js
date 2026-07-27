// Phase 3/4 Fix: Shared Unlocked HTMLAudioElement & Session Audio Priming
// Browsers (Chrome, Firefox, Safari) enforce an Autoplay Policy that blocks `audio.play()`
// on NEW HTMLAudioElement instances created after an asynchronous `await fetch`.
//
// By maintaining a shared `HTMLAudioElement` instance unlocked via `primeAudio()`
// during a user gesture (e.g. "Yes" on prompt, "Next Question", "Start Quiz"),
// subsequent questions can update `.src` on the shared audio instance and play
// without triggering `NotAllowedError`.

let sharedAudioInstance = null;

export function getSharedAudio() {
  if (typeof window === 'undefined') return null;
  if (!sharedAudioInstance) {
    sharedAudioInstance = new Audio();
  }
  return sharedAudioInstance;
}

export function primeAudio() {
  try {
    const audio = getSharedAudio();
    if (!audio) return;
    const silentWav = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
    audio.src = silentWav;
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          console.log('[audioPriming] Shared HTMLAudioElement successfully unlocked for session.');
        })
        .catch((err) => {
          console.warn('[audioPriming] Audio unlock attempt notice:', err.message);
        });
    }
  } catch (e) {
    console.warn('[audioPriming] Audio priming error:', e.message);
  }
}
