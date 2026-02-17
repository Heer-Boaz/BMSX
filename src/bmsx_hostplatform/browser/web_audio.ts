import { clamp01 } from 'bmsx/utils/clamp';
import {
	AudioService,
	AudioClipHandle,
} from '../platform';

export class WebAudioService implements AudioService {
	private readonly ctx: AudioContext;
	private readonly master: GainNode;

	constructor(context?: AudioContext) {
		const ctx = context ?? new AudioContext();
		this.ctx = ctx;
		const gain = ctx.createGain();
		gain.gain.value = 1;
		gain.connect(ctx.destination);
		this.master = gain;
	}

	get available(): boolean { return true; }

	currentTime(): number { return this.ctx.currentTime; }

	sampleRate(): number { return this.ctx.sampleRate; }

	coreQueuedFrames(): number { return 0; }

	setCoreNeedHandler(_handler: (() => void) | null): void {
	}

	clearCoreStream(): void {
	}

	async resume(): Promise<void> {
		if (this.ctx.state !== 'running') {
			await this.ctx.resume();
		}
	}

	async suspend(): Promise<void> {
		if (this.ctx.state === 'running') {
			await this.ctx.suspend();
		}
	}

	getMasterGain(): number {
		return this.master.gain.value;
	}

	setMasterGain(v: number): void {
		const vv = clamp01(v);
		this.master.gain.value = vv;
	}

	setFrameTimeSec(_seconds: number): void {
		// WebAudio runs directly on the AudioContext clock and does not use frame-driven buffering.
	}

	pushCoreFrames(_samples: Int16Array, _channels: number, _sampleRate: number): void {
		throw new Error('WebAudioService: pushCoreFrames is forbidden; use WorkerStreamingAudioService.');
	}

	createClipFromPcm(samples: Int16Array, sampleRate: number, channels: number): AudioClipHandle {
		throw new Error(`WebAudioService: createClipFromPcm is forbidden; use WorkerStreamingAudioService with core buffer input. (channels=${channels}, sampleRate=${sampleRate}, frames=${Math.floor(samples.length / channels)})`);
	}
}
