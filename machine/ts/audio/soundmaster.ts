import { machineManager } from '../core/machine_manager';
import { type AudioOutputPuller, type AudioService } from '../platform';
import { PAL_REFRESH_UFPS_SCALED } from '../machine/model_registry';
import { HZ_SCALE } from '../machine/runtime/timing/constants';
import { clamp01 } from '../common/clamp';
import { isIOSAudioTarget } from '../platform/browser_audio_target';
import { AudioOutputResampler } from './output_resampler';

const MIX_MINIMAL_OVERHEAD_SEC = 0.002;
const MIX_LOW_OVERHEAD_SEC = 0.004;
const MIX_BALANCED_OVERHEAD_SEC = 0.006;
const MIX_SAFE_OVERHEAD_SEC = 0.012;

type MixLatencyProfile = 'minimal' | 'low' | 'balanced' | 'safe';

export class SoundMaster {
	public static readonly instance: SoundMaster = new SoundMaster();
	private globalSuspensions: Set<string>;
	private audio!: AudioService;
	private mixUfpsScaled = PAL_REFRESH_UFPS_SCALED;
	private mixLatencyProfile: MixLatencyProfile;
	private mixTargetAheadSec: number;
	private readonly outputResampler = new AudioOutputResampler();
	private readonly pullRuntimeOutput: AudioOutputPuller = (output, frameCount, sampleRate): number => {
		const outputRing = machineManager.runtime.machine.audioController.synchronizeOutput();
		return this.outputResampler.pull(outputRing, output, frameCount, sampleRate, 1);
	};

	private constructor() {
		this.globalSuspensions = new Set();
		this.mixLatencyProfile = isIOSAudioTarget() ? 'safe' : 'low';
		this.mixTargetAheadSec = (HZ_SCALE / this.mixUfpsScaled) + this.profileOverheadSec();
	}

	private isRuntimeAudioAvailable(): boolean {
		return !!this.audio && this.audio.available;
	}

	public bootstrapRuntimeAudio(ufpsScaled: number, startingVolume: number): void {
		this.audio = machineManager.platform.audio;
		this.setMixerUfpsScaled(ufpsScaled);
		this.volume = clamp01(startingVolume);
		this.startMixer();
		void this.audio.resume();
	}

	public resetPlaybackState(): void {
		this.outputResampler.reset();
		machineManager.runtime.machine.audioOutput.outputRing.clear();
		if (this.audio) {
			this.audio.clearRuntimeAudioTransport();
		}
	}

	public isRuntimeAudioReady(): boolean {
		return !!this.audio;
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
		if (this.audio && this.globalSuspensions.size === 0) {
			this.audio.setFrameTimeSec(this.mixTargetAheadSec);
		}
	}

	public finishFrame(): void {
		if (!this.isRuntimeAudioAvailable() || this.globalSuspensions.size !== 0) {
			return;
		}
		this.audio.pumpRuntimeAudio();
	}

	private startMixer(): void {
		this.outputResampler.reset();
		machineManager.runtime.machine.audioOutput.outputRing.clear();
		this.audio.clearRuntimeAudioTransport();
		this.audio.setFrameTimeSec(this.mixTargetAheadSec);
		this.audio.setRuntimeAudioPuller(this.pullRuntimeOutput);
	}

	private stopMixer(): void {
		this.audio.setRuntimeAudioPuller(null);
		this.audio.clearRuntimeAudioTransport();
		this.outputResampler.reset();
		machineManager.runtime.machine.audioOutput.outputRing.clear();
	}

	public pause(): void {
		this.suspendAll('pause');
	}

	public resume(): void {
		this.resumeAll('pause');
	}

	public suspendAll(tag: string): void {
		if (!this.isRuntimeAudioAvailable()) {
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
		if (!this.isRuntimeAudioAvailable()) {
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
