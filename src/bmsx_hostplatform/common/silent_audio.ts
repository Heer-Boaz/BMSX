import {
	AudioClipHandle,
	AudioFilterParams,
	AudioPlaybackParams,
	AudioService,
	SubscriptionHandle,
	VoiceEndedEvent,
	VoiceHandle,
	createSubscriptionHandle,
} from 'bmsx/platform';

class SilentClip implements AudioClipHandle {
	readonly duration = 0;
	dispose(): void { }
}

class SilentVoice implements VoiceHandle {
	readonly startedAt = 0;
	readonly startOffset = 0;
	private readonly endListeners = new Set<(event: VoiceEndedEvent) => void>();

	constructor() {
		queueMicrotask(() => this.end());
	}

	onEnded(cb: (event: VoiceEndedEvent) => void): SubscriptionHandle {
		this.endListeners.add(cb);
		return createSubscriptionHandle(() => {
			this.endListeners.delete(cb);
		});
	}

	setGainLinear(_value: number): void { }
	rampGainLinear(_target: number, _durationSec: number): void { }
	setFilter(_filter: AudioFilterParams): void { }
	setRate(_rate: number): void { }

	stop(): void {
		this.end();
	}

	private end(): void {
		for (const listener of this.endListeners) {
			listener({ clippedAt: 0 });
		}
		this.endListeners.clear();
	}

	disconnect(): void {
		this.endListeners.clear();
	}
}

export class SilentAudioService implements AudioService {
	readonly available = true;

	currentTime(): number { return 0; }
	sampleRate(): number { return 44100; }
	coreQueuedFrames(): number { return 0; }
	setCoreNeedHandler(_handler: (() => void) | null): void { }
	clearCoreStream(): void { }
	async resume(): Promise<void> { }
	async suspend(): Promise<void> { }
	getMasterGain(): number { return 0; }
	setMasterGain(_value: number): void { }
	setFrameTimeSec(_seconds: number): void { }

	async createClipFromBytes(_bytes: ArrayBuffer): Promise<AudioClipHandle> {
		return new SilentClip();
	}

	pushCoreFrames(_samples: Int16Array, _channels: number, _sampleRate: number): void { }

	createClipFromPcm(_samples: Int16Array, _sampleRate: number, _channels: number): AudioClipHandle {
		return new SilentClip();
	}

	createVoice(_clip: AudioClipHandle, _params: AudioPlaybackParams): VoiceHandle {
		return new SilentVoice();
	}
}
