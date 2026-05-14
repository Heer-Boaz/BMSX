import { type AudioOutputPuller, type AudioService } from 'bmsx/platform';
import { APU_SAMPLE_RATE_HZ } from 'bmsx/machine/devices/audio/contracts';

export class SilentAudioService implements AudioService {
	readonly available = true;

	currentTime(): number { return 0; }
	outputSampleRate(): number { return APU_SAMPLE_RATE_HZ; }
	setRuntimeAudioPuller(_puller: AudioOutputPuller | null): void { }
	clearRuntimeAudioTransport(): void { }
	pumpRuntimeAudio(): void { }
	async resume(): Promise<void> { }
	async suspend(): Promise<void> { }
	getMasterGain(): number { return 0; }
	setMasterGain(_value: number): void { }
	setFrameTimeSec(_seconds: number): void { }
}
