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
		needPort: MessagePort;
		ringSampleBuffer: SharedArrayBuffer;
		ringControlBuffer: SharedArrayBuffer;
		coreStreamCapacityFrames: number;
		coreStreamSamplesBuffer: SharedArrayBuffer;
		coreStreamControlBuffer: SharedArrayBuffer;
		crossOriginIsolated: boolean;
	}
	| {
		type: 'set_frame_time';
		frameTimeSec: number;
	}
	| {
		type: 'decode';
		clipId: number;
		bytes: ArrayBuffer;
		formatHint?: 'adpcm';
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
		coreFillFrames: number;
		coreUnderruns: number;
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
	private readonly ringControl: Int32Array;
	private readonly capacityFrames: number;
	private readonly coreStreamCapacityFrames: number;
	private readonly coreStreamSamplesBuffer: SharedArrayBuffer;
	private readonly coreStreamControlBuffer: SharedArrayBuffer;
	private readonly coreStreamSamples: Int16Array;
	private readonly coreStreamControl: Int32Array;
	private readonly frameTimeSec: number;

	private workletNode: AudioWorkletNode | null = null;
	private workletModuleUrl = '';
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

	constructor(context: AudioContext, options: WorkerStreamingAudioOptions = {}) {
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
		const initialFrameTimeSec = options.frameTimeSec;
		if (initialFrameTimeSec !== undefined && (!Number.isFinite(initialFrameTimeSec) || initialFrameTimeSec <= 0)) {
			throw new Error('[WorkerStreamingAudioService] frameTimeSec must be a positive finite value.');
		}
		this.frameTimeSec = initialFrameTimeSec ?? 0.005;

		this.ctx = context;
		this.ringSampleBuffer = new SharedArrayBuffer(this.capacityFrames * 2 * Float32Array.BYTES_PER_ELEMENT);
		this.ringControlBuffer = new SharedArrayBuffer(CTRL_LENGTH * Int32Array.BYTES_PER_ELEMENT);
		this.ringControl = new Int32Array(this.ringControlBuffer);
		this.ringControl[CTRL_READ_PTR] = 0;
		this.ringControl[CTRL_WRITE_PTR] = 0;
		this.ringControl[CTRL_UNDERRUNS] = 0;
		this.ringControl[CTRL_RESERVED] = 0;
		this.coreStreamCapacityFrames = this.capacityFrames;
		this.coreStreamSamplesBuffer = new SharedArrayBuffer(this.coreStreamCapacityFrames * 2 * Int16Array.BYTES_PER_ELEMENT);
		this.coreStreamControlBuffer = new SharedArrayBuffer(CORE_CTRL_LENGTH * Int32Array.BYTES_PER_ELEMENT);
		this.coreStreamSamples = new Int16Array(this.coreStreamSamplesBuffer);
		this.coreStreamControl = new Int32Array(this.coreStreamControlBuffer);
		this.coreStreamControl[CORE_CTRL_READ_PTR] = 0;
		this.coreStreamControl[CORE_CTRL_WRITE_PTR] = 0;
		this.coreStreamControl[CORE_CTRL_OVERRUNS] = 0;
		this.coreStreamControl[CORE_CTRL_UNDERRUNS] = 0;

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
			const needChannel = new MessageChannel();
			this.workletNode.port.onmessage = this.handleWorkletControlMessage;
			this.workletNode.port.postMessage({ type: 'connect_need_port' }, [needChannel.port1]);
				this.workletNode.connect(this.ctx.destination);

				this.postOrQueueMessage({
					type: 'init',
					sampleRate: this.ctx.sampleRate,
					capacityFrames: this.capacityFrames,
					frameTimeSec: this.frameTimeSec,
					needPort: needChannel.port2,
					ringSampleBuffer: this.ringSampleBuffer,
					ringControlBuffer: this.ringControlBuffer,
					coreStreamCapacityFrames: this.coreStreamCapacityFrames,
					coreStreamSamplesBuffer: this.coreStreamSamplesBuffer,
					coreStreamControlBuffer: this.coreStreamControlBuffer,
					crossOriginIsolated: globalThis.crossOriginIsolated === true,
				}, [needChannel.port2]);
		} catch (error) {
			this.setFatal(error instanceof Error ? error : new Error(String(error)));
		}
	}

	private createWorkletBlobUrl(): string {
		const source = `
(() => {
	const CTRL_READ_PTR = 0;
	const CTRL_WRITE_PTR = 1;
	const CTRL_UNDERRUNS = 2;
	const WORKLET_NEED_LOW_WATER_FRAMES = 256;
	const WORKLET_PREEMPTIVE_MARGIN_FRAMES = 256;

	class BmsxEmulatorWorkerOut extends AudioWorkletProcessor {
		constructor(options) {
			super();
			const processorOptions = options.processorOptions;
			this.samples = new Float32Array(processorOptions.sampleBuffer);
			this.control = new Int32Array(processorOptions.controlBuffer);
			this.capacityFrames = processorOptions.capacityFrames;
			this.needPort = null;
			this.port.onmessage = (event) => {
				const message = event.data;
				if (!message || message.type !== 'connect_need_port') {
					return;
				}
				const port = event.ports[0];
				if (!port) {
					this.port.postMessage({ type: 'need_port_error', reason: 'no event.ports[0]' });
					return;
				}
				this.needPort = port;
				this.port.postMessage({ type: 'need_port_connected' });
			};
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
			if (this.needPort !== null) {
				const writePtrAfter = Atomics.load(this.control, CTRL_WRITE_PTR) >>> 0;
				const availableAfter = (writePtrAfter - readPtr) >>> 0;
				if (availableAfter < WORKLET_NEED_LOW_WATER_FRAMES + WORKLET_PREEMPTIVE_MARGIN_FRAMES + frameCount) {
					this.needPort.postMessage(1);
				}
			}
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
	const BADP_HEADER_SIZE = 48;
	const BADP_VERSION = 1;
	const ADPCM_STEP_TABLE = [
		7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
		19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
		50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
		130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
		337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
		876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
		2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
		5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
		15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
	];
	const ADPCM_INDEX_TABLE = [
		-1, -1, -1, -1, 2, 4, 6, 8,
		-1, -1, -1, -1, 2, 4, 6, 8,
	];
	const MAX_ACTIVE_VOICES = 128;
	const AUDIO_RENDER_QUANTUM_FRAMES = 128;
	const WORKLET_LOW_WATER_FRAMES = 256;
	const LEAD_MARGIN_FRAMES = 128;

	let ringSamples = null;
	let ringControl = null;
	let capacityFrames = 0;
	let coreStreamSamples = null;
	let coreStreamControl = null;
	let coreStreamCapacityFrames = 0;
	let coreStreamPrimed = false;
	let outputSampleRate = 0;
	let frameTimeSec = 0;
	let targetLeadFrames = 0;
	let needPort = null;
	let initialized = false;
	let suspended = true;
	let masterGain = 1;
	let lastStatsMs = 0;
	let lastUnderruns = 0;
	let decodeChain = Promise.resolve();
	let sampledLeft = 0;
	let sampledRight = 0;

	const clips = new Map();
	const voices = new Map();
	const endedVoiceIds = new Int32Array(MAX_ACTIVE_VOICES);
	const statsMessage = {
		type: 'stats',
		fillFrames: 0,
		underruns: 0,
		coreFillFrames: 0,
		coreUnderruns: 0,
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
		const minimum = AUDIO_RENDER_QUANTUM_FRAMES * 2;
		const maximum = capacityFrames - AUDIO_RENDER_QUANTUM_FRAMES * 4;
		if (maximum < minimum) {
			throw new Error('[WorkerStreamingAudioService.worker] Ring capacity is too small for emulator lead buffering.');
		}
		const requested = frameTimeSec > 0
			? Math.floor(frameTimeSec * outputSampleRate)
			: 256;
		targetLeadFrames = clamp(requested, minimum, maximum);
		const minimumLead = WORKLET_LOW_WATER_FRAMES + LEAD_MARGIN_FRAMES;
		if (targetLeadFrames < minimumLead) {
			targetLeadFrames = minimumLead;
		}
		if (targetLeadFrames > 512) {
			targetLeadFrames = 512;
		}
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

		function isBadpBuffer(bytes) {
			return (
				bytes.byteLength >= BADP_HEADER_SIZE
				&& bytes[0] === 0x42
				&& bytes[1] === 0x41
				&& bytes[2] === 0x44
				&& bytes[3] === 0x50
			);
		}

		function decodeBadpToPcm(bytes) {
			const input = new Uint8Array(bytes);
			if (!isBadpBuffer(input)) {
				throw new Error('[WorkerStreamingAudioService.worker] Unsupported audio format. Expected BADP.');
			}
			const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
			const version = dv.getUint16(4, true);
			if (version !== BADP_VERSION) {
				throw new Error('[WorkerStreamingAudioService.worker] Unsupported BADP version.');
			}
			const channels = dv.getUint16(6, true);
			const sampleRate = dv.getUint32(8, true);
			const totalFrames = dv.getUint32(12, true);
			const seekEntryCount = dv.getUint32(28, true);
			const seekTableOffset = dv.getUint32(32, true);
			const dataOffset = dv.getUint32(36, true);
			if (channels <= 0 || channels > 2) {
				throw new Error('[WorkerStreamingAudioService.worker] BADP channel count must be 1 or 2.');
			}
			if (sampleRate <= 0) {
				throw new Error('[WorkerStreamingAudioService.worker] BADP sample rate must be positive.');
			}
			if (dataOffset < BADP_HEADER_SIZE || dataOffset > input.byteLength) {
				throw new Error('[WorkerStreamingAudioService.worker] BADP data offset is invalid.');
			}
			if (seekEntryCount > 0 && (seekTableOffset < BADP_HEADER_SIZE || seekTableOffset >= dataOffset)) {
				throw new Error('[WorkerStreamingAudioService.worker] BADP seek table offset is invalid.');
			}

			const pcm = new Int16Array(totalFrames * channels);
			const predictors = new Int32Array(channels);
			const stepIndices = new Int32Array(channels);
			let decodedFrames = 0;
			let cursor = dataOffset;
			while (decodedFrames < totalFrames) {
				if (cursor + 4 + channels * 4 > input.byteLength) {
					throw new Error('[WorkerStreamingAudioService.worker] BADP block header exceeds buffer.');
				}
				const blockStart = cursor;
				const blockFrames = dv.getUint16(cursor, true);
				cursor += 2;
				const blockBytes = dv.getUint16(cursor, true);
				cursor += 2;
				if (blockFrames <= 0) {
					throw new Error('[WorkerStreamingAudioService.worker] BADP block has zero frames.');
				}
				const blockHeaderBytes = 4 + channels * 4;
				if (blockBytes < blockHeaderBytes) {
					throw new Error('[WorkerStreamingAudioService.worker] BADP block bytes are invalid.');
				}
				const blockEnd = blockStart + blockBytes;
				if (blockEnd > input.byteLength) {
					throw new Error('[WorkerStreamingAudioService.worker] BADP block exceeds buffer size.');
				}
				for (let channel = 0; channel < channels; channel += 1) {
					predictors[channel] = dv.getInt16(cursor, true);
					cursor += 2;
					stepIndices[channel] = dv.getUint8(cursor);
					cursor += 2;
					if (stepIndices[channel] < 0 || stepIndices[channel] > 88) {
						throw new Error('[WorkerStreamingAudioService.worker] BADP step index is out of range.');
					}
				}

				let nibbleCursor = 0;
				const payloadStart = cursor;
				for (let frame = 0; frame < blockFrames && decodedFrames < totalFrames; frame += 1) {
					const dstBase = decodedFrames * channels;
					for (let channel = 0; channel < channels; channel += 1) {
						const payloadIndex = payloadStart + (nibbleCursor >> 1);
						if (payloadIndex >= blockEnd) {
							throw new Error('[WorkerStreamingAudioService.worker] BADP block payload underrun.');
						}
						const packed = input[payloadIndex];
						const code = (nibbleCursor & 1) === 0 ? ((packed >> 4) & 0x0f) : (packed & 0x0f);
						nibbleCursor += 1;
						const step = ADPCM_STEP_TABLE[stepIndices[channel]];
						let diff = step >> 3;
						if ((code & 4) !== 0) diff += step;
						if ((code & 2) !== 0) diff += step >> 1;
						if ((code & 1) !== 0) diff += step >> 2;
						if ((code & 8) !== 0) {
							predictors[channel] -= diff;
						} else {
							predictors[channel] += diff;
						}
						if (predictors[channel] < -32768) predictors[channel] = -32768;
						if (predictors[channel] > 32767) predictors[channel] = 32767;
						stepIndices[channel] += ADPCM_INDEX_TABLE[code];
						if (stepIndices[channel] < 0) stepIndices[channel] = 0;
						if (stepIndices[channel] > 88) stepIndices[channel] = 88;
						pcm[dstBase + channel] = predictors[channel];
					}
					decodedFrames += 1;
				}
				cursor = blockEnd;
			}
			if (decodedFrames !== totalFrames) {
				throw new Error('[WorkerStreamingAudioService.worker] BADP decode frame count mismatch.');
			}
			return {
				pcm,
				channels,
				sampleRate,
				frames: totalFrames,
				durationSec: totalFrames / sampleRate,
			};
		}

		async function decodeClip(clipId, bytes, _formatHint) {
			const decoded = decodeBadpToPcm(bytes);
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
		let coreUnderruns = 0;
		let coreReadPtr = 0;
		let coreAvailable = 0;
		if (coreStreamPrimed) {
			coreReadPtr = Atomics.load(coreStreamControl, CORE_CTRL_READ_PTR) >>> 0;
			const coreWritePtr = Atomics.load(coreStreamControl, CORE_CTRL_WRITE_PTR) >>> 0;
			coreAvailable = (coreWritePtr - coreReadPtr) >>> 0;
		} else {
			const coreReadPtrNow = Atomics.load(coreStreamControl, CORE_CTRL_READ_PTR) >>> 0;
			const coreWritePtrNow = Atomics.load(coreStreamControl, CORE_CTRL_WRITE_PTR) >>> 0;
			coreAvailable = (coreWritePtrNow - coreReadPtrNow) >>> 0;
			if (coreAvailable > 0) {
				coreStreamPrimed = true;
				coreReadPtr = coreReadPtrNow;
			}
		}

		for (let frame = 0; frame < framesToWrite; frame += 1) {
			const absoluteFrame = (writePtr + frame) >>> 0;
			let mixedL = 0;
			let mixedR = 0;
			if (coreStreamPrimed) {
				if (coreAvailable === 0) {
					const coreWritePtrNow = Atomics.load(coreStreamControl, CORE_CTRL_WRITE_PTR) >>> 0;
					coreAvailable = (coreWritePtrNow - coreReadPtr) >>> 0;
				}
				if (coreAvailable > 0) {
					const src = (coreReadPtr % coreStreamCapacityFrames) * 2;
					mixedL += coreStreamSamples[src] * PCM_SCALE;
					mixedR += coreStreamSamples[src + 1] * PCM_SCALE;
					coreReadPtr = (coreReadPtr + 1) >>> 0;
					coreAvailable -= 1;
				} else {
					coreUnderruns += 1;
				}
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

		if (coreStreamPrimed) {
			Atomics.store(coreStreamControl, CORE_CTRL_READ_PTR, coreReadPtr | 0);
		}
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
		const coreRead = Atomics.load(coreStreamControl, CORE_CTRL_READ_PTR) >>> 0;
		const coreWrite = Atomics.load(coreStreamControl, CORE_CTRL_WRITE_PTR) >>> 0;
		statsMessage.coreFillFrames = (coreWrite - coreRead) >>> 0;
		statsMessage.coreUnderruns = Atomics.load(coreStreamControl, CORE_CTRL_UNDERRUNS) >>> 0;
		statsMessage.voicesActive = voices.size;
		statsMessage.mixTimeMs = mixTimeMs;
		self.postMessage(statsMessage);
	}

	function schedulePump() {
		if (!initialized || suspended) {
			return;
		}
		try {
			pump();
		} catch (error) {
			postError(error, true, 'general');
		}
	}

	function fillToTarget() {
		while (true) {
			const fill = currentFillFrames();
			if (fill >= targetLeadFrames) {
				break;
			}
			const deficit = targetLeadFrames - fill;
			const written = mixAndWrite(deficit);
			if (written <= 0) {
				break;
			}
		}
	}

	function pump() {
		if (!initialized || suspended) {
			return;
		}

		const mixStart = performance.now();
		let fill = currentFillFrames();
		if (fill < 256) {
			const written = mixAndWrite(targetLeadFrames);
			if (written > 0) {
				fill = currentFillFrames();
			}
		}

		for (let i = 0; i < 12; i += 1) {
			fill = currentFillFrames();
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
	}

		async function handleInit(message) {
			if (!message.crossOriginIsolated || self.crossOriginIsolated !== true) {
				throw new Error('[WorkerStreamingAudioService.worker] crossOriginIsolated=true is required.');
			}
			if (!(message.needPort instanceof MessagePort)) {
				throw new Error('[WorkerStreamingAudioService.worker] Missing realtime need port.');
			}
			ringSamples = new Float32Array(message.ringSampleBuffer);
			ringControl = new Int32Array(message.ringControlBuffer);
		capacityFrames = message.capacityFrames;
		coreStreamSamples = new Int16Array(message.coreStreamSamplesBuffer);
		coreStreamControl = new Int32Array(message.coreStreamControlBuffer);
		coreStreamCapacityFrames = message.coreStreamCapacityFrames;
		coreStreamPrimed = false;
		outputSampleRate = message.sampleRate;
		frameTimeSec = message.frameTimeSec;
		needPort = message.needPort;
		needPort.onmessage = () => {
			schedulePump();
		};
		needPort.start();
		masterGain = 1;
		initialized = true;
		suspended = true;
		updateTargetLeadFrames();
		pump();
		fillToTarget();
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
					updateTargetLeadFrames();
					pump();
					fillToTarget();
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

	private handleWorkletControlMessage = (event: MessageEvent<{ type: string; reason?: string }>): void => {
		const message = event.data;
		if (!message || typeof message.type !== 'string') {
			return;
		}
		switch (message.type) {
			case 'need_port_connected':
				return;
			case 'need_port_error':
				this.setFatal(new Error('[WorkerStreamingAudioService] Worklet need-port setup failed: ' + String(message.reason)));
				return;
			default:
				this.setFatal(new Error('[WorkerStreamingAudioService] Unsupported worklet control message: ' + message.type));
		}
	};

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
		if (this.workletNode !== null) {
			this.workletNode.port.onmessage = null;
		}
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

	sampleRate(): number {
		return this.ctx.sampleRate;
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

		const control = this.coreStreamControl;
		const stream = this.coreStreamSamples;
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
			const minimumDrop = framesToWrite - free;
			let framesToDrop = framesToWrite >> 1;
			if (framesToDrop < minimumDrop) {
				framesToDrop = minimumDrop;
			}
			if (framesToDrop > fill) {
				framesToDrop = fill;
			}
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
		const readPtr = Atomics.load(this.ringControl, CTRL_READ_PTR) >>> 0;
		const writePtr = Atomics.load(this.ringControl, CTRL_WRITE_PTR) >>> 0;
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
