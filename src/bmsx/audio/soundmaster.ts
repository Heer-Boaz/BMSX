import { $ } from '../core/game';
import { Platform, AudioPlaybackParams, AudioService, AudioClipHandle, VoiceHandle, RngService } from '../core/platform';
import { Registry } from '../core/registry';
import { asset_id, AudioMeta, AudioType, AudioTypes, id2res, RegisterablePersistent } from '../rompack/rompack';

export type VoiceId = number;
type ModulationInput = RandomModulationParams | ModulationParams | undefined;

export interface SoundMasterPlayRequest {
	params?: RandomModulationParams | ModulationParams;
	modulationPreset?: asset_id;
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
	resolve(key: asset_id): RandomModulationParams | ModulationParams | undefined;
}

interface RomAudioResource {
	start: number;
	end: number;
	audiometa: AudioMeta;
}

interface PausedSnapshot {
	id: asset_id;
	offset: number;
	params: ModulationParams;
	priority: number;
}

interface ActiveVoiceRecord extends ActiveVoiceInfo {
	handle: VoiceHandle;
	clip: AudioClipHandle;
	endedUnsub: (() => void) | null;
	finalized: boolean;
}

const EPS = 1 / 44100;
const MIN_GAIN = 0.0001;
const DEFAULT_DECODE_CONCURRENCY = 4;
const DEFAULT_MAX_VOICES: Record<AudioType, number> = { sfx: 16, music: 1, ui: 8 };

export class SoundMaster implements RegisterablePersistent {
	public get id(): 'sm' { return 'sm'; }
	public get registrypersistent(): true { return true; }

	public static readonly instance: SoundMaster = new SoundMaster();

	private tracks: Record<asset_id, RomAudioResource>;
	private clips: Record<string, AudioClipHandle>;
	private clipPromises: Record<string, Promise<AudioClipHandle> | undefined>;
	private audio!: AudioService;
	private rng!: RngService;
	private modulationResolver: ModulationPresetResolver | null;
	private modulationPresetCache: Map<asset_id, RandomModulationParams | ModulationParams | undefined>;
	private voicesByType: Record<AudioType, ActiveVoiceRecord[]>;
	private currentVoiceByType: Record<AudioType, VoiceHandle | null>;
	private currentPlayParamsByType: Record<AudioType, ModulationParams | null>;
	public currentAudioByType: Record<AudioType, AudioMetadataWithID | null>;
	private pausedByType: Record<AudioType, PausedSnapshot[]>;
	private endedListenersByType: Record<AudioType, Set<(info: ActiveVoiceInfo) => void>>;
	private nextVoiceId: VoiceId;
	private musicTransitionTimer: ReturnType<typeof setTimeout> | null;
	private pendingStingerReturnTo: asset_id | null;
	private maxVoicesByType: Record<AudioType, number>;
	private decodeConcurrency: number;
	private voiceRecordByHandle: WeakMap<VoiceHandle, ActiveVoiceRecord>;

	private constructor() {
		this.tracks = {};
		this.clips = {};
		this.clipPromises = {};
		this.modulationResolver = null;
		this.modulationPresetCache = new Map();
		this.voicesByType = { sfx: [], music: [], ui: [] };
		this.currentVoiceByType = { sfx: null, music: null, ui: null };
		this.currentPlayParamsByType = { sfx: null, music: null, ui: null };
		this.currentAudioByType = { sfx: null, music: null, ui: null };
		this.pausedByType = { sfx: [], music: [], ui: [] };
		this.endedListenersByType = { sfx: new Set(), music: new Set(), ui: new Set() };
		this.nextVoiceId = 1;
		this.musicTransitionTimer = null;
		this.pendingStingerReturnTo = null;
		this.maxVoicesByType = { sfx: DEFAULT_MAX_VOICES.sfx, music: DEFAULT_MAX_VOICES.music, ui: DEFAULT_MAX_VOICES.ui };
		this.decodeConcurrency = DEFAULT_DECODE_CONCURRENCY;
		this.voiceRecordByHandle = new WeakMap();
		this.bind();
	}

	private get A(): AudioService {
		if (!this.audio) throw new Error('[SoundMaster] Audio service not initialized. Call init() first.');
		return this.audio;
	}

