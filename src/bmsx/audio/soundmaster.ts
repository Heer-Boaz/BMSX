import { engineCore } from '../core/engine';
import { AudioPlaybackParams, AudioService, AudioClipHandle, VoiceHandle, VoiceEndedEvent, AudioFilterParams, RngService, SubscriptionHandle, createSubscriptionHandle } from '../platform';
import { asset_id, AudioMeta, CartridgeLayerId, id2res, RomAsset } from '../rompack/format';
import { Runtime } from '../machine/runtime/runtime';
import { clamp01 } from '../common/clamp';

export type VoiceId = number;
export type AudioSlot = number;
type ModulationInput = RandomModulationParams | ModulationParams;

export interface SoundMasterPlayRequest {
	params?: RandomModulationParams | ModulationParams;
	modulation_preset?: asset_id;
	priority?: number;
}

export interface SoundMasterResolvedPlayRequest {
	playbackRate: number;
	gainLinear: number;
	offsetSeconds: number;
	filter: AudioFilterParams | null;
	priority?: number;
}

export interface ActiveVoiceInfo {
	slot: AudioSlot;
	voiceId: VoiceId;
	id: asset_id;
	priority: number;
	params: ModulationParams;
	startedAt: number;
	startOffset: number;
	meta: AudioMeta;
}

export interface AudioMetadataWithID extends AudioMeta {
	id: asset_id;
}

export type AudioStopSelector = 'all' | 'oldest' | 'newest' | 'byid' | 'byvoice';
export type ModulationRange = [number, number];

export interface FilterModulationParams {
	type?: BiquadFilterType;
	frequency?: number;
	q?: number;
	gain?: number;
}

export interface RandomModulationParams {
	pitchRange?: ModulationRange;
	volumeRange?: ModulationRange;
	offsetRange?: ModulationRange;
	playbackRateRange?: ModulationRange;
	filter?: FilterModulationParams;
}

export interface ModulationParams {
	pitchDelta?: number;
	volumeDelta?: number;
	offset?: number;
	playbackRate?: number;
	filter?: FilterModulationParams;
}

export interface ModulationPresetResolver {
	resolve(key: asset_id): RandomModulationParams | ModulationParams;
}

// Host-side audio playback/output and browser latency handling. This is the
// mixer behind the machine APU; cart-visible audio is MMIO, not SoundMaster.
export type AudioBytesResolver = (id: asset_id) => Uint8Array;

type RomAudioResource = RomAsset & {
	start?: number;
	end?: number;
	audiometa: AudioMeta;
	payload_id: CartridgeLayerId;
};

