import { AudioOutputResampler } from '../../machine/ts/audio/output_resampler';
import type { AudioController } from '../../machine/ts/machine/devices/audio/controller';
import type { ApuOutputRing } from '../../machine/ts/machine/devices/audio/output_ring';
import { HZ_SCALE } from '../../machine/ts/spec/bmsx/timing';

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
const MUTE_REASON_DEBUGGER = 0x04;
const MUTE_REASON_RUNTIME_TASK = 0x08;
const MUTE_REASON_SYSTEM = 0x10;

export class HostAudioOutput {
	private muteReasons = 0;
	private readonly outputResampler = new AudioOutputResampler();
	private readonly pullRuntimeAudio: AudioOutputPuller = (
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
		private readonly audio: HostAudioSink,
		private readonly audioController: AudioController,
		private readonly outputRing: ApuOutputRing,
		ufpsScaled: number,
	) {
		this.audio.setEmulationFrameTimeSec(HZ_SCALE / ufpsScaled);
	}

	public bootstrap(): void {
		this.stop();
		if (this.muteReasons !== 0) {
			return;
		}
		this.start();
		void this.audio.resume();
	}

	public restart(ufpsScaled: number): void {
		this.syncTiming(ufpsScaled);
		this.stop();
		if (this.muteReasons !== 0) {
			return;
		}
		this.start();
		void this.audio.resume();
	}

	public syncTiming(ufpsScaled: number): void {
		this.audio.setEmulationFrameTimeSec(HZ_SCALE / ufpsScaled);
	}

	public pumpRuntimeAudio(): void {
		this.audio.pumpRuntimeAudio();
	}

	public mutePause(muted: boolean): void {
		this.setMuteReason(MUTE_REASON_PAUSE, muted);
	}

	public muteUi(muted: boolean): void {
		this.setMuteReason(MUTE_REASON_UI, muted);
	}

	public muteDebugger(muted: boolean): void {
		this.setMuteReason(MUTE_REASON_DEBUGGER, muted);
	}

	public muteRuntimeTask(muted: boolean): void {
		this.setMuteReason(MUTE_REASON_RUNTIME_TASK, muted);
	}

	public muteSystem(muted: boolean): void {
		this.setMuteReason(MUTE_REASON_SYSTEM, muted);
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
		if (muted) {
			this.stop();
			void this.audio.suspend();
			return;
		}
		void this.audio.resume();
		this.start();
	}

	private start(): void {
		this.audio.setRuntimeAudioPuller(this.pullRuntimeAudio);
	}

	private stop(): void {
		this.audio.setRuntimeAudioPuller(null);
		this.outputResampler.reset();
		this.outputRing.clear();
	}
}
