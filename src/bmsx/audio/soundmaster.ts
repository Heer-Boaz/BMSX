import { engineCore } from '../core/engine';
import { AudioPlaybackParams, AudioService, AudioClipHandle, VoiceHandle, VoiceEndedEvent, AudioFilterParams, SubscriptionHandle, createSubscriptionHandle } from '../platform';
import { Runtime } from '../machine/runtime/runtime';
import { clamp01 } from '../common/clamp';

export type VoiceId = number;
export type AudioSlot = number;

export interface SoundMasterResolvedPlayRequest {
	playbackRate: number;
	gainLinear: number;
	offsetSeconds: number;
	filter: AudioFilterParams | null;
}

export interface SoundMasterAudioSource {
	sourceAddr: number;
	sourceBytes: number;
	sampleRateHz: number;
	channels: number;
	bitsPerSample: number;
	frameCount: number;
	dataOffset: number;
	dataBytes: number;
	loopStartSample: number;
	loopEndSample: number;
}

export interface ActiveVoiceInfo {
	slot: AudioSlot;
	voiceId: VoiceId;
	sourceAddr: number;
	params: ModulationParams;
	startedAt: number;
	startOffset: number;
}

export interface FilterModulationParams {
	type?: BiquadFilterType;
	frequency?: number;
	q?: number;
	gain?: number;
}

export interface ModulationParams {
	pitchDelta?: number;
	volumeDelta?: number;
	offset?: number;
	playbackRate?: number;
	filter?: FilterModulationParams;
}

// Host-side audio playback/output and browser latency handling. This is the
// mixer behind the machine APU; cart-visible audio is MMIO, not SoundMaster.
interface ActiveVoiceRecord extends ActiveVoiceInfo {
	handle: StreamVoiceHandle;
	clip: StreamClipHandle;
	backendVoice: VoiceHandle;
	backendEnded: SubscriptionHandle | null;
	finalized: boolean;
}

const MIN_GAIN = 0.0001;
const MIX_MINIMAL_OVERHEAD_SEC = 0.002;
const MIX_LOW_OVERHEAD_SEC = 0.004;
const MIX_BALANCED_OVERHEAD_SEC = 0.006;
const MIX_SAFE_OVERHEAD_SEC = 0.012;

type MixLatencyProfile = 'minimal' | 'low' | 'balanced' | 'safe';

function isIOSAudioTarget(): boolean {
	if (typeof navigator === 'undefined') {
		return false;
	}
	const platform = navigator.platform;
	switch (platform) {
		case 'iPhone':
		case 'iPad':
		case 'iPod':
			return true;
	}
	if (platform === 'MacIntel' && navigator.maxTouchPoints > 1) {
		return true;
	}
	const userAgent = navigator.userAgent;
	return userAgent.indexOf('iPhone') >= 0 || userAgent.indexOf('iPad') >= 0 || userAgent.indexOf('iPod') >= 0;
}

class StreamClipHandle implements AudioClipHandle {
	public constructor(
		public readonly backendClip: AudioClipHandle,
	) { }
	public get duration(): number {
		return this.backendClip.duration;
	}
	public dispose(): void {
		this.backendClip.dispose();
	}
}

class StreamVoiceHandle implements VoiceHandle {
	private readonly endedListeners = new Set<(event: VoiceEndedEvent) => void>();

	public constructor(
		private readonly owner: SoundMaster,
		public readonly voiceId: number,
		public readonly startedAt: number,
		public readonly startOffset: number,
	) { }

	public onEnded(cb: (event: VoiceEndedEvent) => void): SubscriptionHandle {
		this.endedListeners.add(cb);
		return createSubscriptionHandle(() => {
			this.endedListeners.delete(cb);
		});
	}

	public emitEnded(clippedAt: number): void {
		for (const listener of this.endedListeners) {
			listener({ clippedAt });
		}
		this.endedListeners.clear();
	}

	public setGainLinear(value: number): void {
		this.owner.setVoiceGainLinear(this.voiceId, value);
	}

	public rampGainLinear(target: number, durationSec: number): void {
		this.owner.rampVoiceGainLinear(this.voiceId, target, durationSec);
	}

	public setFilter(filter: AudioFilterParams): void {
		this.owner.setVoiceFilter(this.voiceId, filter);
	}

	public setRate(rate: number): void {
		this.owner.setVoiceRate(this.voiceId, rate);
	}