interface PausedSnapshot {
	slot: AudioSlot;
	id: asset_id;
	offset: number;
	params: ModulationParams;
	priority: number;
}

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
	private tracks: Record<asset_id, RomAudioResource>;
	private streamClips: Record<string, StreamClipHandle>;
	private streamClipLoads: Record<string, Promise<StreamClipHandle>>;
	private audio!: AudioService;
	private rng!: RngService;
	private modulationResolver: ModulationPresetResolver;
	private audioResolver: AudioBytesResolver;
	private modulationPresetCache: Map<asset_id, RandomModulationParams | ModulationParams>;
	private voices: ActiveVoiceRecord[];
	private currentVoiceBySlot: Record<number, StreamVoiceHandle | undefined>;
	private currentPlayParamsBySlot: Record<number, ModulationParams | undefined>;
	public currentAudioBySlot: Record<number, AudioMetadataWithID | undefined>;
	private pausedVoices: PausedSnapshot[];
	private endedListeners: Set<(info: ActiveVoiceInfo) => void>;
	private nextVoiceId: VoiceId;
	private voiceRecordByHandle: WeakMap<VoiceHandle, ActiveVoiceRecord>;
	private mixFps: number;
	private mixLatencyProfile: MixLatencyProfile;
	private mixTargetAheadSec: number;

	private constructor() {
		this.globalSuspensions = new Set();
		this.tracks = {};
		this.streamClips = {};
		this.streamClipLoads = {};
		this.modulationResolver = null;
		this.audioResolver = null;
		this.modulationPresetCache = new Map();
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
		if (!this.audio) throw new Error('[SoundMaster] Audio service not initialized. Call init() first.');
		return this.audio;
	}

	private get R(): RngService {
		if (!this.rng) throw new Error('[SoundMaster] RNG service not initialized. Call init() first.');
		return this.rng;
	}

	private isRuntimeAudioAvailable(): boolean {
		return !!this.audio && this.audio.available;
	}

	private clearVoiceCollections(): void {
		this.voices = [];
		this.currentVoiceBySlot = {};
		this.currentPlayParamsBySlot = {};
		this.currentAudioBySlot = {};
		this.pausedVoices = [];
	}

	public bootstrapRuntimeAudio(startingVolume: number): void {
		this.audio = engineCore.platform.audio;
		this.rng = engineCore.platform.rng;
		const sampleRate = this.A.sampleRate();
		if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
			throw new Error('[SoundMaster] Audio sample rate must be a positive finite value.');
		}
		this.setMixerFps(Runtime.instance.timing.ufps);
		this.volume = clamp01(startingVolume);
	}

	public async init(audioResources: id2res, startingVolume: number, resolver: ModulationPresetResolver | null, audioResolver: AudioBytesResolver) {
		this.bootstrapRuntimeAudio(startingVolume);
		this.modulationResolver = resolver;
		this.audioResolver = audioResolver;
		this.modulationPresetCache.clear();

		await this.A.resume();

		this.tracks = this.coerceAudioResources(audioResources);
		this.streamClips = {};
		this.streamClipLoads = {};
		this.resetPlaybackState();
		this.startMixer();
	}

	public isRuntimeAudioReady(): boolean {
		return !!this.audio;
	}

	public hasAudio(id: asset_id): boolean {
		return this.tracks[id] !== undefined;
	}

	public currentTrackBySlot(slot: AudioSlot): asset_id {
		return this.currentVoiceBySlot[slot] === undefined ? '' : this.currentAudioBySlot[slot]?.id ?? '';
	}

	public resetPlaybackState(): void {
		this.stopAllVoices();
		this.clearVoiceCollections();
		this.nextVoiceId = 1;
		this.voiceRecordByHandle = new WeakMap();
	}

	public stopAllVoices(): void {
		while (this.voices.length > 0) {
			this.stopVoiceRecord(this.voices[this.voices.length - 1]);
		}
	}

	private coerceAudioResources(resources: id2res): Record<asset_id, RomAudioResource> {
		const map: Record<asset_id, RomAudioResource> = {};
		const ids = Object.keys(resources);
		for (let i = 0; i < ids.length; i++) {
			const key = ids[i] as asset_id;
			const value = resources[key];
			if (!value || typeof value !== 'object') {
				throw new Error(`[SoundMaster] Audio resource '${String(key)}' is invalid.`);
			}
			const start = (value as { start?: number }).start;
			const end = (value as { end?: number }).end;
			const meta = (value as { audiometa?: AudioMeta }).audiometa;
			if (typeof start !== 'number' || typeof end !== 'number') {
				throw new Error(`[SoundMaster] Audio resource '${String(key)}' is missing byte offsets.`);
			}
			if (!meta) {
				throw new Error(`[SoundMaster] Audio resource '${String(key)}' is missing audio metadata.`);
			}
			const payload_id = (value as { payload_id?: CartridgeLayerId }).payload_id as CartridgeLayerId;
			map[key] = { ...value, start, end, audiometa: meta, payload_id };
		}
		return map;
	}

	private getRuntimeBytes(id: asset_id): Uint8Array {
		if (!this.audioResolver) {
			throw new Error('[SoundMaster] Audio resolver not configured.');
		}
		return this.audioResolver(id);
	}

	private async clipFor(id: asset_id): Promise<StreamClipHandle> {
		const cached = this.streamClips[id];
		if (cached) {
			return cached;
		}
		const pending = this.streamClipLoads[id];
		if (pending) {
			return pending;
		}
		const runtimeBytes = this.getRuntimeBytes(id);
		const copyBytes = new Uint8Array(runtimeBytes.byteLength);
		copyBytes.set(runtimeBytes);
		const task = this.A.createClipFromBytes(copyBytes.buffer).then((backendClip) => {
			const clip = new StreamClipHandle(backendClip);
			this.streamClips[id] = clip;
			this.streamClipLoads[id] = undefined;
			return clip;
		}, (error) => {
			this.streamClipLoads[id] = undefined;
			throw error;
		});
		this.streamClipLoads[id] = task;
		return task;
	}

	public invalidateClip(id: asset_id): void {
		if (!this.isRuntimeAudioAvailable()) {
			return;
		}
		const clip = this.streamClips[id];
		if (clip) {
			clip.dispose();
		}
		this.streamClips[id] = undefined;
		this.streamClipLoads[id] = undefined;
		this.stop(id);
	}

	private normalizePlayRequest(options?: SoundMasterPlayRequest | ModulationParams | RandomModulationParams): SoundMasterPlayRequest {
		if (!options) return {};
		if (this.isPlayRequest(options)) {
			const req = options as SoundMasterPlayRequest;
			return { params: req.params, modulation_preset: req.modulation_preset, priority: req.priority };
		}
		return { params: options as (RandomModulationParams | ModulationParams) };
	}

	private isPlayRequest(options: unknown): options is SoundMasterPlayRequest {
		if (!options || typeof options !== 'object') return false;
		const obj = options as Record<string, unknown>;
		return ('params' in obj) || ('priority' in obj) || ('modulation_preset' in obj);
	}

	private resolvePlayParams(options?: ModulationInput): ModulationParams {
		if (!options) return {};

		const randomInRange = (range?: ModulationRange): number => {
			if (!range) return 0;
			const first = range[0];
			const second = range[1];
			if (first <= second) {
				return first + (second - first) * this.R.next();
			}
			return second + (first - second) * this.R.next();
		};

		const baseParams = options as ModulationParams;
		const randomParams = options as RandomModulationParams;

		const params: ModulationParams = {};
		params.offset = (baseParams.offset !== undefined ? baseParams.offset : 0) + randomInRange(randomParams.offsetRange);
		params.pitchDelta = (baseParams.pitchDelta !== undefined ? baseParams.pitchDelta : 0) + randomInRange(randomParams.pitchRange);
		params.volumeDelta = (baseParams.volumeDelta !== undefined ? baseParams.volumeDelta : 0) + randomInRange(randomParams.volumeRange);
		params.playbackRate = (baseParams.playbackRate !== undefined ? baseParams.playbackRate : 1) + randomInRange(randomParams.playbackRateRange);
		if (baseParams.filter) {
			params.filter = { ...baseParams.filter };
		} else if (randomParams.filter) {
			params.filter = { ...randomParams.filter };
		}
		return params;
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

	private resolveModulationPreset(key: asset_id): RandomModulationParams | ModulationParams | undefined {
		if (this.modulationPresetCache.has(key)) {
			return this.modulationPresetCache.get(key);
		}
		if (!this.modulationResolver) {
			this.modulationPresetCache.set(key, undefined);
			return undefined;
		}
		const resolved = this.modulationResolver.resolve(key);
		this.modulationPresetCache.set(key, resolved);
		return resolved;
	}

	private createVoiceParams(meta: AudioMeta, params: ModulationParams, clip: AudioClipHandle): AudioPlaybackParams {
		const loopStart = meta.loop;
		const loopEnd = (meta as { loopEnd?: number }).loopEnd;
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

	private effectivePlaybackRate(params: ModulationParams): number {
		return (params.playbackRate ?? 1) * Math.pow(2, (params.pitchDelta ?? 0) / 12);
	}

	public async play(id: asset_id, options?: SoundMasterPlayRequest | ModulationParams | RandomModulationParams): Promise<VoiceId> {
		return this.playOnSlot(0, id, options);
	}

	public async playOnSlot(slot: AudioSlot, id: asset_id, options?: SoundMasterPlayRequest | ModulationParams | RandomModulationParams): Promise<VoiceId> {
		const request = this.normalizePlayRequest(options);
		const modulationPreset = request.modulation_preset;
		let sourceParams = request.params;
		if (!sourceParams && modulationPreset !== undefined) {
			sourceParams = this.resolveModulationPreset(modulationPreset);
			if (!sourceParams) {
				console.warn(`SoundMaster: Missing modulation preset '${String(modulationPreset)}' for ${String(id)}`);
			}
		}
		const params = this.resolvePlayParams(sourceParams);
		return this.playWithParams(slot, id, params, request.priority);
	}

	public async playResolved(id: asset_id, request: SoundMasterResolvedPlayRequest): Promise<VoiceId> {
		return this.playResolvedOnSlot(0, id, request);
	}

	public async playResolvedOnSlot(slot: AudioSlot, id: asset_id, request: SoundMasterResolvedPlayRequest): Promise<VoiceId> {
		const params = this.resolveResolvedPlayParams(request);
		return this.playWithParams(slot, id, params, request.priority);
	}

	private async playWithParams(slot: AudioSlot, id: asset_id, params: ModulationParams, requestedPriority: number | undefined): Promise<VoiceId> {
		const meta = this.getAudioMetaOrThrow(id);
		const priority = requestedPriority ?? meta.priority ?? 0;
		const clip = await this.clipFor(id);
		const playback = this.createVoiceParams(meta, params, clip);
		return this.startVoice(slot, id, meta, clip, params, priority, playback);
	}

	private startVoice(
		slot: AudioSlot,
		id: asset_id,
		meta: AudioMeta,
		clip: StreamClipHandle,
		params: ModulationParams,
		priority: number,
		playback: AudioPlaybackParams,
	): VoiceId {
		this.stopSlot(slot);
		const voiceId = this.nextVoiceId++;
		const backendVoice = this.A.createVoice(clip.backendClip, playback);
		const startedAt = backendVoice.startedAt;
		const startOffset = backendVoice.startOffset;
		const voice = new StreamVoiceHandle(this, voiceId, startedAt, startOffset);
		const record: ActiveVoiceRecord = {
			slot,
			voiceId,
			id,
			priority,
			params,
			startedAt,
			startOffset,
			meta,
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
		this.currentAudioBySlot[slot] = { ...meta, id };
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
				this.currentAudioBySlot[record.slot] = { ...latest.meta, id: latest.id };
				this.currentPlayParamsBySlot[record.slot] = latest.params;
			} else {
				delete this.currentVoiceBySlot[record.slot];
				delete this.currentAudioBySlot[record.slot];
				delete this.currentPlayParamsBySlot[record.slot];
			}
		}

		if (this.endedListeners.size > 0) {
			const payload: ActiveVoiceInfo = {
				slot: record.slot,
				voiceId: record.voiceId,
				id: record.id,
				priority: record.priority,
				params: record.params,
				startedAt: record.startedAt,
				startOffset: record.startOffset,
				meta: record.meta,
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

	private getAudioMetaOrThrow(id: asset_id): AudioMeta {
		const resource = this.tracks[id];
		if (!resource) {
			throw new Error(`[SoundMaster] Audio asset '${String(id)}' not found.`);
		}
		return resource.audiometa;
	}

	public stop(id?: asset_id): void {
		if (!this.isRuntimeAudioAvailable()) {
			return;
		}
		if (id === undefined) {
			this.stopAllVoices();
			return;
		}
		const targets: ActiveVoiceRecord[] = [];
		for (let index = this.voices.length - 1; index >= 0; index -= 1) {
			if (this.voices[index].id === id) {
				targets.push(this.voices[index]);
			}
		}
		for (let i = 0; i < targets.length; i++) {
			this.stopVoiceRecord(targets[i]);
		}
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
				id: v.id,
				priority: v.priority,
				params: v.params,
				startedAt: v.startedAt,
				startOffset: v.startOffset,
				meta: v.meta,
			});
		}
		return result;
	}

	public snapshotVoices(slot: AudioSlot): PausedSnapshot[] {
		const now = this.A.currentTime();
		const snapshots: PausedSnapshot[] = [];
		for (let i = 0; i < this.voices.length; i++) {
			const v = this.voices[i];
			if (v.slot !== slot) {
				continue;
			}
			const rate = this.effectivePlaybackRate(v.params);
			const progressed = (now - v.startedAt) * rate;
			const offset = v.startOffset + progressed;
			snapshots.push({ slot, id: v.id, offset, params: v.params, priority: v.priority });
		}
		return snapshots;
	}

	public drainPausedSnapshots(slot: AudioSlot): PausedSnapshot[] {
		const drained: PausedSnapshot[] = [];
		const kept: PausedSnapshot[] = [];
		for (let i = 0; i < this.pausedVoices.length; i++) {
			const snapshot = this.pausedVoices[i];
			if (snapshot.slot === slot) {
				drained.push(snapshot);
			} else {
				kept.push(snapshot);
			}
		}
		this.pausedVoices = kept;
		return drained;
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
		const clipIds = Object.keys(this.streamClips);
		for (let i = 0; i < clipIds.length; i += 1) {
			const clip = this.streamClips[clipIds[i]];
			if (clip) {
				clip.dispose();
			}
		}
		this.streamClips = {};
		this.streamClipLoads = {};
		this.tracks = {};
		this.clearVoiceCollections();
		this.modulationPresetCache.clear();
	}
}
