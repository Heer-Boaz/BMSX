import { clamp01 } from 'bmsx/common/clamp';
import { isIOSAudioTarget } from 'bmsx/platform/browser_audio_target';
import { type AudioOutputPuller, type AudioService } from '../platform';

const CORE_CTRL_READ_PTR = 0;
const CORE_CTRL_WRITE_PTR = 1;
const CORE_CTRL_OVERRUNS = 2;
const CORE_CTRL_UNDERRUNS = 3;
const CORE_CTRL_SEQ = 4;
const CORE_CTRL_LENGTH = 5;

const DEFAULT_CAPACITY_FRAMES = 16384;
const DEFAULT_AUDIO_TARGET_AHEAD_SEC = 0.024;
const IOS_AUDIO_TARGET_AHEAD_SEC = 0.036;
const WORKLET_TARGET_MIN_DEFAULT = 384;
const WORKLET_TARGET_MAX_DEFAULT = 4096;
const WORKLET_TARGET_MIN_IOS = 768;
const WORKLET_TARGET_MAX_IOS = 4096;
const WORKLET_REARM_MARGIN_DEFAULT = 128;
const WORKLET_REARM_MARGIN_IOS = 256;
const WORKLET_REQUEST_AHEAD_DEFAULT = 256;
const WORKLET_REQUEST_AHEAD_IOS = 384;
const NEED_PUMP_BUDGET_FRAMES = 8192;

export interface WorkerStreamingAudioOptions {
	capacityFrames?: number;
	frameTimeSec?: number;
}

export function supportsWorkerStreamingAudio(): boolean {
	return !!globalThis.crossOriginIsolated
		&& 'SharedArrayBuffer' in globalThis
		&& 'AudioWorkletNode' in globalThis;
}

function requireWorkerStreamingAudioSupport(): void {
	if (!globalThis.crossOriginIsolated) {
		throw new Error('[WorkerStreamingAudioService] SharedArrayBuffer audio backend requires crossOriginIsolated=true.');
	}
	if (!('SharedArrayBuffer' in globalThis)) {
		throw new Error('[WorkerStreamingAudioService] SharedArrayBuffer is not available.');
	}
	if (!('AudioWorkletNode' in globalThis)) {
		throw new Error('[WorkerStreamingAudioService] AudioWorkletNode is not available.');
	}
}

type WorkletMessageToMain =
	| { type: 'need_port_connected' }
	| { type: 'need_main' }
	| {
		type: 'stats';
		fillFrames: number;
		underruns: number;
		overruns: number;
		rate: number;
		mixTimeMs: number;
	}
	| { type: 'need_port_error'; reason: string }
	| { type: 'worklet_error'; message: string };