	public stop(): void {
		this.owner.stopVoiceById(this.voiceId);
	}

	public disconnect(): void {
		this.endedListeners.clear();
	}
}

export class SoundMaster {
	public static readonly instance: SoundMaster = new SoundMaster();

	private globalSuspensions: Set<string>;
	private streamClips: Record<string, StreamClipHandle>;
	private streamClipLoads: Record<string, Promise<StreamClipHandle>>;
	private streamClipGeneration: number;
	private audio!: AudioService;
	private voices: ActiveVoiceRecord[];
	private currentVoiceBySlot: Record<number, StreamVoiceHandle | undefined>;
	private currentPlayParamsBySlot: Record<number, ModulationParams | undefined>;
	private endedListeners: Set<(info: ActiveVoiceInfo) => void>;
	private nextVoiceId: VoiceId;
	private voiceRecordByHandle: WeakMap<VoiceHandle, ActiveVoiceRecord>;
	private playGeneration: number;
	private slotPlaySequence: Record<number, number>;
	private mixFps: number;
	private mixLatencyProfile: MixLatencyProfile;
	private mixTargetAheadSec: number;

	private constructor() {
		this.globalSuspensions = new Set();
		this.streamClips = {};
		this.streamClipLoads = {};
		this.streamClipGeneration = 0;
		this.playGeneration = 0;
		this.slotPlaySequence = {};
		this.clearVoiceCollections();
		this.endedListeners = new Set();
		this.nextVoiceId = 1;
		this.voiceRecordByHandle = new WeakMap();
		this.mixFps = 50;
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

	private clearVoiceCollections(): void {
		this.voices = [];
		this.currentVoiceBySlot = {};
		this.currentPlayParamsBySlot = {};
	}

	public bootstrapRuntimeAudio(startingVolume: number): void {
		this.audio = engineCore.platform.audio;
		const sampleRate = this.A.sampleRate();
		if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
			throw new Error('[SoundMaster] Audio sample rate must be a positive finite value.');
		}
		this.setMixerFps(Runtime.instance.timing.ufps);
		this.volume = clamp01(startingVolume);
		this.startMixer();
		void this.A.resume();
	}

	public resetPlaybackState(): void {
		this.stopAllVoices();
		this.clearStreamClipCache();
		this.clearVoiceCollections();
		this.nextVoiceId = 1;
		this.voiceRecordByHandle = new WeakMap();
		this.slotPlaySequence = {};
	}

	private clearStreamClipCache(): void {
		this.streamClipGeneration = (this.streamClipGeneration + 1) >>> 0;
		const clipIds = Object.keys(this.streamClips);
		for (let i = 0; i < clipIds.length; i += 1) {
			const clip = this.streamClips[clipIds[i]];
			if (clip) {
				clip.dispose();
			}
		}
		this.streamClips = {};
		this.streamClipLoads = {};
	}

	public isRuntimeAudioReady(): boolean {
		return !!this.audio;
	}

	public stopAllVoices(): void {
		this.invalidatePendingPlays();
		while (this.voices.length > 0) {
			this.stopVoiceRecord(this.voices[this.voices.length - 1]);
		}
	}

	private audioSourceKey(source: SoundMasterAudioSource): string {
		return [
			'src',
			source.sourceAddr >>> 0,
			source.sourceBytes >>> 0,
			source.sampleRateHz >>> 0,
			source.channels >>> 0,
			source.bitsPerSample >>> 0,
			source.frameCount >>> 0,
			source.dataOffset >>> 0,
			source.dataBytes >>> 0,
		].join(':');
	}

	private async clipForSource(source: SoundMasterAudioSource, runtimeBytes: Uint8Array): Promise<StreamClipHandle> {
		const key = this.audioSourceKey(source);
		const cached = this.streamClips[key];
		if (cached) {
			return cached;
		}
		const pending = this.streamClipLoads[key];
		if (pending) {
			return pending;
		}
		const copyBytes = new Uint8Array(runtimeBytes.byteLength);
		copyBytes.set(runtimeBytes);
		const generation = this.streamClipGeneration;
		const task = this.A.createClipFromBytes(copyBytes.buffer).then((backendClip) => {
			const clip = new StreamClipHandle(backendClip);
			if (generation !== this.streamClipGeneration) {
				clip.dispose();
				return clip;
			}
			this.streamClips[key] = clip;
			this.streamClipLoads[key] = undefined;
			return clip;
		}, (error) => {
			this.streamClipLoads[key] = undefined;
			throw error;
		});
		this.streamClipLoads[key] = task;
		return task;
	}

