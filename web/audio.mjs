/**
 * PICO-8-ish Web Audio player for RigPlayer.
 *
 * Reads `rig.music.pattern` rows (MIDI pitch, velocity, waveform 0–7, effect)
 * and the cart transport bpm — the same encoding PicoForge's p8-to-rig writes.
 * Lua `sfx(n)` / `music(n|-1)` drive it. Not bit-accurate; good enough for carts.
 */

const WAVE_TRIANGLE = 0;
const WAVE_TILT = 1;
const WAVE_SAW = 2;
const WAVE_SQUARE = 3;
const WAVE_PULSE = 4;
const WAVE_ORGAN = 5;
const WAVE_NOISE = 6;
const WAVE_PHASER = 7;

function midiToHz(midi) {
	return 440 * 2 ** ((midi - 69) / 12);
}

function stepSec(bpm, stepsPerBeat) {
	const spb = stepsPerBeat > 0 ? stepsPerBeat : 4;
	const b = bpm > 0 ? bpm : 120;
	return 60 / (b * spb);
}

/**
 * @typedef {{ active: boolean, pitch?: number, velocity?: number, waveform?: number, effect?: number, gate?: number }} MusicStep
 * @typedef {{ steps: MusicStep[], stepsPerBeat: number, loopStartStep: number, loopEndStep: number }} MusicPattern
 */

/**
 * @returns {{
 *   load: (music: { bpm: number, patterns: (MusicPattern|null)[] }) => void,
 *   unlock: () => Promise<void>,
 *   sfx: (n: number, channel?: number, offset?: number) => void,
 *   music: (n: number) => void,
 *   dispose: () => void,
 * }}
 */