type MainToWorkletMessage =
	| { type: 'configure'; frameTimeSec: number; preferHighLead: boolean }
	| { type: 'set_frame_time'; frameTimeSec: number }
	| { type: 'set_master_gain'; gain: number };

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
	private runtimeAudioPuller: AudioOutputPuller | null = null;
	private runtimeAudioPumping = false;
	private runtimeOutputBuffer = new Int16Array(0);
	private readonly msgSetMasterGain: { type: 'set_master_gain'; gain: number } = { type: 'set_master_gain', gain: 1 };
	private readonly msgSetFrameTimeSec: { type: 'set_frame_time'; frameTimeSec: number } = { type: 'set_frame_time', frameTimeSec: DEFAULT_AUDIO_TARGET_AHEAD_SEC };

	constructor(context: AudioContext, options: WorkerStreamingAudioOptions = {}) {
		requireWorkerStreamingAudioSupport();

		const requestedCapacity = options.capacityFrames ?? DEFAULT_CAPACITY_FRAMES;
		this.preferHighLead = isIOSAudioTarget();
		this.frameTimeSec = options.frameTimeSec ?? (this.preferHighLead ? IOS_AUDIO_TARGET_AHEAD_SEC : DEFAULT_AUDIO_TARGET_AHEAD_SEC);

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
				this.pumpRuntimeAudio();
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
		const refillMargin = this.preferHighLead ? WORKLET_REARM_MARGIN_IOS : WORKLET_REARM_MARGIN_DEFAULT;
		const requestAhead = this.preferHighLead ? WORKLET_REQUEST_AHEAD_IOS : WORKLET_REQUEST_AHEAD_DEFAULT;
		const requested = Math.ceil(this.ctx.sampleRate * this.frameTimeSec) + requestAhead + refillMargin;
		const minTarget = this.preferHighLead ? WORKLET_TARGET_MIN_IOS : WORKLET_TARGET_MIN_DEFAULT;
		const maxTarget = this.preferHighLead ? WORKLET_TARGET_MAX_IOS : WORKLET_TARGET_MAX_DEFAULT;
		const target = requested < minTarget ? minTarget : (requested > maxTarget ? maxTarget : requested);
		const capacityMax = this.coreStreamCapacityFrames - 1;
		return target > capacityMax ? capacityMax : target;
	}

	private transportQueuedFrames(): number {
		const readPtr = Atomics.load(this.coreStreamControl, CORE_CTRL_READ_PTR) >>> 0;
		const writePtr = Atomics.load(this.coreStreamControl, CORE_CTRL_WRITE_PTR) >>> 0;
		return (writePtr - readPtr) >>> 0;
	}

	private ensureRuntimeOutputBuffer(frameCount: number): void {
		const requiredSamples = frameCount * 2;
		if (this.runtimeOutputBuffer.length < requiredSamples) {
			this.runtimeOutputBuffer = new Int16Array(requiredSamples);
		}
	}

	private writeRuntimeFrames(samples: Int16Array, frameCount: number): void {
		const control = this.coreStreamControl;
		const stream = this.coreStreamSamples;
		const capacity = this.coreStreamCapacityFrames;
		const writePtr = Atomics.load(control, CORE_CTRL_WRITE_PTR) >>> 0;
		const seqBegin = (Atomics.add(control, CORE_CTRL_SEQ, 1) + 1) | 0;
		const dstFrame = writePtr % capacity;
		let firstSpan = capacity - dstFrame;
		if (firstSpan > frameCount) {
			firstSpan = frameCount;
		}
		let dstCursor = dstFrame * 2;
		let srcCursor = 0;
		for (let frame = 0; frame < firstSpan; frame += 1) {
			stream[dstCursor] = samples[srcCursor];
			stream[dstCursor + 1] = samples[srcCursor + 1];
			dstCursor += 2;
			srcCursor += 2;
		}
		const secondSpan = frameCount - firstSpan;
		dstCursor = 0;
		for (let frame = 0; frame < secondSpan; frame += 1) {
			stream[dstCursor] = samples[srcCursor];
			stream[dstCursor + 1] = samples[srcCursor + 1];
			dstCursor += 2;
			srcCursor += 2;
		}
		Atomics.store(control, CORE_CTRL_WRITE_PTR, ((writePtr + frameCount) >>> 0) | 0);
		Atomics.store(control, CORE_CTRL_SEQ, (seqBegin + 1) | 0);
	}

	private setFatal(error: Error): void {
		if (this.fatalError !== null) {
			return;
		}
		this.fatalError = error;
		this.runtimeAudioPumping = false;
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

	public outputSampleRate(): number {
		return this.ctx.sampleRate;
	}

	public setRuntimeAudioPuller(puller: AudioOutputPuller | null): void {
		this.runtimeAudioPuller = puller;
		if (puller === null) {
			this.runtimeAudioPumping = false;
		}
	}

	public clearRuntimeAudioTransport(): void {
		const readPtr = Atomics.load(this.coreStreamControl, CORE_CTRL_READ_PTR) >>> 0;
		const seqBegin = (Atomics.add(this.coreStreamControl, CORE_CTRL_SEQ, 1) + 1) | 0;
		Atomics.store(this.coreStreamControl, CORE_CTRL_WRITE_PTR, readPtr | 0);
		Atomics.store(this.coreStreamControl, CORE_CTRL_SEQ, (seqBegin + 1) | 0);
		Atomics.store(this.coreStreamControl, CORE_CTRL_UNDERRUNS, 0);
		Atomics.store(this.coreStreamControl, CORE_CTRL_OVERRUNS, 0);
	}

	public pumpRuntimeAudio(): void {
		if (this.runtimeAudioPumping) {
			return;
		}
		if (this.runtimeAudioPuller === null) {
			return;
		}
		this.runtimeAudioPumping = true;
		try {
			const targetFrames = this.computeTargetFillFramesMain();
			let budgetFrames = NEED_PUMP_BUDGET_FRAMES;
			while (budgetFrames > 0) {
				const queuedFrames = this.transportQueuedFrames();
				if (queuedFrames >= targetFrames) {
					break;
				}
				const freeFrames = this.coreStreamCapacityFrames - 1 - queuedFrames;
				if (freeFrames <= 0) {
					break;
				}
				let framesToWrite = targetFrames - queuedFrames;
				if (framesToWrite > freeFrames) {
					framesToWrite = freeFrames;
				}
				if (framesToWrite > budgetFrames) {
					framesToWrite = budgetFrames;
				}
				this.ensureRuntimeOutputBuffer(framesToWrite);
				const retainedOutputFrames = targetFrames - queuedFrames - framesToWrite;
				this.runtimeAudioPuller(this.runtimeOutputBuffer, framesToWrite, this.ctx.sampleRate, retainedOutputFrames);
				this.writeRuntimeFrames(this.runtimeOutputBuffer, framesToWrite);
				budgetFrames -= framesToWrite;
			}
		} finally {
			this.runtimeAudioPumping = false;
		}
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
		this.frameTimeSec = seconds;
		if (this.workletNode !== null) {
			this.msgSetFrameTimeSec.frameTimeSec = seconds;
			this.postWorkletMessage(this.msgSetFrameTimeSec);
		}
	}
}
