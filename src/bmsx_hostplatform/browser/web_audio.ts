import { clamp01 } from 'bmsx/utils/clamp';
import {
	AudioService,
	AudioClipHandle,
} from '../platform';

class WebClip implements AudioClipHandle {
	constructor(public readonly buffer: AudioBuffer) {}
	get duration(): number { return this.buffer.duration; }
	dispose(): void { /* GC-managed */ }
}

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
		if (channels <= 0) {
			throw new Error('WebAudioService: Invalid channel count.');
		}
		const frames = Math.floor(samples.length / channels);
		const buffer = this.ctx.createBuffer(channels, frames, sampleRate);
		const scale = 1 / 32768;
		for (let channel = 0; channel < channels; channel += 1) {
			const channelData = buffer.getChannelData(channel);
			let cursor = channel;
			for (let frame = 0; frame < frames; frame += 1) {
				channelData[frame] = samples[cursor] * scale;
				cursor += channels;
			}
		}
		return new WebClip(buffer);
	}
}
