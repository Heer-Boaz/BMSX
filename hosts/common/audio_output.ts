import { AudioOutputResampler } from '../../machine/ts/audio/output_resampler';
import type { AudioController } from '../../machine/ts/machine/devices/audio/controller';
import type { HostAudioDevice } from './audio_device';

export type AudioOutputPuller = (
	output: Int16Array,
	frameCount: number,
	sampleRate: number,
) => number;

export interface HostAudioSink {
	setRuntimeAudioPuller(puller: AudioOutputPuller | null): void;
	pumpRuntimeAudio(): void;
	resume(): void | Promise<void>;
	suspend(): void | Promise<void>;
	setEmulationFrameTimeSec(seconds: number): void;
}

const MUTE_REASON_PAUSE = 0x01;
const MUTE_REASON_UI = 0x02;
const MUTE_REASON_MENU = 0x04;
const MUTE_REASON_RUNTIME_TASK = 0x08;
const MUTE_REASON_SYSTEM = 0x10;
const MUTE_REASON_REWIND = 0x20;

export class HostAudioOutput {
	private muteReasons = 0;
	private readonly outputResampler = new AudioOutputResampler();
	public readonly pullRuntimeAudio: AudioOutputPuller = (
		output,
		frameCount,
		sampleRate,
	): number => this.outputResampler.pull(
		this.audioController.synchronizeOutput(),
		output,
		frameCount,
		sampleRate,
	);

	public constructor(
		public readonly device: HostAudioDevice,
		private readonly audioController: AudioController,
		public ufpsScaled: number,
	) {}
	public get muted(): boolean { return this.muteReasons !== 0; }

	public restart(ufpsScaled: number): void {
		this.ufpsScaled = ufpsScaled;
		this.resetPlayback();
		this.device.changed(this, true);
	}

	public syncTiming(ufpsScaled: number): void {
		this.ufpsScaled = ufpsScaled;
		this.device.changed(this, false);
	}

	public mutePause(muted: boolean): void {
		this.setMuteReason(MUTE_REASON_PAUSE, muted);
	}

	public muteUi(muted: boolean): void {
		this.setMuteReason(MUTE_REASON_UI, muted);
	}

	public muteMenu(muted: boolean): void {
		this.setMuteReason(MUTE_REASON_MENU, muted);
	}

	public muteRuntimeTask(muted: boolean): void {
		this.setMuteReason(MUTE_REASON_RUNTIME_TASK, muted);
	}

	public muteSystem(muted: boolean): void {
		this.setMuteReason(MUTE_REASON_SYSTEM, muted);
	}

	public muteRewind(muted: boolean): void {
		this.setMuteReason(MUTE_REASON_REWIND, muted);
	}

	private setMuteReason(reason: number, muted: boolean): void {
		const wasMuted = this.muteReasons !== 0;
		if (muted) {
			this.muteReasons |= reason;
		} else {
			this.muteReasons &= ~reason;
		}
		if (wasMuted === (this.muteReasons !== 0)) {
			return;
		}
		if (muted) this.resetPlayback();
		this.device.changed(this, true);
	}

	/** Drops output-only playback, including deferred PCM. Guest APU state is not restored or replaced. */
	public resetPlayback(): void {
		this.outputResampler.reset();
		this.audioController.synchronizeOutput().clear();
	}

	public dispose(): void {
		if (this.device.selected === this) this.device.select(null);
		else this.resetPlayback();
	}
}
