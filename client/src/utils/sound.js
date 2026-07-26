/**
 * Sonidos de notificación usando la Web Audio API.
 * Genera tonos sintetizados sin necesidad de archivos externos.
 */

let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

/**
 * Reproduce un chime suave de dos tonos (notificaciones normales).
 * "ding-ding" ~300ms.
 */
export function playNotificationSound() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.value = 660;
  gain1.gain.setValueAtTime(0, now);
  gain1.gain.linearRampToValueAtTime(0.12, now + 0.02);
  gain1.gain.linearRampToValueAtTime(0.08, now + 0.1);
  gain1.gain.linearRampToValueAtTime(0, now + 0.18);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.2);

  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.value = 880;
  gain2.gain.setValueAtTime(0, now + 0.1);
  gain2.gain.linearRampToValueAtTime(0.1, now + 0.13);
  gain2.gain.linearRampToValueAtTime(0.06, now + 0.2);
  gain2.gain.linearRampToValueAtTime(0, now + 0.3);
  osc2.connect(gain2);
  gain2.connect(ctx.destination);
  osc2.start(now + 0.1);
  osc2.stop(now + 0.32);
}

/**
 * Reproduce un sonido URGENTE para alertas críticas.
 * Tres tonos descendentes con timbre más agresivo (triangular/sawtooth),
 * simulando una alarma breve (~700ms).
 */
export function playAlertCriticalSound() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Tres pulsos descendentes, cada uno más corto
  const pulses = [
    { freq: 880, start: 0, dur: 0.15 },    // A5
    { freq: 660, start: 0.18, dur: 0.12 },  // E5
    { freq: 440, start: 0.34, dur: 0.2 },    // A4 más largo
  ];

  for (const p of pulses) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // Triangular para un sonido más presente que sine pero menos agresivo que sawtooth
    osc.type = 'triangle';
    osc.frequency.value = p.freq;

    const tStart = now + p.start;
    gain.gain.setValueAtTime(0, tStart);
    gain.gain.linearRampToValueAtTime(0.15, tStart + 0.02);
    gain.gain.linearRampToValueAtTime(0.1, tStart + p.dur * 0.6);
    gain.gain.linearRampToValueAtTime(0, tStart + p.dur);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(tStart);
    osc.stop(tStart + p.dur + 0.02);
  }
}