	private get R(): RngService {
		if (!this.rng) throw new Error('[SoundMaster] RNG service not initialized. Call init() first.');
		return this.rng;
	}

	public async init(audioResources: id2res, startingVolume: number, resolver?: ModulationPresetResolver) {
		this.audio = Platform.instance.audio;
		this.rng = Platform.instance.rng;
		this.modulationResolver = resolver ?? null;
		this.modulationPresetCache.clear();

		await this.A.resume();

		this.tracks = this.coerceAudioResources(audioResources);
		this.clips = {};
		this.clipPromises = {};
		this.resetVoiceState();

		this.predecodeTracks();
		this.volume = this.clampVolume(startingVolume);
	}

	public bind(): void {
		Registry.instance.register(this);
	}

	public unbind(): void {
		Registry.instance.deregister(this, true);
	}

	private resetVoiceState(): void {
		this.stopAllVoices();
		this.voicesByType = { sfx: [], music: [], ui: [] };
		this.currentVoiceByType = { sfx: null, music: null, ui: null };
		this.currentPlayParamsByType = { sfx: null, music: null, ui: null };
		this.currentAudioByType = { sfx: null, music: null, ui: null };
		this.pausedByType = { sfx: [], music: [], ui: [] };
		this.nextVoiceId = 1;
		this.musicTransitionTimer = null;
		this.pendingStingerReturnTo = null;
		this.voiceRecordByHandle = new WeakMap();
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
			map[key] = { start, end, audiometa: meta };
		}
		return map;
	}

	private predecodeTracks(): void {
		const ids = Object.keys(this.tracks);
		const total = ids.length;
		if (total === 0) return;
		const limit = this.decodeConcurrency < 1 ? 1 : (this.decodeConcurrency > total ? total : this.decodeConcurrency);
		let cursor = 0;

		const launch = () => {
			if (cursor >= total) return;
			const id = ids[cursor] as asset_id;
			cursor++;
			this.bufferFor(id)
				.then(() => { launch(); })
				.catch(error => {
					console.error(`[SoundMaster] Failed to predecode '${String(id)}':`, error);
					launch();
				});
		};

		for (let i = 0; i < limit; i++) launch();
	}

	private async decode(audioData: ArrayBuffer): Promise<AudioClipHandle> {
		return this.A.decode(audioData);
	}

	private async bufferFor(id: asset_id): Promise<AudioClipHandle> {
		const cached = this.clips[id];
		if (cached) return cached;
		const inflight = this.clipPromises[id];
		if (inflight) return inflight;

		const resource = this.tracks[id];
		if (!resource) {
			throw new Error(`SoundMaster: missing track resource for ${String(id)}`);
		}
		if (!$.rompack) {
			throw new Error('SoundMaster: rompack not loaded.');
		}
		const rom = $.rompack.rom;
		const slice = rom.slice(resource.start, resource.end);
		const promise = this.decode(slice)
			.then(clip => {
				this.clips[id] = clip;
				this.clipPromises[id] = undefined;
				return clip;
			})
			.catch(err => {
				this.clipPromises[id] = undefined;
				throw err;
			});
		this.clipPromises[id] = promise;
		return promise;
	}

	private normalizePlayRequest(options?: SoundMasterPlayRequest | ModulationParams | RandomModulationParams): SoundMasterPlayRequest {
		if (!options) return {};
		if (this.isPlayRequest(options)) {
			const req = options as SoundMasterPlayRequest;
			return { params: req.params, modulationPreset: req.modulationPreset, priority: req.priority };
		}
		return { params: options as (RandomModulationParams | ModulationParams) };
	}

	private isPlayRequest(options: unknown): options is SoundMasterPlayRequest {
		if (!options || typeof options !== 'object') return false;
		const obj = options as Record<string, unknown>;
		return ('params' in obj) || ('priority' in obj) || ('modulationPreset' in obj);
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

	private resolveModulationPreset(key: asset_id | undefined): RandomModulationParams | ModulationParams | undefined {
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
		if (rate <= 0) rate = EPS;

		let offset = params.offset !== undefined ? params.offset : 0;
		const duration = clip.duration;
		if (duration > 0) {
			if (loop) {
				const mod = offset % duration;
				offset = mod < 0 ? mod + duration : mod;
			} else {
				if (offset < 0) offset = 0;
				const cap = duration - EPS;
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

	private effectivePlaybackRate(params: ModulationParams | null | undefined): number {
		if (!params) return 1;
		const base = params.playbackRate !== undefined ? params.playbackRate : 1;
		const pitch = params.pitchDelta !== undefined ? params.pitchDelta : 0;
		return base * Math.pow(2, pitch / 12);
	}

	public play(id: asset_id, options?: SoundMasterPlayRequest | ModulationParams | RandomModulationParams): Promise<VoiceId | null> {
		const request = this.normalizePlayRequest(options);
		let sourceParams = request.params;
		if (!sourceParams && request.modulationPreset !== undefined) {
			sourceParams = this.resolveModulationPreset(request.modulationPreset);
			if (!sourceParams) {
				console.warn(`SoundMaster: Missing modulation preset '${String(request.modulationPreset)}' for ${String(id)}`);
			}
		}
		const params = this.resolvePlayParams(sourceParams);
		const meta = this.getAudioMetaOrThrow(id);
		const typeCandidate = meta.audiotype;
		if (!this.isAudioType(typeCandidate)) {
			throw new Error(`[SoundMaster] Audio asset '${String(id)}' has unknown audio type '${String(typeCandidate)}'.`);
		}
		const priority = request.priority !== undefined ? request.priority : (meta.priority !== undefined ? meta.priority : 0);

		return this.bufferFor(id)
			.then(clip => {
				const playback = this.createVoiceParams(meta, params, clip);
				return this.startVoice(typeCandidate, id, meta, clip, params, priority, playback, null);
			})
			.catch((e: unknown): VoiceId | null => {
				const message = e instanceof Error ? e.message : String(e);
				console.error(message);
				return null;
			});
	}

	private startVoice(
		type: AudioType,
		id: asset_id,
		meta: AudioMeta,
		clip: AudioClipHandle,
		params: ModulationParams,
		priority: number,
		playback: AudioPlaybackParams,
		onStarted: ((voice: VoiceHandle, record: ActiveVoiceRecord) => void) | null,
	): VoiceId | null {
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

		const voice = this.A.createVoice(clip, playback);
		const voiceId = this.nextVoiceId++;
		const record: ActiveVoiceRecord = {
			voiceId,
			id,
			priority,
			params,
			startedAt: voice.startedAt,
			startOffset: voice.startOffset,
			meta,
			handle: voice,
			clip,
			endedUnsub: null,
			finalized: false,
		};

		pool.push(record);
		this.voiceRecordByHandle.set(voice, record);
		this.currentVoiceByType[type] = voice;
		this.currentAudioByType[type] = { ...meta, id };
		this.currentPlayParamsByType[type] = params;

		const unsubscribe = voice.onEnded(() => this.onVoiceEnded(type, record));
		record.endedUnsub = unsubscribe;

		if (onStarted) onStarted(voice, record);

		return voiceId;
	}

	private onVoiceEnded(type: AudioType, record: ActiveVoiceRecord): void {
		if (record.finalized) return;
		if (record.endedUnsub) {
			record.endedUnsub();
			record.endedUnsub = null;
		}
		this.removeRecord(type, record.voiceId);
		this.finalizeVoiceEnd(type, record);
	}

	private finalizeVoiceEnd(type: AudioType, record: ActiveVoiceRecord): void {
		if (record.finalized) return;
		record.finalized = true;
		this.voiceRecordByHandle.delete(record.handle);
		try { record.handle.disconnect(); } catch (error) { console.error('[SoundMaster] Failed to disconnect voice handle:', error); }

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

	private removeRecord(type: AudioType, voiceId: VoiceId): ActiveVoiceRecord | undefined {
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
		this.removeRecord(type, record.voiceId);
		if (record.endedUnsub) {
			record.endedUnsub();
			record.endedUnsub = null;
		}
		try { record.handle.stop(); } catch (error) { console.error('[SoundMaster] Failed to stop voice:', error); }
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

	public stop(idOrType?: asset_id | AudioType, which?: AudioStopSelector, idOrVoice?: asset_id | VoiceId): void {
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
		this.stop('sfx', 'all');
	}

	public stopMusic(): void {
		this.stop('music', 'all');
	}

	public stopUI(): void {
		this.stop('ui', 'all');
	}

	public pause(type?: AudioType): void {
		if (!type) {
			void this.A.suspend();
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
		void this.A.resume();
	}

	public resumeType(type: AudioType): void {
		const paused = this.drainPausedSnapshots(type);
		for (let i = 0; i < paused.length; i++) {
			const snapshot = paused[i];
			const params: ModulationParams = { ...snapshot.params, offset: snapshot.offset };
			void this.play(snapshot.id, { params, priority: snapshot.priority });
		}
	}

	public get volume(): number {
		return this.clampVolume(this.A.getMasterGain());
	}

	public set volume(value: number) {
		const clamped = this.clampVolume(value);
		this.A.setMasterGain(clamped);
	}

	private clampVolume(value: number): number {
		if (value < 0) return 0;
		if (value > 1) return 1;
		return Number.isFinite(value) ? value : 0;
	}

	public currentTimeByType(type: AudioType): number | null {
		const handle = this.currentVoiceByType[type];
		if (!handle) return null;
		const record = this.voiceRecordByHandle.get(handle);
		if (!record || record.finalized) return null;
		const rate = this.effectivePlaybackRate(record.params);
		const now = this.A.currentTime();
		return record.startOffset + (now - record.startedAt) * rate;
	}

	public currentTrackByType(type: AudioType): asset_id | null {
		const audioMeta = this.currentAudioByType[type];
		return audioMeta ? audioMeta.id : null;
	}

	public currentTrackMetaByType(type: AudioType): AudioMeta | null {
		const audioMeta = this.currentAudioByType[type];
		return audioMeta ? audioMeta : null;
	}

	public currentModulationParamsByType(type: AudioType): ModulationParams | null {
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
		sync?: 'immediate' | 'loop' | { delayMs: number } | { stinger: asset_id; returnTo?: asset_id; returnToPrevious?: boolean };
		fadeMs?: number;
		startAtLoopStart?: boolean;
		startFresh?: boolean;
	}): void {
		const sync = opts.sync !== undefined ? opts.sync : 'immediate';
		const fadeMs = opts.fadeMs !== undefined ? opts.fadeMs : 250;
		const startAtLoopStart = opts.startAtLoopStart !== undefined ? opts.startAtLoopStart : false;
		const startFresh = opts.startFresh !== undefined ? opts.startFresh : false;

		if (this.musicTransitionTimer !== null) {
			clearTimeout(this.musicTransitionTimer);
			this.musicTransitionTimer = null;
		}

		if (typeof sync === 'object' && 'stinger' in sync) {
			const stingerType = this.getAudioMetaOrThrow(sync.stinger).audiotype;
			if (!this.isAudioType(stingerType)) {
				throw new Error(`[SoundMaster] Audio asset '${String(sync.stinger)}' has unknown audio type.`);
			}
			if (sync.returnToPrevious) {
				const previousId = this.currentTrackByType('music');
				const previousOffset = this.currentTimeByType('music') ?? 0;
				this.pendingStingerReturnTo = previousId !== null ? previousId : opts.to;
				this.stop('music', 'all');
				this.play(sync.stinger).then(voiceId => {
					if (voiceId === null) return;
					const unsub = this.addEndedListener(stingerType, info => {
						if (info.voiceId !== voiceId) return;
						unsub();
						const target = this.pendingStingerReturnTo;
						this.pendingStingerReturnTo = null;
						if (target !== null) {
							this.startMusicWithFade(target, fadeMs, startAtLoopStart, previousOffset);
						}
					});
				}).catch(() => {});
				return;
			}
			const returnTarget = sync.returnTo !== undefined ? sync.returnTo : opts.to;
			this.pendingStingerReturnTo = returnTarget;
			this.stop('music', 'all');
			this.play(sync.stinger).then(voiceId => {
				if (voiceId === null) return;
				const unsub = this.addEndedListener(stingerType, info => {
					if (info.voiceId !== voiceId) return;
					unsub();
					const target = this.pendingStingerReturnTo;
					this.pendingStingerReturnTo = null;
					if (target !== null) {
						this.startMusicWithFade(target, fadeMs, startAtLoopStart);
					}
				});
			}).catch(() => {});
			return;
		}

		if (sync === 'immediate') {
			this.startMusicWithFade(opts.to, fadeMs, startAtLoopStart, startFresh ? 0 : undefined);
			return;
		}

		if (typeof sync === 'object' && 'delayMs' in sync) {
			const delayMs = sync.delayMs >= 0 ? sync.delayMs : 0;
			this.musicTransitionTimer = setTimeout(() => {
				this.musicTransitionTimer = null;
				this.startMusicWithFade(opts.to, fadeMs, startAtLoopStart, startFresh ? 0 : undefined);
			}, delayMs);
			return;
		}

		const currentRecord = this.getCurrentRecord('music');
		if (!currentRecord) {
			this.startMusicWithFade(opts.to, fadeMs, startAtLoopStart, startFresh ? 0 : undefined);
			return;
		}

		const duration = currentRecord.clip.duration;
		if (!(duration > 0)) {
			this.startMusicWithFade(opts.to, fadeMs, startAtLoopStart, startFresh ? 0 : undefined);
			return;
		}

		const nowOffset = this.currentTimeByType('music');
		if (nowOffset === null) {
			this.startMusicWithFade(opts.to, fadeMs, startAtLoopStart, startFresh ? 0 : undefined);
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
			this.startMusicWithFade(opts.to, fadeMs, startAtLoopStart, startFresh ? 0 : undefined);
		}, Math.floor(delaySec * 1000));
	}

	private getCurrentRecord(type: AudioType): ActiveVoiceRecord | null {
		const handle = this.currentVoiceByType[type];
		if (!handle) return null;
		const record = this.voiceRecordByHandle.get(handle);
		return record && !record.finalized ? record : null;
	}

	private startMusicWithFade(target: asset_id, fadeMs: number, startAtLoopStart: boolean, startAtSeconds?: number): void {
		const meta = this.getAudioMetaOrThrow(target);
		const baseOffset = startAtSeconds !== undefined ? startAtSeconds : ((startAtLoopStart && meta.loop !== undefined && meta.loop !== null) ? meta.loop : 0);
		const fadeSec = Math.max(0, fadeMs) / 1000;
		const oldHandle = this.currentVoiceByType.music;
		const oldRecord = oldHandle ? this.voiceRecordByHandle.get(oldHandle) : undefined;

		this.bufferFor(target)
			.then(clip => {
				const params: ModulationParams = { offset: baseOffset };
				const playback = this.createVoiceParams(meta, params, clip);
				playback.gainLinear = MIN_GAIN;
				const priority = meta.priority !== undefined ? meta.priority : 0;
				const voiceId = this.startVoice('music', target, meta, clip, params, priority, playback, (voice) => {
					voice.rampGainLinear(1.0, fadeSec);
				});
				if (voiceId !== null && oldRecord && !oldRecord.finalized) {
					oldRecord.handle.rampGainLinear(MIN_GAIN, fadeSec);
					if (fadeMs > 0) {
						setTimeout(() => this.stopVoiceRecord('music', oldRecord), fadeMs);
					} else {
						this.stopVoiceRecord('music', oldRecord);
					}
				}
			})
			.catch(error => console.error(error));
	}

	public dispose(): void {
		this.stopAllVoices();
		const clipIds = Object.keys(this.clips);
		for (let i = 0; i < clipIds.length; i++) {
			const clip = this.clips[clipIds[i]];
			if (clip) clip.dispose();
		}
		this.clips = {};
		this.clipPromises = {};
		this.tracks = {};
		this.currentAudioByType = { sfx: null, music: null, ui: null };
		this.currentPlayParamsByType = { sfx: null, music: null, ui: null };
		this.currentVoiceByType = { sfx: null, music: null, ui: null };
		this.pausedByType = { sfx: [], music: [], ui: [] };
		this.voicesByType = { sfx: [], music: [], ui: [] };
		this.modulationPresetCache.clear();
		if (this.musicTransitionTimer !== null) {
			clearTimeout(this.musicTransitionTimer);
			this.musicTransitionTimer = null;
		}
		this.pendingStingerReturnTo = null;
		this.unbind();
	}
}
