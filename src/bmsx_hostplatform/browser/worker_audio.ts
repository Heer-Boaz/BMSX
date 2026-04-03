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

const CORE_CTRL_READ_PTR = 0;
const CORE_CTRL_WRITE_PTR = 1;
const CORE_CTRL_OVERRUNS = 2;
const CORE_CTRL_UNDERRUNS = 3;
const CORE_CTRL_SEQ = 4;
const CORE_CTRL_LENGTH = 5;

const DEFAULT_CAPACITY_FRAMES = 16384;
const DEFAULT_FRAME_TIME_SEC = 0.024;
const IOS_FRAME_TIME_SEC = 0.036;
const WORKLET_TARGET_MIN_DEFAULT = 384;
const WORKLET_TARGET_MAX_DEFAULT = 4096;
const WORKLET_TARGET_MIN_IOS = 768;
const WORKLET_TARGET_MAX_IOS = 4096;
const WORKLET_REARM_MARGIN_DEFAULT = 128;
const WORKLET_REARM_MARGIN_IOS = 256;
const WORKLET_REQUEST_AHEAD_DEFAULT = 256;
const WORKLET_REQUEST_AHEAD_IOS = 384;
const NEED_PUMP_BUDGET_FRAMES = 8192;

function isIOSDevice(): boolean {
	const platform = navigator.platform;
	if (platform === 'iPhone' || platform === 'iPad' || platform === 'iPod') {
		return true;
	}
	if (platform === 'MacIntel' && navigator.maxTouchPoints > 1) {
		return true;
	}
	const userAgent = navigator.userAgent;
	return userAgent.indexOf('iPhone') >= 0 || userAgent.indexOf('iPad') >= 0 || userAgent.indexOf('iPod') >= 0;
}

export interface WorkerStreamingAudioOptions {
	capacityFrames?: number;
	frameTimeSec?: number;
}

type WorkletMessageToMain =
	| {
		type: 'need_port_connected';
	}
	| {
		type: 'need_main';
	}
	| {
		type: 'stats';
		fillFrames: number;
		underruns: number;
		overruns: number;
		rate: number;
		mixTimeMs: number;
	}
	| {
		type: 'need_port_error';
		reason: string;
	}
	| {
		type: 'clip_ready';
		clipId: number;
		durationSec: number;
	}
	| {
		type: 'voice_ended';
		voiceId: number;
	}
	| {
		type: 'worklet_error';
		message: string;
	};

type MainToWorkletMessage =
	| {
		type: 'configure';
		frameTimeSec: number;
		preferHighLead: boolean;
	}
	| {
		type: 'set_frame_time';
		frameTimeSec: number;
	}
	| {
		type: 'set_master_gain';
		gain: number;
	}
	| {
		type: 'register_badp_clip';
		clipId: number;
		bytes: ArrayBuffer;
	}
	| {
		type: 'dispose_clip';
		clipId: number;
	}
	| {
		type: 'create_voice';
		voiceId: number;
		clipId: number;
		params: AudioPlaybackParams;
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
		type: 'voice_set_rate';
		voiceId: number;
		rate: number;
	}
	| {
		type: 'voice_stop';
		voiceId: number;
	};

class WorkerCoreStreamClip implements AudioClipHandle {
	readonly duration = 0;
	dispose(): void { }
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

class WorkerClip implements AudioClipHandle {
	private disposed = false;

	public constructor(
		private readonly service: WorkerStreamingAudioService,
		public readonly clipId: number,
		public readonly duration: number,
	) { }

