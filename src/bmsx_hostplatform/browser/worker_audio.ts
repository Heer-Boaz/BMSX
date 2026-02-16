import { clamp01 } from 'bmsx/utils/clamp';
import {
	AudioService,
	AudioClipHandle,
	AudioPlaybackParams,
	VoiceHandle,
	VoiceEndedEvent,
	AudioFilterParams,
	SubscriptionHandle,
	createSubscriptionHandle,
} from '../platform';
import { OGG_VORBIS_DECODER_B64 } from './ogg_vorbis_decoder_base64';

const CTRL_READ_PTR = 0;
const CTRL_WRITE_PTR = 1;
const CTRL_UNDERRUNS = 2;
const CTRL_RESERVED = 3;
const CTRL_LENGTH = 4;

const DEFAULT_CAPACITY_FRAMES = 1024;
const DEFAULT_WATERMARK_FRAMES = 256;

const enum WorkerErrorScope {
	General = 'general',
	Decode = 'decode',
	Voice = 'voice',
	Init = 'init',
}

type MainToWorkerMessage =
	| {
		type: 'init';
		sampleRate: number;
		capacityFrames: number;
		watermarkFrames: number;
		ringSampleBuffer: SharedArrayBuffer;
		ringControlBuffer: SharedArrayBuffer;
		contextTimeOriginSec: number;
		crossOriginIsolated: boolean;
		decoderScriptUrl: string;
	}
	| {
		type: 'decode';
		clipId: number;
		bytes: ArrayBuffer;
		formatHint?: 'wav' | 'ogg';
	}
	| {
		type: 'create_pcm_clip';
		clipId: number;
		sampleRate: number;
		channels: number;
		samples: Int16Array;
	}
	| {
		type: 'dispose_clip';
		clipId: number;
	}
	| {
		type: 'createVoice';
		voiceId: number;
		clipId: number;
		startedAtSec: number;
		params: {
			offset: number;
			rate: number;
			gainLinear: number;
			loop: { start: number; end?: number } | null;
			filter: AudioFilterParams | null;
			priority?: number;
		};
	}
	| {
		type: 'voice_set_gain';
		voiceId: number;
		gain: number;
	}
	| {
		type: 'voice_ramp_gain';
		voiceId: number;
		targetGain: number;
		seconds: number;
	}
	| {
		type: 'voice_set_filter';
		voiceId: number;
		filter: AudioFilterParams | null;
	}
	| {
		type: 'voice_set_rate';
		voiceId: number;
		rate: number;
	}
	| {
		type: 'voice_stop';
		voiceId: number;
	}
	| {
		type: 'set_master_gain';
		gain: number;
	}
	| {
		type: 'suspend';
	}
	| {
		type: 'resume';
	};

type WorkerToMainMessage =
	| {
		type: 'init_done';
	}
	| {
		type: 'decoded';
		clipId: number;
		frames: number;
		channels: number;
		sampleRate: number;
		durationSec: number;
	}
	| {
		type: 'voice_ended';
		voiceId: number;
	}
	| {
		type: 'stats';
		fillFrames: number;
		underruns: number;
		voicesActive: number;
		mixTimeMs: number;
	}
	| {
		type: 'error';
		fatal: boolean;
		scope: WorkerErrorScope;
		message: string;
		stack?: string;
		clipId?: number;
		voiceId?: number;
	};

class WorkerClip implements AudioClipHandle {
	private disposed = false;

	constructor(
		private readonly service: WorkerStreamingAudioService,
		public readonly clipId: number,
		public readonly duration: number,
	) { }

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.service.disposeClip(this.clipId);
	}
}

class WorkerVoice implements VoiceHandle {
	private readonly endedListeners = new Set<(event: VoiceEndedEvent) => void>();
	private ended = false;

	constructor(
		private readonly service: WorkerStreamingAudioService,
		readonly voiceId: number,
		readonly startedAt: number,
		readonly startOffset: number,
	) { }

	onEnded(cb: (event: VoiceEndedEvent) => void): SubscriptionHandle {
		this.endedListeners.add(cb);
		return createSubscriptionHandle(() => {
			this.endedListeners.delete(cb);
		});
	}

	setGainLinear(value: number): void {
		this.service.setVoiceGain(this.voiceId, value);
	}

	rampGainLinear(target: number, durationSec: number): void {
		this.service.rampVoiceGain(this.voiceId, target, durationSec);
	}

	setFilter(filter: AudioFilterParams | null): void {
		this.service.setVoiceFilter(this.voiceId, filter);
	}

	setRate(rate: number): void {
		this.service.setVoiceRate(this.voiceId, rate);
	}

	stop(): void {
		this.service.stopVoice(this.voiceId);
	}

	disconnect(): void {
		this.endedListeners.clear();
		this.service.disconnectVoice(this.voiceId);
	}

	markEnded(clippedAt: number): void {
		if (this.ended) {
			return;
		}
		this.ended = true;
		for (const listener of this.endedListeners) {
			listener({ clippedAt });
		}
		this.endedListeners.clear();
	}
}

export class WorkerStreamingAudioService implements AudioService {
	readonly available = true;

	private readonly ctx: AudioContext;
	private readonly worker: Worker;
	private readonly ringSampleBuffer: SharedArrayBuffer;
	private readonly ringControlBuffer: SharedArrayBuffer;
	private readonly capacityFrames: number;
	private readonly watermarkFrames: number;

	private workletNode: AudioWorkletNode | null = null;
	private workletModuleUrl: string;
	private decoderScriptUrl: string;
	private fatalError: Error = null;
	private workerBooted = false;
	private readyPromise: Promise<void>;
	private resolveReady: (() => void) | null = null;
	private rejectReady: ((error: Error) => void) | null = null;
	private pendingMessages: Array<{ message: MainToWorkerMessage; transfer?: Transferable[] }> = [];

	private nextClipId = 1;
	private nextVoiceId = 1;
	private masterGain = 1;
	private readonly decodeResolvers = new Map<number, {
		resolve: (clip: AudioClipHandle) => void;
		reject: (error: Error) => void;
	}>();
	private readonly voices = new Map<number, WorkerVoice>();