	private resolveResolvedPlayParams(request: SoundMasterResolvedPlayRequest): ModulationParams {
		const params: ModulationParams = {
			pitchDelta: 0,
			volumeDelta: request.gainLinear > 0 ? 20 * Math.log10(request.gainLinear) : -96,
			offset: request.offsetSeconds,
			playbackRate: request.playbackRate,
		};
		if (request.filter !== null) {
			params.filter = request.filter;
		}
		return params;
	}

	private createVoiceParamsWithLoop(
		loopStart: number | undefined,
		loopEnd: number | undefined,
		params: ModulationParams,
		clip: AudioClipHandle,
	): AudioPlaybackParams {
		let loop: AudioPlaybackParams['loop'] = null;
		if (loopStart !== undefined) {
			loop = { start: loopStart, end: loopEnd };
		}

		let rate = params.playbackRate ?? 1;
		rate *= Math.pow(2, (params.pitchDelta ?? 0) / 12);
		if (rate <= 0) {
			throw new Error('[SoundMaster] Playback rate must be positive.');
		}

		let offset = params.offset ?? 0;
		const duration = clip.duration;
		if (duration > 0) {
			if (loop) {
				const mod = offset % duration;
				offset = mod < 0 ? mod + duration : mod;
			} else {
				if (offset < 0) offset = 0;
				const cap = duration;
				if (offset > cap) offset = cap;
			}
		}

		let gainLinear = Math.pow(10, (params.volumeDelta ?? 0) / 20);
		if (gainLinear < 0) gainLinear = 0;
		if (gainLinear > 1) gainLinear = 1;

		let filter: AudioPlaybackParams['filter'] = null;
		if (params.filter) {
			const filterParams = params.filter;
			filter = {
				type: filterParams.type ?? 'lowpass',
				frequency: filterParams.frequency ?? 350,
				q: filterParams.q ?? 1,
				gain: filterParams.gain ?? 0,
			};
		}

		return {
			offset,
			rate,
			gainLinear,
			loop,
			filter,
		};
	}

	public async playResolvedSourceOnSlot(
		slot: AudioSlot,
		source: SoundMasterAudioSource,
		runtimeBytes: Uint8Array,
		request: SoundMasterResolvedPlayRequest,
	): Promise<VoiceId> {
		const params = this.resolveResolvedPlayParams(request);
		return this.playWithSourceParams(slot, source, runtimeBytes, params);
	}

	private async playWithSourceParams(
		slot: AudioSlot,
		source: SoundMasterAudioSource,
		runtimeBytes: Uint8Array,
		params: ModulationParams,
	): Promise<VoiceId> {
		const playGeneration = this.playGeneration;
		const slotSequence = this.advanceSlotPlaySequence(slot);
		let clip: StreamClipHandle;
		try {
			clip = await this.clipForSource(source, runtimeBytes);
		} catch (error) {
			if (!this.isPendingPlayCurrent(slot, slotSequence, playGeneration)) {
				return 0;
			}
			throw error;
		}
		if (!this.isPendingPlayCurrent(slot, slotSequence, playGeneration)) {
			return 0;
		}
		const loopStart = source.loopStartSample > 0 ? source.loopStartSample / source.sampleRateHz : undefined;
		const loopEnd = source.loopEndSample > source.loopStartSample ? source.loopEndSample / source.sampleRateHz : undefined;
		const playback = this.createVoiceParamsWithLoop(loopStart, loopEnd, params, clip);
		return this.startVoice(slot, source.sourceAddr, clip, params, playback);
	}

	private advanceSlotPlaySequence(slot: AudioSlot): number {
		const sequence = ((this.slotPlaySequence[slot] ?? 0) + 1) >>> 0;
		this.slotPlaySequence[slot] = sequence;
		return sequence;
	}

	private invalidatePendingPlays(): void {
		this.playGeneration = (this.playGeneration + 1) >>> 0;
	}

	private isPendingPlayCurrent(slot: AudioSlot, slotSequence: number, playGeneration: number): boolean {
		return this.playGeneration === playGeneration && this.slotPlaySequence[slot] === slotSequence;
	}