	public dispose(): void {
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

	public constructor(
		private readonly service: WorkerStreamingAudioService,
		public readonly voiceId: number,
		public readonly startedAt: number,
		public readonly startOffset: number,
	) { }

	public onEnded(cb: (event: VoiceEndedEvent) => void): SubscriptionHandle {
		this.endedListeners.add(cb);
		return createSubscriptionHandle(() => {
			this.endedListeners.delete(cb);
		});
	}

	public setGainLinear(value: number): void {
		this.service.setVoiceGain(this.voiceId, value);
	}

	public rampGainLinear(target: number, durationSec: number): void {
		this.service.rampVoiceGain(this.voiceId, target, durationSec);
	}

	public setFilter(_filter: AudioFilterParams): void {
	}

	public setRate(rate: number): void {
		this.service.setVoiceRate(this.voiceId, rate);
	}

	public stop(): void {
		this.service.stopVoice(this.voiceId);
	}

	public disconnect(): void {
		this.endedListeners.clear();
		this.service.disconnectVoice(this.voiceId);
	}

	public markEnded(clippedAt: number): void {
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
	private readonly coreStreamCapacityFrames: number;
	private readonly coreStreamSamplesBuffer: SharedArrayBuffer;
	private readonly coreStreamControlBuffer: SharedArrayBuffer;
	private readonly coreStreamSamples: Int16Array;
	private readonly coreStreamControl: Int32Array;
	private frameTimeSec: number;
	private readonly preferHighLead: boolean;

	private workletNode: AudioWorkletNode | null = null;
	private workletModuleUrl = '';
	private fatalError: Error | null = null;
	private readonly readyPromise: Promise<void>;
	private resolveReady: (() => void) | null = null;
	private rejectReady: ((error: Error) => void) | null = null;

	private masterGain = 1;
	private coreNeedHandler: (() => void) | null = null;
	private coreNeedPumping = false;
	private readonly coreStreamClip: WorkerCoreStreamClip = new WorkerCoreStreamClip();
	private readonly coreStreamVoice: WorkerCoreStreamVoice = new WorkerCoreStreamVoice();
	private nextClipId = 1;
	private nextVoiceId = 1;
	private readonly clipReadyResolves = new Map<number, (clip: AudioClipHandle) => void>();
	private readonly clipReadyRejects = new Map<number, (error: Error) => void>();
	private readonly voices = new Map<number, WorkerVoice>();
	private readonly msgSetMasterGain: { type: 'set_master_gain'; gain: number } = { type: 'set_master_gain', gain: 1 };
	private readonly msgSetFrameTimeSec: { type: 'set_frame_time'; frameTimeSec: number } = { type: 'set_frame_time', frameTimeSec: DEFAULT_FRAME_TIME_SEC };
	private readonly msgDisposeClip: { type: 'dispose_clip'; clipId: number } = { type: 'dispose_clip', clipId: 0 };
	private readonly msgVoiceSetGain: { type: 'voice_set_gain'; voiceId: number; gain: number } = { type: 'voice_set_gain', voiceId: 0, gain: 1 };
	private readonly msgVoiceRampGain: { type: 'voice_ramp_gain'; voiceId: number; targetGain: number; seconds: number } = {
		type: 'voice_ramp_gain',
		voiceId: 0,
		targetGain: 1,
		seconds: 0,
	};
	private readonly msgVoiceSetRate: { type: 'voice_set_rate'; voiceId: number; rate: number } = { type: 'voice_set_rate', voiceId: 0, rate: 1 };
	private readonly msgVoiceStop: { type: 'voice_stop'; voiceId: number } = { type: 'voice_stop', voiceId: 0 };

	constructor(context: AudioContext, options: WorkerStreamingAudioOptions = {}) {
		if (globalThis.crossOriginIsolated !== true) {
			throw new Error('[WorkerStreamingAudioService] SharedArrayBuffer audio backend requires crossOriginIsolated=true.');
		}
		if (typeof AudioWorkletNode !== 'function') {
			throw new Error('[WorkerStreamingAudioService] AudioWorkletNode is not available.');
		}

		const requestedCapacity = Math.floor(options.capacityFrames ?? DEFAULT_CAPACITY_FRAMES);
		if (requestedCapacity < 2048) {
			throw new Error('[WorkerStreamingAudioService] capacityFrames must be at least 2048.');
		}
		this.preferHighLead = isIOSDevice();
		const initialFrameTimeSec = options.frameTimeSec;
		if (initialFrameTimeSec !== undefined && (!Number.isFinite(initialFrameTimeSec) || initialFrameTimeSec <= 0)) {
			throw new Error('[WorkerStreamingAudioService] frameTimeSec must be a positive finite value.');
		}
		this.frameTimeSec = initialFrameTimeSec ?? (this.preferHighLead ? IOS_FRAME_TIME_SEC : DEFAULT_FRAME_TIME_SEC);

		this.ctx = context;
		this.coreStreamCapacityFrames = requestedCapacity;
		this.coreStreamSamplesBuffer = new SharedArrayBuffer(this.coreStreamCapacityFrames * 2 * Int16Array.BYTES_PER_ELEMENT);
		this.coreStreamControlBuffer = new SharedArrayBuffer(CORE_CTRL_LENGTH * Int32Array.BYTES_PER_ELEMENT);
		this.coreStreamSamples = new Int16Array(this.coreStreamSamplesBuffer);
		this.coreStreamControl = new Int32Array(this.coreStreamControlBuffer);
		this.coreStreamControl[CORE_CTRL_READ_PTR] = 0;
		this.coreStreamControl[CORE_CTRL_WRITE_PTR] = 0;
		this.coreStreamControl[CORE_CTRL_OVERRUNS] = 0;
		this.coreStreamControl[CORE_CTRL_UNDERRUNS] = 0;
		this.coreStreamControl[CORE_CTRL_SEQ] = 0;

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
			this.workletNode = new AudioWorkletNode(this.ctx, 'bmsx-core-stream-out', {
				numberOfInputs: 0,
				numberOfOutputs: 1,
				outputChannelCount: [2],
				channelCount: 2,
				channelCountMode: 'explicit',
				processorOptions: {
					coreSamplesBuffer: this.coreStreamSamplesBuffer,
					coreControlBuffer: this.coreStreamControlBuffer,
					coreCapacityFrames: this.coreStreamCapacityFrames,
					frameTimeSec: this.frameTimeSec,
					preferHighLead: this.preferHighLead,
				},
			});
			this.workletNode.port.onmessage = this.handleWorkletControlMessage;
			this.workletNode.connect(this.ctx.destination);
			this.workletNode.port.postMessage({
				type: 'configure',
				frameTimeSec: this.frameTimeSec,
				preferHighLead: this.preferHighLead,
			} satisfies MainToWorkletMessage);
			if (this.resolveReady !== null) {
				this.resolveReady();
				this.resolveReady = null;
				this.rejectReady = null;
			}
			if (this.workletModuleUrl.length > 0) {
				URL.revokeObjectURL(this.workletModuleUrl);
				this.workletModuleUrl = '';
			}
		} catch (error) {
			this.setFatal(error instanceof Error ? error : new Error(String(error)));
		}
	}

	private createWorkletBlobUrl(): string {
		const source = `
(() => {
	const CORE_CTRL_READ_PTR = 0;
	const CORE_CTRL_WRITE_PTR = 1;
	const CORE_CTRL_OVERRUNS = 2;
	const CORE_CTRL_UNDERRUNS = 3;
	const CORE_CTRL_SEQ = 4;
	const PCM_SCALE = 1 / 32768;
	const WORKLET_TARGET_MIN_DEFAULT = 384;
	const WORKLET_TARGET_MAX_DEFAULT = 4096;
	const WORKLET_TARGET_MIN_IOS = 768;
	const WORKLET_TARGET_MAX_IOS = 4096;
	const WORKLET_REARM_MARGIN_DEFAULT = 128;
	const WORKLET_REARM_MARGIN_IOS = 256;
	const WORKLET_REQUEST_AHEAD_DEFAULT = 256;
	const WORKLET_REQUEST_AHEAD_IOS = 384;
	const WORKLET_NEED_REPOST_INTERVAL_MS = 2;
	const BADP_HEADER_SIZE = 48;
	const BADP_VERSION = 1;
	const BADP_NO_LOOP = 0xffffffff;
	const MAX_ACTIVE_VOICES = 128;
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

	function clamp(value, min, max) {
		if (value < min) return min;
		if (value > max) return max;
		return value;
	}

	class BadpDecoderCursor {
		constructor() {
			this.clip = null;
			this.view = null;
			this.predictors = new Int32Array(2);
			this.stepIndices = new Int32Array(2);
			this.nextFrame = 0;
			this.blockEnd = 0;
			this.blockFrames = 0;
			this.blockFrameIndex = 0;
			this.payloadOffset = 0;
			this.nibbleCursor = 0;
			this.decodedFrame = -1;
			this.decodedLeft = 0;
			this.decodedRight = 0;
			this.previousDecodedFrame = -1;
			this.previousDecodedLeft = 0;
			this.previousDecodedRight = 0;
		}

		reset(clip, frame) {
			this.clip = clip;
			this.view = new DataView(clip.bytes.buffer, clip.bytes.byteOffset, clip.bytes.byteLength);
			this.nextFrame = 0;
			this.blockEnd = 0;
			this.blockFrames = 0;
			this.blockFrameIndex = 0;
			this.payloadOffset = 0;
			this.nibbleCursor = 0;
			this.decodedFrame = -1;
			this.decodedLeft = 0;
			this.decodedRight = 0;
			this.previousDecodedFrame = -1;
			this.previousDecodedLeft = 0;
			this.previousDecodedRight = 0;
			this.seekToFrame(frame);
		}

		readFrameAt(frame, out) {
			if (frame < 0 || frame >= this.clip.frames) {
				return false;
			}
			if (frame === this.decodedFrame) {
				out[0] = this.decodedLeft;
				out[1] = this.decodedRight;
				return true;
			}
			if (frame === this.previousDecodedFrame) {
				out[0] = this.previousDecodedLeft;
				out[1] = this.previousDecodedRight;
				return true;
			}
			if (frame < this.nextFrame) {
				this.seekToFrame(frame);
			}
			while (this.nextFrame <= frame) {
				this.decodeNextFrame();
			}
			out[0] = this.decodedLeft;
			out[1] = this.decodedRight;
			return true;
		}

		seekToFrame(frame) {
			if (frame < 0 || frame > this.clip.frames) {
				throw new Error('[WorkerStreamingAudioService.worklet] BADP seek frame out of range.');
			}
			if (frame === this.clip.frames) {
				this.nextFrame = frame;
				this.decodedFrame = -1;
				this.decodedLeft = 0;
				this.decodedRight = 0;
				this.previousDecodedFrame = -1;
				this.previousDecodedLeft = 0;
				this.previousDecodedRight = 0;
				return;
			}
			let seekIndex = 0;
			let lo = 0;
			let hi = this.clip.seekFrames.length - 1;
			while (lo <= hi) {
				const mid = (lo + hi) >> 1;
				if (this.clip.seekFrames[mid] <= frame) {
					seekIndex = mid;
					lo = mid + 1;
				} else {
					hi = mid - 1;
				}
			}
			let currentFrame = this.clip.seekFrames[seekIndex];
			let cursor = this.clip.dataOffset + this.clip.seekOffsets[seekIndex];
			this.loadBlock(cursor);
			while (currentFrame + this.blockFrames <= frame) {
				currentFrame += this.blockFrames;
				cursor = this.blockEnd;
				this.loadBlock(cursor);
			}
			this.nextFrame = currentFrame;
			this.decodedFrame = -1;
			this.decodedLeft = 0;
			this.decodedRight = 0;
			this.previousDecodedFrame = -1;
			this.previousDecodedLeft = 0;
			this.previousDecodedRight = 0;
			while (this.nextFrame <= frame) {
				this.decodeNextFrame();
			}
		}

		loadBlock(offset) {
			if (offset + 4 > this.clip.bytes.byteLength) {
				throw new Error('[WorkerStreamingAudioService.worklet] BADP block header exceeds bounds.');
			}
			const blockFrames = this.view.getUint16(offset, true);
			const blockBytes = this.view.getUint16(offset + 2, true);
			if (blockFrames <= 0) {
				throw new Error('[WorkerStreamingAudioService.worklet] BADP block frame count invalid.');
			}
			const blockHeaderBytes = 4 + this.clip.channels * 4;
			if (blockBytes < blockHeaderBytes) {
				throw new Error('[WorkerStreamingAudioService.worklet] BADP block header length invalid.');
			}
			const blockEnd = offset + blockBytes;
			if (blockEnd > this.clip.bytes.byteLength) {
				throw new Error('[WorkerStreamingAudioService.worklet] BADP block exceeds bounds.');
			}
			let cursor = offset + 4;
			for (let channel = 0; channel < this.clip.channels; channel += 1) {
				const predictor = this.view.getInt16(cursor, true);
				const stepIndex = this.view.getUint8(cursor + 2);
				if (stepIndex < 0 || stepIndex > 88) {
					throw new Error('[WorkerStreamingAudioService.worklet] BADP step index out of range.');
				}
				this.predictors[channel] = predictor;
				this.stepIndices[channel] = stepIndex;
				cursor += 4;
			}
			this.blockEnd = blockEnd;
			this.blockFrames = blockFrames;
			this.blockFrameIndex = 0;
			this.payloadOffset = offset + blockHeaderBytes;
			this.nibbleCursor = 0;
		}

		decodeNextFrame() {
			if (this.nextFrame >= this.clip.frames) {
				throw new Error('[WorkerStreamingAudioService.worklet] BADP decode advanced out of bounds.');
			}
			if (this.blockFrameIndex >= this.blockFrames) {
				this.loadBlock(this.blockEnd);
			}
			if (this.decodedFrame >= 0) {
				this.previousDecodedFrame = this.decodedFrame;
				this.previousDecodedLeft = this.decodedLeft;
				this.previousDecodedRight = this.decodedRight;
			} else {
				this.previousDecodedFrame = -1;
				this.previousDecodedLeft = 0;
				this.previousDecodedRight = 0;
			}
			let left = 0;
			let right = 0;
			for (let channel = 0; channel < this.clip.channels; channel += 1) {
				const payloadIndex = this.payloadOffset + (this.nibbleCursor >> 1);
				if (payloadIndex >= this.blockEnd) {
					throw new Error('[WorkerStreamingAudioService.worklet] BADP payload underrun.');
				}
				const packed = this.clip.bytes[payloadIndex];
				const code = (this.nibbleCursor & 1) === 0 ? ((packed >> 4) & 0x0f) : (packed & 0x0f);
				this.nibbleCursor += 1;
				const step = ADPCM_STEP_TABLE[this.stepIndices[channel]];
				let diff = step >> 3;
				if ((code & 4) !== 0) diff += step;
				if ((code & 2) !== 0) diff += step >> 1;
				if ((code & 1) !== 0) diff += step >> 2;
				if ((code & 8) !== 0) {
					this.predictors[channel] -= diff;
				} else {
					this.predictors[channel] += diff;
				}
				if (this.predictors[channel] < -32768) this.predictors[channel] = -32768;
				if (this.predictors[channel] > 32767) this.predictors[channel] = 32767;
				this.stepIndices[channel] += ADPCM_INDEX_TABLE[code];
				if (this.stepIndices[channel] < 0) this.stepIndices[channel] = 0;
				if (this.stepIndices[channel] > 88) this.stepIndices[channel] = 88;
				if (channel === 0) left = this.predictors[channel];
				else right = this.predictors[channel];
			}
			if (this.clip.channels === 1) {
				right = left;
			}
			this.blockFrameIndex += 1;
			this.nextFrame += 1;
			this.decodedFrame = this.nextFrame - 1;
			this.decodedLeft = left;
			this.decodedRight = right;
		}
	}

	class BmsxCoreStreamOut extends AudioWorkletProcessor {
		constructor(options) {
			super();
			const processorOptions = options.processorOptions;
			this.coreSamples = new Int16Array(processorOptions.coreSamplesBuffer);
			this.coreControl = new Int32Array(processorOptions.coreControlBuffer);
			this.coreCapacityFrames = processorOptions.coreCapacityFrames;
			this.frameTimeSec = processorOptions.frameTimeSec;
			this.preferHighLead = processorOptions.preferHighLead === true;
			this.masterGain = 1;
			this.lastStatsMs = 0;
			this.lastNeedMs = 0;
			this.needArmed = true;
			this.readPos = Atomics.load(this.coreControl, CORE_CTRL_READ_PTR) >>> 0;
			this.lastCommittedWritePtr = Atomics.load(this.coreControl, CORE_CTRL_WRITE_PTR) >>> 0;
			this.rate = 1;
			this.lastSampleL = 0;
			this.lastSampleR = 0;
			this.concealMode = 0;
			this.concealUnderrunCount = 0;
			this.recoverPos = 0;
			this.recoverLength = 256;
			this.concealThreshold = 16;
			this.recoverFromL = 0;
			this.recoverFromR = 0;
			this.concealGain = 1;
			this.concealDecayPerFrame = 1 / this.recoverLength;
			this.clips = new Map();
			this.voices = new Map();
			this.activeVoices = new Array(MAX_ACTIVE_VOICES);
			this.activeVoiceCount = 0;
			this.voiceScratch0 = new Int16Array(2);
			this.voiceScratch1 = new Int16Array(2);
			this.voiceSampledL = 0;
			this.voiceSampledR = 0;
			this.endedVoiceIds = new Int32Array(MAX_ACTIVE_VOICES);
			this.endedVoiceCount = 0;
			this.voiceRemoveIds = new Int32Array(MAX_ACTIVE_VOICES);
			this.voiceRemoveCount = 0;
			this.decoderPool = new Array(MAX_ACTIVE_VOICES);
			this.decoderPoolCount = 0;
			this.voicePool = new Array(MAX_ACTIVE_VOICES);
			this.voicePoolCount = 0;
			this.needMainMessage = { type: 'need_main' };
			this.statsMessage = {
				type: 'stats',
				fillFrames: 0,
				underruns: 0,
				overruns: 0,
				rate: 1,
				mixTimeMs: 0,
			};
			this.clipReadyMessage = { type: 'clip_ready', clipId: 0, durationSec: 0 };
			this.voiceEndedMessage = { type: 'voice_ended', voiceId: 0 };
			this.needPortConnectedMessage = { type: 'need_port_connected' };
			this.needPortErrorMessage = { type: 'need_port_error', reason: '' };
			this.workletErrorMessage = { type: 'worklet_error', message: '' };

			this.port.onmessage = (event) => {
				const message = event.data;
				try {
					switch (message.type) {
						case 'configure':
							this.frameTimeSec = message.frameTimeSec;
							this.preferHighLead = message.preferHighLead === true;
							break;
						case 'set_frame_time':
							this.frameTimeSec = message.frameTimeSec;
							break;
						case 'set_master_gain':
							this.masterGain = clamp(message.gain, 0, 1);
							break;
						case 'register_badp_clip':
							this.registerBadpClip(message.clipId, message.bytes);
							break;
						case 'dispose_clip':
							this.disposeClip(message.clipId);
							break;
						case 'create_voice':
							this.createVoice(message);
							break;
						case 'voice_set_gain':
							this.setVoiceGain(message.voiceId, message.gain);
							break;
						case 'voice_ramp_gain':
							this.rampVoiceGain(message.voiceId, message.targetGain, message.seconds);
							break;
						case 'voice_set_rate':
							this.setVoiceRate(message.voiceId, message.rate);
							break;
						case 'voice_stop':
							this.stopVoice(message.voiceId);
							break;
						default:
							this.needPortErrorMessage.reason = 'unsupported message type';
							this.port.postMessage(this.needPortErrorMessage);
					}
				} catch (error) {
					const err = error instanceof Error ? error : new Error(String(error));
					this.workletErrorMessage.message = err.message;
					this.port.postMessage(this.workletErrorMessage);
				}
			};

			this.port.postMessage(this.needPortConnectedMessage);
		}

		enqueueEndedVoice(voiceId) {
			this.endedVoiceIds[this.endedVoiceCount] = voiceId;
			this.endedVoiceCount += 1;
		}

		acquireDecoder(clip, frame) {
			if (this.decoderPoolCount > 0) {
				this.decoderPoolCount -= 1;
				const decoder = this.decoderPool[this.decoderPoolCount];
				this.decoderPool[this.decoderPoolCount] = null;
				decoder.reset(clip, frame);
				return decoder;
			}
			const decoder = new BadpDecoderCursor();
			decoder.reset(clip, frame);
			return decoder;
		}

		releaseDecoder(decoder) {
			if (this.decoderPoolCount >= MAX_ACTIVE_VOICES) {
				return;
			}
			this.decoderPool[this.decoderPoolCount] = decoder;
			this.decoderPoolCount += 1;
		}

		acquireVoice() {
			if (this.voicePoolCount > 0) {
				this.voicePoolCount -= 1;
				const voice = this.voicePool[this.voicePoolCount];
				this.voicePool[this.voicePoolCount] = null;
				return voice;
			}
			return {
				voiceId: 0,
				clip: null,
				decoder: null,
				activeIndex: -1,
				positionFrames: 0,
				stepFrames: 1,
				loopEnabled: false,
				loopStartFrames: 0,
				loopEndFrames: 0,
				gainLinear: 1,
				targetGainLinear: 1,
				gainRampRemainingFrames: 0,
				gainRampDelta: 0,
				startedCounter: 0,
			};
		}

		releaseVoice(voice) {
			const decoder = voice.decoder;
			if (decoder !== null) {
				this.releaseDecoder(decoder);
				voice.decoder = null;
			}
			voice.activeIndex = -1;
			if (this.voicePoolCount >= MAX_ACTIVE_VOICES) {
				return;
			}
			this.voicePool[this.voicePoolCount] = voice;
			this.voicePoolCount += 1;
		}

		removeVoice(voiceId) {
			const voice = this.voices.get(voiceId);
			if (!voice) {
				return;
			}
			this.voices.delete(voiceId);
			const lastIndex = this.activeVoiceCount - 1;
			const removeIndex = voice.activeIndex;
			if (removeIndex !== lastIndex) {
				const movedVoice = this.activeVoices[lastIndex];
				this.activeVoices[removeIndex] = movedVoice;
				movedVoice.activeIndex = removeIndex;
			}
			this.activeVoices[lastIndex] = null;
			this.activeVoiceCount = lastIndex;
			this.releaseVoice(voice);
			this.enqueueEndedVoice(voiceId);
		}

		registerBadpClip(clipId, bytesBuffer) {
			const bytes = new Uint8Array(bytesBuffer);
			if (bytes.byteLength < BADP_HEADER_SIZE) {
				throw new Error('[WorkerStreamingAudioService.worklet] BADP asset too small.');
			}
			if (bytes[0] !== 0x42 || bytes[1] !== 0x41 || bytes[2] !== 0x44 || bytes[3] !== 0x50) {
				throw new Error('[WorkerStreamingAudioService.worklet] BADP signature invalid.');
			}
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			const version = view.getUint16(4, true);
			if (version !== BADP_VERSION) {
				throw new Error('[WorkerStreamingAudioService.worklet] BADP version unsupported.');
			}
			const channels = view.getUint16(6, true);
			const sampleRateClip = view.getUint32(8, true);
			const frames = view.getUint32(12, true);
			const loopStartFrame = view.getUint32(16, true);
			const loopEndFrame = view.getUint32(20, true);
			const seekEntryCount = view.getUint32(28, true);
			const seekTableOffset = view.getUint32(32, true);
			const dataOffset = view.getUint32(36, true);
			if (channels <= 0 || channels > 2) {
				throw new Error('[WorkerStreamingAudioService.worklet] BADP channels must be 1 or 2.');
			}
			if (sampleRateClip <= 0) {
				throw new Error('[WorkerStreamingAudioService.worklet] BADP sample rate invalid.');
			}
			if (frames === 0) {
				throw new Error('[WorkerStreamingAudioService.worklet] BADP frame count invalid.');
			}
			if (dataOffset < BADP_HEADER_SIZE || dataOffset > bytes.byteLength) {
				throw new Error('[WorkerStreamingAudioService.worklet] BADP data offset invalid.');
			}
			if (seekEntryCount > 0 && (seekTableOffset < BADP_HEADER_SIZE || seekTableOffset >= dataOffset)) {
				throw new Error('[WorkerStreamingAudioService.worklet] BADP seek table offset invalid.');
			}
			const seekFrames = new Uint32Array(seekEntryCount > 0 ? seekEntryCount : 1);
			const seekOffsets = new Uint32Array(seekEntryCount > 0 ? seekEntryCount : 1);
			if (seekEntryCount > 0) {
				let cursor = seekTableOffset;
				for (let index = 0; index < seekEntryCount; index += 1) {
					if (cursor + 8 > dataOffset) {
						throw new Error('[WorkerStreamingAudioService.worklet] BADP seek table exceeds bounds.');
					}
					seekFrames[index] = view.getUint32(cursor, true);
					seekOffsets[index] = view.getUint32(cursor + 4, true);
					cursor += 8;
				}
			} else {
				seekFrames[0] = 0;
				seekOffsets[0] = 0;
			}
			this.clips.set(clipId, {
				clipId,
				bytes,
				channels,
				sampleRate: sampleRateClip,
				frames,
				durationSec: frames / sampleRateClip,
				loopStartFrame,
				loopEndFrame,
				dataOffset,
				seekFrames,
				seekOffsets,
			});
			this.clipReadyMessage.clipId = clipId;
			this.clipReadyMessage.durationSec = frames / sampleRateClip;
			this.port.postMessage(this.clipReadyMessage);
		}

		disposeClip(clipId) {
			if (!this.clips.has(clipId)) {
				return;
			}
			this.clips.delete(clipId);
			this.voiceRemoveCount = 0;
			for (let index = 0; index < this.activeVoiceCount; index += 1) {
				const voice = this.activeVoices[index];
				if (voice.clip.clipId === clipId) {
					this.voiceRemoveIds[this.voiceRemoveCount] = voice.voiceId;
					this.voiceRemoveCount += 1;
				}
			}
			for (let i = 0; i < this.voiceRemoveCount; i += 1) {
				this.removeVoice(this.voiceRemoveIds[i]);
			}
		}

		createVoice(message) {
			const clip = this.clips.get(message.clipId);
			if (!clip) {
				throw new Error('[WorkerStreamingAudioService.worklet] Clip not registered for voice.');
			}
			if (this.activeVoiceCount >= MAX_ACTIVE_VOICES) {
				let oldestId = -1;
				let oldestCounter = Infinity;
				for (let index = 0; index < this.activeVoiceCount; index += 1) {
					const voice = this.activeVoices[index];
					if (voice.startedCounter < oldestCounter) {
						oldestCounter = voice.startedCounter;
						oldestId = voice.voiceId;
					}
				}
				if (oldestId !== -1) {
					this.removeVoice(oldestId);
				}
			}
			const loop = message.params.loop;
			const hasHeaderLoop = clip.loopStartFrame !== BADP_NO_LOOP
				&& clip.loopEndFrame !== BADP_NO_LOOP
				&& clip.loopEndFrame > clip.loopStartFrame;
			const loopEnabled = loop !== null || hasHeaderLoop;
			const loopStartFrames = loop !== null
				? clamp(Math.floor(loop.start * clip.sampleRate), 0, clip.frames)
				: (hasHeaderLoop ? clamp(clip.loopStartFrame, 0, clip.frames) : 0);
			const loopEndFrames = loop !== null
				? clamp(Math.floor((loop.end !== undefined ? loop.end : clip.durationSec) * clip.sampleRate), 0, clip.frames)
				: (hasHeaderLoop ? clamp(clip.loopEndFrame, 0, clip.frames) : clip.frames);
			if (loopEnabled && loopEndFrames <= loopStartFrames) {
				throw new Error('[WorkerStreamingAudioService.worklet] Loop end must be greater than loop start.');
			}
			let positionFrames = message.params.offset * clip.sampleRate;
			if (loopEnabled) {
				positionFrames = this.wrapLoopFrame(positionFrames, loopStartFrames, loopEndFrames);
			} else {
				positionFrames = clamp(positionFrames, 0, clip.frames);
			}
			const stepFrames = (clip.sampleRate / sampleRate) * message.params.rate;
			if (!Number.isFinite(stepFrames) || stepFrames <= 0) {
				throw new Error('[WorkerStreamingAudioService.worklet] Voice rate must be positive.');
			}
			const nowCounter = Atomics.load(this.coreControl, CORE_CTRL_READ_PTR) >>> 0;
			const voice = this.acquireVoice();
			voice.voiceId = message.voiceId;
			voice.clip = clip;
			voice.decoder = this.acquireDecoder(clip, Math.floor(positionFrames));
			voice.positionFrames = positionFrames;
			voice.stepFrames = stepFrames;
			voice.loopEnabled = loopEnabled;
			voice.loopStartFrames = loopStartFrames;
			voice.loopEndFrames = loopEndFrames;
			voice.gainLinear = clamp(message.params.gainLinear, 0, 1);
			voice.targetGainLinear = voice.gainLinear;
			voice.gainRampRemainingFrames = 0;
			voice.gainRampDelta = 0;
			voice.startedCounter = nowCounter;
			voice.activeIndex = this.activeVoiceCount;
			this.activeVoices[this.activeVoiceCount] = voice;
			this.activeVoiceCount += 1;
			this.voices.set(voice.voiceId, voice);
		}

		setVoiceGain(voiceId, gain) {
			const voice = this.voices.get(voiceId);
			if (!voice) {
				return;
			}
			const clamped = clamp(gain, 0, 1);
			voice.gainLinear = clamped;
			voice.targetGainLinear = clamped;
			voice.gainRampRemainingFrames = 0;
			voice.gainRampDelta = 0;
		}

		rampVoiceGain(voiceId, targetGain, seconds) {
			const voice = this.voices.get(voiceId);
			if (!voice) {
				return;
			}
			const target = clamp(targetGain, 0, 1);
			const frames = Math.max(1, Math.floor(seconds * sampleRate));
			voice.targetGainLinear = target;
			voice.gainRampRemainingFrames = frames;
			voice.gainRampDelta = (target - voice.gainLinear) / frames;
		}

		setVoiceRate(voiceId, rate) {
			const voice = this.voices.get(voiceId);
			if (!voice) {
				return;
			}
			const step = (voice.clip.sampleRate / sampleRate) * rate;
			if (!Number.isFinite(step) || step <= 0) {
				throw new Error('[WorkerStreamingAudioService.worklet] Voice rate must be positive.');
			}
			voice.stepFrames = step;
		}

		stopVoice(voiceId) {
			this.removeVoice(voiceId);
		}

		wrapLoopFrame(positionFrames, loopStartFrames, loopEndFrames) {
			const length = loopEndFrames - loopStartFrames;
			if (length <= 0) {
				return loopStartFrames;
			}
			let wrapped = (positionFrames - loopStartFrames) % length;
			if (wrapped < 0) {
				wrapped += length;
			}
			return loopStartFrames + wrapped;
		}

		sampleVoiceFrame(voice) {
			let positionFrames = voice.positionFrames;
			let frame = Math.floor(positionFrames);
			if (voice.loopEnabled) {
				if (frame >= voice.loopEndFrames || frame < voice.loopStartFrames) {
					positionFrames = this.wrapLoopFrame(positionFrames, voice.loopStartFrames, voice.loopEndFrames);
					frame = Math.floor(positionFrames);
				}
			} else if (frame >= voice.clip.frames) {
				return false;
			}
			if (!voice.decoder.readFrameAt(frame, this.voiceScratch0)) {
				return false;
			}
			const frac = positionFrames - frame;
			if (frac === 0) {
				this.voiceSampledL = this.voiceScratch0[0] * PCM_SCALE;
				this.voiceSampledR = this.voiceScratch0[1] * PCM_SCALE;
				voice.positionFrames = positionFrames + voice.stepFrames;
				return true;
			}
			let frameNext = frame + 1;
			if (voice.loopEnabled) {
				if (frameNext >= voice.loopEndFrames) {
					frameNext = voice.loopStartFrames + (frameNext - voice.loopEndFrames);
				}
			} else if (frameNext >= voice.clip.frames) {
				frameNext = frame;
			}
			if (frameNext !== frame) {
				if (!voice.decoder.readFrameAt(frameNext, this.voiceScratch1)) {
					return false;
				}
				const left0 = this.voiceScratch0[0];
				const right0 = this.voiceScratch0[1];
				this.voiceSampledL = (left0 + (this.voiceScratch1[0] - left0) * frac) * PCM_SCALE;
				this.voiceSampledR = (right0 + (this.voiceScratch1[1] - right0) * frac) * PCM_SCALE;
			} else {
				this.voiceSampledL = this.voiceScratch0[0] * PCM_SCALE;
				this.voiceSampledR = this.voiceScratch0[1] * PCM_SCALE;
			}
			voice.positionFrames = positionFrames + voice.stepFrames;
			return true;
		}

		readCommittedWritePtr() {
			for (let attempt = 0; attempt < 4; attempt += 1) {
				const seq0 = Atomics.load(this.coreControl, CORE_CTRL_SEQ) | 0;
				if ((seq0 & 1) !== 0) {
					continue;
				}
				const writePtr = Atomics.load(this.coreControl, CORE_CTRL_WRITE_PTR) >>> 0;
				const seq1 = Atomics.load(this.coreControl, CORE_CTRL_SEQ) | 0;
				if (seq0 === seq1 && (seq1 & 1) === 0) {
					this.lastCommittedWritePtr = writePtr;
					return writePtr;
				}
			}
			return this.lastCommittedWritePtr;
		}

		computeTargetFillFrames() {
			const minTarget = this.preferHighLead ? WORKLET_TARGET_MIN_IOS : WORKLET_TARGET_MIN_DEFAULT;
			const maxTarget = this.preferHighLead ? WORKLET_TARGET_MAX_IOS : WORKLET_TARGET_MAX_DEFAULT;
			const requested = Math.ceil(sampleRate * this.frameTimeSec);
			const target = clamp(requested, minTarget, maxTarget);
			const capacityMax = this.coreCapacityFrames - 1;
			return target > capacityMax ? capacityMax : target;
		}

		process(_inputs, outputs) {
			const output = outputs[0];
			if (!output || output.length === 0) {
				return true;
			}
			const left = output[0];
			const right = output.length > 1 ? output[1] : output[0];
			const frames = left.length;
			const masterGain = this.masterGain;
			const activeVoices = this.activeVoices;

			const mixStartMs = currentTime * 1000;
			const readPtr = Atomics.load(this.coreControl, CORE_CTRL_READ_PTR) >>> 0;
			if (readPtr > this.readPos) {
				this.readPos = readPtr;
			}

			const writePtr = this.readCommittedWritePtr();
			let cursor = this.readPos >>> 0;
			const available = (writePtr - cursor) >>> 0;
			let framesToRead = frames;
			if (framesToRead > available) {
				framesToRead = available;
			}
			if (framesToRead < frames && this.concealMode === 0) {
				this.concealUnderrunCount = frames - framesToRead;
				if (this.concealUnderrunCount >= this.concealThreshold) {
					this.concealMode = 1;
					this.concealGain = 1;
					this.recoverFromL = this.lastSampleL;
					this.recoverFromR = this.lastSampleR;
				}
			} else if (framesToRead < frames && this.concealMode === 1) {
				this.concealUnderrunCount += frames - framesToRead;
			}
			for (let frame = 0; frame < frames; frame += 1) {
				let outL = 0;
				let outR = 0;
				if (frame < framesToRead) {
					const src = (cursor % this.coreCapacityFrames) * 2;
					const sampleL = this.coreSamples[src] * PCM_SCALE * masterGain;
					const sampleR = this.coreSamples[src + 1] * PCM_SCALE * masterGain;
					outL = sampleL;
					outR = sampleR;
					if (this.concealMode === 1) {
						this.concealMode = 2;
						this.recoverPos = 0;
						this.recoverFromL = this.lastSampleL;
						this.recoverFromR = this.lastSampleR;
					}
					if (this.concealMode === 2) {
						const t = this.recoverPos / this.recoverLength;
						outL = sampleL * t + this.recoverFromL * (1 - t);
						outR = sampleR * t + this.recoverFromR * (1 - t);
						this.recoverPos += 1;
						if (this.recoverPos >= this.recoverLength) {
							this.concealMode = 0;
						}
					}
					cursor = (cursor + 1) >>> 0;
				} else if (this.concealMode !== 0) {
					outL = this.lastSampleL * this.concealGain;
					outR = this.lastSampleR * this.concealGain;
					this.concealGain -= this.concealDecayPerFrame;
					if (this.concealGain < 0) {
						this.concealGain = 0;
					}
				}
				this.voiceRemoveCount = 0;
				const activeVoiceCount = this.activeVoiceCount;
				for (let voiceIndex = 0; voiceIndex < activeVoiceCount; voiceIndex += 1) {
					const voice = activeVoices[voiceIndex];
					if (!this.sampleVoiceFrame(voice)) {
						this.voiceRemoveIds[this.voiceRemoveCount] = voice.voiceId;
						this.voiceRemoveCount += 1;
						continue;
					}
					const voiceGain = voice.gainLinear * masterGain;
					outL += this.voiceSampledL * voiceGain;
					outR += this.voiceSampledR * voiceGain;
					if (voice.gainRampRemainingFrames > 0) {
						voice.gainLinear += voice.gainRampDelta;
						voice.gainRampRemainingFrames -= 1;
						if (voice.gainRampRemainingFrames === 0) {
							voice.gainLinear = voice.targetGainLinear;
							voice.gainRampDelta = 0;
						}
					}
				}
				for (let i = 0; i < this.voiceRemoveCount; i += 1) {
					this.removeVoice(this.voiceRemoveIds[i]);
				}
				outL = clamp(outL, -1, 1);
				outR = clamp(outR, -1, 1);
				left[frame] = outL;
				right[frame] = outR;
				this.lastSampleL = outL;
				this.lastSampleR = outR;
			}
			const underruns = frames - framesToRead;

			this.readPos = cursor;
			Atomics.store(this.coreControl, CORE_CTRL_READ_PTR, cursor | 0);
			if (underruns > 0) {
				Atomics.add(this.coreControl, CORE_CTRL_UNDERRUNS, underruns);
			}

			const writeAfter = this.readCommittedWritePtr();
			const fillFrames = (writeAfter - cursor) >>> 0;
			const targetFill = this.computeTargetFillFrames();
			const rearmMargin = this.preferHighLead ? WORKLET_REARM_MARGIN_IOS : WORKLET_REARM_MARGIN_DEFAULT;
			const requestAhead = this.preferHighLead ? WORKLET_REQUEST_AHEAD_IOS : WORKLET_REQUEST_AHEAD_DEFAULT;
			const needTrigger = targetFill + requestAhead;
			const rearmTrigger = targetFill + rearmMargin + requestAhead;
			const nowMs = currentTime * 1000;
			if (this.needArmed) {
				if (fillFrames <= needTrigger) {
					this.needArmed = false;
					this.lastNeedMs = nowMs;
					this.port.postMessage(this.needMainMessage);
				}
			} else if (fillFrames >= rearmTrigger) {
				this.needArmed = true;
			} else if ((nowMs - this.lastNeedMs) >= WORKLET_NEED_REPOST_INTERVAL_MS) {
				this.lastNeedMs = nowMs;
				this.port.postMessage(this.needMainMessage);
			}

			if ((nowMs - this.lastStatsMs) >= 500) {
				this.lastStatsMs = nowMs;
				this.statsMessage.fillFrames = fillFrames;
				this.statsMessage.underruns = Atomics.load(this.coreControl, CORE_CTRL_UNDERRUNS) >>> 0;
				this.statsMessage.overruns = Atomics.load(this.coreControl, CORE_CTRL_OVERRUNS) >>> 0;
				this.statsMessage.rate = this.rate;
				this.statsMessage.mixTimeMs = nowMs - mixStartMs;
				this.port.postMessage(this.statsMessage);
			}

			if (this.endedVoiceCount > 0) {
				for (let i = 0; i < this.endedVoiceCount; i += 1) {
					this.voiceEndedMessage.voiceId = this.endedVoiceIds[i];
					this.port.postMessage(this.voiceEndedMessage);
				}
				this.endedVoiceCount = 0;
			}

			return true;
		}
	}

	registerProcessor('bmsx-core-stream-out', BmsxCoreStreamOut);
})();
`;
		return URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
	}

	private handleWorkletControlMessage = (event: MessageEvent<WorkletMessageToMain>): void => {
		const message = event.data;
		switch (message.type) {
			case 'need_port_connected':
				return;
			case 'need_main':
				this.pumpCoreNeed();
				return;
			case 'stats':
				return;
			case 'clip_ready': {
				const resolve = this.clipReadyResolves.get(message.clipId);
				if (!resolve) {
					return;
				}
				this.clipReadyResolves.delete(message.clipId);
				this.clipReadyRejects.delete(message.clipId);
				resolve(new WorkerClip(this, message.clipId, message.durationSec));
				return;
			}
			case 'voice_ended': {
				const voice = this.voices.get(message.voiceId);
				if (!voice) {
					return;
				}
				this.voices.delete(message.voiceId);
				voice.markEnded(this.ctx.currentTime);
				return;
			}
			case 'need_port_error':
				this.setFatal(new Error('[WorkerStreamingAudioService] Worklet control error: ' + message.reason));
				return;
			case 'worklet_error':
				this.setFatal(new Error('[WorkerStreamingAudioService] Worklet runtime error: ' + message.message));
				return;
			default:
				this.setFatal(new Error('[WorkerStreamingAudioService] Unsupported worklet control message.'));
		}
	};

	private computeTargetFillFramesMain(): number {
		const refillMargin = this.preferHighLead ? WORKLET_REARM_MARGIN_IOS : WORKLET_REARM_MARGIN_DEFAULT;
		const requestAhead = this.preferHighLead ? WORKLET_REQUEST_AHEAD_IOS : WORKLET_REQUEST_AHEAD_DEFAULT;
		// Match the worklet's rearm threshold so refill requests can actually restore steady-state headroom.
		const requested = Math.ceil(this.ctx.sampleRate * this.frameTimeSec) + requestAhead + refillMargin;
		const minTarget = this.preferHighLead ? WORKLET_TARGET_MIN_IOS : WORKLET_TARGET_MIN_DEFAULT;
		const maxTarget = this.preferHighLead ? WORKLET_TARGET_MAX_IOS : WORKLET_TARGET_MAX_DEFAULT;
		const target = requested < minTarget ? minTarget : (requested > maxTarget ? maxTarget : requested);
		const capacityMax = this.coreStreamCapacityFrames - 1;
		return target > capacityMax ? capacityMax : target;
	}

	private pumpCoreNeed(): void {
		if (this.coreNeedPumping) {
			return;
		}
		if (this.coreNeedHandler === null) {
			return;
		}
		this.coreNeedPumping = true;
		try {
			let budgetFrames = NEED_PUMP_BUDGET_FRAMES;
			const targetFrames = this.computeTargetFillFramesMain();
			while (budgetFrames > 0) {
				const queuedFrames = this.coreQueuedFrames();
				if (queuedFrames >= targetFrames) {
					break;
				}
				const beforeWrite = Atomics.load(this.coreStreamControl, CORE_CTRL_WRITE_PTR) >>> 0;
				this.coreNeedHandler();
				const afterWrite = Atomics.load(this.coreStreamControl, CORE_CTRL_WRITE_PTR) >>> 0;
				const writtenFrames = (afterWrite - beforeWrite) >>> 0;
				if (writtenFrames === 0) {
					break;
				}
				budgetFrames -= writtenFrames;
			}
		} finally {
			this.coreNeedPumping = false;
		}
	}

	private setFatal(error: Error): void {
		if (this.fatalError !== null) {
			return;
		}
		this.fatalError = error;
		this.coreNeedPumping = false;
		for (const reject of this.clipReadyRejects.values()) {
			reject(error);
		}
		this.clipReadyResolves.clear();
		this.clipReadyRejects.clear();
		if (this.rejectReady !== null) {
			this.rejectReady(error);
			this.resolveReady = null;
			this.rejectReady = null;
		}
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

	private postWorkletMessage(message: MainToWorkletMessage): void {
		if (this.workletNode === null) {
			throw new Error('[WorkerStreamingAudioService] AudioWorkletNode is not initialized.');
		}
		this.workletNode.port.postMessage(message);
	}

	public currentTime(): number {
		return this.ctx.currentTime;
	}

	public sampleRate(): number {
		return this.ctx.sampleRate;
	}

	public coreQueuedFrames(): number {
		const readPtr = Atomics.load(this.coreStreamControl, CORE_CTRL_READ_PTR) >>> 0;
		const writePtr = Atomics.load(this.coreStreamControl, CORE_CTRL_WRITE_PTR) >>> 0;
		return (writePtr - readPtr) >>> 0;
	}

	public setCoreNeedHandler(handler: (() => void) | null): void {
		this.coreNeedHandler = handler;
		if (handler === null) {
			this.coreNeedPumping = false;
		}
	}

	public clearCoreStream(): void {
		const readPtr = Atomics.load(this.coreStreamControl, CORE_CTRL_READ_PTR) >>> 0;
		const seqBegin = (Atomics.add(this.coreStreamControl, CORE_CTRL_SEQ, 1) + 1) | 0;
		Atomics.store(this.coreStreamControl, CORE_CTRL_WRITE_PTR, readPtr | 0);
		Atomics.store(this.coreStreamControl, CORE_CTRL_SEQ, (seqBegin + 1) | 0);
		Atomics.store(this.coreStreamControl, CORE_CTRL_UNDERRUNS, 0);
		Atomics.store(this.coreStreamControl, CORE_CTRL_OVERRUNS, 0);
	}

	public async resume(): Promise<void> {
		await this.ensureReady();
		if (this.ctx.state !== 'running') {
			await this.ctx.resume();
		}
	}

	public async suspend(): Promise<void> {
		await this.ensureReady();
		if (this.ctx.state === 'running') {
			await this.ctx.suspend();
		}
	}

	public getMasterGain(): number {
		return this.masterGain;
	}

	public setMasterGain(value: number): void {
		const gain = clamp01(value);
		this.masterGain = gain;
		if (this.workletNode !== null) {
			this.msgSetMasterGain.gain = gain;
			this.postWorkletMessage(this.msgSetMasterGain);
		}
	}

	public setFrameTimeSec(seconds: number): void {
		if (!Number.isFinite(seconds) || seconds <= 0) {
			throw new Error('[WorkerStreamingAudioService] frame time must be positive and finite.');
		}
		this.frameTimeSec = seconds;
		if (this.workletNode !== null) {
			this.msgSetFrameTimeSec.frameTimeSec = seconds;
			this.postWorkletMessage(this.msgSetFrameTimeSec);
		}
	}

	public async createClipFromBytes(bytes: ArrayBuffer): Promise<AudioClipHandle> {
		await this.ensureReady();
		const clipId = this.nextClipId++;
		const task = new Promise<AudioClipHandle>((resolve, reject) => {
			this.clipReadyResolves.set(clipId, resolve);
			this.clipReadyRejects.set(clipId, reject);
		});
		this.postWorkletMessage({
			type: 'register_badp_clip',
			clipId,
			bytes,
		});
		return task;
	}

	public pushCoreFrames(samples: Int16Array, _channels: number, _sampleRate: number): void {
		const frames = samples.length >>> 1;
		if (frames <= 0) {
			return;
		}

		const control = this.coreStreamControl;
		const stream = this.coreStreamSamples;
		const capacity = this.coreStreamCapacityFrames;
		const maxQueuedFrames = capacity - 1;
		const readPtr = Atomics.load(control, CORE_CTRL_READ_PTR) >>> 0;
		const writePtr = Atomics.load(control, CORE_CTRL_WRITE_PTR) >>> 0;
		const fill = (writePtr - readPtr) >>> 0;
		const boundedFill = fill > maxQueuedFrames ? maxQueuedFrames : fill;
		const free = maxQueuedFrames - boundedFill;
		let framesToWrite = frames;
		if (framesToWrite > free) {
			const framesDropped = framesToWrite - free;
			Atomics.add(control, CORE_CTRL_OVERRUNS, framesDropped);
			framesToWrite = free;
		}
		if (framesToWrite <= 0) {
			return;
		}

		const seqBegin = (Atomics.add(control, CORE_CTRL_SEQ, 1) + 1) | 0;
		let dstFrame = writePtr % capacity;
		let firstSpan = capacity - dstFrame;
		if (firstSpan > framesToWrite) {
			firstSpan = framesToWrite;
		}
		let dstCursor = dstFrame * 2;
		let srcCursor = 0;
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
		Atomics.store(control, CORE_CTRL_SEQ, (seqBegin + 1) | 0);
	}

	public createClipFromPcm(samples: Int16Array, sampleRate: number, channels: number): AudioClipHandle {
		this.pushCoreFrames(samples, channels, sampleRate);
		return this.coreStreamClip;
	}

	public createVoice(clip: AudioClipHandle, params: AudioPlaybackParams): VoiceHandle {
		if (clip === this.coreStreamClip) {
			return this.coreStreamVoice;
		}
		const workerClip = clip as WorkerClip;
		const voiceId = this.nextVoiceId++;
		const voice = new WorkerVoice(this, voiceId, this.ctx.currentTime, params.offset);
		this.voices.set(voiceId, voice);
		this.postWorkletMessage({
			type: 'create_voice',
			voiceId,
			clipId: workerClip.clipId,
			params,
		});
		return voice;
	}

	public disposeClip(clipId: number): void {
		this.msgDisposeClip.clipId = clipId;
		this.postWorkletMessage(this.msgDisposeClip);
	}

	public setVoiceGain(voiceId: number, gain: number): void {
		this.msgVoiceSetGain.voiceId = voiceId;
		this.msgVoiceSetGain.gain = clamp01(gain);
		this.postWorkletMessage(this.msgVoiceSetGain);
	}

	public rampVoiceGain(voiceId: number, targetGain: number, seconds: number): void {
		this.msgVoiceRampGain.voiceId = voiceId;
		this.msgVoiceRampGain.targetGain = clamp01(targetGain);
		this.msgVoiceRampGain.seconds = seconds;
		this.postWorkletMessage(this.msgVoiceRampGain);
	}

	public setVoiceRate(voiceId: number, rate: number): void {
		this.msgVoiceSetRate.voiceId = voiceId;
		this.msgVoiceSetRate.rate = rate;
		this.postWorkletMessage(this.msgVoiceSetRate);
	}

	public stopVoice(voiceId: number): void {
		this.msgVoiceStop.voiceId = voiceId;
		this.postWorkletMessage(this.msgVoiceStop);
	}

	public disconnectVoice(voiceId: number): void {
		this.voices.delete(voiceId);
	}
}
