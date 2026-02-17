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

class WebClip implements AudioClipHandle {
	constructor(public readonly buffer: AudioBuffer) {}
	get duration(): number { return this.buffer.duration; }
	dispose(): void { /* GC-managed */ }
}

class WebVoice implements VoiceHandle {
	private readonly ctx: AudioContext;
	private readonly src: AudioBufferSourceNode;
	private readonly gain: GainNode;
	private readonly filter: BiquadFilterNode;
	private ended = false;
	private endedUnsubs: Array<() => void> = [];
	readonly startedAt: number;
	readonly startOffset: number;

	constructor(
		ctx: AudioContext,
		dest: AudioNode,
		clip: WebClip,
		params: AudioPlaybackParams,
	) {
		this.ctx = ctx;

		const gain = ctx.createGain();
		gain.gain.value = clamp01(params.gainLinear);

		let nodeDest: AudioNode = gain;

		let filter: BiquadFilterNode = null;
		if (params.filter !== null) {
			filter = ctx.createBiquadFilter();
			filter.type = params.filter.type;
			filter.frequency.value = params.filter.frequency;
			filter.Q.value = params.filter.q;
			filter.gain.value = params.filter.gain;
			filter.connect(gain);
			nodeDest = filter;
		}

		const src = ctx.createBufferSource();
		src.buffer = clip.buffer;

		if (params.loop !== null) {
			src.loop = true;
			src.loopStart = params.loop.start;
			if (params.loop.end !== undefined) src.loopEnd = params.loop.end;
		} else {
			src.loop = false;
		}

		src.playbackRate.value = params.rate;

		gain.connect(dest);
		src.connect(nodeDest);

		const dur = clip.duration;
		let off = params.offset;
		if (dur > 0) {
			if (src.loop) {
				const mod = off % dur;
				off = mod < 0 ? mod + dur : mod;
			} else {
				if (off < 0) off = 0;
				const cap = Math.max(dur - this.minRampInterval(), 0);
				if (off > cap) off = cap;
			}
		}

		src.start(0, off);

		this.src = src;
		this.gain = gain;
		this.filter = filter;
		this.startedAt = ctx.currentTime;
		this.startOffset = off;

		src.onended = () => {
			if (this.ended) return;
			this.ended = true;
			for (let i = 0; i < this.endedUnsubs.length; i++) this.endedUnsubs[i]();
			this.endedUnsubs.length = 0;
		};
	}

	onEnded(cb: (e: VoiceEndedEvent) => void): SubscriptionHandle {
		const handler = () => cb({ clippedAt: this.ctx.currentTime });
		this.src.addEventListener('ended', handler);
		const unsub = () => this.src.removeEventListener('ended', handler);
		this.endedUnsubs.push(unsub);
		return createSubscriptionHandle(() => {
			const retained: Array<() => void> = [];
			for (let i = 0; i < this.endedUnsubs.length; i++) {
				if (this.endedUnsubs[i] !== unsub) retained.push(this.endedUnsubs[i]);
			}
			this.endedUnsubs = retained;
			unsub();
		});
	}

	private minRampInterval(): number {
		const rate = this.ctx.sampleRate;
		return rate > 0 ? (1 / rate) : Number.EPSILON;
	}

	setGainLinear(v: number): void {
		const now = this.ctx.currentTime;
		const p = this.gain.gain;
		p.cancelScheduledValues(now);
		p.setValueAtTime(p.value, now);
		p.linearRampToValueAtTime(clamp01(v), now + this.minRampInterval());
	}

	rampGainLinear(target: number, durationSec: number): void {
		const now = this.ctx.currentTime;
		const p = this.gain.gain;
		p.cancelScheduledValues(now);
		p.setValueAtTime(p.value, now);
		const dur = durationSec > 0 ? durationSec : this.minRampInterval();
		p.linearRampToValueAtTime(clamp01(target), now + dur);
	}

	setFilter(p: AudioFilterParams): void {
		if (p === null) return;
		if (this.filter === null) return;
		this.filter.type = p.type;
		this.filter.frequency.value = p.frequency;
		this.filter.Q.value = p.q;
		this.filter.gain.value = p.gain;
	}

	setRate(v: number): void {
		this.src.playbackRate.value = v;
	}

	stop(): void {
		try { this.src.stop(); } catch { }
	}

	disconnect(): void {
		try { this.src.disconnect(); } catch { }
		try { this.gain.disconnect(); } catch { }
		if (this.filter !== null) {
			try { this.filter.disconnect(); } catch { }
		}
	}
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

	async decode(bytes: ArrayBuffer): Promise<AudioClipHandle> {
		const buf = await this.ctx.decodeAudioData(bytes.slice(0));
		return new WebClip(buf);
	}

	pushCoreFrames(samples: Int16Array, channels: number, sampleRate: number): void {
		if (channels !== 2) {
			throw new Error('WebAudioService: core stream expects stereo PCM.');
		}
		if (sampleRate !== this.ctx.sampleRate) {
			throw new Error('WebAudioService: core stream sample rate must match AudioContext sample rate.');
		}
		const clip = this.createClipFromPcm(samples, sampleRate, channels) as WebClip;
		const src = this.ctx.createBufferSource();
		src.buffer = clip.buffer;
		src.connect(this.master);
		src.start(this.ctx.currentTime);
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

	createVoice(clip: AudioClipHandle, params: AudioPlaybackParams): VoiceHandle {
		if (!(clip instanceof WebClip)) {
			throw new Error('WebAudioService: Unsupported clip handle.');
		}
		return new WebVoice(this.ctx, this.master, clip, params);
	}
}
