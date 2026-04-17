import { $ } from '../core/engine_core';
import { AudioPlaybackParams, AudioService, AudioClipHandle, VoiceHandle, VoiceEndedEvent, AudioFilterParams, RngService, SubscriptionHandle, createSubscriptionHandle } from '../platform';
import { asset_id, AudioMeta, AudioType, AudioTypes, CartridgeLayerId, DEFAULT_MACHINE_MAX_VOICES, id2res, RomAsset } from '../rompack/rompack';
import { Runtime } from '../machine/runtime/runtime';
import { clamp01 } from '../common/clamp';

export type VoiceId = number;
type ModulationInput = RandomModulationParams | ModulationParams;

export interface SoundMasterPlayRequest {
	params?: RandomModulationParams | ModulationParams;
	modulation_preset?: asset_id;
	priority?: number;
}

export interface ActiveVoiceInfo {
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

type AudioPlaybackMode = 'replace' | 'ignore' | 'queue' | 'stop' | 'pause';
type MusicTransitionStingerSync = { stinger: asset_id; return_to?: asset_id; return_to_previous?: boolean };
type MusicTransitionDelaySync = { delay_ms: number };
type MusicTransitionSync = 'immediate' | 'loop' | MusicTransitionDelaySync | MusicTransitionStingerSync;
type AudioRouterOptions = {
	modulation_params?: RandomModulationParams | ModulationParams;
	params?: RandomModulationParams | ModulationParams;
	modulation_preset?: asset_id;
	priority?: number;
	policy?: AudioPlaybackMode;
	max_voices?: number;
	channel?: AudioType;
	audio_id?: asset_id;
	sync?: MusicTransitionSync;
	fade_ms?: number;
	crossfade_ms?: number;
	start_at_loop_start?: boolean;
	start_fresh?: boolean;
};
export type AudioPlayOptions = RandomModulationParams | ModulationParams | SoundMasterPlayRequest | AudioRouterOptions;

// Host-side audio playback/output and browser latency handling. This class is
// not the console audio device; cart-visible audio should be owned by a
// machine-side MMIO controller when the APU boundary is introduced.
export type AudioBytesResolver = (id: asset_id) => Uint8Array;

type RomAudioResource = RomAsset & {
	start?: number;
	end?: number;
	audiometa: AudioMeta;
	payload_id: CartridgeLayerId;
};

interface PausedSnapshot {
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

type ParsedAudioOptions = {
	request: SoundMasterPlayRequest;
	policy?: AudioPlaybackMode;
	maxVoices?: number;
	channel?: AudioType;
};

type AudioQueueItem = {
	id: asset_id;
	request: SoundMasterPlayRequest;
	maxVoices: number;
};

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
	if (platform === 'iPhone' || platform === 'iPad' || platform === 'iPod') {
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

function isMusicTransitionStingerSync(sync: MusicTransitionSync): sync is MusicTransitionStingerSync {
	return typeof sync === 'object' && (sync as MusicTransitionStingerSync).stinger !== undefined;
}

function isMusicTransitionDelaySync(sync: MusicTransitionSync): sync is MusicTransitionDelaySync {
	return typeof sync === 'object' && (sync as MusicTransitionDelaySync).delay_ms !== undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function parseAudioChannel(value: unknown): AudioType {
	if (value === 'sfx' || value === 'music' || value === 'ui') {
		return value;
	}
	throw new Error(`Unknown audio channel "${String(value)}".`);
}

function parsePlaybackMode(value: unknown): AudioPlaybackMode {
	if (value === 'replace' || value === 'ignore' || value === 'queue' || value === 'stop' || value === 'pause') {
		return value;
	}
	throw new Error(`Unknown audio policy "${String(value)}".`);
}

function hasModulationFields(value: Record<string, unknown>): boolean {
	return value.pitchDelta !== undefined
		|| value.volumeDelta !== undefined
		|| value.offset !== undefined
		|| value.playbackRate !== undefined
		|| value.pitchRange !== undefined
		|| value.volumeRange !== undefined
		|| value.offsetRange !== undefined
		|| value.playbackRateRange !== undefined
		|| value.filter !== undefined;
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
	private voicesByType: Record<AudioType, ActiveVoiceRecord[]>;
	private currentVoiceByType: Record<AudioType, VoiceHandle>;
	private currentPlayParamsByType: Record<AudioType, ModulationParams>;
	public currentAudioByType: Record<AudioType, AudioMetadataWithID>;
	private pausedByType: Record<AudioType, PausedSnapshot[]>;
	private audioQueueByType: Record<AudioType, AudioQueueItem[]>;
	private resumeOnNextEndByType: Record<AudioType, boolean>;
	private endedListenersByType: Record<AudioType, Set<(info: ActiveVoiceInfo) => void>>;
	private nextVoiceId: VoiceId;
	private musicTransitionTimer: ReturnType<typeof setTimeout>;
	private musicTransitionRequestId: number;
	private pendingStingerReturnTo: asset_id;
	private pendingStingerReturnUnsub: (() => void) | null;
	private pendingStingerType: AudioType | null;
	private pendingStingerVoice: VoiceId | null;
	private maxVoicesByType: Record<AudioType, number>;
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
		this.voicesByType = { sfx: [], music: [], ui: [] };
		this.currentVoiceByType = { sfx: null, music: null, ui: null };
		this.currentPlayParamsByType = { sfx: null, music: null, ui: null };
		this.currentAudioByType = { sfx: null, music: null, ui: null };
		this.pausedByType = { sfx: [], music: [], ui: [] };
		this.audioQueueByType = { sfx: [], music: [], ui: [] };
		this.resumeOnNextEndByType = { sfx: false, music: false, ui: false };
		this.endedListenersByType = { sfx: new Set(), music: new Set(), ui: new Set() };
		this.nextVoiceId = 1;
		this.musicTransitionTimer = null;
		this.musicTransitionRequestId = 0;
		this.pendingStingerReturnTo = null;
		this.pendingStingerReturnUnsub = null;
		this.pendingStingerType = null;
		this.pendingStingerVoice = null;
		this.maxVoicesByType = { sfx: DEFAULT_MACHINE_MAX_VOICES.sfx, music: DEFAULT_MACHINE_MAX_VOICES.music, ui: DEFAULT_MACHINE_MAX_VOICES.ui };
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

	public bootstrapRuntimeAudio(startingVolume: number): void {
		this.audio = $.platform.audio;
		this.rng = $.platform.rng;
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
		this.resetVoiceState();
		this.startMixer();
	}

	public isRuntimeAudioReady(): boolean {
		return !!this.audio;
	}

	public hasAudio(id: asset_id): boolean {
		return this.tracks[id] !== undefined;
	}

	public setMaxVoicesByType(specs: Partial<Record<AudioType, number>>): void {
		for (let index = 0; index < AudioTypes.length; index += 1) {
			const type = AudioTypes[index];
			const spec = specs[type];
			if (spec === undefined) {
				continue;
			}
			if (!Number.isFinite(spec)) {
				throw new Error(`[SoundMaster] max voices for '${type}' must be a finite number.`);
			}
			const value = Math.floor(spec);
			if (value < 1) {
				throw new Error(`[SoundMaster] max voices for '${type}' must be at least 1.`);
			}
			this.maxVoicesByType[type] = value;
			const pool = this.voicesByType[type];
			while (pool.length > value) {
				this.stopVoiceRecord(type, pool[0]);
			}
		}
	}

	private resetVoiceState(): void {
		this.beginMusicTransition();
		this.stopAllVoices();
		this.voicesByType = { sfx: [], music: [], ui: [] };
		this.currentVoiceByType = { sfx: null, music: null, ui: null };
		this.currentPlayParamsByType = { sfx: null, music: null, ui: null };
		this.currentAudioByType = { sfx: null, music: null, ui: null };
		this.pausedByType = { sfx: [], music: [], ui: [] };
		this.audioQueueByType = { sfx: [], music: [], ui: [] };
		this.resumeOnNextEndByType = { sfx: false, music: false, ui: false };
		this.nextVoiceId = 1;
		this.voiceRecordByHandle = new WeakMap();
	}

	public resetPlaybackState(): void {
		this.resetVoiceState();
	}

	private stopAllVoices(): void {
		this.stop('sfx', 'all');
		this.stop('music', 'all');
		this.stop('ui', 'all');
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

	private resolvePlayParams(options: ModulationInput): ModulationParams {
		if (!options) return {};
		const anyOptions = options as RandomModulationParams | ModulationParams;

		const randomInRange = (range?: ModulationRange): number => {
			if (!range) return 0;
			let min = range[0];
			let max = range[1];
			if (min > max) { const t = min; min = max; max = t; }
			const span = max - min;
			return min + span * this.R.next();
		};

		const baseParams = anyOptions as ModulationParams;
		const randomParams = anyOptions as RandomModulationParams;

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

	private resolveModulationPreset(key: asset_id): RandomModulationParams | ModulationParams {
		if (key === undefined || key === null) return undefined;
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
		const loop = (loopStart !== undefined && loopStart !== null) ? { start: loopStart, end: loopEnd } : null;

		let rate = params.playbackRate !== undefined ? params.playbackRate : 1;
		const pitch = params.pitchDelta !== undefined ? params.pitchDelta : 0;
		const pitchRate = Math.pow(2, pitch / 12);
		rate *= pitchRate;
		if (rate <= 0) {
			throw new Error('[SoundMaster] Playback rate must be positive.');
		}

		let offset = params.offset !== undefined ? params.offset : 0;
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

		const volumeDelta = params.volumeDelta !== undefined ? params.volumeDelta : 0;
		let gainLinear = Math.pow(10, volumeDelta / 20);
		if (gainLinear < 0) gainLinear = 0;
		if (gainLinear > 1) gainLinear = 1;

		let filter: AudioPlaybackParams['filter'] = null;
		if (params.filter) {
			const filterParams = params.filter;
			filter = {
				type: filterParams.type !== undefined ? filterParams.type : 'lowpass',
				frequency: filterParams.frequency !== undefined ? filterParams.frequency : 350,
				q: filterParams.q !== undefined ? filterParams.q : 1,
				gain: filterParams.gain !== undefined ? filterParams.gain : 0,
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
		if (!params) return 1;
		const base = params.playbackRate !== undefined ? params.playbackRate : 1;
		const pitch = params.pitchDelta !== undefined ? params.pitchDelta : 0;
		return base * Math.pow(2, pitch / 12);
	}

	public async play(id: asset_id, options?: SoundMasterPlayRequest | ModulationParams | RandomModulationParams): Promise<VoiceId> {
		try {
			const request = this.normalizePlayRequest(options);
			let sourceParams = request.params;
			if (!sourceParams && request.modulation_preset !== undefined) {
				sourceParams = this.resolveModulationPreset(request.modulation_preset);
				if (!sourceParams) {
					console.warn(`SoundMaster: Missing modulation preset '${String(request.modulation_preset)}' for ${String(id)}`);
				}
			}
			const params = this.resolvePlayParams(sourceParams);
			const meta = this.getAudioMetaOrThrow(id);
			const typeCandidate = meta.audiotype;
			if (!this.isAudioType(typeCandidate)) {
				throw new Error(`[SoundMaster] Audio asset '${String(id)}' has unknown audio type '${String(typeCandidate)}'.`);
			}
			const priority = request.priority !== undefined ? request.priority : (meta.priority !== undefined ? meta.priority : 0);
			const clip = await this.clipFor(id);
			const playback = this.createVoiceParams(meta, params, clip);
			const voiceId = this.startVoice(typeCandidate, id, meta, clip, params, priority, playback, null);
			return voiceId;
		} catch (error) {
			console.error(error);
			return null;
		}
	}

	private startVoice(
		type: AudioType,
		id: asset_id,
		meta: AudioMeta,
		clip: StreamClipHandle,
		params: ModulationParams,
		priority: number,
		playback: AudioPlaybackParams,
		onStarted: ((voice: StreamVoiceHandle, record: ActiveVoiceRecord) => void) | null,
	): VoiceId {
		const pool = this.voicesByType[type];
		const capacity = this.maxVoicesByType[type];
		if (capacity > 0 && pool.length >= capacity) {
			const dropIndex = this.selectVoiceDropIndex(pool);
			const dropRecord = dropIndex >= 0 ? pool[dropIndex] : undefined;
			if (dropRecord) {
				if (priority < dropRecord.priority) {
					return null;
				}
				this.stopVoiceRecord(type, dropRecord);
			}
		}

		const voiceId = this.nextVoiceId++;
		let backendVoice: VoiceHandle;
		try {
			backendVoice = this.A.createVoice(clip.backendClip, playback);
		} catch (error) {
			throw error;
		}
		const startedAt = backendVoice.startedAt;
		const startOffset = backendVoice.startOffset;
		const voice = new StreamVoiceHandle(this, voiceId, startedAt, startOffset);
		const record: ActiveVoiceRecord = {
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

		pool.push(record);
		record.backendEnded = backendVoice.onEnded(() => {
			this.stopVoiceRecord(type, record);
		});
		this.voiceRecordByHandle.set(voice, record);
		this.currentVoiceByType[type] = voice;
		this.currentAudioByType[type] = { ...meta, id };
		this.currentPlayParamsByType[type] = params;

		if (onStarted) onStarted(voice, record);

		return voiceId;
	}

	private finalizeVoiceEnd(type: AudioType, record: ActiveVoiceRecord): void {
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

		if (this.currentVoiceByType[type] === record.handle) {
			const pool = this.voicesByType[type];
			const latest = pool.length > 0 ? pool[pool.length - 1] : null;
			if (latest) {
				this.currentVoiceByType[type] = latest.handle;
				this.currentAudioByType[type] = { ...latest.meta, id: latest.id };
				this.currentPlayParamsByType[type] = latest.params;
			} else {
				this.currentVoiceByType[type] = null;
				this.currentAudioByType[type] = null;
				this.currentPlayParamsByType[type] = null;
			}
		}

		this.onAudioChannelEnded(type);

		const listeners = this.endedListenersByType[type];
		if (listeners.size > 0) {
			const payload: ActiveVoiceInfo = {
				voiceId: record.voiceId,
				id: record.id,
				priority: record.priority,
				params: record.params,
				startedAt: record.startedAt,
				startOffset: record.startOffset,
				meta: record.meta,
			};
			const iterator = listeners.values();
			for (let current = iterator.next(); !current.done; current = iterator.next()) {
				try {
					current.value(payload);
				} catch (error) {
					console.error('[SoundMaster] Ended listener failed:', error);
				}
			}
		}
	}

	private removeRecord(type: AudioType, voiceId: VoiceId): ActiveVoiceRecord {
		const pool = this.voicesByType[type];
		for (let i = 0; i < pool.length; i++) {
			if (pool[i].voiceId === voiceId) {
				return pool.splice(i, 1)[0];
			}
		}
		return undefined;
	}

	private stopVoiceRecord(type: AudioType, record: ActiveVoiceRecord): void {
		if (record.finalized) return;
		if (record.backendEnded !== null) {
			record.backendEnded.unsubscribe();
			record.backendEnded = null;
		}
		record.backendVoice.stop();
		this.removeRecord(type, record.voiceId);
		this.finalizeVoiceEnd(type, record);
	}

	private selectVoiceDropIndex(pool: ActiveVoiceRecord[]): number {
		if (pool.length === 0) return -1;
		let index = 0;
		let candidate = pool[0];
		for (let i = 1; i < pool.length; i++) {
			const record = pool[i];
			if (record.priority < candidate.priority) {
				candidate = record;
				index = i;
				continue;
			}
			if (record.priority === candidate.priority && record.startedAt < candidate.startedAt) {
				candidate = record;
				index = i;
			}
		}
		return index;
	}

	private findRecordByVoiceId(voiceId: VoiceId): { type: AudioType; record: ActiveVoiceRecord } | null {
		for (let typeIndex = 0; typeIndex < AudioTypes.length; typeIndex += 1) {
			const type = AudioTypes[typeIndex];
			const pool = this.voicesByType[type];
			for (let index = 0; index < pool.length; index += 1) {
				const record = pool[index];
				if (record.voiceId === voiceId) {
					return { type, record };
				}
			}
		}
		return null;
	}

	public setVoiceGainLinear(voiceId: VoiceId, gain: number): void {
		const found = this.findRecordByVoiceId(voiceId);
		if (!found) {
			return;
		}
		found.record.backendVoice.setGainLinear(clamp01(gain));
	}

	public rampVoiceGainLinear(voiceId: VoiceId, target: number, seconds: number): void {
		const found = this.findRecordByVoiceId(voiceId);
		if (!found) {
			return;
		}
		if (!Number.isFinite(seconds) || seconds <= 0) {
			throw new Error('[SoundMaster] Gain ramp duration must be positive and finite.');
		}
		found.record.backendVoice.rampGainLinear(clamp01(target), seconds);
	}

	public setVoiceRate(voiceId: VoiceId, rate: number): void {
		const found = this.findRecordByVoiceId(voiceId);
		if (!found) {
			return;
		}
		if (!Number.isFinite(rate) || rate <= 0) {
			throw new Error('[SoundMaster] Voice rate must be positive and finite.');
		}
		const record = found.record;
		record.params.playbackRate = rate;
		record.backendVoice.setRate(rate);
	}

	public setVoiceFilter(voiceId: VoiceId, filter: AudioFilterParams): void {
		const found = this.findRecordByVoiceId(voiceId);
		if (!found) {
			return;
		}
		found.record.params.filter = {
			type: filter.type,
			frequency: filter.frequency,
			q: filter.q,
			gain: filter.gain,
		};
		found.record.backendVoice.setFilter(filter);
	}

	public stopVoiceById(voiceId: VoiceId): void {
		const found = this.findRecordByVoiceId(voiceId);
		if (!found) {
			return;
		}
		this.stopVoiceRecord(found.type, found.record);
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

	private isAudioType(value: unknown): value is AudioType {
		return typeof value === 'string' && AudioTypes.includes(value as AudioType);
	}

	private parseAudioOptions(options?: AudioPlayOptions): ParsedAudioOptions {
		const out: ParsedAudioOptions = { request: {} };
		if (options === null || options === undefined) {
			return out;
		}
		if (!isObject(options)) {
			throw new Error('audio options must be a table.');
		}

		if (options.channel !== undefined) {
			out.channel = parseAudioChannel(options.channel);
		}
		if (options.policy !== undefined) {
			out.policy = parsePlaybackMode(options.policy);
		}
		if (options.max_voices !== undefined) {
			if (typeof options.max_voices !== 'number') {
				throw new Error('max_voices must be a number.');
			}
			out.maxVoices = Math.floor(options.max_voices);
		}
		if (options.priority !== undefined) {
			if (typeof options.priority !== 'number') {
				throw new Error('priority must be a number.');
			}
			out.request.priority = Math.floor(options.priority);
		}

		if (options.modulation_params !== undefined) {
			if (!isObject(options.modulation_params)) {
				throw new Error('modulation_params must be a table.');
			}
			out.request.params = options.modulation_params as RandomModulationParams | ModulationParams;
		} else if (options.params !== undefined) {
			if (!isObject(options.params)) {
				throw new Error('params must be a table.');
			}
			out.request.params = options.params as RandomModulationParams | ModulationParams;
		} else if (hasModulationFields(options)) {
			out.request.params = options as RandomModulationParams | ModulationParams;
		}

		if (!out.request.params && options.modulation_preset !== undefined) {
			if (typeof options.modulation_preset !== 'string') {
				throw new Error('modulation_preset must be a string.');
			}
			out.request.modulation_preset = options.modulation_preset;
		}

		return out;
	}

	private resolveMusicTransition(options: AudioPlayOptions | undefined, id?: asset_id): {
		request?: {
			to: asset_id;
			sync?: MusicTransitionSync;
			fade_ms?: number;
			crossfade_ms?: number;
			start_at_loop_start?: boolean;
			start_fresh?: boolean;
		};
	} {
		if (!options) {
			return {};
		}
		if (!isObject(options)) {
			throw new Error('music options must be a table.');
		}
		const hasTransition = options.sync !== undefined
			|| options.fade_ms !== undefined
			|| options.crossfade_ms !== undefined
			|| options.start_at_loop_start !== undefined
			|| options.start_fresh !== undefined
			|| options.audio_id !== undefined;
		if (!hasTransition) {
			return {};
		}
		const target = (id && id.length > 0) ? id : options.audio_id;
		if (!target || typeof target !== 'string') {
			throw new Error('music_transition.audio_id must be a string.');
		}
		if (options.fade_ms !== undefined && typeof options.fade_ms !== 'number') {
			throw new Error('music_transition.fade_ms must be a number.');
		}
		if (options.crossfade_ms !== undefined && typeof options.crossfade_ms !== 'number') {
			throw new Error('music_transition.crossfade_ms must be a number.');
		}
		if (options.fade_ms !== undefined && options.crossfade_ms !== undefined) {
			throw new Error('music_transition cannot specify both fade_ms and crossfade_ms.');
		}
		if (options.start_at_loop_start !== undefined && typeof options.start_at_loop_start !== 'boolean') {
			throw new Error('music_transition.start_at_loop_start must be a boolean.');
		}
		if (options.start_fresh !== undefined && typeof options.start_fresh !== 'boolean') {
			throw new Error('music_transition.start_fresh must be a boolean.');
		}
		if (options.sync !== undefined && typeof options.sync !== 'string' && !isObject(options.sync)) {
			throw new Error('music_transition.sync must be a string or table.');
		}
		return {
			request: {
				to: target,
				sync: options.sync as MusicTransitionSync | undefined,
				fade_ms: options.fade_ms,
				crossfade_ms: options.crossfade_ms,
				start_at_loop_start: options.start_at_loop_start,
				start_fresh: options.start_fresh,
			},
		};
	}

	private onAudioChannelEnded(type: AudioType): void {
		if (this.resumeOnNextEndByType[type]) {
			this.resumeOnNextEndByType[type] = false;
			this.resumeType(type);
			return;
		}
		const queue = this.audioQueueByType[type];
		while (queue.length > 0) {
			const item = queue[0];
			if (this.activeCountByType(type) >= item.maxVoices) {
				return;
			}
			queue.shift();
			void this.play(item.id, item.request);
		}
	}

	public playWithPolicy(type: AudioType, id: asset_id, request: SoundMasterPlayRequest = {}, policy: AudioPlaybackMode = 'replace', maxVoices = 1): void {
		if (!this.isRuntimeAudioAvailable()) {
			return;
		}
		const audioMeta = this.getAudioMetaOrThrow(id);
		const priority = request.priority ?? audioMeta.priority ?? 0;
		const resolvedRequest: SoundMasterPlayRequest = { ...request, priority };
		if (maxVoices < 1) {
			throw new Error('max_voices must be at least 1.');
		}
		if (policy === 'stop') {
			this.stop(type, 'all');
			this.audioQueueByType[type] = [];
			return;
		}
		const active = this.activeCountByType(type);
		if (active >= maxVoices) {
			if (policy === 'ignore') {
				return;
			}
			if (policy === 'replace') {
				const infos = this.getActiveVoiceInfosByType(type);
				if (infos.length === 0) {
					throw new Error('No active voices returned for audio channel.');
				}
				let minIdx = 0;
				let minPr = infos[0].priority;
				let oldest = infos[0].startedAt;
				for (let i = 1; i < infos.length; i += 1) {
					const info = infos[i];
					if (info.priority < minPr || (info.priority === minPr && info.startedAt < oldest)) {
						minIdx = i;
						minPr = info.priority;
						oldest = info.startedAt;
					}
				}
				if (priority < minPr) {
					return;
				}
				this.stop(type, 'byvoice', infos[minIdx].voiceId);
			}
			if (policy === 'pause') {
				this.pause(type);
				this.resumeOnNextEndByType[type] = true;
			}
			if (policy === 'queue') {
				this.audioQueueByType[type].push({ id, request: resolvedRequest, maxVoices });
				return;
			}
		}
		void this.play(id, resolvedRequest);
	}

	public playSfx(id: asset_id, options?: AudioPlayOptions): void {
		if (!this.isRuntimeAudioAvailable()) {
			return;
		}
		const parsed = this.parseAudioOptions(options);
		const channel = parsed.channel ?? 'sfx';
		if (channel === 'music') {
			throw new Error('sfx does not support music channel.');
		}
		this.playWithPolicy(channel, id, parsed.request, parsed.policy, parsed.maxVoices ?? 1);
	}

	public playMusic(id: asset_id, options?: AudioPlayOptions): void {
		if (!this.isRuntimeAudioAvailable()) {
			return;
		}
		const transition = this.resolveMusicTransition(options, id);
		if (transition.request) {
			this.requestMusicTransition(transition.request);
			return;
		}
		if (!id) {
			this.stopMusic();
			return;
		}
		const parsed = this.parseAudioOptions(options);
		if (parsed.channel && parsed.channel !== 'music') {
			throw new Error('music does not support non-music channel.');
		}
		this.playWithPolicy('music', id, parsed.request, parsed.policy, parsed.maxVoices ?? 1);
	}

	public stopMusicWithOptions(options?: AudioPlayOptions): void {
		if (options === undefined) {
			this.stopMusic();
			return;
		}
		if (!isObject(options)) {
			throw new Error('stop_music options must be a table.');
		}
		if (options.fade_ms !== undefined && typeof options.fade_ms !== 'number') {
			throw new Error('stop_music.fade_ms must be a number.');
		}
		if (options.crossfade_ms !== undefined) {
			throw new Error('stop_music does not support crossfade_ms.');
		}
		this.stopMusic({
			fade_ms: options.fade_ms,
		});
	}

	public stop(idOrType?: asset_id | AudioType, which?: AudioStopSelector, idOrVoice?: asset_id | VoiceId): void {
		if (!this.isRuntimeAudioAvailable()) {
			return;
		}
		if (this.isAudioType(idOrType)) {
			this.stopByTypeInternal(idOrType, which ?? 'all', idOrVoice);
			return;
		}
		if (idOrType !== undefined) {
			try {
				const inferredType = this.getAudioMetaOrThrow(idOrType).audiotype;
				if (!this.isAudioType(inferredType)) {
					throw new Error(`[SoundMaster] Audio asset '${String(idOrType)}' has unknown audio type '${String(inferredType)}'.`);
				}
				this.stopByTypeInternal(inferredType, 'byid', idOrType);
			} catch (err) {
				console.error(err);
			}
		}
	}

	private stopByTypeInternal(type: AudioType, which: AudioStopSelector, idOrVoice?: asset_id | VoiceId): void {
		const pool = this.voicesByType[type];
		const targets: ActiveVoiceRecord[] = [];

		switch (which) {
			case 'all':
				while (pool.length > 0) {
					const record = pool.pop();
					if (record) targets.push(record);
				}
				break;
			case 'oldest': {
					const record = pool.shift();
					if (record) targets.push(record);
					break;
				}
			case 'newest': {
					const record = pool.pop();
					if (record) targets.push(record);
					break;
				}
			case 'byid': {
					if (idOrVoice === undefined) return;
					for (let i = pool.length - 1; i >= 0; i--) {
						if (pool[i].id === idOrVoice) {
							targets.push(pool.splice(i, 1)[0]);
						}
					}
					break;
				}
			case 'byvoice': {
					if (idOrVoice === undefined) return;
					for (let i = pool.length - 1; i >= 0; i--) {
						if (pool[i].voiceId === idOrVoice) {
							targets.push(pool.splice(i, 1)[0]);
							break;
						}
					}
					break;
				}
		}

		for (let i = 0; i < targets.length; i++) {
			this.stopVoiceRecord(type, targets[i]);
		}
	}

	public stopEffect(): void {
		if (!this.isRuntimeAudioAvailable()) {
			return;
		}
		this.stop('sfx', 'all');
	}

	public stopMusic(opts?: { fade_ms?: number; }): void {
		if (!this.isRuntimeAudioAvailable()) {
			return;
		}
		const transitionId = this.beginMusicTransition();
		const fade_ms = opts?.fade_ms;
		if (fade_ms !== undefined && fade_ms > 0) {
			this.stopMusicAfterFadeOut(transitionId, fade_ms);
			return;
		}
		this.stop('music', 'all');
	}

	public stopUI(): void {
		if (!this.isRuntimeAudioAvailable()) {
			return;
		}
		this.stop('ui', 'all');
	}

	public pause(type?: AudioType): void {
		if (!this.isRuntimeAudioAvailable()) {
			return;
		}
		if (!type) {
			this.suspendAll('pause');
			return;
		}
		const pool = this.voicesByType[type];
		const snapshots: PausedSnapshot[] = [];
		const now = this.A.currentTime();
		while (pool.length > 0) {
			const record = pool.pop();
			if (!record) continue;
			const rate = this.effectivePlaybackRate(record.params);
			const progressed = (now - record.startedAt) * rate;
			const offset = record.startOffset + progressed;
			snapshots.push({ id: record.id, offset, params: record.params, priority: record.priority });
			this.stopVoiceRecord(type, record);
		}
		this.pausedByType[type].push(...snapshots);
	}

	public resume(): void {
		if (!this.isRuntimeAudioAvailable()) {
			return;
		}
		this.resumeAll('pause');
	}

	public resumeType(type: AudioType): void {
		if (!this.isRuntimeAudioAvailable()) {
			return;
		}
		const paused = this.drainPausedSnapshots(type);
		for (let i = 0; i < paused.length; i++) {
			const snapshot = paused[i];
			const params: ModulationParams = { ...snapshot.params, offset: snapshot.offset };
			void this.play(snapshot.id, { params, priority: snapshot.priority });
		}
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

	public currentTimeByType(type: AudioType): number {
		const handle = this.currentVoiceByType[type];
		if (!handle) return null;
		const record = this.voiceRecordByHandle.get(handle);
		if (!record || record.finalized) return null;
		const rate = this.effectivePlaybackRate(record.params);
		const now = this.A.currentTime();
		return record.startOffset + (now - record.startedAt) * rate;
	}

	public currentTrackByType(type: AudioType): asset_id {
		const audioMeta = this.currentAudioByType[type];
		return audioMeta ? audioMeta.id : null;
	}

	public currentTrackMetaByType(type: AudioType): AudioMeta {
		const audioMeta = this.currentAudioByType[type];
		return audioMeta ? audioMeta : null;
	}

	public currentModulationParamsByType(type: AudioType): ModulationParams {
		return this.currentPlayParamsByType[type] || null;
	}

	public activeCountByType(type: AudioType): number {
		return this.voicesByType[type].length;
	}

	public getActiveVoiceInfosByType(type: AudioType): ActiveVoiceInfo[] {
		const pool = this.voicesByType[type];
		const result: ActiveVoiceInfo[] = [];
		for (let i = 0; i < pool.length; i++) {
			const v = pool[i];
			result.push({
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

	public getCurrentTimeSec(): number {
		return this.A.currentTime();
	}

	public snapshotVoices(type: AudioType): { id: asset_id; offset: number; params: ModulationParams; priority: number; }[] {
		const now = this.A.currentTime();
		const pool = this.voicesByType[type];
		const snapshots: { id: asset_id; offset: number; params: ModulationParams; priority: number; }[] = [];
		for (let i = 0; i < pool.length; i++) {
			const v = pool[i];
			const rate = this.effectivePlaybackRate(v.params);
			const progressed = (now - v.startedAt) * rate;
			const offset = v.startOffset + progressed;
			snapshots.push({ id: v.id, offset, params: v.params, priority: v.priority });
		}
		return snapshots;
	}

	public drainPausedSnapshots(type: AudioType): { id: asset_id; offset: number; params: ModulationParams; priority: number; }[] {
		const arr = this.pausedByType[type];
		this.pausedByType[type] = [];
		return arr;
	}

	public addEndedListener(type: AudioType, listener: (info: ActiveVoiceInfo) => void): () => void {
		const listeners = this.endedListenersByType[type];
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	public requestMusicTransition(opts: {
		to: asset_id;
		sync?: MusicTransitionSync;
		fade_ms?: number;
		crossfade_ms?: number;
		start_at_loop_start?: boolean;
		start_fresh?: boolean;
	}): void {
		const transitionId = this.beginMusicTransition();
		if (opts.fade_ms !== undefined && opts.crossfade_ms !== undefined) {
			throw new Error('[SoundMaster] music_transition cannot specify both fade_ms and crossfade_ms.');
		}

		const sync = opts.sync !== undefined ? opts.sync : 'immediate';
		const fade_ms = opts.fade_ms !== undefined ? opts.fade_ms : 0;
		const crossfade_ms = opts.crossfade_ms;
		const start_at_loop_start = opts.start_at_loop_start !== undefined ? opts.start_at_loop_start : false;
		const start_fresh = opts.start_fresh !== undefined ? opts.start_fresh : false;
		const runTransition = (target: asset_id, startAtSeconds?: number): void => {
			this.startMusicTransition(target, fade_ms, crossfade_ms, start_at_loop_start, startAtSeconds);
		};

		if (!isMusicTransitionStingerSync(sync) && !start_fresh && this.currentTrackByType('music') === opts.to) {
			return;
		}

		if (isMusicTransitionStingerSync(sync)) {
			const stingerType = this.getAudioMetaOrThrow(sync.stinger).audiotype;
			if (!this.isAudioType(stingerType)) {
				throw new Error(`[SoundMaster] Audio asset '${String(sync.stinger)}' has unknown audio type.`);
			}
				if (sync.return_to_previous) {
					const previousId = this.currentTrackByType('music');
					const previousOffset = this.currentTimeByType('music') ?? 0;
					this.pendingStingerReturnTo = previousId !== null ? previousId : opts.to;
					this.stop('music', 'all');
					this.play(sync.stinger).then(voiceId => {
						if (transitionId !== this.musicTransitionRequestId) {
							if (voiceId !== null) {
								this.stop(stingerType, 'byvoice', voiceId);
							}
							return;
						}
						if (voiceId === null) {
							if (transitionId === this.musicTransitionRequestId) {
								this.pendingStingerReturnTo = null;
							this.pendingStingerType = null;
							this.pendingStingerVoice = null;
						}
						return;
					}
					this.pendingStingerType = stingerType;
					this.pendingStingerVoice = voiceId;
					const unsub = this.addEndedListener(stingerType, info => {
						if (info.voiceId !== voiceId) {
							return;
						}
						unsub();
						if (transitionId !== this.musicTransitionRequestId) {
							return;
						}
						if (this.pendingStingerReturnUnsub === unsub) {
							this.pendingStingerReturnUnsub = null;
						}
							const target = this.pendingStingerReturnTo;
							this.pendingStingerReturnTo = null;
							this.pendingStingerType = null;
							this.pendingStingerVoice = null;
							if (target !== null) {
								runTransition(target, previousOffset);
							}
						});
						this.pendingStingerReturnUnsub = unsub;
					}).catch(() => {});
				return;
			}
				const returnTarget = sync.return_to !== undefined ? sync.return_to : opts.to;
				this.pendingStingerReturnTo = returnTarget;
				this.stop('music', 'all');
				this.play(sync.stinger).then(voiceId => {
						if (transitionId !== this.musicTransitionRequestId) {
							if (voiceId !== null) {
								this.stop(stingerType, 'byvoice', voiceId);
							}
							return;
						}
						if (voiceId === null) {
							if (transitionId === this.musicTransitionRequestId) {
								this.pendingStingerReturnTo = null;
							this.pendingStingerType = null;
							this.pendingStingerVoice = null;
						}
						return;
					}
					this.pendingStingerType = stingerType;
					this.pendingStingerVoice = voiceId;
					const unsub = this.addEndedListener(stingerType, info => {
						if (info.voiceId !== voiceId) {
							return;
						}
					unsub();
					if (transitionId !== this.musicTransitionRequestId) {
						return;
					}
						if (this.pendingStingerReturnUnsub === unsub) {
							this.pendingStingerReturnUnsub = null;
						}
							const target = this.pendingStingerReturnTo;
							this.pendingStingerReturnTo = null;
							this.pendingStingerType = null;
							this.pendingStingerVoice = null;
							if (target !== null) {
								runTransition(target);
							}
						});
						this.pendingStingerReturnUnsub = unsub;
			}).catch(() => {});
			return;
		}

		if (sync === 'immediate') {
			runTransition(opts.to, start_fresh ? 0 : undefined);
			return;
		}

		if (isMusicTransitionDelaySync(sync)) {
			const delay_ms = sync.delay_ms >= 0 ? sync.delay_ms : 0;
			this.musicTransitionTimer = setTimeout(() => {
				this.musicTransitionTimer = null;
				if (transitionId !== this.musicTransitionRequestId) {
					return;
				}
				runTransition(opts.to, start_fresh ? 0 : undefined);
			}, delay_ms);
			return;
		}

		const currentRecord = this.getCurrentRecord('music');
		if (!currentRecord) {
			runTransition(opts.to, start_fresh ? 0 : undefined);
			return;
		}

		const duration = currentRecord.clip.duration;
		if (!(duration > 0)) {
			runTransition(opts.to, start_fresh ? 0 : undefined);
			return;
		}

		const nowOffset = this.currentTimeByType('music');
		if (nowOffset === null) {
			runTransition(opts.to, start_fresh ? 0 : undefined);
			return;
		}

		const offsetMod = ((nowOffset % duration) + duration) % duration;
		let boundary = duration;
		const loopStart = currentRecord.meta.loop;
		if (loopStart !== undefined && loopStart !== null) {
			boundary = offsetMod < loopStart ? loopStart : duration;
		}
		const delaySec = Math.max(0, boundary - offsetMod);
		this.musicTransitionTimer = setTimeout(() => {
			this.musicTransitionTimer = null;
			if (transitionId !== this.musicTransitionRequestId) {
				return;
			}
			runTransition(opts.to, start_fresh ? 0 : undefined);
		}, Math.floor(delaySec * 1000));
	}

	private getCurrentRecord(type: AudioType): ActiveVoiceRecord {
		const handle = this.currentVoiceByType[type];
		if (!handle) return null;
		const record = this.voiceRecordByHandle.get(handle);
		return record && !record.finalized ? record : null;
	}

	private startMusicTransition(target: asset_id, fade_ms: number, crossfade_ms: number | undefined, start_at_loop_start: boolean, startAtSeconds?: number): void {
		if (crossfade_ms !== undefined) {
			this.startMusicWithCrossfade(target, crossfade_ms, start_at_loop_start, startAtSeconds);
			return;
		}
		this.startMusicAfterFadeOut(target, fade_ms, start_at_loop_start, startAtSeconds);
	}

	private startMusicNow(target: asset_id, start_at_loop_start: boolean, startAtSeconds?: number): void {
		const meta = this.getAudioMetaOrThrow(target);
		const baseOffset = startAtSeconds !== undefined ? startAtSeconds : ((start_at_loop_start && meta.loop !== undefined && meta.loop !== null) ? meta.loop : 0);
		void (async () => {
			try {
				const clip = await this.clipFor(target);
				const params: ModulationParams = { offset: baseOffset };
				const playback = this.createVoiceParams(meta, params, clip);
				const priority = meta.priority !== undefined ? meta.priority : 0;
				this.startVoice('music', target, meta, clip, params, priority, playback, null);
			} catch (error) {
				console.error(error);
			}
		})();
	}

	private startMusicAfterFadeOut(target: asset_id, fade_ms: number, start_at_loop_start: boolean, startAtSeconds?: number): void {
		const fadeOutMs = Math.max(0, Math.floor(fade_ms));
		const oldRecords = this.voicesByType.music.slice();
		if (oldRecords.length === 0) {
			this.startMusicNow(target, start_at_loop_start, startAtSeconds);
			return;
		}
		if (fadeOutMs <= 0) {
			this.stop('music', 'all');
			this.startMusicNow(target, start_at_loop_start, startAtSeconds);
			return;
		}
		const fadeOutSec = fadeOutMs / 1000;
		for (let i = 0; i < oldRecords.length; i++) {
			const record = oldRecords[i];
			if (!record.finalized) {
				record.handle.rampGainLinear(MIN_GAIN, fadeOutSec);
			}
		}
		const transitionId = this.musicTransitionRequestId;
		this.musicTransitionTimer = setTimeout(() => {
			this.musicTransitionTimer = null;
			if (transitionId !== this.musicTransitionRequestId) {
				return;
			}
			for (let i = 0; i < oldRecords.length; i++) {
				const record = oldRecords[i];
				if (!record.finalized) {
					this.stopVoiceRecord('music', record);
				}
			}
			this.startMusicNow(target, start_at_loop_start, startAtSeconds);
		}, fadeOutMs);
	}

	private stopMusicAfterFadeOut(transitionId: number, fade_ms: number): void {
		const fadeOutMs = Math.max(0, Math.floor(fade_ms));
		const oldRecords = this.voicesByType.music.slice();
		if (oldRecords.length === 0) {
			return;
		}
		if (fadeOutMs <= 0) {
			this.stop('music', 'all');
			return;
		}
		const fadeOutSec = fadeOutMs / 1000;
		for (let i = 0; i < oldRecords.length; i++) {
			const record = oldRecords[i];
			if (!record.finalized) {
				record.handle.rampGainLinear(MIN_GAIN, fadeOutSec);
			}
		}
		this.musicTransitionTimer = setTimeout(() => {
			this.musicTransitionTimer = null;
			if (transitionId !== this.musicTransitionRequestId) {
				return;
			}
			for (let i = 0; i < oldRecords.length; i++) {
				const record = oldRecords[i];
				if (!record.finalized) {
					this.stopVoiceRecord('music', record);
				}
			}
		}, fadeOutMs);
	}

	private startMusicWithCrossfade(target: asset_id, crossfade_ms: number, start_at_loop_start: boolean, startAtSeconds?: number): void {
		const crossfadeMs = Math.max(0, Math.floor(crossfade_ms));
		const crossfadeSec = crossfadeMs / 1000;
		const oldRecords = this.voicesByType.music.slice();
		const meta = this.getAudioMetaOrThrow(target);
		const baseOffset = startAtSeconds !== undefined ? startAtSeconds : ((start_at_loop_start && meta.loop !== undefined && meta.loop !== null) ? meta.loop : 0);
		void (async () => {
			try {
				const clip = await this.clipFor(target);
				const params: ModulationParams = { offset: baseOffset };
				const playback = this.createVoiceParams(meta, params, clip);
				if (crossfadeMs > 0) {
					playback.gainLinear = MIN_GAIN;
				}
				const priority = meta.priority !== undefined ? meta.priority : 0;
				const voiceId = this.startVoice('music', target, meta, clip, params, priority, playback, crossfadeMs > 0
					? (voice) => {
						voice.rampGainLinear(1.0, crossfadeSec);
					}
					: null);
				if (voiceId === null) {
					return;
				}
				for (let i = 0; i < oldRecords.length; i++) {
					const oldRecord = oldRecords[i];
					if (oldRecord.finalized || oldRecord.voiceId === voiceId) {
						continue;
					}
					if (crossfadeMs > 0) {
						oldRecord.handle.rampGainLinear(MIN_GAIN, crossfadeSec);
						setTimeout(() => {
							if (!oldRecord.finalized) {
								this.stopVoiceRecord('music', oldRecord);
							}
						}, crossfadeMs);
					} else {
						this.stopVoiceRecord('music', oldRecord);
					}
				}
			} catch (error) {
				console.error(error);
			}
		})();
	}

	private beginMusicTransition(): number {
		this.musicTransitionRequestId += 1;
		if (this.musicTransitionTimer !== null) {
			clearTimeout(this.musicTransitionTimer);
			this.musicTransitionTimer = null;
		}
		if (this.pendingStingerReturnUnsub !== null) {
			this.pendingStingerReturnUnsub();
		}
		if (this.pendingStingerType !== null && this.pendingStingerVoice !== null) {
			this.stop(this.pendingStingerType, 'byvoice', this.pendingStingerVoice);
		}
		this.pendingStingerReturnUnsub = null;
		this.pendingStingerReturnTo = null;
		this.pendingStingerType = null;
		this.pendingStingerVoice = null;
		return this.musicTransitionRequestId;
	}

	public dispose(): void {
		this.beginMusicTransition();
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
		this.currentAudioByType = { sfx: null, music: null, ui: null };
		this.currentPlayParamsByType = { sfx: null, music: null, ui: null };
		this.currentVoiceByType = { sfx: null, music: null, ui: null };
		this.pausedByType = { sfx: [], music: [], ui: [] };
		this.voicesByType = { sfx: [], music: [], ui: [] };
		this.modulationPresetCache.clear();
	}
}
