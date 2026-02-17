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
	private readonly coreStreamVoice: WorkerCoreStreamVoice = new WorkerCoreStreamVoice();

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
	const WORKLET_TARGET_MIN_DEFAULT = 256;
	const WORKLET_TARGET_MAX_DEFAULT = 512;
	const WORKLET_TARGET_MIN_IOS = 512;
	const WORKLET_TARGET_MAX_IOS = 768;
	const WORKLET_NEED_MARGIN_FRAMES = 128;
	const PI_KP = 0.000015;
	const PI_KI = 0.00000015;
	const PI_INTEGRATOR_LIMIT = 40000;
	const RATE_MIN = 0.996;
	const RATE_MAX = 1.004;
	const NEED_POST_INTERVAL_MS = 2;
	const CONCEAL_FADE_OUT_MS = 3;
	const CONCEAL_FADE_IN_MS = 2;

	function clamp(value, min, max) {
		if (value < min) return min;
		if (value > max) return max;
		return value;
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
			this.integrator = 0;
			this.rate = 1;
			this.lastOutL = 0;
			this.lastOutR = 0;
			this.sampledL = 0;
			this.sampledR = 0;
			this.inUnderrun = false;
			this.concealGain = 0;
			this.fadeOutStep = 1 / Math.max(1, sampleRate * (CONCEAL_FADE_OUT_MS / 1000));
			this.fadeInStep = 1 / Math.max(1, sampleRate * (CONCEAL_FADE_IN_MS / 1000));

			this.port.onmessage = (event) => {
				const message = event.data;
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
					default:
						this.port.postMessage({ type: 'need_port_error', reason: 'unsupported message type' });
						break;
				}
			};

			this.port.postMessage({ type: 'need_port_connected' });
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
			this.integrator += error;
			this.integrator = clamp(this.integrator, -PI_INTEGRATOR_LIMIT, PI_INTEGRATOR_LIMIT);
			let nextRate = 1 + PI_KP * error + PI_KI * this.integrator;
			const lowWater = targetFill >> 1;
			const highWater = targetFill + (targetFill >> 1);
			if (fillFrames < lowWater) {
				nextRate -= Math.min(0.0015, (lowWater - fillFrames) * 0.000008);
			} else if (fillFrames > highWater) {
				nextRate += Math.min(0.0015, (fillFrames - highWater) * 0.000008);
			}
			this.rate = clamp(nextRate, RATE_MIN, RATE_MAX);
			return this.rate;
		}

		loadInterpolatedSample(framePos) {
			const baseFrame = Math.floor(framePos);
			const frac = framePos - baseFrame;
			const writePtr = Atomics.load(this.coreControl, CORE_CTRL_WRITE_PTR) >>> 0;
			const available = (writePtr - baseFrame) >>> 0;
			if (available === 0) {
				return false;
			}

			const src0 = (baseFrame % this.coreCapacityFrames) * 2;
			const s0L = this.coreSamples[src0] * PCM_SCALE;
			const s0R = this.coreSamples[src0 + 1] * PCM_SCALE;
			let s1L = s0L;
			let s1R = s0R;
			if (available > 1) {
				const src1 = ((baseFrame + 1) % this.coreCapacityFrames) * 2;
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
						outL = this.sampledL * (1 - blend) + this.lastOutL * blend;
						outR = this.sampledR * (1 - blend) + this.lastOutR * blend;
						this.concealGain -= this.fadeInStep;
						if (this.concealGain <= 0) {
							this.concealGain = 0;
							this.inUnderrun = false;
						}
					} else {
						outL = this.sampledL;
						outR = this.sampledR;
					}
					this.readPos += renderRate;
				} else {
					if (!this.inUnderrun) {
						this.inUnderrun = true;
						this.concealGain = 1;
					}
					outL = this.lastOutL * this.concealGain;
					outR = this.lastOutR * this.concealGain;
					if (this.concealGain > 0) {
						this.concealGain -= this.fadeOutStep;
						if (this.concealGain < 0) {
							this.concealGain = 0;
						}
					}
					localUnderruns += 1;
				}
				outL *= this.masterGain;
				outR *= this.masterGain;
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
				this.port.postMessage({ type: 'need_main' });
			}

			if (nowMs - this.lastStatsMs >= 500) {
				this.lastStatsMs = nowMs;
				this.port.postMessage({
					type: 'stats',
					fillFrames,
					underruns: Atomics.load(this.coreControl, CORE_CTRL_UNDERRUNS) >>> 0,
					overruns: Atomics.load(this.coreControl, CORE_CTRL_OVERRUNS) >>> 0,
					rate: this.rate,
					mixTimeMs: nowMs - mixStartMs,
				});
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

	currentTime(): number {
		return this.ctx.currentTime;
	}

	sampleRate(): number {
		return this.ctx.sampleRate;
	}

	coreQueuedFrames(): number {
		const readPtr = Atomics.load(this.coreStreamControl, CORE_CTRL_READ_PTR) >>> 0;
		const writePtr = Atomics.load(this.coreStreamControl, CORE_CTRL_WRITE_PTR) >>> 0;
		return (writePtr - readPtr) >>> 0;
	}

	setCoreNeedHandler(handler: (() => void) | null): void {
		this.coreNeedHandler = handler;
	}

	clearCoreStream(): void {
		const writePtr = Atomics.load(this.coreStreamControl, CORE_CTRL_WRITE_PTR) >>> 0;
		Atomics.store(this.coreStreamControl, CORE_CTRL_READ_PTR, writePtr | 0);
		Atomics.store(this.coreStreamControl, CORE_CTRL_UNDERRUNS, 0);
	}

	async resume(): Promise<void> {
		await this.ensureReady();
		if (this.ctx.state !== 'running') {
			await this.ctx.resume();
		}
	}

	async suspend(): Promise<void> {
		await this.ensureReady();
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
		if (this.workletNode !== null) {
			this.workletNode.port.postMessage({ type: 'set_master_gain', gain } satisfies MainToWorkletMessage);
		}
	}

	async decode(_bytes: ArrayBuffer): Promise<AudioClipHandle> {
		throw new Error('[WorkerStreamingAudioService] decode() is removed. Use pushCoreFrames() streaming only.');
	}

	pushCoreFrames(samples: Int16Array, _channels: number, _sampleRate: number): void {
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
			let framesToDrop = framesToWrite - free;
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
	}

	createClipFromPcm(samples: Int16Array, sampleRate: number, channels: number): AudioClipHandle {
		this.pushCoreFrames(samples, channels, sampleRate);
		return this.coreStreamClip;
	}

	createVoice(clip: AudioClipHandle, _params: AudioPlaybackParams): VoiceHandle {
		if (clip instanceof WorkerCoreStreamClip) {
			return this.coreStreamVoice;
		}
		throw new Error('[WorkerStreamingAudioService] createVoice() is removed. Use pushCoreFrames() streaming only.');
	}

	setFrameTimeSec(seconds: number): void {
		if (!Number.isFinite(seconds) || seconds <= 0) {
			throw new Error('[WorkerStreamingAudioService] frame time must be positive and finite.');
		}
		if (this.workletNode !== null) {
			this.workletNode.port.postMessage({ type: 'set_frame_time', frameTimeSec: seconds } satisfies MainToWorkletMessage);
		}
	}
}
