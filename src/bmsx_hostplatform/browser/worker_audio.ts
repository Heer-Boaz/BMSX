import { clamp01 } from 'bmsx/utils/clamp';
import {
	AudioService,
	AudioClipHandle,
} from '../platform';

const CORE_CTRL_READ_PTR = 0;
const CORE_CTRL_WRITE_PTR = 1;
const CORE_CTRL_OVERRUNS = 2;
const CORE_CTRL_UNDERRUNS = 3;
const CORE_CTRL_SEQ = 4;
const CORE_CTRL_LENGTH = 5;

const DEFAULT_CAPACITY_FRAMES = 16384;
const DEFAULT_FRAME_TIME_SEC = 0.012;
const IOS_FRAME_TIME_SEC = 0.018;
const WORKLET_TARGET_MIN_DEFAULT = 512;
const WORKLET_TARGET_MAX_DEFAULT = 1024;
const WORKLET_TARGET_MIN_MINIMAL = 128;
const WORKLET_TARGET_MAX_MINIMAL = 384;
const WORKLET_TARGET_MIN_IOS = 768;
const WORKLET_TARGET_MAX_IOS = 1536;
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
	private readonly msgSetMasterGain: { type: 'set_master_gain'; gain: number } = { type: 'set_master_gain', gain: 1 };
	private readonly msgSetFrameTimeSec: { type: 'set_frame_time'; frameTimeSec: number } = { type: 'set_frame_time', frameTimeSec: DEFAULT_FRAME_TIME_SEC };

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
	const WORKLET_TARGET_MIN_DEFAULT = 512;
	const WORKLET_TARGET_MAX_DEFAULT = 1024;
	const WORKLET_TARGET_MIN_MINIMAL = 128;
	const WORKLET_TARGET_MAX_MINIMAL = 384;
	const WORKLET_TARGET_MIN_IOS = 768;
	const WORKLET_TARGET_MAX_IOS = 1536;
	const WORKLET_REARM_MARGIN_DEFAULT = 128;
	const WORKLET_REARM_MARGIN_MINIMAL = 32;
	const WORKLET_REARM_MARGIN_IOS = 256;
	const WORKLET_REQUEST_AHEAD_DEFAULT = 256;
	const WORKLET_REQUEST_AHEAD_MINIMAL = 64;
	const WORKLET_REQUEST_AHEAD_IOS = 384;
	const WORKLET_NEED_REPOST_INTERVAL_MS = 2;

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
			this.needArmed = true;
			this.readPos = Atomics.load(this.coreControl, CORE_CTRL_READ_PTR) >>> 0;
			this.lastCommittedWritePtr = Atomics.load(this.coreControl, CORE_CTRL_WRITE_PTR) >>> 0;
			this.rate = 1;
			this.lastSampleL = 0;
			this.lastSampleR = 0;
			this.concealMode = 0;
			this.recoverPos = 0;
			this.recoverLength = 64;
			this.recoverFromL = 0;
			this.recoverFromR = 0;
			this.concealGain = 1;
			this.concealDecayPerFrame = 1 / this.recoverLength;
			this.needMainMessage = { type: 'need_main' };
			this.statsMessage = {
				type: 'stats',
				fillFrames: 0,
				underruns: 0,
				overruns: 0,
				rate: 1,
				mixTimeMs: 0,
			};
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
			const isMinimal = this.frameTimeSec <= 0.005;
			const minTarget = this.preferHighLead ? WORKLET_TARGET_MIN_IOS : (isMinimal ? WORKLET_TARGET_MIN_MINIMAL : WORKLET_TARGET_MIN_DEFAULT);
			const maxTarget = this.preferHighLead ? WORKLET_TARGET_MAX_IOS : (isMinimal ? WORKLET_TARGET_MAX_MINIMAL : WORKLET_TARGET_MAX_DEFAULT);
			const requested = Math.floor(sampleRate * this.frameTimeSec);
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
				this.concealMode = 1;
				this.concealGain = 1;
				this.recoverFromL = this.lastSampleL;
				this.recoverFromR = this.lastSampleR;
			}
			for (let frame = 0; frame < framesToRead; frame += 1) {
				const src = (cursor % this.coreCapacityFrames) * 2;
				const sampleL = this.coreSamples[src] * PCM_SCALE * this.masterGain;
				const sampleR = this.coreSamples[src + 1] * PCM_SCALE * this.masterGain;
				let outL = sampleL;
				let outR = sampleR;
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
				left[frame] = outL;
				right[frame] = outR;
				this.lastSampleL = outL;
				this.lastSampleR = outR;
				cursor = (cursor + 1) >>> 0;
			}
			for (let frame = framesToRead; frame < frames; frame += 1) {
				const outL = this.lastSampleL * this.concealGain;
				const outR = this.lastSampleR * this.concealGain;
				left[frame] = outL;
				right[frame] = outR;
				this.lastSampleL = outL;
				this.lastSampleR = outR;
				this.concealGain -= this.concealDecayPerFrame;
				if (this.concealGain < 0) {
					this.concealGain = 0;
				}
				this.concealMode = 1;
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
			const isMinimal = this.frameTimeSec <= 0.005;
			const rearmMargin = this.preferHighLead ? WORKLET_REARM_MARGIN_IOS : (isMinimal ? WORKLET_REARM_MARGIN_MINIMAL : WORKLET_REARM_MARGIN_DEFAULT);
			const requestAhead = this.preferHighLead ? WORKLET_REQUEST_AHEAD_IOS : (isMinimal ? WORKLET_REQUEST_AHEAD_MINIMAL : WORKLET_REQUEST_AHEAD_DEFAULT);
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
		const requested = Math.floor(this.ctx.sampleRate * this.frameTimeSec);
		const isMinimal = this.frameTimeSec <= 0.005;
		const minTarget = this.preferHighLead ? WORKLET_TARGET_MIN_IOS : (isMinimal ? WORKLET_TARGET_MIN_MINIMAL : WORKLET_TARGET_MIN_DEFAULT);
		const maxTarget = this.preferHighLead ? WORKLET_TARGET_MAX_IOS : (isMinimal ? WORKLET_TARGET_MAX_MINIMAL : WORKLET_TARGET_MAX_DEFAULT);
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
}
