import { clamp01 } from 'bmsx/utils/clamp';
import {
	AudioService,
	AudioClipHandle,
} from '../platform';

const CORE_CTRL_READ_PTR = 0;
const CORE_CTRL_WRITE_PTR = 1;
const CORE_CTRL_OVERRUNS = 2;
const CORE_CTRL_UNDERRUNS = 3;
const CORE_CTRL_LENGTH = 4;

const DEFAULT_CAPACITY_FRAMES = 16384;
const DEFAULT_FRAME_TIME_SEC = 0.005;
const IOS_FRAME_TIME_SEC = 0.014;

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
	};

class WorkerCoreStreamClip implements AudioClipHandle {
	readonly duration = 0;
	dispose(): void { }
}

export class WorkerStreamingAudioService implements AudioService {
	readonly available = true;

	private readonly ctx: AudioContext;
	private readonly capacityFrames: number;
	private readonly coreStreamCapacityFrames: number;
	private readonly coreStreamSamplesBuffer: SharedArrayBuffer;
	private readonly coreStreamControlBuffer: SharedArrayBuffer;
	private readonly coreStreamSamples: Int16Array;
	private readonly coreStreamControl: Int32Array;
	private readonly frameTimeSec: number;
	private readonly preferHighLead: boolean;

	private workletNode: AudioWorkletNode | null = null;
	private workletModuleUrl = '';
	private fatalError: Error | null = null;
	private readonly readyPromise: Promise<void>;
	private resolveReady: (() => void) | null = null;
	private rejectReady: ((error: Error) => void) | null = null;

	private masterGain = 1;
	private coreNeedHandler: (() => void) | null = null;
	private readonly coreStreamClip: WorkerCoreStreamClip = new WorkerCoreStreamClip();
	private readonly msgSetMasterGain: { type: 'set_master_gain'; gain: number } = { type: 'set_master_gain', gain: 1 };
	private readonly msgSetFrameTimeSec: { type: 'set_frame_time'; frameTimeSec: number } = { type: 'set_frame_time', frameTimeSec: DEFAULT_FRAME_TIME_SEC };

