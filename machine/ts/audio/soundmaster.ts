import { type AudioOutputPuller, type AudioService } from '../platform';
import { PAL_REFRESH_UFPS_SCALED } from '../machine/model_registry';
import { HZ_SCALE } from '../machine/runtime/timing/constants';
import type { AudioController } from '../machine/devices/audio/controller';
import type { ApuOutputRing } from '../machine/devices/audio/output_ring';
import { clamp01 } from '../common/clamp';
import { isIOSAudioTarget } from '../platform/browser_audio_target';
import { AudioOutputResampler } from './output_resampler';

const MIX_MINIMAL_OVERHEAD_SEC = 0.002;
const MIX_LOW_OVERHEAD_SEC = 0.004;
const MIX_BALANCED_OVERHEAD_SEC = 0.006;
const MIX_SAFE_OVERHEAD_SEC = 0.012;

type MixLatencyProfile = 'minimal' | 'low' | 'balanced' | 'safe';

export class SoundMaster {
	private readonly globalSuspensions = new Set<string>();
	private mixUfpsScaled = PAL_REFRESH_UFPS_SCALED;
	private mixLatencyProfile: MixLatencyProfile;
	private mixTargetAheadSec: number;
	private readonly outputResampler = new AudioOutputResampler();
	private readonly pullRuntimeOutput: AudioOutputPuller = (output, frameCount, sampleRate): number => {
		const outputRing = this.audioController.synchronizeOutput();
		return this.outputResampler.pull(outputRing, output, frameCount, sampleRate, 1);
	};

	public constructor(
		private readonly audio: AudioService,
		private readonly audioController: AudioController,
		private readonly outputRing: ApuOutputRing,
	) {
		this.mixLatencyProfile = isIOSAudioTarget() ? 'safe' : 'low';
		this.mixTargetAheadSec = (HZ_SCALE / this.mixUfpsScaled) + this.profileOverheadSec();
	}

	public bootstrapRuntimeAudio(ufpsScaled: number, startingVolume: number): void {
		this.setMixerUfpsScaled(ufpsScaled);
		this.volume = clamp01(startingVolume);
		this.startMixer();
		void this.audio.resume();
	}

	public resetPlaybackState(): void {
		this.outputResampler.reset();
		this.outputRing.clear();
		this.audio.clearRuntimeAudioTransport();
	}

	public setMixerUfpsScaled(ufpsScaled: number): void {
		this.mixUfpsScaled = ufpsScaled;
		this.recomputeMixTarget();
	}

	private profileOverheadSec(): number {
		switch (this.mixLatencyProfile) {
			case 'minimal': return MIX_MINIMAL_OVERHEAD_SEC;
			case 'low': return MIX_LOW_OVERHEAD_SEC;
			case 'balanced': return MIX_BALANCED_OVERHEAD_SEC;
			case 'safe': return MIX_SAFE_OVERHEAD_SEC;
		}
	}

	private recomputeMixTarget(): void {
		const frameTimeSec = HZ_SCALE / this.mixUfpsScaled;
		this.mixTargetAheadSec = frameTimeSec + this.profileOverheadSec();
		if (this.globalSuspensions.size === 0) {
			this.audio.setFrameTimeSec(this.mixTargetAheadSec);
		}
	}

	public finishFrame(): void {
		if (!this.audio.available || this.globalSuspensions.size !== 0) {
			return;
		}
		this.audio.pumpRuntimeAudio();
	}

	private startMixer(): void {
		this.outputResampler.reset();
		this.outputRing.clear();
		this.audio.clearRuntimeAudioTransport();
		this.audio.setFrameTimeSec(this.mixTargetAheadSec);
		this.audio.setRuntimeAudioPuller(this.pullRuntimeOutput);
	}

	private stopMixer(): void {
		this.audio.setRuntimeAudioPuller(null);
		this.audio.clearRuntimeAudioTransport();
		this.outputResampler.reset();
		this.outputRing.clear();
	}

	public pause(): void {
		this.suspendAll('pause');
	}

	public resume(): void {
		this.resumeAll('pause');
	}

	public suspendAll(tag: string): void {
		if (!this.audio.available) {
			return;
		}
		if (this.globalSuspensions.has(tag)) {
			return;
		}
		this.globalSuspensions.add(tag);
		if (this.globalSuspensions.size === 1) {
			this.stopMixer();
			void this.audio.suspend();
		}
	}

	public resumeAll(tag: string): void {
		if (!this.audio.available) {
			return;
		}
		if (!this.globalSuspensions.delete(tag)) {
			return;
		}
		if (this.globalSuspensions.size === 0) {
			void this.audio.resume();
			this.startMixer();
		}
	}

	public get volume(): number {
		return this.audio.getMasterGain();
	}

	public set volume(value: number) {
		this.audio.setMasterGain(value);
	}
}
