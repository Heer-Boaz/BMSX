import { consoleCore } from '../core/console';
import { type AudioOutputPuller, type AudioService } from '../platform';
import { DEFAULT_UFPS_SCALED, HZ_SCALE } from '../machine/runtime/timing/constants';
import { clamp01 } from '../common/clamp';
import { isIOSAudioTarget } from '../platform/browser_audio_target';

const MIX_MINIMAL_OVERHEAD_SEC = 0.002;
const MIX_LOW_OVERHEAD_SEC = 0.004;
const MIX_BALANCED_OVERHEAD_SEC = 0.006;
const MIX_SAFE_OVERHEAD_SEC = 0.012;

type MixLatencyProfile = 'minimal' | 'low' | 'balanced' | 'safe';

export class SoundMaster {
	public static readonly instance: SoundMaster = new SoundMaster();
	private globalSuspensions: Set<string>;
	private audio!: AudioService;
	private mixUfpsScaled: number;
	private mixLatencyProfile: MixLatencyProfile;
	private mixTargetAheadSec: number;
	private readonly pullRuntimeOutput: AudioOutputPuller = (output, frameCount, sampleRate, targetQueuedFrames): void => {
		consoleCore.runtime.machine.audioOutput.pullOutputFrames(output, frameCount, sampleRate, 1, targetQueuedFrames);
	};

	private constructor() {
		this.globalSuspensions = new Set();
		this.mixUfpsScaled = DEFAULT_UFPS_SCALED;
		this.mixLatencyProfile = 'low';
		this.mixTargetAheadSec = 0;
		this.setLatencyProfile(isIOSAudioTarget() ? 'safe' : 'low');
	}

	private get A(): AudioService {
		if (!this.audio) throw new Error('[SoundMaster] Audio service not initialized. Call bootstrapRuntimeAudio() first.');
		return this.audio;
	}

	private isRuntimeAudioAvailable(): boolean {
		return !!this.audio && this.audio.available;
	}

	public bootstrapRuntimeAudio(ufpsScaled: number, startingVolume: number): void {
		this.audio = consoleCore.platform.audio;
		this.setMixerUfpsScaled(ufpsScaled);
		this.volume = clamp01(startingVolume);
		this.startMixer();
		void this.A.resume();
	}

	public resetPlaybackState(): void {
		if (this.audio) {
			this.A.clearRuntimeAudioTransport();
		}
	}

	public isRuntimeAudioReady(): boolean {
		return !!this.audio;
	}

	public setMixerUfpsScaled(ufpsScaled: number): void {
		this.mixUfpsScaled = ufpsScaled;
		this.recomputeMixTarget();
	}

	public setLatencyProfile(profile: MixLatencyProfile): void {
		this.mixLatencyProfile = profile;
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
			this.A.setFrameTimeSec(this.mixTargetAheadSec);
		}
	}

	public getLatencyProfile(): MixLatencyProfile {
		return this.mixLatencyProfile;
	}

	public finishFrame(): void {
		if (!this.isRuntimeAudioAvailable() || this.globalSuspensions.size !== 0) {
			return;
		}
		this.A.pumpRuntimeAudio();
	}

	private startMixer(): void {
		this.A.clearRuntimeAudioTransport();
		this.A.setFrameTimeSec(this.mixTargetAheadSec);
		this.A.setRuntimeAudioPuller(this.pullRuntimeOutput);
		this.A.pumpRuntimeAudio();
	}

	private stopMixer(): void {
		this.A.setRuntimeAudioPuller(null);
		this.A.clearRuntimeAudioTransport();
	}

	public pause(): void {
		if (!this.isRuntimeAudioAvailable()) {
			return;
		}
		this.suspendAll('pause');
	}

	public resume(): void {
		if (!this.isRuntimeAudioAvailable()) {
			return;
		}
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
			void this.A.suspend();
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
			void this.A.resume();
			this.startMixer();
		}
	}

	public get volume(): number {
		return clamp01(this.A.getMasterGain());
	}

	public set volume(value: number) {
		this.A.setMasterGain(clamp01(value));
	}
}
