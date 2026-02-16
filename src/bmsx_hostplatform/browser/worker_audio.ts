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

const CORE_CTRL_READ_PTR = 0;
const CORE_CTRL_WRITE_PTR = 1;
const CORE_CTRL_OVERRUNS = 2;
const CORE_CTRL_UNDERRUNS = 3;
const CORE_CTRL_LENGTH = 4;

const DEFAULT_CAPACITY_FRAMES = 16384;

const enum WorkerErrorScope {
	General = 'general',
	Decode = 'decode',
	Voice = 'voice',
	Init = 'init',
}

export interface WorkerStreamingAudioOptions {
	capacityFrames?: number;
	frameTimeSec?: number;
}

type MainToWorkerMessage =
	| {
		type: 'init';
		sampleRate: number;
		capacityFrames: number;
		frameTimeSec: number;
		ringSampleBuffer: SharedArrayBuffer;
		ringControlBuffer: SharedArrayBuffer;
		coreStreamCapacityFrames: number;
		coreStreamSamplesBuffer: SharedArrayBuffer;
		coreStreamControlBuffer: SharedArrayBuffer;
		crossOriginIsolated: boolean;
		decoderScriptUrl: string;
	}
	| {
		type: 'set_frame_time';
		frameTimeSec: number;
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
		type: 'create_voice';
		voiceId: number;
		clipId: number;
		params: {
			offset: number;
			rate: number;
			gainLinear: number;
			loop: { start: number; end?: number } | null;
			filter: AudioFilterParams | null;
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

class WorkerCoreStreamClip implements AudioClipHandle {
	readonly duration = 0;
	dispose(): void { }
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

	setFilter(filter: AudioFilterParams): void {
		this.service.setVoiceFilter(this.voiceId, filter ?? null);
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

class WorkerCoreStreamVoice implements VoiceHandle {
	readonly startedAt = 0;
	readonly startOffset = 0;
	onEnded(_cb: (event: VoiceEndedEvent) => void): SubscriptionHandle {
		return createSubscriptionHandle(() => { });
	}
	setGainLinear(_value: number): void { }
	rampGainLinear(_target: number, _durationSec: number): void { }
	setFilter(_filter: AudioFilterParams): void { }
	setRate(_rate: number): void { }
	stop(): void { }
	disconnect(): void { }
}

export class WorkerStreamingAudioService implements AudioService {
	readonly available = true;

	private readonly ctx: AudioContext;
	private readonly worker: Worker;
	private readonly workerUrl: string;
	private readonly ringSampleBuffer: SharedArrayBuffer;
	private readonly ringControlBuffer: SharedArrayBuffer;
	private readonly capacityFrames: number;
	private readonly coreStreamCapacityFrames: number;
	private readonly coreStreamSamplesBuffer: SharedArrayBuffer;
	private readonly coreStreamControlBuffer: SharedArrayBuffer;
	private readonly frameTimeSec: number;

	private workletNode: AudioWorkletNode | null = null;
	private workletModuleUrl = '';
	private decoderScriptUrl = '';
	private fatalError: Error | null = null;
	private workerReady = false;
	private readonly readyPromise: Promise<void>;
	private resolveReady: (() => void) | null = null;
	private rejectReady: ((error: Error) => void) | null = null;
	private pendingMessages: Array<{ message: MainToWorkerMessage; transfer?: Transferable[] }> = [];

	private nextClipId = 1;
	private nextVoiceId = 1;
	private masterGain = 1;
	private readonly decodeResolves = new Map<number, (clip: AudioClipHandle) => void>();
	private readonly decodeRejects = new Map<number, (error: Error) => void>();
	private readonly voices = new Map<number, WorkerVoice>();
	private readonly coreStreamClip: WorkerCoreStreamClip = new WorkerCoreStreamClip();
	private readonly coreStreamVoice: WorkerCoreStreamVoice = new WorkerCoreStreamVoice();

	constructor(context?: AudioContext, options: WorkerStreamingAudioOptions = {}) {
		if (globalThis.crossOriginIsolated !== true) {
			throw new Error('[WorkerStreamingAudioService] SharedArrayBuffer audio backend requires crossOriginIsolated=true.');
		}
		if (typeof AudioWorkletNode !== 'function') {
			throw new Error('[WorkerStreamingAudioService] AudioWorkletNode is not available.');
		}
		if (typeof Worker !== 'function') {
			throw new Error('[WorkerStreamingAudioService] Worker is not available.');
		}

		this.capacityFrames = Math.floor(options.capacityFrames ?? DEFAULT_CAPACITY_FRAMES);
		if (this.capacityFrames < 2048) {
			throw new Error('[WorkerStreamingAudioService] capacityFrames must be at least 2048.');
		}
		const initialFrameTimeSec = options.frameTimeSec;
		if (initialFrameTimeSec !== undefined && (!Number.isFinite(initialFrameTimeSec) || initialFrameTimeSec <= 0)) {
			throw new Error('[WorkerStreamingAudioService] frameTimeSec must be a positive finite value.');
		}
		this.frameTimeSec = initialFrameTimeSec ?? 0;

		this.ctx = context ?? new AudioContext({ latencyHint: 'interactive' });
		this.ringSampleBuffer = new SharedArrayBuffer(this.capacityFrames * 2 * Float32Array.BYTES_PER_ELEMENT);
		this.ringControlBuffer = new SharedArrayBuffer(CTRL_LENGTH * Int32Array.BYTES_PER_ELEMENT);
		const ringControl = new Int32Array(this.ringControlBuffer);
		ringControl[CTRL_READ_PTR] = 0;
		ringControl[CTRL_WRITE_PTR] = 0;
		ringControl[CTRL_UNDERRUNS] = 0;
		ringControl[CTRL_RESERVED] = 0;
		this.coreStreamCapacityFrames = this.capacityFrames;
		this.coreStreamSamplesBuffer = new SharedArrayBuffer(this.coreStreamCapacityFrames * 2 * Int16Array.BYTES_PER_ELEMENT);
		this.coreStreamControlBuffer = new SharedArrayBuffer(CORE_CTRL_LENGTH * Int32Array.BYTES_PER_ELEMENT);
		const coreControl = new Int32Array(this.coreStreamControlBuffer);
		coreControl[CORE_CTRL_READ_PTR] = 0;
		coreControl[CORE_CTRL_WRITE_PTR] = 0;
		coreControl[CORE_CTRL_OVERRUNS] = 0;
		coreControl[CORE_CTRL_UNDERRUNS] = 0;

		this.workerUrl = this.createWorkerBlobUrl();
		this.worker = new Worker(this.workerUrl);
		this.worker.onmessage = this.handleWorkerMessage;
		this.worker.onerror = (event: ErrorEvent) => {
			this.setFatal(new Error('[WorkerStreamingAudioService] Worker crashed: ' + event.message));
		};

		this.readyPromise = new Promise<void>((resolve, reject) => {
			this.resolveReady = resolve;
			this.rejectReady = reject;
		});

		void this.initialize();
	}

	private async initialize(): Promise<void> {
		try {
			this.decoderScriptUrl = this.createDecoderScriptBlobUrl();
			this.workletModuleUrl = this.createWorkletBlobUrl();
			await this.ctx.audioWorklet.addModule(this.workletModuleUrl);
			this.workletNode = new AudioWorkletNode(this.ctx, 'bmsx-emulator-worker-out', {
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
				frameTimeSec: this.frameTimeSec,
				ringSampleBuffer: this.ringSampleBuffer,
				ringControlBuffer: this.ringControlBuffer,
				coreStreamCapacityFrames: this.coreStreamCapacityFrames,
				coreStreamSamplesBuffer: this.coreStreamSamplesBuffer,
				coreStreamControlBuffer: this.coreStreamControlBuffer,
				crossOriginIsolated: globalThis.crossOriginIsolated === true,
				decoderScriptUrl: this.decoderScriptUrl,
			});
		} catch (error) {
			this.setFatal(error instanceof Error ? error : new Error(String(error)));
		}
	}

	private createDecoderScriptBlobUrl(): string {
		const binary = atob(OGG_VORBIS_DECODER_B64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) {
			bytes[i] = binary.charCodeAt(i);
		}
		return URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
	}

	private createWorkletBlobUrl(): string {
		const source = `
(() => {
	const CTRL_READ_PTR = 0;
	const CTRL_WRITE_PTR = 1;
	const CTRL_UNDERRUNS = 2;

	class BmsxEmulatorWorkerOut extends AudioWorkletProcessor {
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
			Atomics.notify(this.control, CTRL_READ_PTR, 1);
			return true;
		}
	}

	registerProcessor('bmsx-emulator-worker-out', BmsxEmulatorWorkerOut);
})();
`;
		return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
	}

	private createWorkerBlobUrl(): string {
		const source = `
(() => {
	'use strict';

	const CTRL_READ_PTR = 0;
	const CTRL_WRITE_PTR = 1;
	const CTRL_UNDERRUNS = 2;
	const CORE_CTRL_READ_PTR = 0;
	const CORE_CTRL_WRITE_PTR = 1;
	const CORE_CTRL_OVERRUNS = 2;
	const CORE_CTRL_UNDERRUNS = 3;
	const PCM_SCALE = 1 / 32768;
	const MAX_ACTIVE_VOICES = 128;
	const AUDIO_RENDER_QUANTUM_FRAMES = 128;

	let ringSamples = null;
	let ringControl = null;
	let capacityFrames = 0;
	let coreStreamSamples = null;
	let coreStreamControl = null;
	let coreStreamCapacityFrames = 0;
	let outputSampleRate = 0;
	let frameTimeSec = 0;
	let targetLeadFrames = 0;
	let pumpWaitTimeoutMs = 2;
	let initialized = false;
	let suspended = true;
	let masterGain = 1;
	let pumpScheduled = false;
	let lastStatsMs = 0;
	let lastUnderruns = 0;
	let decodeChain = Promise.resolve();
	let oggDecoder = null;
	let sampledLeft = 0;
	let sampledRight = 0;

	const clips = new Map();
	const voices = new Map();
	const pumpChannel = new MessageChannel();
	const endedVoiceIds = new Int32Array(MAX_ACTIVE_VOICES);
	const statsMessage = {
		type: 'stats',
		fillFrames: 0,
		underruns: 0,
		voicesActive: 0,
		mixTimeMs: 0,
	};

	function clamp(value, min, max) {
		if (value < min) return min;
		if (value > max) return max;
		return value;
	}

	function clamp01(value) {
		return clamp(value, 0, 1);
	}

	function postError(error, fatal, scope, extras) {
		const err = error instanceof Error ? error : new Error(String(error));
		const payload = {
			type: 'error',
			fatal: !!fatal,
			scope,
			message: err.message,
			stack: err.stack,
		};
		if (extras) {
			if (extras.clipId !== undefined) payload.clipId = extras.clipId;
			if (extras.voiceId !== undefined) payload.voiceId = extras.voiceId;
		}
		self.postMessage(payload);
	}

	function currentFillFrames() {
		const readPtr = Atomics.load(ringControl, CTRL_READ_PTR) >>> 0;
		const writePtr = Atomics.load(ringControl, CTRL_WRITE_PTR) >>> 0;
		return (writePtr - readPtr) >>> 0;
	}

	function updateTargetLeadFrames() {
		const requested = frameTimeSec > 0
			? Math.ceil(outputSampleRate * frameTimeSec)
			: AUDIO_RENDER_QUANTUM_FRAMES;
		const minimum = AUDIO_RENDER_QUANTUM_FRAMES * 2;
		const maximum = capacityFrames - AUDIO_RENDER_QUANTUM_FRAMES;
		if (maximum <= minimum) {
			throw new Error('[WorkerStreamingAudioService.worker] Ring capacity is too small for emulator lead buffering.');
		}
		targetLeadFrames = requested < minimum ? minimum : (requested > maximum ? maximum : requested);
		pumpWaitTimeoutMs = Math.max(2, Math.ceil((AUDIO_RENDER_QUANTUM_FRAMES * 1000) / outputSampleRate));
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

	function readTag(dv, offset) {
		return String.fromCharCode(
			dv.getUint8(offset),
			dv.getUint8(offset + 1),
			dv.getUint8(offset + 2),
			dv.getUint8(offset + 3)
		);
	}

	function detectFormat(bytes, hint) {
		if (hint === 'wav' || hint === 'ogg') {
			return hint;
		}
		if (bytes.byteLength >= 4) {
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			const a = view.getUint8(0);
			const b = view.getUint8(1);
			const c = view.getUint8(2);
			const d = view.getUint8(3);
			if (a === 0x52 && b === 0x49 && c === 0x46 && d === 0x46) return 'wav';
			if (a === 0x4f && b === 0x67 && c === 0x67 && d === 0x53) return 'ogg';
		}
		throw new Error('[WorkerStreamingAudioService.worker] Unsupported audio format.');
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
			throw new Error('[WorkerStreamingAudioService.worker] WAV file has no data chunk.');
		}
		if (audioFormat !== 1 && audioFormat !== 3) {
			throw new Error('[WorkerStreamingAudioService.worker] Unsupported WAV encoding.');
		}
		if (channels <= 0 || sampleRate <= 0) {
			throw new Error('[WorkerStreamingAudioService.worker] Invalid WAV channel/sampleRate metadata.');
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

		for (let i = 0; i < sampleCount; i += 1) {
			let sample = 0;
			if (audioFormat === 1) {
				sample = dv.getInt16(sampleCursor, true) / 32768;
			} else {
				sample = dv.getFloat32(sampleCursor, true);
			}
			const clamped = clamp(sample, -1, 1);
			const scaled = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
			pcm[i] = clamp(scaled, -32768, 32767);
			sampleCursor += bytesPerSample;
		}

		return {
			pcm,
			channels,
			sampleRate,
			frames,
			durationSec: frames / sampleRate,
		};
	}

	async function decodeOggToPcm(bytes) {
		const decoded = await oggDecoder.decodeFile(bytes);
		if (!decoded || !Array.isArray(decoded.channelData)) {
			throw new Error('[WorkerStreamingAudioService.worker] OGG decode failed.');
		}
		const channels = decoded.channelData.length;
		const sampleRate = decoded.sampleRate;
		const frames = decoded.samplesDecoded;
		if (channels <= 0 || sampleRate <= 0 || frames < 0) {
			throw new Error('[WorkerStreamingAudioService.worker] OGG metadata is invalid.');
		}

		const pcm = new Int16Array(frames * channels);
		let cursor = 0;
		for (let frame = 0; frame < frames; frame += 1) {
			for (let channel = 0; channel < channels; channel += 1) {
				const source = decoded.channelData[channel];
				const value = source ? source[frame] : 0;
				const clamped = clamp(value, -1, 1);
				const scaled = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
				pcm[cursor] = clamp(scaled, -32768, 32767);
				cursor += 1;
			}
		}
		await oggDecoder.reset();

		return {
			pcm,
			channels,
			sampleRate,
			frames,
			durationSec: frames / sampleRate,
		};
	}

	async function decodeClip(clipId, bytes, formatHint) {
		const input = new Uint8Array(bytes);
		const format = detectFormat(input, formatHint);
		let decoded;
		if (format === 'wav') {
			decoded = decodeWavToPcm(input);
		} else {
			decoded = await decodeOggToPcm(input);
		}
		clips.set(clipId, decoded);
		self.postMessage({
			type: 'decoded',
			clipId,
			frames: decoded.frames,
			channels: decoded.channels,
			sampleRate: decoded.sampleRate,
			durationSec: decoded.durationSec,
		});
	}

	function createPcmClip(message) {
		if (message.sampleRate <= 0 || message.channels <= 0) {
			throw new Error('[WorkerStreamingAudioService.worker] Invalid PCM clip metadata.');
		}
		const frames = Math.floor(message.samples.length / message.channels);
		if (frames <= 0) {
			throw new Error('[WorkerStreamingAudioService.worker] PCM clip has no frames.');
		}
		clips.set(message.clipId, {
			pcm: message.samples,
			channels: message.channels,
			sampleRate: message.sampleRate,
			frames,
			durationSec: frames / message.sampleRate,
		});
	}

	function endVoice(voiceId) {
		if (!voices.has(voiceId)) {
			return;
		}
		voices.delete(voiceId);
		self.postMessage({ type: 'voice_ended', voiceId });
	}

	function selectDropVoiceId() {
		let selectedId = -1;
		let selectedStart = Infinity;
		for (const [voiceId, voice] of voices) {
			if (voice.startSampleCounter < selectedStart) {
				selectedStart = voice.startSampleCounter;
				selectedId = voiceId;
			}
		}
		return selectedId;
	}

	function disposeClip(clipId) {
		if (!clips.has(clipId)) {
			return;
		}
		clips.delete(clipId);
		for (const [voiceId, voice] of voices) {
			if (voice.clipId === clipId) {
				endVoice(voiceId);
			}
		}
	}

	function configureVoiceRate(voice, rate) {
		if (!Number.isFinite(rate) || rate <= 0) {
			throw new Error('[WorkerStreamingAudioService.worker] Playback rate must be positive and finite.');
		}
		voice.rate = rate;
		voice.step = (voice.clip.sampleRate / outputSampleRate) * rate;
	}

	function computeBiquad(type, frequency, q, gain, sampleRate, voice) {
		const nyquist = sampleRate * 0.5;
		const freq = clamp(frequency, 1, nyquist - 1);
		const safeQ = q > 0 ? q : 0.0001;
		const safeGain = Number.isFinite(gain) ? gain : 0;
		const w0 = (2 * Math.PI * freq) / sampleRate;
		const cosW0 = Math.cos(w0);
		const sinW0 = Math.sin(w0);
		const alpha = sinW0 / (2 * safeQ);
		const A = Math.pow(10, safeGain / 40);

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
				throw new Error('[WorkerStreamingAudioService.worker] Unsupported biquad type.');
		}

		if (a0 === 0) {
			throw new Error('[WorkerStreamingAudioService.worker] Biquad normalization failed.');
		}
		const invA0 = 1 / a0;
		voice.fb0 = b0 * invA0;
		voice.fb1 = b1 * invA0;
		voice.fb2 = b2 * invA0;
		voice.fa1 = a1 * invA0;
		voice.fa2 = a2 * invA0;
	}

	function setVoiceFilter(voice, filter) {
		if (filter === null) {
			voice.filterEnabled = false;
			voice.z1L = 0;
			voice.z2L = 0;
			voice.z1R = 0;
			voice.z2R = 0;
			return;
		}
		computeBiquad(filter.type, filter.frequency, filter.q, filter.gain, outputSampleRate, voice);
		voice.filterEnabled = true;
		voice.z1L = 0;
		voice.z2L = 0;
		voice.z1R = 0;
		voice.z2R = 0;
	}

	function readSample(clip, frameIndex, channelIndex) {
		if (frameIndex < 0 || frameIndex >= clip.frames) {
			return 0;
		}
		const sampleIndex = frameIndex * clip.channels + channelIndex;
		return clip.pcm[sampleIndex] * PCM_SCALE;
	}

	function sampleVoice(voice) {
		let position = voice.position;
		const clip = voice.clip;

		if (voice.loopEnabled) {
			position = wrapLoopPosition(position, voice.loopStartFrames, voice.loopEndFrames);
			voice.position = position;
		} else if (position >= clip.frames) {
			return false;
		}

		const idx0 = Math.floor(position);
		const frac = position - idx0;
		let idx1 = idx0 + 1;
		if (voice.loopEnabled && idx1 >= voice.loopEndFrames) {
			idx1 = voice.loopStartFrames + (idx1 - voice.loopEndFrames);
		}

		const left0 = readSample(clip, idx0, 0);
		const left1 = idx1 < clip.frames ? readSample(clip, idx1, 0) : 0;
		const left = left0 + (left1 - left0) * frac;

		if (clip.channels === 1) {
			sampledLeft = left;
			sampledRight = left;
			return true;
		}

		const right0 = readSample(clip, idx0, 1);
		const right1 = idx1 < clip.frames ? readSample(clip, idx1, 1) : 0;
		sampledLeft = left;
		sampledRight = right0 + (right1 - right0) * frac;
		return true;
	}

	function createVoice(message) {
		const clip = clips.get(message.clipId);
		if (!clip) {
			throw new Error('[WorkerStreamingAudioService.worker] Unknown clip for voice.');
		}

		if (voices.size >= MAX_ACTIVE_VOICES) {
			const dropVoiceId = selectDropVoiceId();
			if (dropVoiceId !== -1) {
				endVoice(dropVoiceId);
			}
		}

		const loop = message.params.loop;
		const loopEnabled = loop !== null;
		const loopStartFrames = loopEnabled ? clamp(loop.start * clip.sampleRate, 0, clip.frames) : 0;
		const loopEndSec = loopEnabled ? (loop.end !== undefined ? loop.end : clip.durationSec) : clip.durationSec;
		const loopEndFrames = loopEnabled ? clamp(loopEndSec * clip.sampleRate, 0, clip.frames) : clip.frames;
		if (loopEnabled && loopEndFrames <= loopStartFrames) {
			throw new Error('[WorkerStreamingAudioService.worker] Invalid loop range.');
		}

		let startPosition = message.params.offset * clip.sampleRate;
		if (loopEnabled) {
			startPosition = wrapLoopPosition(startPosition, loopStartFrames, loopEndFrames);
		} else {
			startPosition = clamp(startPosition, 0, clip.frames);
		}

		const writePtrNow = Atomics.load(ringControl, CTRL_WRITE_PTR) >>> 0;
		// Start voices at the current write pointer so queued audio remains sample-accurate
		// without coupling start timing to absolute AudioContext time drift while suspended.
		const startSampleCounter = writePtrNow;

		const voice = {
			voiceId: message.voiceId,
			clipId: message.clipId,
			clip,
			startSampleCounter,
			nextSampleCounter: startSampleCounter,
			position: startPosition,
			rate: 1,
			step: 1,
			gain: clamp01(message.params.gainLinear),
			targetGain: clamp01(message.params.gainLinear),
			gainRampRemainingFrames: 0,
			gainRampDelta: 0,
			loopEnabled,
			loopStartFrames,
			loopEndFrames,
			filterEnabled: false,
			fb0: 0,
			fb1: 0,
			fb2: 0,
			fa1: 0,
			fa2: 0,
			z1L: 0,
			z2L: 0,
			z1R: 0,
			z2R: 0,
		};

		configureVoiceRate(voice, message.params.rate);
		setVoiceFilter(voice, message.params.filter);
		voices.set(message.voiceId, voice);
	}

	function setVoiceGain(voiceId, gain) {
		const voice = voices.get(voiceId);
		if (!voice) {
			return;
		}
		const clamped = clamp01(gain);
		voice.gain = clamped;
		voice.targetGain = clamped;
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

	function mixAndWrite(framesRequested) {
		const readPtr = Atomics.load(ringControl, CTRL_READ_PTR) >>> 0;
		const writePtr = Atomics.load(ringControl, CTRL_WRITE_PTR) >>> 0;
		const fill = (writePtr - readPtr) >>> 0;
		const free = capacityFrames - fill;
		if (free <= 0) {
			return 0;
		}
		const framesToWrite = framesRequested > free ? free : framesRequested;
		let endedVoiceCount = 0;
		let coreReadPtr = Atomics.load(coreStreamControl, CORE_CTRL_READ_PTR) >>> 0;
		const coreWritePtr = Atomics.load(coreStreamControl, CORE_CTRL_WRITE_PTR) >>> 0;
		let coreAvailable = (coreWritePtr - coreReadPtr) >>> 0;
		let coreUnderruns = 0;

		for (let frame = 0; frame < framesToWrite; frame += 1) {
			const absoluteFrame = (writePtr + frame) >>> 0;
			let mixedL = 0;
			let mixedR = 0;
			if (coreAvailable > 0) {
				const src = (coreReadPtr % coreStreamCapacityFrames) * 2;
				mixedL += coreStreamSamples[src] * PCM_SCALE;
				mixedR += coreStreamSamples[src + 1] * PCM_SCALE;
				coreReadPtr = (coreReadPtr + 1) >>> 0;
				coreAvailable -= 1;
			} else {
				coreUnderruns += 1;
			}

			for (const [voiceId, voice] of voices) {
				if (absoluteFrame < voice.nextSampleCounter) {
					continue;
				}
				if (absoluteFrame > voice.nextSampleCounter) {
					const skipped = absoluteFrame - voice.nextSampleCounter;
					voice.position += skipped * voice.step;
					voice.nextSampleCounter = absoluteFrame;
				}

				if (voice.loopEnabled && voice.position >= voice.loopEndFrames) {
					voice.position = wrapLoopPosition(voice.position, voice.loopStartFrames, voice.loopEndFrames);
				}
				if (!voice.loopEnabled && voice.position >= voice.clip.frames) {
					endedVoiceIds[endedVoiceCount] = voiceId;
					endedVoiceCount += 1;
					continue;
				}

				if (!sampleVoice(voice)) {
					endedVoiceIds[endedVoiceCount] = voiceId;
					endedVoiceCount += 1;
					continue;
				}

				let left = sampledLeft * voice.gain;
				let right = sampledRight * voice.gain;
				if (voice.filterEnabled) {
					const yL = voice.fb0 * left + voice.z1L;
					voice.z1L = voice.fb1 * left - voice.fa1 * yL + voice.z2L;
					voice.z2L = voice.fb2 * left - voice.fa2 * yL;
					const yR = voice.fb0 * right + voice.z1R;
					voice.z1R = voice.fb1 * right - voice.fa1 * yR + voice.z2R;
					voice.z2R = voice.fb2 * right - voice.fa2 * yR;
					left = yL;
					right = yR;
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

			const dst = ((writePtr + frame) % capacityFrames) * 2;
			ringSamples[dst] = clamp(mixedL * masterGain, -1, 1);
			ringSamples[dst + 1] = clamp(mixedR * masterGain, -1, 1);
		}

		Atomics.store(coreStreamControl, CORE_CTRL_READ_PTR, coreReadPtr | 0);
		if (coreUnderruns > 0) {
			Atomics.add(coreStreamControl, CORE_CTRL_UNDERRUNS, coreUnderruns);
		}
		Atomics.store(ringControl, CTRL_WRITE_PTR, ((writePtr + framesToWrite) >>> 0) | 0);
		for (let i = 0; i < endedVoiceCount; i += 1) {
			endVoice(endedVoiceIds[i]);
		}
		return framesToWrite;
	}

	function sendStats(mixTimeMs) {
		statsMessage.fillFrames = currentFillFrames();
		statsMessage.underruns = Atomics.load(ringControl, CTRL_UNDERRUNS) >>> 0;
		statsMessage.voicesActive = voices.size;
		statsMessage.mixTimeMs = mixTimeMs;
		self.postMessage(statsMessage);
	}

	function schedulePump() {
		if (!initialized || suspended || pumpScheduled) {
			return;
		}
		pumpScheduled = true;
		pumpChannel.port2.postMessage(0);
	}

	function pump() {
		if (!initialized || suspended) {
			return;
		}

		const mixStart = performance.now();
		for (let i = 0; i < 8; i += 1) {
			const fill = currentFillFrames();
			if (fill >= targetLeadFrames) {
				break;
			}
			const deficit = targetLeadFrames - fill;
			const chunk = deficit < AUDIO_RENDER_QUANTUM_FRAMES ? AUDIO_RENDER_QUANTUM_FRAMES : (deficit > 1024 ? 1024 : deficit);
			const written = mixAndWrite(chunk);
			if (written <= 0) {
				break;
			}
		}
		const mixTimeMs = performance.now() - mixStart;
		const underruns = Atomics.load(ringControl, CTRL_UNDERRUNS) >>> 0;
		const now = performance.now();
		if (underruns !== lastUnderruns || now - lastStatsMs >= 500) {
			lastUnderruns = underruns;
			lastStatsMs = now;
			sendStats(mixTimeMs);
		}

		if (!suspended) {
			const readPtr = Atomics.load(ringControl, CTRL_READ_PTR) | 0;
			if (currentFillFrames() >= targetLeadFrames) {
				Atomics.wait(ringControl, CTRL_READ_PTR, readPtr, pumpWaitTimeoutMs);
			}
			schedulePump();
		}
	}

	pumpChannel.port1.onmessage = () => {
		pumpScheduled = false;
		try {
			pump();
		} catch (error) {
			postError(error, true, 'general');
		}
	};

	async function handleInit(message) {
		if (!message.crossOriginIsolated || self.crossOriginIsolated !== true) {
			throw new Error('[WorkerStreamingAudioService.worker] crossOriginIsolated=true is required.');
		}
		if (!message.decoderScriptUrl) {
			throw new Error('[WorkerStreamingAudioService.worker] Missing decoder script URL.');
		}
		importScripts(message.decoderScriptUrl);
		const api = self['ogg-vorbis-decoder'];
		oggDecoder = new api.OggVorbisDecoder();
		await oggDecoder.ready;
		ringSamples = new Float32Array(message.ringSampleBuffer);
		ringControl = new Int32Array(message.ringControlBuffer);
		capacityFrames = message.capacityFrames;
		coreStreamSamples = new Int16Array(message.coreStreamSamplesBuffer);
		coreStreamControl = new Int32Array(message.coreStreamControlBuffer);
		coreStreamCapacityFrames = message.coreStreamCapacityFrames;
		outputSampleRate = message.sampleRate;
		frameTimeSec = message.frameTimeSec;
		masterGain = 1;
		initialized = true;
		suspended = true;
		updateTargetLeadFrames();
		self.postMessage({ type: 'init_done' });
	}

	self.onmessage = (event) => {
		const message = event.data;
		if (!message || typeof message.type !== 'string') {
			return;
		}

		if (message.type !== 'init' && !initialized) {
			postError(new Error('[WorkerStreamingAudioService.worker] Command received before init.'), true, 'init');
			return;
		}

		try {
			switch (message.type) {
				case 'init':
					void handleInit(message).catch((error) => {
						postError(error, true, 'init');
					});
					break;
				case 'set_frame_time':
					frameTimeSec = message.frameTimeSec;
					updateTargetLeadFrames();
					schedulePump();
					break;
				case 'decode':
					decodeChain = decodeChain
						.then(() => decodeClip(message.clipId, message.bytes, message.formatHint))
						.catch((error) => {
							postError(error, false, 'decode', { clipId: message.clipId });
						});
					break;
				case 'create_pcm_clip':
					createPcmClip(message);
					break;
				case 'dispose_clip':
					disposeClip(message.clipId);
					break;
				case 'create_voice':
					createVoice(message);
					schedulePump();
					break;
				case 'voice_set_gain':
					setVoiceGain(message.voiceId, message.gain);
					break;
				case 'voice_ramp_gain':
					rampVoiceGain(message.voiceId, message.targetGain, message.seconds);
					break;
				case 'voice_set_filter': {
					const voice = voices.get(message.voiceId);
					if (voice) {
						setVoiceFilter(voice, message.filter);
					}
					break;
				}
				case 'voice_set_rate':
					setVoiceRate(message.voiceId, message.rate);
					break;
				case 'voice_stop':
					endVoice(message.voiceId);
					break;
				case 'set_master_gain':
					masterGain = clamp01(message.gain);
					break;
				case 'suspend':
					suspended = true;
					break;
				case 'resume':
					suspended = false;
					schedulePump();
					break;
				default:
					throw new Error('[WorkerStreamingAudioService.worker] Unsupported command: ' + String(message.type));
			}
		} catch (error) {
			const scope = message.type === 'decode'
				? 'decode'
				: (message.type.indexOf('voice') === 0 || message.type === 'create_voice')
					? 'voice'
					: (message.type === 'init' ? 'init' : 'general');
			postError(error, true, scope, {
				clipId: message.clipId,
				voiceId: message.voiceId,
			});
		}
	};
})();
`;
		return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
	}

	private flushPendingMessages(): void {
		if (!this.workerReady) {
			return;
		}
		for (let i = 0; i < this.pendingMessages.length; i += 1) {
			const entry = this.pendingMessages[i];
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
		if (!this.workerReady && message.type !== 'init') {
			this.pendingMessages.push({ message, transfer });
			return;
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
				this.workerReady = true;
				this.flushPendingMessages();
				if (this.resolveReady !== null) {
					this.resolveReady();
					this.resolveReady = null;
					this.rejectReady = null;
				}
				if (this.workletModuleUrl.length > 0) {
					URL.revokeObjectURL(this.workletModuleUrl);
					this.workletModuleUrl = '';
				}
				if (this.decoderScriptUrl.length > 0) {
					URL.revokeObjectURL(this.decoderScriptUrl);
					this.decoderScriptUrl = '';
				}
				break;
			case 'decoded': {
				const resolve = this.decodeResolves.get(message.clipId);
				const reject = this.decodeRejects.get(message.clipId);
				if (resolve === undefined || reject === undefined) {
					return;
				}
				this.decodeResolves.delete(message.clipId);
				this.decodeRejects.delete(message.clipId);
				if (!Number.isFinite(message.durationSec) || message.durationSec < 0) {
					reject(new Error('[WorkerStreamingAudioService] Worker produced invalid decoded duration.'));
					return;
				}
				resolve(new WorkerClip(this, message.clipId, message.durationSec));
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
					const reject = this.decodeRejects.get(message.clipId);
					if (reject !== undefined) {
						this.decodeResolves.delete(message.clipId);
						this.decodeRejects.delete(message.clipId);
						reject(error);
					}
				}
				if (message.fatal) {
					this.setFatal(error);
				}
				break;
			}
		}
	};

	private setFatal(error: Error): void {
		if (this.fatalError !== null) {
			return;
		}
		this.fatalError = error;
		if (this.rejectReady !== null) {
			this.rejectReady(error);
			this.resolveReady = null;
			this.rejectReady = null;
		}
		for (const reject of this.decodeRejects.values()) {
			reject(error);
		}
		this.decodeResolves.clear();
		this.decodeRejects.clear();
		for (const [voiceId, voice] of this.voices) {
			void voiceId;
			voice.markEnded(this.ctx.currentTime);
		}
		this.voices.clear();
		console.error(error);
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
			this.decodeResolves.set(clipId, resolve);
			this.decodeRejects.set(clipId, reject);
			this.postOrQueueMessage({
				type: 'decode',
				clipId,
				bytes,
			}, [bytes]);
		});
	}

	pushCoreFrames(samples: Int16Array, channels: number, sampleRate: number): void {
		if (channels !== 2) {
			throw new Error('[WorkerStreamingAudioService] core stream expects stereo PCM.');
		}
		if (sampleRate !== this.ctx.sampleRate) {
			throw new Error('[WorkerStreamingAudioService] core stream sample rate must match AudioContext sample rate.');
		}
		const frames = Math.floor(samples.length / channels);
		if (frames <= 0) {
			return;
		}

		const control = new Int32Array(this.coreStreamControlBuffer);
		const stream = new Int16Array(this.coreStreamSamplesBuffer);
		const capacity = this.coreStreamCapacityFrames;
		const maxQueuedFrames = capacity - 1;
		let sourceStartFrame = 0;
		let framesToWrite = frames;
		if (framesToWrite > maxQueuedFrames) {
			sourceStartFrame = framesToWrite - maxQueuedFrames;
			framesToWrite = maxQueuedFrames;
		}
		let readPtr = Atomics.load(control, CORE_CTRL_READ_PTR) >>> 0;
		const writePtr = Atomics.load(control, CORE_CTRL_WRITE_PTR) >>> 0;
		const fill = (writePtr - readPtr) >>> 0;
		const free = capacity - fill;
		if (framesToWrite > free) {
			const framesToDrop = framesToWrite - free;
			readPtr = (readPtr + framesToDrop) >>> 0;
			Atomics.store(control, CORE_CTRL_READ_PTR, readPtr | 0);
			Atomics.add(control, CORE_CTRL_OVERRUNS, framesToDrop);
		}

		let dstFrame = writePtr % capacity;
		let srcFrame = sourceStartFrame;
		let firstSpan = capacity - dstFrame;
		if (firstSpan > framesToWrite) {
			firstSpan = framesToWrite;
		}
		let dstCursor = dstFrame * 2;
		let srcCursor = srcFrame * 2;
		for (let frame = 0; frame < firstSpan; frame += 1) {
			stream[dstCursor] = samples[srcCursor];
			stream[dstCursor + 1] = samples[srcCursor + 1];
			dstCursor += 2;
			srcCursor += 2;
		}
		const secondSpan = framesToWrite - firstSpan;
		dstCursor = 0;
		for (let frame = 0; frame < secondSpan; frame += 1) {
			stream[dstCursor] = samples[srcCursor];
			stream[dstCursor + 1] = samples[srcCursor + 1];
			dstCursor += 2;
			srcCursor += 2;
		}

		Atomics.store(control, CORE_CTRL_WRITE_PTR, ((writePtr + framesToWrite) >>> 0) | 0);
		Atomics.notify(control, CORE_CTRL_WRITE_PTR, 1);
	}

	createClipFromPcm(samples: Int16Array, sampleRate: number, channels: number): AudioClipHandle {
		this.pushCoreFrames(samples, channels, sampleRate);
		return this.coreStreamClip;
	}

	private getQueuedSeconds(): number {
		const control = new Int32Array(this.ringControlBuffer);
		const readPtr = Atomics.load(control, CTRL_READ_PTR) >>> 0;
		const writePtr = Atomics.load(control, CTRL_WRITE_PTR) >>> 0;
		const fillFrames = (writePtr - readPtr) >>> 0;
		return fillFrames / this.ctx.sampleRate;
	}

	createVoice(clip: AudioClipHandle, params: AudioPlaybackParams): VoiceHandle {
		if (clip instanceof WorkerCoreStreamClip) {
			void params;
			return this.coreStreamVoice;
		}
		if (!(clip instanceof WorkerClip)) {
			throw new Error('[WorkerStreamingAudioService] Unsupported clip handle.');
		}
		const voiceId = this.nextVoiceId++;
		const startedAt = this.ctx.currentTime + this.getQueuedSeconds();
		const voice = new WorkerVoice(this, voiceId, startedAt, params.offset);
		this.voices.set(voiceId, voice);
		this.postOrQueueMessage({
			type: 'create_voice',
			voiceId,
			clipId: clip.clipId,
			params: {
				offset: params.offset,
				rate: params.rate,
				gainLinear: params.gainLinear,
				loop: params.loop ?? null,
				filter: params.filter ?? null,
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
		if (!Number.isFinite(seconds) || seconds <= 0) {
			throw new Error('[WorkerStreamingAudioService] ramp duration must be positive and finite.');
		}
		this.postOrQueueMessage({
			type: 'voice_ramp_gain',
			voiceId,
			targetGain: clamp01(targetGain),
			seconds,
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

	setFrameTimeSec(seconds: number): void {
		if (!Number.isFinite(seconds) || seconds <= 0) {
			throw new Error('[WorkerStreamingAudioService] frame time must be positive and finite.');
		}
		this.postOrQueueMessage({ type: 'set_frame_time', frameTimeSec: seconds });
	}
}
