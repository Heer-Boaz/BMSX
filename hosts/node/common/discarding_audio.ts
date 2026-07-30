import { type AudioOutputPuller, type HostAudioSink } from '../../common/audio_output';

const HEADLESS_AUDIO_SAMPLE_RATE = 48000;

export class DiscardingAudioSink implements HostAudioSink {
	private puller: AudioOutputPuller | null = null;
	private output = new Int16Array(0);
	private outputFrameCount = 0;
	private active = false;

	public setRuntimeAudioPuller(puller: AudioOutputPuller | null): void {
		this.puller = puller;
	}

	public pumpRuntimeAudio(): void {
		const puller = this.puller;
		if (!this.active || !puller) {
			return;
		}
		while (true) {
			const produced = puller(
				this.output,
				this.outputFrameCount,
				HEADLESS_AUDIO_SAMPLE_RATE,
			);
			if (produced !== this.outputFrameCount) {
				return;
			}
		}
	}

	public resume(): void {
		this.active = true;
	}

	public suspend(): void {
		this.active = false;
	}

	public setEmulationFrameTimeSec(seconds: number): void {
		const outputFrameCount = (seconds * HEADLESS_AUDIO_SAMPLE_RATE + 1) | 0;
		if (this.outputFrameCount === outputFrameCount) {
			return;
		}
		this.outputFrameCount = outputFrameCount;
		this.output = new Int16Array(outputFrameCount * 2);
	}
}
