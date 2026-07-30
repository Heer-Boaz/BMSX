import { type AudioOutputPuller, type HostAudioSink } from '../../common/audio_output';

export class SilentAudioSink implements HostAudioSink {
	setRuntimeAudioPuller(_puller: AudioOutputPuller | null): void { }
	clearRuntimeAudioTransport(): void { }
	pumpRuntimeAudio(): void { }
	async resume(): Promise<void> { }
	async suspend(): Promise<void> { }
	setEmulationFrameTimeSec(_seconds: number): void { }
}