	constructor(context?: AudioContext, options?: { capacityFrames?: number; watermarkFrames?: number; }) {
		if (globalThis.crossOriginIsolated !== true) {
			throw new Error('[WorkerStreamingAudioService] SharedArrayBuffer requires crossOriginIsolated=true.');
		}
		if (typeof AudioWorkletNode !== 'function') {
			throw new Error('[WorkerStreamingAudioService] AudioWorkletNode is not available in this runtime.');
		}
		if (typeof Worker !== 'function') {
			throw new Error('[WorkerStreamingAudioService] Worker is not available in this runtime.');
		}

		this.capacityFrames = options?.capacityFrames ?? DEFAULT_CAPACITY_FRAMES;
		this.watermarkFrames = options?.watermarkFrames ?? DEFAULT_WATERMARK_FRAMES;
		if (this.capacityFrames <= 0 || this.watermarkFrames <= 0 || this.watermarkFrames >= this.capacityFrames) {
			throw new Error('[WorkerStreamingAudioService] Invalid ringbuffer sizing.');
		}

		this.ctx = context ?? new AudioContext({ latencyHint: 'interactive' });
		this.ringSampleBuffer = new SharedArrayBuffer(this.capacityFrames * 2 * Float32Array.BYTES_PER_ELEMENT);
		this.ringControlBuffer = new SharedArrayBuffer(CTRL_LENGTH * Int32Array.BYTES_PER_ELEMENT);
		const ringControl = new Int32Array(this.ringControlBuffer);
		ringControl[CTRL_READ_PTR] = 0;
		ringControl[CTRL_WRITE_PTR] = 0;
		ringControl[CTRL_UNDERRUNS] = 0;
		ringControl[CTRL_RESERVED] = 0;

		const ready = new Promise<void>((resolve, reject) => {
			this.resolveReady = resolve;
			this.rejectReady = reject;
		});
		this.readyPromise = ready;

		function workerMain() {
			const CTRL_READ_PTR = 0;
			const CTRL_WRITE_PTR = 1;
			const CTRL_UNDERRUNS = 2;
			const MAX_ACTIVE_VOICES = 128;
			const PCM_SCALE = 1 / 32768;

			/** @type {Float32Array | null} */
			let ringSamples = null;
			/** @type {Int32Array | null} */
			let ringControl = null;
			let capacityFrames = 0;
			let watermarkFrames = 0;
			let outputSampleRate = 0;
			let contextTimeOriginSec = 0;
			let suspended = true;
			let initialized = false;
			let masterGain = 1;
			let pumpScheduled = false;
			let lastUnderruns = 0;
			let lastStatsMs = 0;
			const PUMP_WAIT_TIMEOUT_MS = 12;
			const pumpChannel = new MessageChannel();

			/** @type {Map<number, { sampleRate: number; channels: number; frames: number; pcm: Int16Array; durationSec: number; }>} */
			const clips = new Map();

			/** @type {Map<number, any>} */
			const voices = new Map();

			/** @type {any} */
			let oggDecoder = null;
			let decodeChain = Promise.resolve();

			function clamp(value, min, max) {
				if (value < min) return min;
				if (value > max) return max;
				return value;
			}

			function clamp01(value) {
				return clamp(value, 0, 1);
			}

			function nowMs() {
				return typeof performance !== 'undefined' ? performance.now() : Date.now();
			}

			function postError(error, fatal, scope, extras) {
				const err = error instanceof Error ? error : new Error(String(error));
				self.postMessage({
					type: 'error',
					fatal: !!fatal,
					scope,
					message: err.message,
					stack: err.stack,
					...extras,
				});
			}

			function sendInitDone() {
				self.postMessage({ type: 'init_done' });
			}

			function sendDecoded(clipId, clip) {
				self.postMessage({
					type: 'decoded',
					clipId,
					frames: clip.frames,
					channels: clip.channels,
					sampleRate: clip.sampleRate,
					durationSec: clip.durationSec,
				});
			}

			function sendVoiceEnded(voiceId) {
				self.postMessage({ type: 'voice_ended', voiceId });
			}

			function sendStats(mixTimeMs) {
				if (!initialized || ringControl === null) {
					return;
				}
				const readPtr = Atomics.load(ringControl, CTRL_READ_PTR) >>> 0;
				const writePtr = Atomics.load(ringControl, CTRL_WRITE_PTR) >>> 0;
				const fillFrames = (writePtr - readPtr) >>> 0;
				const underruns = Atomics.load(ringControl, CTRL_UNDERRUNS) >>> 0;
				self.postMessage({
					type: 'stats',
					fillFrames,
					underruns,
					voicesActive: voices.size,
					mixTimeMs,
				});
			}

			function schedulePump() {
				if (!initialized || suspended) {
					return;
				}
				if (pumpScheduled) {
					return;
				}
				pumpScheduled = true;
				pumpChannel.port2.postMessage(0);
			}

			pumpChannel.port1.onmessage = () => {
				pumpScheduled = false;
				try {
					pump();
				} catch (error) {
					postError(error, true, 'general');
				}
			};

			function secToOutputSample(timeSec) {
				const sample = Math.floor((timeSec - contextTimeOriginSec) * outputSampleRate);
				if (sample <= 0) {
					return 0;
				}
				if (sample >= 0xffffffff) {
					return 0xffffffff >>> 0;
				}
				return sample >>> 0;
			}

			function detectFormat(bytes, hint) {
				if (hint === 'wav' || hint === 'ogg') {
					return hint;
				}
				if (bytes.byteLength >= 12) {
					const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
					const a = view.getUint8(0);
					const b = view.getUint8(1);
					const c = view.getUint8(2);
					const d = view.getUint8(3);
					if (a === 0x52 && b === 0x49 && c === 0x46 && d === 0x46) {
						return 'wav';
					}
					if (a === 0x4f && b === 0x67 && c === 0x67 && d === 0x53) {
						return 'ogg';
					}
				}
				throw new Error('[WorkerStreamingAudioService.worker] Unknown audio format; expected WAV or OGG.');
			}

			function readTag(dv, offset) {
				return String.fromCharCode(
					dv.getUint8(offset),
					dv.getUint8(offset + 1),
					dv.getUint8(offset + 2),
					dv.getUint8(offset + 3),
				);
			}

			function decodeWavToPcm(bytes) {
				const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
				if (dv.byteLength < 12) {
					throw new Error('[WorkerStreamingAudioService.worker] WAV data is too small.');
				}
				if (readTag(dv, 0) !== 'RIFF' || readTag(dv, 8) !== 'WAVE') {
					throw new Error('[WorkerStreamingAudioService.worker] Invalid WAV header.');
				}

				let cursor = 12;
				let audioFormat = 0;
				let channels = 0;
				let sampleRate = 0;
				let bitsPerSample = 0;
				let dataOffset = 0;
				let dataLength = 0;

				while (cursor + 8 <= dv.byteLength) {
					const chunkId = readTag(dv, cursor);
					const chunkSize = dv.getUint32(cursor + 4, true);
					cursor += 8;
					const chunkEnd = cursor + chunkSize;
					if (chunkEnd > dv.byteLength) {
						throw new Error('[WorkerStreamingAudioService.worker] Invalid WAV chunk size.');
					}
					if (chunkId === 'fmt ') {
						if (chunkSize < 16) {
							throw new Error('[WorkerStreamingAudioService.worker] Invalid WAV fmt chunk.');
						}
						audioFormat = dv.getUint16(cursor + 0, true);
						channels = dv.getUint16(cursor + 2, true);
						sampleRate = dv.getUint32(cursor + 4, true);
						bitsPerSample = dv.getUint16(cursor + 14, true);
					} else if (chunkId === 'data') {
						dataOffset = cursor;
						dataLength = chunkSize;
					}
					cursor = chunkEnd + (chunkSize & 1);
				}

				if (dataOffset === 0 || dataLength === 0) {
					throw new Error('[WorkerStreamingAudioService.worker] WAV file is missing data chunk.');
				}
				if (audioFormat !== 1 && audioFormat !== 3) {
					throw new Error(`[WorkerStreamingAudioService.worker] Unsupported WAV encoding ${audioFormat}.`);
				}
				if (channels <= 0 || sampleRate <= 0) {
					throw new Error('[WorkerStreamingAudioService.worker] Invalid WAV channels/sampleRate.');
				}
				if (audioFormat === 1 && bitsPerSample !== 16) {
					throw new Error('[WorkerStreamingAudioService.worker] WAV PCM must be 16-bit.');
				}
				if (audioFormat === 3 && bitsPerSample !== 32) {
					throw new Error('[WorkerStreamingAudioService.worker] WAV float must be 32-bit.');
				}

				const bytesPerSample = bitsPerSample / 8;
				const totalSamples = Math.floor(dataLength / bytesPerSample);
				const frames = Math.floor(totalSamples / channels);
				const sampleCount = frames * channels;
				const pcm = new Int16Array(sampleCount);
				let sampleCursor = dataOffset;
				for (let index = 0; index < sampleCount; index += 1) {
					let sample = 0;
					if (audioFormat === 1) {
						sample = dv.getInt16(sampleCursor, true) / 32768;
					} else {
						sample = dv.getFloat32(sampleCursor, true);
					}
					const clamped = clamp(sample, -1, 1);
					const scaled = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
					pcm[index] = clamp(scaled, -32768, 32767);
					sampleCursor += bytesPerSample;
				}

				const durationSec = frames / sampleRate;
				if (!Number.isFinite(durationSec) || durationSec < 0) {
					throw new Error('[WorkerStreamingAudioService.worker] WAV decode produced invalid duration.');
				}

				return {
					pcm,
					channels,
					sampleRate,
					frames,
					durationSec,
				};
			}

			async function ensureOggDecoder() {
				if (oggDecoder !== null) {
					return oggDecoder;
				}
				const api = self['ogg-vorbis-decoder'];
				if (!api || typeof api.OggVorbisDecoder !== 'function') {
					throw new Error('[WorkerStreamingAudioService.worker] OGG decoder script did not expose OggVorbisDecoder.');
				}
				oggDecoder = new api.OggVorbisDecoder();
				await oggDecoder.ready;
				return oggDecoder;
			}

			async function decodeOggToPcm(bytes) {
				const decoder = await ensureOggDecoder();
				const decoded = await decoder.decodeFile(bytes);
				if (!decoded || !Array.isArray(decoded.channelData)) {
					throw new Error('[WorkerStreamingAudioService.worker] OGG decode returned invalid payload.');
				}
				const channels = decoded.channelData.length;
				const sampleRate = decoded.sampleRate;
				const frames = decoded.samplesDecoded;
				if (channels <= 0 || sampleRate <= 0 || frames < 0) {
					throw new Error('[WorkerStreamingAudioService.worker] OGG decode returned invalid format metadata.');
				}

				const pcm = new Int16Array(frames * channels);
				let cursor = 0;
				for (let frame = 0; frame < frames; frame += 1) {
					for (let channel = 0; channel < channels; channel += 1) {
						const source = decoded.channelData[channel];
						const sample = source ? source[frame] : 0;
						const clamped = clamp(sample, -1, 1);
						const scaled = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
						pcm[cursor] = clamp(scaled, -32768, 32767);
						cursor += 1;
					}
				}

				await decoder.reset();
				const durationSec = frames / sampleRate;
				if (!Number.isFinite(durationSec) || durationSec < 0) {
					throw new Error('[WorkerStreamingAudioService.worker] OGG decode produced invalid duration.');
				}

				return {
					pcm,
					channels,
					sampleRate,
					frames,
					durationSec,
				};
			}

			async function decodeClip(clipId, bytes, formatHint) {
				const input = new Uint8Array(bytes);
				const format = detectFormat(input, formatHint);
				let decoded;
				if (format === 'wav') {
					decoded = decodeWavToPcm(input);
				} else if (format === 'ogg') {
					decoded = await decodeOggToPcm(input);
				} else {
					throw new Error(`[WorkerStreamingAudioService.worker] Unsupported format '${format}'.`);
				}
				clips.set(clipId, decoded);
				sendDecoded(clipId, decoded);
			}

			function createPcmClip(clipId, sampleRate, channels, samples) {
				if (sampleRate <= 0 || channels <= 0) {
					throw new Error('[WorkerStreamingAudioService.worker] Invalid PCM clip metadata.');
				}
				const frames = Math.floor(samples.length / channels);
				if (frames <= 0) {
					throw new Error('[WorkerStreamingAudioService.worker] PCM clip has no frames.');
				}
				const clip = {
					pcm: samples,
					channels,
					sampleRate,
					frames,
					durationSec: frames / sampleRate,
				};
				clips.set(clipId, clip);
			}

			function endVoice(voiceId) {
				if (!voices.has(voiceId)) {
					return;
				}
				voices.delete(voiceId);
				sendVoiceEnded(voiceId);
			}

			function disposeClip(clipId) {
				if (!clips.has(clipId)) {
					return;
				}
				clips.delete(clipId);
				for (const [voiceId, voice] of voices) {
					if (voice.clipId === clipId) {
						voices.delete(voiceId);
						sendVoiceEnded(voiceId);
					}
				}
			}

			function configureVoiceRate(voice, rate) {
				if (!Number.isFinite(rate) || rate <= 0) {
					throw new Error('[WorkerStreamingAudioService.worker] Playback rate must be a positive finite number.');
				}
				voice.rate = rate;
				voice.step = (voice.clip.sampleRate / outputSampleRate) * rate;
			}

			function computeBiquad(type, frequency, q, gain, sampleRate) {
				const nyquist = sampleRate * 0.5;
				const f = clamp(frequency, 1, nyquist - 1);
				const qSafe = q > 0 ? q : 0.0001;
				const gainSafe = Number.isFinite(gain) ? gain : 0;
				const w0 = (2 * Math.PI * f) / sampleRate;
				const cosW0 = Math.cos(w0);
				const sinW0 = Math.sin(w0);
				const alpha = sinW0 / (2 * qSafe);
				const A = Math.pow(10, gainSafe / 40);

				let b0 = 0;
				let b1 = 0;
				let b2 = 0;
				let a0 = 1;
				let a1 = 0;
				let a2 = 0;

				switch (type) {
					case 'lowpass':
						b0 = (1 - cosW0) * 0.5;
						b1 = 1 - cosW0;
						b2 = (1 - cosW0) * 0.5;
						a0 = 1 + alpha;
						a1 = -2 * cosW0;
						a2 = 1 - alpha;
						break;
					case 'highpass':
						b0 = (1 + cosW0) * 0.5;
						b1 = -(1 + cosW0);
						b2 = (1 + cosW0) * 0.5;
						a0 = 1 + alpha;
						a1 = -2 * cosW0;
						a2 = 1 - alpha;
						break;
					case 'bandpass':
						b0 = alpha;
						b1 = 0;
						b2 = -alpha;
						a0 = 1 + alpha;
						a1 = -2 * cosW0;
						a2 = 1 - alpha;
						break;
					case 'notch':
						b0 = 1;
						b1 = -2 * cosW0;
						b2 = 1;
						a0 = 1 + alpha;
						a1 = -2 * cosW0;
						a2 = 1 - alpha;
						break;
					case 'allpass':
						b0 = 1 - alpha;
						b1 = -2 * cosW0;
						b2 = 1 + alpha;
						a0 = 1 + alpha;
						a1 = -2 * cosW0;
						a2 = 1 - alpha;
						break;
					case 'peaking':
						b0 = 1 + alpha * A;
						b1 = -2 * cosW0;
						b2 = 1 - alpha * A;
						a0 = 1 + alpha / A;
						a1 = -2 * cosW0;
						a2 = 1 - alpha / A;
						break;
					case 'lowshelf': {
						const sqrtA = Math.sqrt(A);
						const twoSqrtAAlpha = 2 * sqrtA * alpha;
						b0 = A * ((A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha);
						b1 = 2 * A * ((A - 1) - (A + 1) * cosW0);
						b2 = A * ((A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha);
						a0 = (A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha;
						a1 = -2 * ((A - 1) + (A + 1) * cosW0);
						a2 = (A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha;
						break;
					}
					case 'highshelf': {
						const sqrtA = Math.sqrt(A);
						const twoSqrtAAlpha = 2 * sqrtA * alpha;
						b0 = A * ((A + 1) + (A - 1) * cosW0 + twoSqrtAAlpha);
						b1 = -2 * A * ((A - 1) + (A + 1) * cosW0);
						b2 = A * ((A + 1) + (A - 1) * cosW0 - twoSqrtAAlpha);
						a0 = (A + 1) - (A - 1) * cosW0 + twoSqrtAAlpha;
						a1 = 2 * ((A - 1) - (A + 1) * cosW0);
						a2 = (A + 1) - (A - 1) * cosW0 - twoSqrtAAlpha;
						break;
					}
					default:
						throw new Error(`[WorkerStreamingAudioService.worker] Unsupported filter type '${type}'.`);
				}

				if (a0 === 0) {
					throw new Error('[WorkerStreamingAudioService.worker] Biquad normalization denominator is zero.');
				}

				return {
					b0: b0 / a0,
					b1: b1 / a0,
					b2: b2 / a0,
					a1: a1 / a0,
					a2: a2 / a0,
				};
			}

			function setVoiceFilter(voice, filter) {
				if (filter === null) {
					voice.filterEnabled = false;
					voice.filter = null;
					voice.z1L = 0;
					voice.z2L = 0;
					voice.z1R = 0;
					voice.z2R = 0;
					return;
				}

				const coeff = computeBiquad(
					filter.type,
					filter.frequency,
					filter.q,
					filter.gain,
					outputSampleRate,
				);
				voice.filterEnabled = true;
				voice.filter = {
					type: filter.type,
					frequency: filter.frequency,
					q: filter.q,
					gain: filter.gain,
					...coeff,
				};
				voice.z1L = 0;
				voice.z2L = 0;
				voice.z1R = 0;
				voice.z2R = 0;
			}

			function applyVoiceFilter(voice, left, right) {
				if (!voice.filterEnabled || !voice.filter) {
					return [left, right];
				}
				const coeff = voice.filter;

				const yL = coeff.b0 * left + voice.z1L;
				voice.z1L = coeff.b1 * left - coeff.a1 * yL + voice.z2L;
				voice.z2L = coeff.b2 * left - coeff.a2 * yL;

				const yR = coeff.b0 * right + voice.z1R;
				voice.z1R = coeff.b1 * right - coeff.a1 * yR + voice.z2R;
				voice.z2R = coeff.b2 * right - coeff.a2 * yR;

				return [yL, yR];
			}

			function wrapLoopPosition(position, loopStartFrames, loopEndFrames) {
				const loopLength = loopEndFrames - loopStartFrames;
				if (loopLength <= 0) {
					return loopStartFrames;
				}
				if (position >= loopEndFrames || position < loopStartFrames) {
					let wrapped = (position - loopStartFrames) % loopLength;
					if (wrapped < 0) {
						wrapped += loopLength;
					}
					return loopStartFrames + wrapped;
				}
				return position;
			}

			function readClipSample(clip, frameIndex, channelIndex) {
				if (frameIndex < 0 || frameIndex >= clip.frames) {
					return 0;
				}
				const sampleIndex = frameIndex * clip.channels + channelIndex;
				return clip.pcm[sampleIndex] * PCM_SCALE;
			}

			function sampleVoiceAtPosition(voice) {
				let position = voice.position;
				const clip = voice.clip;
				if (voice.loopEnabled) {
					position = wrapLoopPosition(position, voice.loopStartFrames, voice.loopEndFrames);
					voice.position = position;
				}
				if (!voice.loopEnabled && position >= clip.frames) {
					return null;
				}

				const channels = clip.channels;
				const idx0 = Math.floor(position);
				const frac = position - idx0;
				let pos1 = position + 1;
				if (voice.loopEnabled && pos1 >= voice.loopEndFrames) {
					pos1 = wrapLoopPosition(pos1, voice.loopStartFrames, voice.loopEndFrames);
				}
				const idx1 = Math.floor(pos1);

				const left0 = readClipSample(clip, idx0, 0);
				const left1 = readClipSample(clip, idx1, 0);
				const left = left0 + (left1 - left0) * frac;

				if (channels === 1) {
					return [left, left];
				}
				const right0 = readClipSample(clip, idx0, 1);
				const right1 = readClipSample(clip, idx1, 1);
				const right = right0 + (right1 - right0) * frac;
				return [left, right];
			}

			function createVoice(msg) {
				if (!clips.has(msg.clipId)) {
					throw new Error(`[WorkerStreamingAudioService.worker] Unknown clip ${msg.clipId} for voice ${msg.voiceId}.`);
				}
				if (voices.size >= MAX_ACTIVE_VOICES) {
					let candidateId = -1;
					let candidatePriority = Infinity;
					let candidateStart = Infinity;
					for (const [voiceId, voice] of voices) {
						if (voice.priority < candidatePriority || (voice.priority === candidatePriority && voice.startSampleCounter < candidateStart)) {
							candidatePriority = voice.priority;
							candidateStart = voice.startSampleCounter;
							candidateId = voiceId;
						}
					}
					if (candidateId !== -1) {
						endVoice(candidateId);
					}
				}

				const clip = clips.get(msg.clipId);
				const loop = msg.params.loop;
				const loopEnabled = loop !== null;
				const loopStartFrames = loopEnabled ? clamp(loop.start * clip.sampleRate, 0, clip.frames) : 0;
				const loopEndFrames = loopEnabled
					? clamp((loop.end !== undefined ? loop.end : clip.durationSec) * clip.sampleRate, 0, clip.frames)
					: clip.frames;
				if (loopEnabled && loopEndFrames <= loopStartFrames) {
					throw new Error('[WorkerStreamingAudioService.worker] Invalid loop range.');
				}
				let initialPosition = msg.params.offset * clip.sampleRate;
				if (loopEnabled) {
					initialPosition = wrapLoopPosition(initialPosition, loopStartFrames, loopEndFrames);
				}
				const requestedStartSampleCounter = secToOutputSample(msg.startedAtSec);
				const writePtrNow = Atomics.load(ringControl, CTRL_WRITE_PTR) >>> 0;
				const startSampleCounter = requestedStartSampleCounter > writePtrNow ? requestedStartSampleCounter : writePtrNow;

				const voice = {
					voiceId: msg.voiceId,
					clipId: msg.clipId,
					clip,
					priority: msg.params.priority ?? 0,
					started: false,
					startSampleCounter,
					nextSampleCounter: startSampleCounter,
					startOffsetFrames: initialPosition,
					position: initialPosition,
					rate: msg.params.rate,
					step: 0,
					gain: clamp01(msg.params.gainLinear),
					targetGain: clamp01(msg.params.gainLinear),
					gainRampRemainingFrames: 0,
					gainRampDelta: 0,
					loopEnabled,
					loopStartFrames,
					loopEndFrames,
					stopAfterSampleCounter: null,
					filterEnabled: false,
					filter: null,
					z1L: 0,
					z2L: 0,
					z1R: 0,
					z2R: 0,
				};

				configureVoiceRate(voice, msg.params.rate);
				setVoiceFilter(voice, msg.params.filter);
				voices.set(msg.voiceId, voice);
			}

			function setVoiceGain(voiceId, gain) {
				const voice = voices.get(voiceId);
				if (!voice) {
					return;
				}
				const g = clamp01(gain);
				voice.gain = g;
				voice.targetGain = g;
				voice.gainRampRemainingFrames = 0;
				voice.gainRampDelta = 0;
			}

			function rampVoiceGain(voiceId, targetGain, seconds) {
				const voice = voices.get(voiceId);
				if (!voice) {
					return;
				}
				const target = clamp01(targetGain);
				const frames = Math.max(1, Math.floor(seconds * outputSampleRate));
				voice.targetGain = target;
				voice.gainRampRemainingFrames = frames;
				voice.gainRampDelta = (target - voice.gain) / frames;
			}

			function setVoiceRate(voiceId, rate) {
				const voice = voices.get(voiceId);
				if (!voice) {
					return;
				}
				configureVoiceRate(voice, rate);
			}

			function stopVoice(voiceId) {
				endVoice(voiceId);
			}

			function mixAndWrite(framesRequested) {
				if (ringControl === null || ringSamples === null) {
					return 0;
				}
				const readPtr = Atomics.load(ringControl, CTRL_READ_PTR) >>> 0;
				const writePtr = Atomics.load(ringControl, CTRL_WRITE_PTR) >>> 0;
				const fill = (writePtr - readPtr) >>> 0;
				const free = capacityFrames - fill;
				if (free <= 0) {
					return 0;
				}
				const framesToWrite = framesRequested > free ? free : framesRequested;
				const endedVoices = [];

				for (let frame = 0; frame < framesToWrite; frame += 1) {
					const absoluteFrame = (writePtr + frame) >>> 0;
					let mixedL = 0;
					let mixedR = 0;

					for (const [voiceId, voice] of voices) {
						if (voice.stopAfterSampleCounter !== null && absoluteFrame >= voice.stopAfterSampleCounter) {
							endedVoices.push(voiceId);
							continue;
						}
						if (absoluteFrame < voice.nextSampleCounter) {
							continue;
						}
						if (!voice.started) {
							voice.started = true;
						}
						if (absoluteFrame > voice.nextSampleCounter) {
							const delta = absoluteFrame - voice.nextSampleCounter;
							voice.position += delta * voice.step;
							voice.nextSampleCounter = absoluteFrame;
						}

						if (voice.loopEnabled && voice.position >= voice.loopEndFrames) {
							voice.position = wrapLoopPosition(voice.position, voice.loopStartFrames, voice.loopEndFrames);
						}
						if (!voice.loopEnabled && voice.position >= voice.clip.frames) {
							endedVoices.push(voiceId);
							continue;
						}

						const sampled = sampleVoiceAtPosition(voice);
						if (sampled === null) {
							endedVoices.push(voiceId);
							continue;
						}

						let left = sampled[0] * voice.gain;
						let right = sampled[1] * voice.gain;
						if (voice.filterEnabled) {
							const filtered = applyVoiceFilter(voice, left, right);
							left = filtered[0];
							right = filtered[1];
						}

						mixedL += left;
						mixedR += right;

						if (voice.gainRampRemainingFrames > 0) {
							voice.gain += voice.gainRampDelta;
							voice.gainRampRemainingFrames -= 1;
							if (voice.gainRampRemainingFrames === 0) {
								voice.gain = voice.targetGain;
								voice.gainRampDelta = 0;
							}
						}

						voice.position += voice.step;
						voice.nextSampleCounter = (absoluteFrame + 1) >>> 0;
					}

					mixedL = clamp(mixedL * masterGain, -1, 1);
					mixedR = clamp(mixedR * masterGain, -1, 1);
					const dst = ((writePtr + frame) % capacityFrames) * 2;
					ringSamples[dst] = mixedL;
					ringSamples[dst + 1] = mixedR;
				}

				Atomics.store(ringControl, CTRL_WRITE_PTR, ((writePtr + framesToWrite) >>> 0) | 0);
				for (let index = 0; index < endedVoices.length; index += 1) {
					endVoice(endedVoices[index]);
				}
				return framesToWrite;
			}

			function pump() {
				if (!initialized || suspended) {
					return;
				}
				const startMs = nowMs();
				for (let iteration = 0; iteration < 8; iteration += 1) {
					const readPtr = Atomics.load(ringControl, CTRL_READ_PTR) >>> 0;
					const writePtr = Atomics.load(ringControl, CTRL_WRITE_PTR) >>> 0;
					const fill = (writePtr - readPtr) >>> 0;
					if (fill >= watermarkFrames) {
						break;
					}
					const deficit = watermarkFrames - fill;
					const frameChunk = clamp(deficit, 256, 1024);
					const written = mixAndWrite(frameChunk);
					if (written <= 0) {
						break;
					}
				}
				const mixTimeMs = nowMs() - startMs;
				const underruns = Atomics.load(ringControl, CTRL_UNDERRUNS) >>> 0;
				const now = nowMs();
				if (underruns !== lastUnderruns || (now - lastStatsMs) >= 500) {
					lastUnderruns = underruns;
					lastStatsMs = now;
					sendStats(mixTimeMs);
				}
				if (!suspended) {
					const readPtr = Atomics.load(ringControl, CTRL_READ_PTR) >>> 0;
					const writePtr = Atomics.load(ringControl, CTRL_WRITE_PTR) >>> 0;
					const fill = (writePtr - readPtr) >>> 0;
					if (fill >= watermarkFrames) {
						Atomics.wait(ringControl, CTRL_READ_PTR, readPtr | 0, PUMP_WAIT_TIMEOUT_MS);
					}
					schedulePump();
				}
			}

			function handleInit(message) {
				if (!message.crossOriginIsolated || self.crossOriginIsolated !== true) {
					throw new Error('[WorkerStreamingAudioService.worker] crossOriginIsolated must be true for SharedArrayBuffer audio backend.');
				}
				if (!message.decoderScriptUrl) {
					throw new Error('[WorkerStreamingAudioService.worker] Missing decoder script URL.');
				}
				importScripts(message.decoderScriptUrl);
				ringSamples = new Float32Array(message.ringSampleBuffer);
				ringControl = new Int32Array(message.ringControlBuffer);
				capacityFrames = message.capacityFrames;
				watermarkFrames = message.watermarkFrames;
				outputSampleRate = message.sampleRate;
				contextTimeOriginSec = message.contextTimeOriginSec;
				masterGain = 1;
				suspended = true;
				initialized = true;
				sendInitDone();
			}

			self.onmessage = (event) => {
				const message = event.data;
				const typed = message;
				if (!typed || typeof typed.type !== 'string') {
					return;
				}

				if (typed.type !== 'init' && !initialized) {
					postError(new Error('[WorkerStreamingAudioService.worker] Received command before init.'), true, 'init');
					return;
				}

				try {
					switch (typed.type) {
						case 'init':
							handleInit(typed);
							break;
						case 'decode':
							decodeChain = decodeChain
								.then(() => decodeClip(typed.clipId, typed.bytes, typed.formatHint))
								.catch((error) => {
									postError(error, false, 'decode', { clipId: typed.clipId });
								});
							break;
						case 'create_pcm_clip':
							createPcmClip(typed.clipId, typed.sampleRate, typed.channels, typed.samples);
							break;
						case 'dispose_clip':
							disposeClip(typed.clipId);
							break;
						case 'createVoice':
							createVoice(typed);
							schedulePump();
							break;
						case 'voice_set_gain':
							setVoiceGain(typed.voiceId, typed.gain);
							break;
						case 'voice_ramp_gain':
							rampVoiceGain(typed.voiceId, typed.targetGain, typed.seconds);
							break;
						case 'voice_set_filter': {
							const voice = voices.get(typed.voiceId);
							if (voice) {
								setVoiceFilter(voice, typed.filter);
							}
							break;
						}
						case 'voice_set_rate':
							setVoiceRate(typed.voiceId, typed.rate);
							break;
						case 'voice_stop':
							stopVoice(typed.voiceId);
							break;
						case 'set_master_gain':
							masterGain = clamp01(typed.gain);
							break;
						case 'suspend':
							suspended = true;
							break;
						case 'resume':
							suspended = false;
							schedulePump();
							break;
						default:
							throw new Error(`[WorkerStreamingAudioService.worker] Unsupported command '${typed.type}'.`);
					}
				} catch (error) {
					const extras = typed.type === 'decode'
						? { clipId: typed.clipId }
						: typed.type.startsWith('voice') || typed.type === 'createVoice'
							? { voiceId: typed.voiceId }
							: undefined;
					postError(error, true, extras?.clipId !== undefined ? 'decode' : extras?.voiceId !== undefined ? 'voice' : 'general', extras);
				}
			};
		}

		const workerCode = `
const __defProp = Object.defineProperty;
const __name = (value, name) => __defProp(value, 'name', { value: name, configurable: true });
const s = __name;
(${workerMain.toString()})()
`;
		this.worker = new Worker(URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' })));
		this.worker.onmessage = this.handleWorkerMessage;
		this.worker.onerror = (event: ErrorEvent) => {
			this.handleFatal(new Error(`[WorkerStreamingAudioService] Worker crashed: ${event.message}`));
		};

		void this.initialize();
	}

	private async initialize(): Promise<void> {
		try {
			this.decoderScriptUrl = this.createDecoderScriptBlobUrl();
			this.workletModuleUrl = this.createWorkletModuleBlobUrl();
			await this.ctx.audioWorklet.addModule(this.workletModuleUrl);
			this.workletNode = new AudioWorkletNode(this.ctx, 'bmsx-worker-stream-out', {
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [2],
				channelCount: 2,
				channelCountMode: 'explicit',
				processorOptions: {
					sampleBuffer: this.ringSampleBuffer,
					controlBuffer: this.ringControlBuffer,
					capacityFrames: this.capacityFrames,
				},
			});
			this.workletNode.connect(this.ctx.destination);

			this.postOrQueueMessage({
				type: 'init',
				sampleRate: this.ctx.sampleRate,
				capacityFrames: this.capacityFrames,
				watermarkFrames: this.watermarkFrames,
				ringSampleBuffer: this.ringSampleBuffer,
				ringControlBuffer: this.ringControlBuffer,
				contextTimeOriginSec: this.ctx.currentTime,
				crossOriginIsolated: globalThis.crossOriginIsolated === true,
				decoderScriptUrl: this.decoderScriptUrl,
			});
		} catch (error) {
			this.handleFatal(error instanceof Error ? error : new Error(String(error)));
		}
	}

	private createDecoderScriptBlobUrl(): string {
		const binary = atob(OGG_VORBIS_DECODER_B64);
		const bytes = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			bytes[index] = binary.charCodeAt(index);
		}
		const blob = new Blob([bytes], { type: 'text/javascript' });
		return URL.createObjectURL(blob);
	}

	private createWorkletModuleBlobUrl(): string {
		const code = `
const CTRL_READ_PTR = 0;
const CTRL_WRITE_PTR = 1;
const CTRL_UNDERRUNS = 2;

class BmsxWorkerStreamOut extends AudioWorkletProcessor {
	constructor(options) {
		super();
		const processorOptions = options.processorOptions;
		this.samples = new Float32Array(processorOptions.sampleBuffer);
		this.control = new Int32Array(processorOptions.controlBuffer);
		this.capacityFrames = processorOptions.capacityFrames;
	}

	process(_inputs, outputs) {
		const output = outputs[0];
		if (!output || output.length === 0) {
			return true;
		}
		const left = output[0];
		const right = output.length > 1 ? output[1] : output[0];
		const frameCount = left.length;
		let readPtr = Atomics.load(this.control, CTRL_READ_PTR) >>> 0;
		const writePtr = Atomics.load(this.control, CTRL_WRITE_PTR) >>> 0;
		let available = (writePtr - readPtr) >>> 0;
		if (available < frameCount) {
			Atomics.add(this.control, CTRL_UNDERRUNS, 1);
		}

		for (let frame = 0; frame < frameCount; frame += 1) {
			if (available > 0) {
				const src = (readPtr % this.capacityFrames) * 2;
				left[frame] = this.samples[src];
				right[frame] = this.samples[src + 1];
				readPtr = (readPtr + 1) >>> 0;
				available -= 1;
			} else {
				left[frame] = 0;
				right[frame] = 0;
			}
		}

		Atomics.store(this.control, CTRL_READ_PTR, readPtr | 0);
		return true;
	}
}

registerProcessor('bmsx-worker-stream-out', BmsxWorkerStreamOut);
`;
		return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
	}

	private flushPendingMessages(): void {
		if (!this.workerBooted) {
			return;
		}
		for (let index = 0; index < this.pendingMessages.length; index += 1) {
			const entry = this.pendingMessages[index];
			if (entry.transfer && entry.transfer.length > 0) {
				this.worker.postMessage(entry.message, entry.transfer);
			} else {
				this.worker.postMessage(entry.message);
			}
		}
		this.pendingMessages.length = 0;
	}

	private postOrQueueMessage(message: MainToWorkerMessage, transfer?: Transferable[]): void {
		if (this.fatalError !== null) {
			throw this.fatalError;
		}
		if (!this.workerBooted && message.type !== 'init') {
			this.pendingMessages.push({ message, transfer });
			return;
		}
		if (message.type === 'init' && this.workerBooted) {
			throw new Error('[WorkerStreamingAudioService] Worker is already initialized.');
		}
		if (transfer && transfer.length > 0) {
			this.worker.postMessage(message, transfer);
		} else {
			this.worker.postMessage(message);
		}
	}

	private handleWorkerMessage = (event: MessageEvent<WorkerToMainMessage>) => {
		const message = event.data;
		if (!message || typeof message.type !== 'string') {
			return;
		}

		switch (message.type) {
			case 'init_done':
				this.workerBooted = true;
				this.flushPendingMessages();
				if (this.workletModuleUrl) {
					URL.revokeObjectURL(this.workletModuleUrl);
					this.workletModuleUrl = '';
				}
				if (this.decoderScriptUrl) {
					URL.revokeObjectURL(this.decoderScriptUrl);
					this.decoderScriptUrl = '';
				}
				if (this.resolveReady !== null) {
					this.resolveReady();
					this.resolveReady = null;
					this.rejectReady = null;
				}
				break;
			case 'decoded': {
				const resolver = this.decodeResolvers.get(message.clipId);
				if (!resolver) {
					return;
				}
				this.decodeResolvers.delete(message.clipId);
				if (!Number.isFinite(message.durationSec) || Number.isNaN(message.durationSec) || message.durationSec < 0) {
					resolver.reject(new Error(`[WorkerStreamingAudioService] Worker returned invalid duration for clip ${message.clipId}.`));
					return;
				}
				resolver.resolve(new WorkerClip(this, message.clipId, message.durationSec));
				break;
			}
			case 'voice_ended': {
				const voice = this.voices.get(message.voiceId);
				if (!voice) {
					return;
				}
				this.voices.delete(message.voiceId);
				voice.markEnded(this.ctx.currentTime);
				break;
			}
			case 'stats':
				break;
			case 'error': {
				const error = new Error(message.message);
				error.stack = message.stack;
				if (message.scope === WorkerErrorScope.Decode && message.clipId !== undefined) {
					const resolver = this.decodeResolvers.get(message.clipId);
					if (resolver) {
						this.decodeResolvers.delete(message.clipId);
						resolver.reject(error);
					}
					if (message.fatal) {
						this.handleFatal(error);
					}
					return;
				}
				if (message.fatal) {
					this.handleFatal(error);
				}
				break;
			}
		}
	};

	private handleFatal(error: Error): void {
		if (this.fatalError !== null) {
			return;
		}
		this.fatalError = error;
		if (this.rejectReady !== null) {
			this.rejectReady(error);
			this.resolveReady = null;
			this.rejectReady = null;
		}
		for (const resolver of this.decodeResolvers.values()) {
			resolver.reject(error);
		}
		this.decodeResolvers.clear();
		throw error;
	}

	private ensureHealthy(): void {
		if (this.fatalError !== null) {
			throw this.fatalError;
		}
	}

	private async ensureReady(): Promise<void> {
		this.ensureHealthy();
		await this.readyPromise;
		this.ensureHealthy();
		if (this.workletNode === null) {
			throw new Error('[WorkerStreamingAudioService] AudioWorkletNode initialization failed.');
		}
	}

	currentTime(): number {
		return this.ctx.currentTime;
	}

	async resume(): Promise<void> {
		await this.ensureReady();
		if (this.ctx.state !== 'running') {
			await this.ctx.resume();
		}
		this.postOrQueueMessage({ type: 'resume' });
	}

	async suspend(): Promise<void> {
		await this.ensureReady();
		this.postOrQueueMessage({ type: 'suspend' });
		if (this.ctx.state === 'running') {
			await this.ctx.suspend();
		}
	}

	getMasterGain(): number {
		return this.masterGain;
	}

	setMasterGain(value: number): void {
		const gain = clamp01(value);
		this.masterGain = gain;
		this.postOrQueueMessage({ type: 'set_master_gain', gain });
	}

	async decode(bytes: ArrayBuffer): Promise<AudioClipHandle> {
		await this.ensureReady();
		this.ensureHealthy();
		const clipId = this.nextClipId++;
		return new Promise<AudioClipHandle>((resolve, reject) => {
			this.decodeResolvers.set(clipId, { resolve, reject });
			this.postOrQueueMessage({
				type: 'decode',
				clipId,
				bytes,
			}, [bytes]);
		});
	}

	createClipFromPcm(samples: Int16Array, sampleRate: number, channels: number): AudioClipHandle {
		if (channels <= 0) {
			throw new Error('[WorkerStreamingAudioService] Invalid PCM channel count.');
		}
		if (sampleRate <= 0) {
			throw new Error('[WorkerStreamingAudioService] Invalid PCM sample rate.');
		}
		const frames = Math.floor(samples.length / channels);
		if (frames <= 0) {
			throw new Error('[WorkerStreamingAudioService] PCM clip has no audio frames.');
		}
		const clipId = this.nextClipId++;
		const copy = new Int16Array(frames * channels);
		copy.set(samples.subarray(0, frames * channels));
		const duration = frames / sampleRate;
		this.postOrQueueMessage({
			type: 'create_pcm_clip',
			clipId,
			sampleRate,
			channels,
			samples: copy,
		}, [copy.buffer]);
		return new WorkerClip(this, clipId, duration);
	}

	private getQueuedSeconds(): number {
		const control = new Int32Array(this.ringControlBuffer);
		const readPtr = Atomics.load(control, CTRL_READ_PTR) >>> 0;
		const writePtr = Atomics.load(control, CTRL_WRITE_PTR) >>> 0;
		const fillFrames = (writePtr - readPtr) >>> 0;
		return fillFrames / this.ctx.sampleRate;
	}

	createVoice(clip: AudioClipHandle, params: AudioPlaybackParams): VoiceHandle {
		if (!(clip instanceof WorkerClip)) {
			throw new Error('[WorkerStreamingAudioService] Unsupported clip handle.');
		}
		const voiceId = this.nextVoiceId++;
		const startedAt = this.ctx.currentTime + this.getQueuedSeconds();
		const voice = new WorkerVoice(this, voiceId, startedAt, params.offset);
		this.voices.set(voiceId, voice);
		this.postOrQueueMessage({
			type: 'createVoice',
			voiceId,
			clipId: clip.clipId,
			startedAtSec: startedAt,
			params: {
				offset: params.offset,
				rate: params.rate,
				gainLinear: params.gainLinear,
				loop: params.loop,
				filter: params.filter,
			},
		});
		return voice;
	}

	disposeClip(clipId: number): void {
		this.postOrQueueMessage({ type: 'dispose_clip', clipId });
	}

	setVoiceGain(voiceId: number, gain: number): void {
		this.postOrQueueMessage({ type: 'voice_set_gain', voiceId, gain: clamp01(gain) });
	}

	rampVoiceGain(voiceId: number, targetGain: number, seconds: number): void {
		this.postOrQueueMessage({
			type: 'voice_ramp_gain',
			voiceId,
			targetGain: clamp01(targetGain),
			seconds: seconds > 0 ? seconds : 1 / this.ctx.sampleRate,
		});
	}

	setVoiceFilter(voiceId: number, filter: AudioFilterParams | null): void {
		this.postOrQueueMessage({ type: 'voice_set_filter', voiceId, filter });
	}

	setVoiceRate(voiceId: number, rate: number): void {
		this.postOrQueueMessage({ type: 'voice_set_rate', voiceId, rate });
	}

	stopVoice(voiceId: number): void {
		this.postOrQueueMessage({ type: 'voice_stop', voiceId });
	}

	disconnectVoice(voiceId: number): void {
		this.voices.delete(voiceId);
	}
}
