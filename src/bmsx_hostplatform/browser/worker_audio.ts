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
		type: 'stats';
		fillFrames: number;
		underruns: number;
		coreFillFrames: number;
		coreUnderruns: number;
		mixTimeMs: number;
	}
	| {
		type: 'error';
		fatal: boolean;
		scope: WorkerErrorScope;
		message: string;
		stack?: string;
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
	private masterGain = 1;
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
		if (this.capacityFrames < 2048) {
			throw new Error('[WorkerStreamingAudioService] capacityFrames must be at least 2048.');
		}
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

		this.coreStreamCapacityFrames = this.capacityFrames < 4096 ? this.capacityFrames : 4096;
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
	const AUDIO_RENDER_QUANTUM_FRAMES = 128;
	const WORKLET_LOW_WATER_FRAMES = 256;
	const LEAD_MARGIN_FRAMES = 128;

	let ringSamples = null;
	let ringControl = null;
	let capacityFrames = 0;
	let coreStreamSamples = null;
	let coreStreamControl = null;
	let coreStreamCapacityFrames = 0;
	let outputSampleRate = 0;
	let frameTimeSec = 0;
	let targetLeadFrames = 0;
	let needPort = null;
	let initialized = false;
	let suspended = true;
	let masterGain = 1;
	let lastStatsMs = 0;
	let lastUnderruns = 0;

	const statsMessage = {
		type: 'stats',
		fillFrames: 0,
		underruns: 0,
		coreFillFrames: 0,
		coreUnderruns: 0,
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

	function postError(error, fatal, scope) {
		const err = error instanceof Error ? error : new Error(String(error));
		self.postMessage({
			type: 'error',
			fatal: !!fatal,
			scope,
			message: err.message,
			stack: err.stack,
		});
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

	function mixAndWrite(framesRequested) {
		const readPtr = Atomics.load(ringControl, CTRL_READ_PTR) >>> 0;
		const writePtr = Atomics.load(ringControl, CTRL_WRITE_PTR) >>> 0;
		const fill = (writePtr - readPtr) >>> 0;
		const free = capacityFrames - fill;
		if (free <= 0) {
			return 0;
		}
		const framesToWrite = framesRequested > free ? free : framesRequested;
		let coreReadPtr = Atomics.load(coreStreamControl, CORE_CTRL_READ_PTR) >>> 0;
		const coreWritePtr = Atomics.load(coreStreamControl, CORE_CTRL_WRITE_PTR) >>> 0;
		let coreAvailable = (coreWritePtr - coreReadPtr) >>> 0;
		let coreUnderruns = 0;

		for (let frame = 0; frame < framesToWrite; frame += 1) {
			let left = 0;
			let right = 0;
			if (coreAvailable > 0) {
				const src = (coreReadPtr % coreStreamCapacityFrames) * 2;
				left = coreStreamSamples[src] * PCM_SCALE;
				right = coreStreamSamples[src + 1] * PCM_SCALE;
				coreReadPtr = (coreReadPtr + 1) >>> 0;
				coreAvailable -= 1;
			} else {
				coreUnderruns += 1;
			}
			const dst = ((writePtr + frame) % capacityFrames) * 2;
			ringSamples[dst] = clamp(left * masterGain, -1, 1);
			ringSamples[dst + 1] = clamp(right * masterGain, -1, 1);
		}

		Atomics.store(coreStreamControl, CORE_CTRL_READ_PTR, coreReadPtr | 0);
		if (coreUnderruns > 0) {
			Atomics.add(coreStreamControl, CORE_CTRL_UNDERRUNS, coreUnderruns);
		}
		Atomics.store(ringControl, CTRL_WRITE_PTR, ((writePtr + framesToWrite) >>> 0) | 0);
		return framesToWrite;
	}

	function sendStats(mixTimeMs) {
		statsMessage.fillFrames = currentFillFrames();
		statsMessage.underruns = Atomics.load(ringControl, CTRL_UNDERRUNS) >>> 0;
		const coreRead = Atomics.load(coreStreamControl, CORE_CTRL_READ_PTR) >>> 0;
		const coreWrite = Atomics.load(coreStreamControl, CORE_CTRL_WRITE_PTR) >>> 0;
		statsMessage.coreFillFrames = (coreWrite - coreRead) >>> 0;
		statsMessage.coreUnderruns = Atomics.load(coreStreamControl, CORE_CTRL_UNDERRUNS) >>> 0;
		statsMessage.mixTimeMs = mixTimeMs;
		self.postMessage(statsMessage);
	}

	function pump() {
		if (!initialized || suspended) {
			return;
		}
		const mixStart = performance.now();
		for (let i = 0; i < 12; i += 1) {
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
	}

	function schedulePump() {
		if (!initialized || suspended) {
			return;
		}
		pump();
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
			postError(error, true, message.type === 'init' ? 'init' : 'general');
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
			case 'stats':
				break;
			case 'error': {
				const error = new Error(message.message);
				error.stack = message.stack;
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

	async decode(_bytes: ArrayBuffer): Promise<AudioClipHandle> {
		throw new Error('[WorkerStreamingAudioService] decode() is removed. Use pushCoreFrames() streaming only.');
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
		this.postOrQueueMessage({ type: 'set_frame_time', frameTimeSec: seconds });
	}
}