export function createAudioEngine() {
	/** @type {AudioContext | null} */
	let ctx = null;
	/** @type {AudioBuffer | null} */
	let noiseBuf = null;
	let bpm = 120;
	/** @type {(MusicPattern|null)[]} */
	let patterns = [];

	/** @type {{ stop: () => void } | null} */
	let musicVoice = null;
	/** Pattern index currently requested for looping music; -1 = stopped. */
	let musicIndex = -1;
	/** @type {({ stop: () => void } | null)[]} */
	const sfxVoices = [null, null, null, null];
	let sfxRound = 0;

	function ensureCtx() {
		const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
		if (!AC) return null;
		if (!ctx) ctx = new AC();
		return ctx;
	}

	async function unlock() {
		const c = ensureCtx();
		if (!c) return;
		if (c.state === "suspended") {
			try {
				await c.resume();
			} catch {
				/* autoplay policy — next gesture will retry */
			}
		}
		if (!noiseBuf) noiseBuf = makeNoiseBuffer(c);
		// Carts often call music() in _init before the first gesture. Start the
		// pending loop once the context is running — but only if nothing is
		// already playing (sfx() also calls unlock and must not restart BGM).
		if (c.state === "running" && musicIndex >= 0 && !musicVoice) {
			const idx = musicIndex;
			playPattern(idx, {
				loop: true,
				onVoice: (v) => {
					musicVoice = v;
				},
			});
		}
	}

	function makeNoiseBuffer(c) {
		const len = c.sampleRate * 0.5;
		const buf = c.createBuffer(1, len, c.sampleRate);
		const data = buf.getChannelData(0);
		let seed = 0xfeed;
		for (let i = 0; i < len; i++) {
			// Cheap LFSR-ish noise — closer to PICO-8 grit than Math.random white.
			seed = (seed * 16807 + 11) & 0xffff;
			data[i] = (seed / 0x8000) - 1;
		}
		return buf;
	}

	/**
	 * @param {AudioContext} c
	 * @param {number} when
	 * @param {number} dur
	 * @param {MusicStep} step
	 * @returns {{ stop: (t?: number) => void }}
	 */
	function scheduleStep(c, when, dur, step) {
		const midi = step.pitch ?? 60;
		const vel = Math.max(0, Math.min(127, step.velocity ?? 90)) / 127;
		const wave = (step.waveform ?? 0) & 255;
		const effect = (step.effect ?? 0) & 7;
		const gate = step.gate != null ? Math.max(0.05, Math.min(1, step.gate)) : 0.9;
		const noteDur = Math.max(0.02, dur * gate);
		const freq = midiToHz(midi);

		const gain = c.createGain();
		gain.connect(c.destination);

		let peak = 0.18 * vel;
		let startGain = peak;
		let endGain = peak * 0.15;

		if (effect === 4) {
			// fade-in
			startGain = 0.001;
			endGain = peak;
		} else if (effect === 5) {
			// fade-out
			startGain = peak;
			endGain = 0.001;
		} else if (effect === 3) {
			endGain = peak * 0.05;
		}

		gain.gain.setValueAtTime(startGain, when);
		gain.gain.exponentialRampToValueAtTime(Math.max(0.001, endGain), when + noteDur);

		/** @type {AudioNode[]} */
		const sources = [];
		const stopAt = when + noteDur + 0.02;

		const startOsc = (type, f, detune = 0) => {
			const osc = c.createOscillator();
			osc.type = type;
			osc.frequency.setValueAtTime(f, when);
			if (detune) osc.detune.setValueAtTime(detune, when);
			if (effect === 3) {
				osc.frequency.exponentialRampToValueAtTime(Math.max(20, f * 0.25), when + noteDur);
			} else if (effect === 2) {
				// vibrato via delayed LFO on detune
				const lfo = c.createOscillator();
				const lfoGain = c.createGain();
				lfo.frequency.value = 6;
				lfoGain.gain.value = 25;
				lfo.connect(lfoGain);
				lfoGain.connect(osc.detune);
				lfo.start(when);
				lfo.stop(stopAt);
				sources.push(lfo);
			}
			osc.connect(gain);
			osc.start(when);
			osc.stop(stopAt);
			sources.push(osc);
			return osc;
		};

		if (wave === WAVE_NOISE) {
			if (!noiseBuf) noiseBuf = makeNoiseBuffer(c);
			const src = c.createBufferSource();
			src.buffer = noiseBuf;
			src.loop = true;
			const filter = c.createBiquadFilter();
			filter.type = "bandpass";
			filter.frequency.setValueAtTime(Math.min(8000, Math.max(80, freq * 2)), when);
			filter.Q.value = 0.7;
			if (effect === 3) {
				filter.frequency.exponentialRampToValueAtTime(80, when + noteDur);
			}
			src.connect(filter);
			filter.connect(gain);
			src.start(when);
			src.stop(stopAt);
			sources.push(src);
		} else if (wave === WAVE_SAW || wave === WAVE_TILT) {
			startOsc("sawtooth", freq);
		} else if (wave === WAVE_SQUARE || wave === WAVE_PULSE) {
			startOsc("square", freq);
		} else if (wave === WAVE_ORGAN) {
			startOsc("triangle", freq);
			startOsc("triangle", freq, 7);
		} else if (wave === WAVE_PHASER) {
			startOsc("triangle", freq);
			startOsc("triangle", freq * 1.01);
		} else {
			// triangle (0) default
			startOsc("triangle", freq);
		}

		return {
			stop(t) {
				const at = t ?? c.currentTime;
				try {
					gain.gain.cancelScheduledValues(at);
					gain.gain.setValueAtTime(Math.max(0.001, gain.gain.value), at);
					gain.gain.exponentialRampToValueAtTime(0.001, at + 0.03);
				} catch {
					/* already stopped */
				}
				for (const s of sources) {
					try {
						s.stop(at + 0.04);
					} catch {
						/* already stopped */
					}
				}
			},
		};
	}

	/**
	 * @param {number} index
	 * @param {{ loop: boolean, offset?: number, onVoice?: (v: { stop: () => void }) => void }} opts
	 */
	function playPattern(index, opts) {
		const c = ensureCtx();
		if (!c || c.state === "suspended") void unlock();
		if (!c) return;
		const pattern = patterns[index];
		if (!pattern || !pattern.steps?.length) return;

		const dur = stepSec(bpm, pattern.stepsPerBeat);
		const steps = pattern.steps;
		let start = Math.max(0, Math.floor(opts.offset ?? 0));
		if (start >= steps.length) start = 0;

		let loopStart = pattern.loopStartStep | 0;
		let loopEnd = pattern.loopEndStep | 0;
		if (opts.loop && loopStart === 0 && loopEnd === 0) {
			loopStart = 0;
			loopEnd = steps.length;
		}

		const voices = [];
		let cancelled = false;
		let timer = 0;
		const t0 = c.currentTime + 0.02;

		const tick = (stepIndex, when) => {
			if (cancelled) return;
			const step = steps[stepIndex];
			if (step?.active) {
				voices.push(scheduleStep(c, when, dur, step));
			}

			let next = stepIndex + 1;
			let looped = false;
			if (opts.loop) {
				const end = loopEnd > 0 ? loopEnd : steps.length;
				if (next >= end) {
					next = loopStart;
					looped = true;
				}
			} else if (next >= steps.length) {
				return;
			}

			const delayMs = Math.max(0, (when + dur - c.currentTime) * 1000 - 8);
			timer = setTimeout(() => {
				if (cancelled) return;
				// Keep scheduling relative to the intended grid so drift stays small.
				const nextWhen = when + dur;
				tick(next, looped && nextWhen < c.currentTime ? c.currentTime + 0.01 : nextWhen);
			}, delayMs);
		};

		tick(start, t0);

		const voice = {
			stop() {
				cancelled = true;
				clearTimeout(timer);
				const now = c.currentTime;
				for (const v of voices) v.stop(now);
				voices.length = 0;
			},
		};
		opts.onVoice?.(voice);
	}

	function stopMusic() {
		musicVoice?.stop();
		musicVoice = null;
	}

	function stopSfx() {
		for (let i = 0; i < sfxVoices.length; i++) {
			sfxVoices[i]?.stop();
			sfxVoices[i] = null;
		}
	}

	function load(doc) {
		bpm = doc?.bpm > 0 ? doc.bpm : 120;
		patterns = Array.isArray(doc?.patterns) ? doc.patterns.slice() : [];
		musicIndex = -1;
		stopMusic();
		stopSfx();
	}

	function sfx(n, channel, offset) {
		const idx = n | 0;
		if (idx < 0) return;
		void unlock();
		let ch = channel;
		if (ch == null || ch < 0 || ch > 3) {
			ch = sfxRound++ & 3;
		} else {
			ch = ch & 3;
		}
		sfxVoices[ch]?.stop();
		sfxVoices[ch] = null;
		playPattern(idx, {
			loop: false,
			offset: offset | 0,
			onVoice: (v) => {
				sfxVoices[ch] = v;
			},
		});
	}

	function music(n) {
		const idx = n | 0;
		stopMusic();
		if (idx < 0) {
			musicIndex = -1;
			return;
		}
		musicIndex = idx;
		// unlock() starts the loop once AudioContext is running (handles the
		// common case where carts call music() in _init before a user gesture).
		void unlock();
	}

	function dispose() {
		stopMusic();
		stopSfx();
		if (ctx) {
			void ctx.close().catch(() => {});
			ctx = null;
		}
		noiseBuf = null;
	}

	return { load, unlock, sfx, music, dispose };
}
