import { type AudioOutputPuller, type AudioService } from 'bmsx/platform';

export class SilentAudioService implements AudioService {
	setRuntimeAudioPuller(_puller: AudioOutputPuller | null): void { }
	clearRuntimeAudioTransport(): void { }
	pumpRuntimeAudio(): void { }
	async resume(): Promise<void> { }
	async suspend(): Promise<void> { }
	setEmulationFrameTimeSec(_seconds: number): void { }
}