	private startVoice(
		slot: AudioSlot,
		sourceAddr: number,
		clip: StreamClipHandle,
		params: ModulationParams,
		playback: AudioPlaybackParams,
	): VoiceId {
		this.stopSlotRecord(slot);
		const voiceId = this.nextVoiceId++;
		const backendVoice = this.A.createVoice(clip.backendClip, playback);
		const startedAt = backendVoice.startedAt;
		const startOffset = backendVoice.startOffset;
		const voice = new StreamVoiceHandle(this, voiceId, startedAt, startOffset);
		const record: ActiveVoiceRecord = {
			slot,
			voiceId,
			sourceAddr,
			params,
			startedAt,
			startOffset,
			handle: voice,
			clip,
			backendVoice,
			backendEnded: null,
			finalized: false,
		};

		this.voices.push(record);
		record.backendEnded = backendVoice.onEnded(() => {
			this.stopVoiceRecord(record);
		});
		this.voiceRecordByHandle.set(voice, record);
		this.currentVoiceBySlot[slot] = voice;
		this.currentPlayParamsBySlot[slot] = params;

		return voiceId;
	}

	private finalizeVoiceEnd(record: ActiveVoiceRecord): void {
		if (record.finalized) return;
		record.finalized = true;
		if (record.backendEnded !== null) {
			record.backendEnded.unsubscribe();
			record.backendEnded = null;
		}
		this.voiceRecordByHandle.delete(record.handle);
		record.handle.emitEnded(this.A.currentTime());
		record.handle.disconnect();
		record.backendVoice.disconnect();

		if (this.currentVoiceBySlot[record.slot] === record.handle) {
			const latest = this.findRecordBySlot(record.slot);
			if (latest) {
				this.currentVoiceBySlot[record.slot] = latest.handle;
				this.currentPlayParamsBySlot[record.slot] = latest.params;
			} else {
				delete this.currentVoiceBySlot[record.slot];
				delete this.currentPlayParamsBySlot[record.slot];
			}
		}

		if (this.endedListeners.size > 0) {
			const payload: ActiveVoiceInfo = {
				slot: record.slot,
				voiceId: record.voiceId,
				sourceAddr: record.sourceAddr,
				params: record.params,
				startedAt: record.startedAt,
				startOffset: record.startOffset,
			};
			const iterator = this.endedListeners.values();
			for (let current = iterator.next(); !current.done; current = iterator.next()) {
				try {
					current.value(payload);
				} catch (error) {
					console.error('[SoundMaster] Ended listener failed:', error);
				}
			}
		}
	}

	private removeRecord(voiceId: VoiceId): ActiveVoiceRecord {
		for (let i = 0; i < this.voices.length; i++) {
			if (this.voices[i].voiceId === voiceId) {
				return this.voices.splice(i, 1)[0];
			}
		}
		return undefined;
	}

	private stopVoiceRecord(record: ActiveVoiceRecord, fade_ms?: number): void {
		if (record.finalized) return;
		if (fade_ms !== undefined && fade_ms > 0) {
			record.handle.rampGainLinear(MIN_GAIN, fade_ms / 1000);
			setTimeout(() => {
				this.stopVoiceRecord(record);
			}, fade_ms);
			return;
		}
		if (record.backendEnded !== null) {
			record.backendEnded.unsubscribe();
			record.backendEnded = null;
		}
		record.backendVoice.stop();
		this.removeRecord(record.voiceId);
		this.finalizeVoiceEnd(record);
	}

	private findRecordByVoiceId(voiceId: VoiceId): ActiveVoiceRecord | null {
		for (let index = 0; index < this.voices.length; index += 1) {
			const record = this.voices[index];
			if (record.voiceId === voiceId) {
				return record;
			}
		}
		return null;
	}

	private findRecordBySlot(slot: AudioSlot): ActiveVoiceRecord | null {
		for (let index = this.voices.length - 1; index >= 0; index -= 1) {
			const record = this.voices[index];
			if (record.slot === slot) {
				return record;
			}
		}
		return null;
	}

	public setVoiceGainLinear(voiceId: VoiceId, gain: number): void {
		const found = this.findRecordByVoiceId(voiceId);
		if (!found) {
			return;
		}
		found.backendVoice.setGainLinear(clamp01(gain));
	}

	public rampVoiceGainLinear(voiceId: VoiceId, target: number, seconds: number): void {
		const found = this.findRecordByVoiceId(voiceId);
		if (!found) {
			return;
		}
		if (!Number.isFinite(seconds) || seconds <= 0) {
			throw new Error('[SoundMaster] Gain ramp duration must be positive and finite.');
		}
		found.backendVoice.rampGainLinear(clamp01(target), seconds);
	}