	constructor(context: AudioContext, options: WorkerStreamingAudioOptions = {}) {
		if (globalThis.crossOriginIsolated !== true) {
			throw new Error('[WorkerStreamingAudioService] SharedArrayBuffer audio backend requires crossOriginIsolated=true.');
		}
		if (typeof AudioWorkletNode !== 'function') {
			throw new Error('[WorkerStreamingAudioService] AudioWorkletNode is not available.');
		}

		this.capacityFrames = Math.floor(options.capacityFrames ?? DEFAULT_CAPACITY_FRAMES);
		if (this.capacityFrames < 2048) {
			throw new Error('[WorkerStreamingAudioService] capacityFrames must be at least 2048.');
		}
		const initialFrameTimeSec = options.frameTimeSec;
		this.preferHighLead = isIOSDevice();
		if (initialFrameTimeSec !== undefined && (!Number.isFinite(initialFrameTimeSec) || initialFrameTimeSec <= 0)) {
			throw new Error('[WorkerStreamingAudioService] frameTimeSec must be a positive finite value.');
		}
		this.frameTimeSec = initialFrameTimeSec ?? (this.preferHighLead ? IOS_FRAME_TIME_SEC : DEFAULT_FRAME_TIME_SEC);

		this.ctx = context;
		this.coreStreamCapacityFrames = this.capacityFrames < 4096 ? this.capacityFrames : 4096;
		this.coreStreamSamplesBuffer = new SharedArrayBuffer(this.coreStreamCapacityFrames * 2 * Int16Array.BYTES_PER_ELEMENT);
		this.coreStreamControlBuffer = new SharedArrayBuffer(CORE_CTRL_LENGTH * Int32Array.BYTES_PER_ELEMENT);
		this.coreStreamSamples = new Int16Array(this.coreStreamSamplesBuffer);
		this.coreStreamControl = new Int32Array(this.coreStreamControlBuffer);
		this.coreStreamControl[CORE_CTRL_READ_PTR] = 0;
		this.coreStreamControl[CORE_CTRL_WRITE_PTR] = 0;
		this.coreStreamControl[CORE_CTRL_OVERRUNS] = 0;
		this.coreStreamControl[CORE_CTRL_UNDERRUNS] = 0;

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
	const PCM_SCALE = 1 / 32768;
	const WORKLET_TARGET_MIN_DEFAULT = 192;
	const WORKLET_TARGET_MAX_DEFAULT = 384;
	const WORKLET_TARGET_MIN_IOS = 384;
	const WORKLET_TARGET_MAX_IOS = 640;
	const WORKLET_NEED_MARGIN_FRAMES = 128;
	const FIXED_RENDER_RATE = 1;
	const NEED_POST_INTERVAL_MS = 1;
	const CONCEAL_FADE_IN_MS = 2;
	const RATE_CONTROL_KP = 0.0000035;
	const RATE_CONTROL_KI = 0.00000002;
	const RATE_CONTROL_INTEGRAL_CLAMP = 16384;
	const RATE_CONTROL_DELTA_CLAMP = 0.003;
	const RATE_CONTROL_HARD_PULL_DELTA = 0.006;
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

	function clamp01(value) {
		return clamp(value, 0, 1);
	}

	function softclip(value) {
		return value / (1 + Math.abs(value));
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
				this.decodedFrame = frame - 1;
				this.decodedLeft = 0;
				this.decodedRight = 0;
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
			this.decodedFrame = currentFrame - 1;
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
			this.readPos = Atomics.load(this.coreControl, CORE_CTRL_READ_PTR) >>> 0;
			this.rate = 1;
			this.rateIntegral = 0;
			this.lastOutL = 0;
			this.lastOutR = 0;
			this.lastCoreL = 0;
			this.lastCoreR = 0;
			this.sampledL = 0;
			this.sampledR = 0;
			this.inUnderrun = false;
			this.concealGain = 0;
			this.fadeInStep = 1 / Math.max(1, sampleRate * (CONCEAL_FADE_IN_MS / 1000));
			this.clips = new Map();
			this.voices = new Map();
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
			this.decodedMessage = { type: 'decoded', clipId: 0, durationSec: 0 };
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
			this.decodedMessage.clipId = clipId;
			this.decodedMessage.durationSec = frames / sampleRateClip;
			this.port.postMessage(this.decodedMessage);
		}

		disposeClip(clipId) {
			if (!this.clips.has(clipId)) {
				return;
			}
			this.clips.delete(clipId);
			this.voiceRemoveCount = 0;
			for (const voice of this.voices.values()) {
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
			if (this.voices.size >= MAX_ACTIVE_VOICES) {
				let oldestId = -1;
				let oldestCounter = Infinity;
				for (const voice of this.voices.values()) {
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
			voice.gainLinear = clamp01(message.params.gainLinear);
			voice.targetGainLinear = voice.gainLinear;
			voice.gainRampRemainingFrames = 0;
			voice.gainRampDelta = 0;
			voice.startedCounter = nowCounter;
			this.voices.set(voice.voiceId, voice);
		}

		setVoiceGain(voiceId, gain) {
			const voice = this.voices.get(voiceId);
			if (!voice) {
				return;
			}
			const clamped = clamp01(gain);
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
			const target = clamp01(targetGain);
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

		computeTargetFillFrames() {
			const minTarget = this.preferHighLead ? WORKLET_TARGET_MIN_IOS : WORKLET_TARGET_MIN_DEFAULT;
			const maxTarget = this.preferHighLead ? WORKLET_TARGET_MAX_IOS : WORKLET_TARGET_MAX_DEFAULT;
			const requested = this.frameTimeSec > 0
				? Math.floor(sampleRate * this.frameTimeSec)
				: minTarget;
			return clamp(requested, minTarget, maxTarget);
		}

		updateRate(fillFrames, targetFill) {
			const error = fillFrames - targetFill;
			if (error > targetFill) {
				this.rate = FIXED_RENDER_RATE + RATE_CONTROL_HARD_PULL_DELTA;
				return this.rate;
			}
			if (error < -targetFill) {
				this.rate = FIXED_RENDER_RATE - RATE_CONTROL_HARD_PULL_DELTA;
				return this.rate;
			}
			this.rateIntegral += error;
			if (this.rateIntegral > RATE_CONTROL_INTEGRAL_CLAMP) {
				this.rateIntegral = RATE_CONTROL_INTEGRAL_CLAMP;
			} else if (this.rateIntegral < -RATE_CONTROL_INTEGRAL_CLAMP) {
				this.rateIntegral = -RATE_CONTROL_INTEGRAL_CLAMP;
			}
			let delta = error * RATE_CONTROL_KP + this.rateIntegral * RATE_CONTROL_KI;
			if (delta > RATE_CONTROL_DELTA_CLAMP) {
				delta = RATE_CONTROL_DELTA_CLAMP;
			} else if (delta < -RATE_CONTROL_DELTA_CLAMP) {
				delta = -RATE_CONTROL_DELTA_CLAMP;
			}
			this.rate = FIXED_RENDER_RATE + delta;
			return this.rate;
		}

		loadInterpolatedSample(framePos) {
			const baseFrame = Math.floor(framePos) >>> 0;
			const frac = framePos - baseFrame;
			const readPtr = Atomics.load(this.coreControl, CORE_CTRL_READ_PTR) >>> 0;
			const writePtr = Atomics.load(this.coreControl, CORE_CTRL_WRITE_PTR) >>> 0;

			// If read position lags behind the producer-consumer window, resync immediately.
			if (baseFrame < readPtr) {
				this.readPos = readPtr;
				this.rateIntegral = 0;
				return false;
			}

			if (baseFrame >= writePtr) {
				return false;
			}

			const src0 = (baseFrame % this.coreCapacityFrames) * 2;
			const s0L = this.coreSamples[src0] * PCM_SCALE;
			const s0R = this.coreSamples[src0 + 1] * PCM_SCALE;
			let s1L = s0L;
			let s1R = s0R;
			const nextFrame = (baseFrame + 1) >>> 0;
			if (nextFrame < writePtr) {
				const src1 = (nextFrame % this.coreCapacityFrames) * 2;
				s1L = this.coreSamples[src1] * PCM_SCALE;
				s1R = this.coreSamples[src1 + 1] * PCM_SCALE;
			}

			this.sampledL = s0L + (s1L - s0L) * frac;
			this.sampledR = s0R + (s1R - s0R) * frac;
			return true;
		}

		process(_inputs, outputs) {
			const output = outputs[0];
			if (!output || output.length === 0) {
				return true;
			}
			const left = output[0];
			const right = output.length > 1 ? output[1] : output[0];
			const frameCount = left.length;

			const mixStartMs = currentTime * 1000;
			const readPtr = Atomics.load(this.coreControl, CORE_CTRL_READ_PTR) >>> 0;
			if (readPtr > Math.floor(this.readPos)) {
				this.readPos = readPtr;
			}
			const targetFill = this.computeTargetFillFrames();
			const currentFill = (Atomics.load(this.coreControl, CORE_CTRL_WRITE_PTR) >>> 0) - (Math.floor(this.readPos) >>> 0);
			const renderRate = this.updateRate(currentFill >>> 0, targetFill);
			let localUnderruns = 0;

			for (let frame = 0; frame < frameCount; frame += 1) {
				const hasSample = this.loadInterpolatedSample(this.readPos);
				let outL = 0;
				let outR = 0;
				if (hasSample) {
					if (this.inUnderrun) {
						const blend = this.concealGain;
						outL = this.sampledL * (1 - blend) + this.lastCoreL * blend;
						outR = this.sampledR * (1 - blend) + this.lastCoreR * blend;
						this.concealGain -= this.fadeInStep;
						if (this.concealGain <= 0) {
							this.concealGain = 0;
							this.inUnderrun = false;
						}
					} else {
						outL = this.sampledL;
						outR = this.sampledR;
					}
					this.lastCoreL = outL;
					this.lastCoreR = outR;
					this.readPos += renderRate;
				} else {
					if (!this.inUnderrun) {
						this.inUnderrun = true;
						this.concealGain = 1;
					}
					outL = this.lastCoreL;
					outR = this.lastCoreR;
					this.rateIntegral = 0;
					localUnderruns += 1;
				}

				this.voiceRemoveCount = 0;
				for (const voice of this.voices.values()) {
					if (!this.sampleVoiceFrame(voice)) {
						this.voiceRemoveIds[this.voiceRemoveCount] = voice.voiceId;
						this.voiceRemoveCount += 1;
						continue;
					}
					outL += this.voiceSampledL * voice.gainLinear;
					outR += this.voiceSampledR * voice.gainLinear;
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

				outL = softclip(outL * this.masterGain);
				outR = softclip(outR * this.masterGain);
				left[frame] = outL;
				right[frame] = outR;
				this.lastOutL = outL;
				this.lastOutR = outR;
			}

			const committedReadPtr = Math.floor(this.readPos) >>> 0;
			Atomics.store(this.coreControl, CORE_CTRL_READ_PTR, committedReadPtr | 0);
			if (localUnderruns > 0) {
				Atomics.add(this.coreControl, CORE_CTRL_UNDERRUNS, localUnderruns);
			}

			const writeAfter = Atomics.load(this.coreControl, CORE_CTRL_WRITE_PTR) >>> 0;
			const fillFrames = (writeAfter - committedReadPtr) >>> 0;
			const needTrigger = targetFill + WORKLET_NEED_MARGIN_FRAMES;
			const nowMs = currentTime * 1000;
			if (fillFrames < needTrigger && (nowMs - this.lastNeedMs) >= NEED_POST_INTERVAL_MS) {
				this.lastNeedMs = nowMs;
				this.port.postMessage(this.needMainMessage);
			}

			if (nowMs - this.lastStatsMs >= 500) {
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
				if (this.coreNeedHandler !== null) {
					this.coreNeedHandler();
				}
				return;
			case 'stats':
				return;
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

	private postWorkletMessage(message: MainToWorkletMessage, transfer?: Transferable[]): void {
		if (this.workletNode === null) {
			throw new Error('[WorkerStreamingAudioService] AudioWorkletNode is not initialized.');
		}
		if (transfer && transfer.length > 0) {
			this.workletNode.port.postMessage(message, transfer);
		} else {
			this.workletNode.port.postMessage(message);
		}
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
	}

	public clearCoreStream(): void {
		const writePtr = Atomics.load(this.coreStreamControl, CORE_CTRL_WRITE_PTR) >>> 0;
		Atomics.store(this.coreStreamControl, CORE_CTRL_READ_PTR, writePtr | 0);
		Atomics.store(this.coreStreamControl, CORE_CTRL_UNDERRUNS, 0);
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

	public pushCoreFrames(samples: Int16Array, _channels: number, _sampleRate: number): void {
		const frames = samples.length >>> 1;

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
			const framesToDrop = framesToWrite - free;
			sourceStartFrame += framesToDrop;
			framesToWrite = free;
			Atomics.add(control, CORE_CTRL_OVERRUNS, framesToDrop);
			if (framesToWrite <= 0) {
				return;
			}
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
	}

	public createClipFromPcm(samples: Int16Array, sampleRate: number, channels: number): AudioClipHandle {
		this.pushCoreFrames(samples, channels, sampleRate);
		return this.coreStreamClip;
	}

	public setFrameTimeSec(seconds: number): void {
		if (!Number.isFinite(seconds) || seconds <= 0) {
			throw new Error('[WorkerStreamingAudioService] frame time must be positive and finite.');
		}
		if (this.workletNode !== null) {
			this.msgSetFrameTimeSec.frameTimeSec = seconds;
			this.postWorkletMessage(this.msgSetFrameTimeSec);
		}
	}
}