	public setVoiceRate(voiceId: VoiceId, rate: number): void {
		const found = this.findRecordByVoiceId(voiceId);
		if (!found) {
			return;
		}
		if (!Number.isFinite(rate) || rate <= 0) {
			throw new Error('[SoundMaster] Voice rate must be positive and finite.');
		}
		const record = found;
		record.params.playbackRate = rate;
		record.backendVoice.setRate(rate);
	}

	public setVoiceFilter(voiceId: VoiceId, filter: AudioFilterParams): void {
		const found = this.findRecordByVoiceId(voiceId);
		if (!found) {
			return;
		}
		found.params.filter = {
			type: filter.type,
			frequency: filter.frequency,
			q: filter.q,
			gain: filter.gain,
		};
		found.backendVoice.setFilter(filter);
	}

	public stopVoiceById(voiceId: VoiceId, fade_ms?: number): void {
		const found = this.findRecordByVoiceId(voiceId);
		if (!found) {
			return;
		}
		this.stopVoiceRecord(found, fade_ms);
	}

	public setSlotGainLinear(slot: AudioSlot, gain: number): void {
		const record = this.findRecordBySlot(slot);
		if (!record) {
			return;
		}
		record.backendVoice.setGainLinear(clamp01(gain));
	}

	public rampSlotGainLinear(slot: AudioSlot, target: number, seconds: number): void {
		const record = this.findRecordBySlot(slot);
		if (!record) {
			return;
		}
		if (!Number.isFinite(seconds) || seconds <= 0) {
			this.setSlotGainLinear(slot, target);
			return;
		}
		record.backendVoice.rampGainLinear(clamp01(target), seconds);
	}

	public stopSlot(slot: AudioSlot, fade_ms?: number): void {
		this.advanceSlotPlaySequence(slot);
		this.stopSlotRecord(slot, fade_ms);
	}

	private stopSlotRecord(slot: AudioSlot, fade_ms?: number): void {
		const record = this.findRecordBySlot(slot);
		if (!record) {
			return;
		}
		this.stopVoiceRecord(record, fade_ms);
	}

	public setMixerFps(fps: number): void {
		if (!Number.isFinite(fps) || fps <= 0) {
			throw new Error('[SoundMaster] Mixer FPS must be a positive finite value.');
		}
		this.mixFps = fps;
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
		const frameTimeSec = 1 / this.mixFps;
		this.mixTargetAheadSec = frameTimeSec + this.profileOverheadSec();
		if (this.audio && this.globalSuspensions.size === 0) {
			this.A.setFrameTimeSec(this.mixTargetAheadSec);
		}
	}

	public getLatencyProfile(): MixLatencyProfile {
		return this.mixLatencyProfile;
	}

	public finishFrame(): void {
	}

	private startMixer(): void {
		this.A.clearCoreStream();
		this.A.setFrameTimeSec(this.mixTargetAheadSec);
		this.A.setCoreNeedHandler(null);
	}

	private stopMixer(): void {
		this.A.setCoreNeedHandler(null);
		this.A.clearCoreStream();
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
		const clamped = clamp01(value);
		this.A.setMasterGain(clamped);
	}

	public pushCoreFrames(samples: Int16Array, channels: number, sampleRate: number): void {
		this.A.pushCoreFrames(samples, channels, sampleRate);
	}

	public getActiveVoiceInfosBySlot(slot: AudioSlot): ActiveVoiceInfo[] {
		const result: ActiveVoiceInfo[] = [];
		for (let i = 0; i < this.voices.length; i++) {
			const v = this.voices[i];
			if (v.slot !== slot) {
				continue;
			}
				result.push({
					slot: v.slot,
					voiceId: v.voiceId,
					sourceAddr: v.sourceAddr,
					params: v.params,
					startedAt: v.startedAt,
					startOffset: v.startOffset,
				});
			}
			return result;
	}

	public addEndedListener(listener: (info: ActiveVoiceInfo) => void): () => void {
		this.endedListeners.add(listener);
		return () => {
			this.endedListeners.delete(listener);
		};
	}

	public dispose(): void {
		this.stopAllVoices();
		this.stopMixer();
		this.clearStreamClipCache();
		this.clearVoiceCollections();
	}
}
