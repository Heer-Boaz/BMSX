import { $ } from '../core/game';
import { Registry } from '../core/registry';
import { asset_id, AudioMeta, AudioType, AudioTypes, id2res, RegisterablePersistent } from "../rompack/rompack";

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
	id: asset_id; // The ID of the audio asset.
}

export type AudioStopSelector = 'all' | 'oldest' | 'newest' | 'byid' | 'byvoice';
export type ModulationRange = [number, number];

export interface FilterModulationParams {
	/**
	 * The type of the biquad filter (e.g., "lowpass", "highpass").
	 */
	type?: BiquadFilterType;

	/**
	 * The frequency of the filter in Hz.
	 */
	frequency?: number;

	/**
	 * The quality factor (Q) of the filter.
	 */
	q?: number;

	/**
	 * The gain of the filter in dB.
	 */
	gain?: number;
}

/**
 * Parameters for random modulation of audio playback.
 * These parameters allow for randomized variations in pitch, volume, offset, playback rate, and filtering.
 */
export interface RandomModulationParams {
	/**
	 * Range of pitch variation, specified as an array of two numbers [min, max].
	 * The pitch will be randomly adjusted within this range.
	 */
	pitchRange?: ModulationRange;

	/**
	 * Range of volume variation, specified as an array of two numbers [min, max].
	 * The volume will be randomly adjusted within this range.
	 */
	volumeRange?: ModulationRange;

	/**
	 * Range of offset variation, specified as an array of two numbers [min, max].
	 * The playback offset will be randomly adjusted within this range.
	 */
	offsetRange?: ModulationRange;

	/**
	 * Range of playback rate variation, specified as an array of two numbers [min, max].
	 * The playback rate will be randomly adjusted within this range.
	 */
	playbackRateRange?: ModulationRange;

	/**
	 * Filter parameters for applying a biquad filter to the audio.
	 */
	filter?: FilterModulationParams;
}

/**
 * Parameters for modulating audio playback.
 * These parameters allow for precise control over pitch, volume, offset, playback rate, and filtering.
 */
export interface ModulationParams {
	/**
	 * The change in pitch, specified as a delta value.
	 * Positive values increase the pitch, while negative values decrease it.
	 */
	pitchDelta?: number;

	/**
	 * The change in volume, specified as a delta value in decibels (dB).
	 * Positive values increase the volume, while negative values decrease it.
	 */
	volumeDelta?: number;

	/**
	 * The playback offset in seconds.
	 * Specifies the starting point of the audio playback.
	 */
	offset?: number;

	/**
	 * The playback rate multiplier.
	 * A value of 1 plays the audio at normal speed, values greater than 1 speed it up, and values less than 1 slow it down.
	 */
	playbackRate?: number;

	/**
	 * Filter parameters for applying a biquad filter to the audio.
	 * Allows for advanced audio effects such as low-pass or high-pass filtering.
	 */
	filter?: FilterModulationParams;
}

export class SoundMaster implements RegisterablePersistent {
	public get id(): 'sm' { return 'sm'; }
	public get registrypersistent(): true { return true; }

	/**
	 * The singleton instance of the SoundMaster class.
	 */
	public static readonly instance: SoundMaster = new SoundMaster();

	private tracks: id2res;
	private buffers: Record<string, AudioBuffer>;
	private bufferPromises: Record<string, Promise<AudioBuffer> | undefined>;
	private sndContext: AudioContext;
	private currentAudioNodeByType: Record<AudioType, AudioBufferSourceNode | null>;
	private currentPlayParamsByType: Record<AudioType, ModulationParams | null>;
	private nodeExtras: WeakMap<AudioBufferSourceNode, { gain?: GainNode; filter?: BiquadFilterNode }>;
	public currentAudioByType: Record<AudioType, AudioMetadataWithID | null>;
	private gainNode: GainNode;
	// For API compatibility, these represent the most recently started voice per type
	private nodeStartTime: Record<AudioType, number>;
	private nodeStartOffset: Record<AudioType, number>;

	// Multi-voice pooling per type (music stays effectively single by default)
	private nextVoiceId: VoiceId;
	private modulationPresetCache: Map<asset_id, RandomModulationParams | ModulationParams | undefined>;
	private voicesByType: Record<AudioType, (ActiveVoiceInfo & { node: AudioBufferSourceNode })[]>;

	// Per-type paused snapshots for pause policy
	private pausedByType: Record<AudioType, { id: asset_id; offset: number; params: ModulationParams; priority: number; }[]>;

	// Ended listeners per type
	private endedListenersByType: Record<AudioType, Set<(info: ActiveVoiceInfo) => void>>;
	private musicTransitionTimer: ReturnType<typeof setTimeout> | null = null;
	private pendingStingerReturnTo: asset_id | null = null;

	constructor() {
		this.bind();
		this.tracks = {};
		this.buffers = {};
		this.bufferPromises = {};
		this.sndContext = null; // Passed externally via the init method
		this.currentAudioNodeByType = { sfx: null, music: null, ui: null };
		this.currentPlayParamsByType = { sfx: null, music: null, ui: null };
		this.nodeExtras = new WeakMap();
		this.currentAudioByType = { sfx: null, music: null, ui: null };
		this.gainNode = null; // Passed externally via the init method
		this.nodeStartTime = { sfx: 0, music: 0, ui: 0 };
		this.nodeStartOffset = { sfx: 0, music: 0, ui: 0 };
		this.nextVoiceId = 1;
		this.modulationPresetCache = new Map();
		this.voicesByType = { sfx: [], music: [], ui: [] };
		// Allow multiple concurrent SFX/UI voices by default; keep music single-voice
		this.pausedByType = { sfx: [], music: [], ui: [] };
		this.endedListenersByType = { sfx: new Set(), music: new Set(), ui: new Set() };
	}

	public async init(audioResources: id2res, sndcontext: AudioContext, startingVolume: number, gainnode?: GainNode) {
		this.modulationPresetCache.clear();
		this.sndContext = sndcontext;
		this.currentAudioByType = { sfx: null, music: null, ui: null };
		this.currentAudioNodeByType = { sfx: null, music: null, ui: null };

		this.tracks = audioResources;
		this.predecodeTracks();

		await this.sndContext.resume();

		if (!gainnode) {
			this.gainNode = this.sndContext.createGain();
			this.gainNode.connect(this.sndContext.destination);
		} else {
			this.gainNode = gainnode;
		}
		this.volume = startingVolume ?? 0;
	}

	public bind(): void {
		// Bind the sound master to the registry
		Registry.instance.register(this);
	}

	public unbind(): void {
		// Unbind the sound master from the registry
		Registry.instance.deregister(this, true);
	}

	private predecodeTracks(): void {
		this.buffers = {};
		this.bufferPromises = {};
		for (const id of Object.keys(this.tracks)) {
			void this.bufferFor(id as asset_id);
		}
	}

	private async decode(audioData: ArrayBuffer): Promise<AudioBuffer> {
		if (this.sndContext.decodeAudioData.length === 2) {
			return new Promise(resolve => {
				this.sndContext.decodeAudioData(audioData, buffer => resolve(buffer));
			});
		} else {
			return this.sndContext.decodeAudioData(audioData);
		}
	}

	private async bufferFor(id: asset_id): Promise<AudioBuffer> {
		const cached = this.buffers[id];
		if (cached) return cached;
		const inflight = this.bufferPromises[id];
		if (inflight) return inflight;
		const resource = this.tracks[id];
		if (!resource) {
			throw new Error(`SoundMaster: missing track resource for ${String(id)}`);
		}
		const slice = $.rompack['rom'].slice(resource['start'], resource['end']);
		const promise = this.decode(slice)
			.then(buffer => {
				this.buffers[id] = buffer;
				this.bufferPromises[id] = undefined;
				return buffer;
			})
			.catch(err => {
				this.bufferPromises[id] = undefined;
				throw err;
			});
		this.bufferPromises[id] = promise;
		return promise;
	}

	private async createNode(id: asset_id): Promise<AudioBufferSourceNode> {
		const node = this.sndContext.createBufferSource();
		node.buffer = await this.bufferFor(id);
		return node;
	}

	private nodeEndedHandler(node: AudioBufferSourceNode, type: AudioType) {
		node.onended = null;
		// Remove from pool
		const pool = this.voicesByType[type];
		const idx = pool.findIndex(v => v.node === node);
		const endedVoice = idx >= 0 ? pool.splice(idx, 1)[0] : undefined;
		this.finalizeVoiceEnd(type, node, endedVoice);
		this.releaseNode(node);
	}

	private finalizeVoiceEnd(type: AudioType, node: AudioBufferSourceNode, endedVoice?: (ActiveVoiceInfo & { node: AudioBufferSourceNode })) {
		const pool = this.voicesByType[type];
		if (this.currentAudioNodeByType[type] === node) {
			const latest = pool.length > 0 ? pool[pool.length - 1] : undefined;
			this.currentAudioByType[type] = latest ? { ...latest.meta, id: latest.id } : null;
			this.currentAudioNodeByType[type] = latest ? latest.node : null;
			this.currentPlayParamsByType[type] = latest ? latest.params : null;
			this.nodeStartTime[type] = latest ? latest.startedAt : 0;
			this.nodeStartOffset[type] = latest ? latest.startOffset : 0;
		}
		if (endedVoice) {
			const listeners = this.endedListenersByType[type];
			if (listeners.size > 0) {
				const payload: ActiveVoiceInfo = {
					voiceId: endedVoice.voiceId,
					id: endedVoice.id,
					priority: endedVoice.priority,
					params: endedVoice.params,
					startedAt: endedVoice.startedAt,
					startOffset: endedVoice.startOffset,
					meta: endedVoice.meta,
				};
				listeners.forEach(fn => {
					try { fn(payload); } catch (e) { console.warn(e); }
				});
			}
		}
	}

	private isPlayRequest(options: unknown): options is SoundMasterPlayRequest {
		if (!options || typeof options !== 'object') return false;
		const obj = options as Record<string, unknown>;
		return ('params' in obj) || ('priority' in obj) || ('modulationPreset' in obj);
	}

	private normalizePlayRequest(options?: SoundMasterPlayRequest | ModulationParams | RandomModulationParams): SoundMasterPlayRequest {
		if (!options) return {};
		if (this.isPlayRequest(options)) {
			const req = options as SoundMasterPlayRequest;
			return {
				params: req.params,
				modulationPreset: req.modulationPreset,
				priority: req.priority,
			};
		}
		return { params: options as (RandomModulationParams | ModulationParams) };
	}

	private getAudioMetaOrThrow(id: asset_id): AudioMeta {
		if (!this.tracks) {
			throw new Error('[SoundMaster] Audio tracks map is not initialised.');
		}
		const resource = this.tracks[id];
		if (!resource || typeof resource !== 'object') {
			throw new Error(`[SoundMaster] Audio asset '${String(id)}' not found.`);
		}
		const meta = (resource as unknown as { audiometa?: AudioMeta }).audiometa;
		if (!meta) {
			throw new Error(`[SoundMaster] Audio asset '${String(id)}' is missing audio metadata.`);
		}
		return meta;
	}

	private getAudioTypeFor(id: asset_id): AudioType {
		const meta = this.getAudioMetaOrThrow(id);
		const typeCandidate = meta.audiotype;
		if (!this.isAudioType(typeCandidate)) {
			throw new Error(`[SoundMaster] Audio asset '${String(id)}' has unknown audio type '${String(typeCandidate)}'.`);
		}
		return typeCandidate;
	}

	private resolvePlayParams(options: ModulationInput): ModulationParams {
		if (!options) return {};
		const anyOptions = options as RandomModulationParams | ModulationParams;

		function getRandomInRange(range?: ModulationRange): number {
			if (!range) return 0;
			return Math.random() * (range[1] - range[0]) + range[0];
		}

		return {
			offset: ((anyOptions as ModulationParams).offset ?? 0) + getRandomInRange((anyOptions as RandomModulationParams).offsetRange),
			pitchDelta: ((anyOptions as ModulationParams).pitchDelta ?? 0) + getRandomInRange((anyOptions as RandomModulationParams).pitchRange),
			volumeDelta: ((anyOptions as ModulationParams).volumeDelta ?? 0) + getRandomInRange((anyOptions as RandomModulationParams).volumeRange),
			playbackRate: ((anyOptions as ModulationParams).playbackRate ?? 1) + getRandomInRange((anyOptions as RandomModulationParams).playbackRateRange),
			filter: anyOptions.filter ? { ...anyOptions.filter } as FilterModulationParams : undefined,
		};
	}

	private resolveModulationPreset(key: asset_id | undefined): RandomModulationParams | ModulationParams | undefined {
		if (key === undefined || key === null) return undefined;
		if (this.modulationPresetCache.has(key)) return this.modulationPresetCache.get(key);
		let resolved: unknown = $.rompack.data[key as keyof typeof $.rompack.data];
		if (resolved === undefined && typeof key === 'string') {
			const segments = key.split('.');
			let cursor: unknown = $.rompack.data;
			for (const segment of segments) {
				if (cursor && typeof cursor === 'object' && segment in (cursor as Record<string, unknown>)) {
					cursor = (cursor as Record<string, unknown>)[segment];
				} else {
					cursor = undefined;
					break;
				}
			}
			resolved = cursor;
		}
		const typed = (resolved && typeof resolved === 'object') ? resolved as (RandomModulationParams | ModulationParams) : undefined;
		this.modulationPresetCache.set(key, typed);
		return typed;
	}

	private playNodeWithParams(_track: AudioMeta, node: AudioBufferSourceNode, params: ModulationParams): number {
		try {
			let destination: AudioNode = this.gainNode;
			const extras: { gain?: GainNode; filter?: BiquadFilterNode } = {};

			if (params.filter) {
				const filter = this.sndContext.createBiquadFilter();
				if (params.filter.type) filter.type = params.filter.type;
				if (params.filter.frequency !== undefined) filter.frequency.value = params.filter.frequency;
				if (params.filter.q !== undefined) filter.Q.value = params.filter.q;
				if (params.filter.gain !== undefined) filter.gain.value = params.filter.gain;
				filter.connect(destination);
				destination = filter;
				extras.filter = filter;
			}

			// Always include a gain stage for envelopes/crossfades
			const gain = this.sndContext.createGain();
			const vol = (params.volumeDelta !== undefined) ? Math.pow(10, params.volumeDelta / 20) : 1;
			gain.gain.value = vol;
			gain.connect(destination);
			destination = gain;
			extras.gain = gain;

			node.connect(destination);
			this.nodeExtras.set(node, extras);

			const buffer = node.buffer;
			let startOffset = params.offset ?? 0;
			if (startOffset < 0) startOffset = 0;
			else if (buffer && startOffset > buffer.duration) startOffset = buffer.duration - 0.001;

			if (_track['loop'] !== null && _track['loop'] !== undefined) {
				node.loop = true;
				node.loopStart = _track['loop']!;
			} else {
				node.loop = false;
			}

			if (buffer) {
				if (node.loop) {
					startOffset = ((startOffset % buffer.duration) + buffer.duration) % buffer.duration;
				} else {
					startOffset = Math.max(0, Math.min(startOffset, buffer.duration - 0.001));
				}
			}

			node.playbackRate.value = (params.playbackRate ?? 1) * (1 + (params.pitchDelta ?? 0));

			this.nodeStartTime[_track['audiotype']] = this.sndContext.currentTime;
			this.nodeStartOffset[_track['audiotype']] = startOffset;
			node.start(0, startOffset);
			node.onended = () => this.nodeEndedHandler(node, _track['audiotype']);
			return startOffset;
		} catch (error) {
			console.error(error);
			return params.offset ?? 0;
		}
	}

	private effectivePlaybackRate(params: ModulationParams | null | undefined): number {
		if (!params) return 1;
		const base = params.playbackRate ?? 1;
		const pitch = params.pitchDelta ?? 0;
		return base * (1 + pitch);
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
		const track = this.getAudioMetaOrThrow(id);
		const audiotype = track['audiotype'];
		if (!this.isAudioType(audiotype)) {
			throw new Error(`[SoundMaster] Audio asset '${String(id)}' has unknown audio type '${String(audiotype)}'.`);
		}
		const playCallback = (node: AudioBufferSourceNode): VoiceId => {
			// Enforce capacity (music single-voice; sfx/ui configurable)
			const pool = this.voicesByType[audiotype];

			this.currentAudioNodeByType[audiotype] = node;
			this.currentAudioByType[audiotype] = { ...track, id: id };
			this.currentPlayParamsByType[audiotype] = params;
			const startTime = this.sndContext.currentTime;
			const voiceId = this.nextVoiceId++;
			const voiceRecord = { voiceId, node, id, priority: request.priority ?? track.priority ?? 0, params, startedAt: startTime, startOffset: 0, meta: track };
			// Add to pool before starting to avoid race where stop() can't see the node yet
			pool.push(voiceRecord);
			const resolvedStartOffset = this.playNodeWithParams(track, node, params);
			voiceRecord.startOffset = resolvedStartOffset;
			return voiceId;
		};
		return this.createNode(id)
			.then(playCallback)
			.catch((e: unknown): VoiceId | null => {
				const message = e instanceof Error ? e.message : String(e);
				console.error(message);
				return null;
			});
	}

	private releaseNode(node: AudioBufferSourceNode) {
		if (!node) {
			console.warn(`SoundMaster: Attempted to release null node. Skipping.`);
			return;
		}
		const extra = this.nodeExtras.get(node);
		node.onended = null;
		try {
			node.stop();
		} catch { /* ignored */ }
		node.disconnect();
		if (extra && extra.gain) extra.gain.disconnect();
		if (extra && extra.filter) extra.filter.disconnect();
		this.nodeExtras.delete(node);
		if (node.buffer) node.buffer = null; // Help GC
	}

	private isAudioType(value: unknown): value is AudioType {
		return typeof value === 'string' && AudioTypes.includes(value as AudioType);
	}

	public stop(idOrType?: asset_id | AudioType, which?: AudioStopSelector, idOrVoice?: asset_id | VoiceId): void {
		// If explicit channel provided
		if (this.isAudioType(idOrType)) {
			this.stopByTypeInternal(idOrType, which ?? 'all', idOrVoice);
			return;
		}
		// Otherwise, treat as asset id and infer channel
		if (idOrType !== undefined) {
			try {
				const inferredType = this.getAudioTypeFor(idOrType);
				this.stopByTypeInternal(inferredType, 'byid', idOrType);
			} catch (err) {
				console.error(err);
			}
		}
	}

	private stopByTypeInternal(type: AudioType, which: AudioStopSelector, idOrVoice?: asset_id | VoiceId): void {
		const pool = this.voicesByType[type];
		const toStop: Array<{ node: AudioBufferSourceNode; record?: (ActiveVoiceInfo & { node: AudioBufferSourceNode }) }> = [];
		switch (which) {
			case 'all':
				for (const record of pool) {
					toStop.push({ node: record.node, record });
				}
				pool.length = 0;
				break;
			case 'oldest': {
					const record = pool.shift();
					if (record) toStop.push({ node: record.node, record });
					break;
				}
			case 'newest': {
					const record = pool.pop();
					if (record) toStop.push({ node: record.node, record });
					break;
				}
			case 'byid': {
					if (idOrVoice === undefined) return;
					for (let i = pool.length - 1; i >= 0; i--) {
						if (pool[i].id === idOrVoice) {
							const record = pool.splice(i, 1)[0];
							if (record) toStop.push({ node: record.node, record });
						}
					}
					break;
				}
			case 'byvoice': {
					if (idOrVoice === undefined) return;
					for (let i = pool.length - 1; i >= 0; i--) {
						if (pool[i].voiceId === idOrVoice) {
							const record = pool.splice(i, 1)[0];
							if (record) toStop.push({ node: record.node, record });
							break;
						}
					}
					break;
				}
		}
		const currentNode = this.currentAudioNodeByType[type];
		if (currentNode && !toStop.some(item => item.node === currentNode) && !pool.some(record => record.node === currentNode)) {
			toStop.push({ node: currentNode });
		}
		for (const item of toStop) {
			this.finalizeVoiceEnd(type, item.node, item.record);
			this.releaseNode(item.node);
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
			if (this.sndContext.state === 'running') {
				this.sndContext.suspend();
			}
			return;
		}
		// Snapshot and stop all voices for the given type
		const pool = this.voicesByType[type];
		const snapshots: { id: asset_id; offset: number; params: ModulationParams; priority: number; }[] = [];
		const now = this.sndContext.currentTime;
		for (const v of pool) {
			const rate = this.effectivePlaybackRate(v.params);
			const progressed = (now - v.startedAt) * rate;
			const offset = (v.startOffset ?? 0) + progressed;
			snapshots.push({ id: v.id, offset, params: v.params, priority: v.priority });
			this.releaseNode(v.node);
		}
		pool.length = 0;
		this.pausedByType[type].push(...snapshots);
		this.currentAudioNodeByType[type] = null;
		this.currentAudioByType[type] = null;
		this.currentPlayParamsByType[type] = null;
		this.nodeStartTime[type] = 0;
		this.nodeStartOffset[type] = 0;
	}

	public resume(): void {
		if (this.sndContext.state === 'suspended') {
			this.sndContext.resume();
		}
	}

	public get volume(): number {
		return parseFloat(this.gainNode.gain.value.toFixed(1));
	}

	public set volume(_v: number) {
		const v = parseFloat(_v.toFixed(1));
		this.gainNode.gain.value = v;
	}

	public currentTimeByType(type: AudioType): number | null {
		if (this.currentAudioByType[type] === null) {
			return null; // No audio is currently playing for this type
		}
		const node = this.currentAudioNodeByType[type];
		if (node) {
			const rate = this.effectivePlaybackRate(this.currentPlayParamsByType[type]);
			return (node.context.currentTime - this.nodeStartTime[type]) * rate + (this.nodeStartOffset[type] ?? 0);
		}
		return null;
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
		return this.voicesByType[type].map(v => ({
			voiceId: v.voiceId,
			id: v.id,
			priority: v.priority,
			params: v.params,
			startedAt: v.startedAt,
			startOffset: v.startOffset,
			meta: v.meta,
		}));
	}

	public getCurrentTimeSec(): number {
		if (this.sndContext) return this.sndContext.currentTime;
		return Date.now() / 1000;
	}

	public snapshotVoices(type: AudioType): { id: asset_id; offset: number; params: ModulationParams; priority: number; }[] {
		const now = this.sndContext.currentTime;
		return this.voicesByType[type].map(v => {
			const rate = this.effectivePlaybackRate(v.params);
			const progressed = (now - v.startedAt) * rate;
			const offset = (v.startOffset ?? 0) + progressed;
			return { id: v.id, offset, params: v.params, priority: v.priority };
		});
	}

	public drainPausedSnapshots(type: AudioType): { id: asset_id; offset: number; params: ModulationParams; priority: number; }[] {
		const arr = this.pausedByType[type];
		this.pausedByType[type] = [];
		return arr;
	}

	public addEndedListener(type: AudioType, listener: (info: ActiveVoiceInfo) => void): () => void {
		this.endedListenersByType[type].add(listener);
		return () => this.endedListenersByType[type].delete(listener);
	}

	public requestMusicTransition(opts: {
		to: asset_id;
		sync?: 'immediate' | 'loop' | { delayMs: number } | { stinger: asset_id; returnTo?: asset_id; returnToPrevious?: boolean };
		fadeMs?: number;
		startAtLoopStart?: boolean;
		startFresh?: boolean;
	}): void {
		const sync = opts.sync ?? 'immediate';
		const fadeMs = opts.fadeMs ?? 250;
		const startAtLoopStart = opts.startAtLoopStart ?? false;
		const startFresh = opts.startFresh ?? false;

		// Clear any pending timer
		if (this.musicTransitionTimer != null) {
			clearTimeout(this.musicTransitionTimer);
			this.musicTransitionTimer = null;
		}

		// Stinger path: object with 'stinger' property
		if (typeof sync === 'object' && 'stinger' in sync) {
			const stingerType = this.getAudioTypeFor(sync.stinger);
			// Select return target: explicit id or previous music
			if (sync.returnToPrevious) {
				const prevId = this.currentTrackByType('music');
				const prevOffset = this.currentTimeByType('music') ?? 0;
				this.pendingStingerReturnTo = prevId != null ? prevId : (opts.to ?? null);
				// Stop music and play stinger; after end, resume prev at saved offset
				const resumeId = this.pendingStingerReturnTo;
				this.stop('music', 'all');
				this.play(sync.stinger).then(voiceId => {
					if (voiceId == null) return;
					const unsub = this.addEndedListener(stingerType, info => {
						if (info.voiceId !== voiceId) return;
						unsub();
						const target = resumeId;
						this.pendingStingerReturnTo = null;
						if (target != null) this.startMusicWithFade(target, fadeMs, startAtLoopStart, prevOffset);
					});
				}).catch(() => { /* play already logged error */ });
				return;
			} else {
				const ret = sync.returnTo ?? opts.to;
				this.pendingStingerReturnTo = ret;
				this.stop('music', 'all');
				this.play(sync.stinger).then(voiceId => {
					if (voiceId == null) return;
					const unsub = this.addEndedListener(stingerType, info => {
						if (info.voiceId !== voiceId) return;
						unsub();
						const target = this.pendingStingerReturnTo;
						this.pendingStingerReturnTo = null;
						if (target != null) this.startMusicWithFade(target, fadeMs, startAtLoopStart);
					});
				}).catch(() => { /* play already logged error */ });
				return;
			}
		}

		if (sync === 'immediate') {
			this.startMusicWithFade(opts.to, fadeMs, startAtLoopStart, startFresh ? 0 : undefined);
			return;
		}

		// Delay path: object with 'delayMs' property
		if (typeof sync === 'object' && 'delayMs' in sync) {
			const delayMs = Math.max(0, sync.delayMs);
			this.musicTransitionTimer = setTimeout(() => {
				this.musicTransitionTimer = null;
				this.startMusicWithFade(opts.to, fadeMs, startAtLoopStart, startFresh ? 0 : undefined);
			}, delayMs);
			return;
		}

		// sync === 'loop'
		const nowOffset = this.currentTimeByType('music');
		const node = this.currentAudioNodeByType['music'];
		const meta = this.currentAudioByType['music'];
		if (!node || !node.buffer || !meta) {
			this.startMusicWithFade(opts.to, fadeMs, startAtLoopStart);
			return;
		}
		const duration = node.buffer.duration;
		const loopStart = meta.loop;
		if (nowOffset == null || duration <= 0 || nowOffset < 0) {
			this.startMusicWithFade(opts.to, fadeMs, startAtLoopStart);
			return;
		}
		const offsetMod = ((nowOffset % duration) + duration) % duration;
		let boundary = duration;
		if (loopStart !== undefined && loopStart !== null) boundary = (offsetMod < loopStart) ? loopStart : duration;
		const delaySec = Math.max(0, boundary - offsetMod);
		this.musicTransitionTimer = setTimeout(() => {
			this.musicTransitionTimer = null;
			this.startMusicWithFade(opts.to, fadeMs, startAtLoopStart, startFresh ? 0 : undefined);
		}, Math.floor(delaySec * 1000));
	}

	private startMusicWithFade(target: asset_id, fadeMs: number, startAtLoopStart: boolean, startAtSeconds?: number): void {
		const targetMeta = this.getAudioMetaOrThrow(target);
		const startOffset = (startAtSeconds !== undefined)
			? startAtSeconds
			: (startAtLoopStart && targetMeta.loop != null ? targetMeta.loop : 0);

		const currentNode = this.currentAudioNodeByType['music'];
		const currentExtras = currentNode ? this.nodeExtras.get(currentNode) : undefined;
		const ctxTime = this.sndContext.currentTime;
		const fadeSec = Math.max(0, fadeMs) / 1000;

		// Ramp down old music if possible
		if (currentExtras && currentExtras.gain) {
			const g = currentExtras.gain.gain;
			g.cancelScheduledValues(ctxTime);
			const cur = g.value;
			g.setValueAtTime(cur, ctxTime);
			g.linearRampToValueAtTime(0.0001, ctxTime + fadeSec);
		}

		this.createNode(target).then(node => {
			const meta = this.getAudioMetaOrThrow(target);
			const playParams: ModulationParams = { offset: startOffset, volumeDelta: -80 };
			this.currentAudioNodeByType['music'] = node;
			this.currentAudioByType['music'] = { ...meta, id: target };
			this.currentPlayParamsByType['music'] = playParams;
			const startTime = this.sndContext.currentTime;
			const voiceId = this.nextVoiceId++;
			const voiceRecord = { voiceId, node, id: target, priority: meta.priority ?? 0, params: playParams, startedAt: startTime, startOffset: 0, meta };
			this.voicesByType['music'].push(voiceRecord);
			const resolvedStartOffset = this.playNodeWithParams(meta, node, playParams);
			voiceRecord.startOffset = resolvedStartOffset;

			// Fade in new
			const extras = this.nodeExtras.get(node);
			const g = extras && extras.gain ? extras.gain.gain : undefined;
			if (g) {
				g.cancelScheduledValues(this.sndContext.currentTime);
				g.setValueAtTime(g.value, this.sndContext.currentTime);
				g.linearRampToValueAtTime(1.0, this.sndContext.currentTime + fadeSec);
			}

			if (currentNode) {
				const pool = this.voicesByType['music'];
				let record: (ActiveVoiceInfo & { node: AudioBufferSourceNode }) | undefined;
				for (let i = pool.length - 1; i >= 0; i--) {
					if (pool[i].node === currentNode) {
						record = pool.splice(i, 1)[0];
						break;
					}
				}
				setTimeout(() => {
					try {
						this.finalizeVoiceEnd('music', currentNode, record);
						this.releaseNode(currentNode);
					} catch { /* ignore */ }
				}, fadeMs);
			}
		}).catch(e => console.error(e));
	}

	public dispose() {
		this.tracks = null;
		this.buffers = null;
		this.sndContext = null;
		this.currentAudioNodeByType = null;
		this.currentPlayParamsByType = null;
		this.nodeExtras = null;
		this.currentAudioByType = null;
		this.gainNode = null;
		this.nodeStartTime = null;
		this.nodeStartOffset = null;
		this.voicesByType = null;
		this.pausedByType = null;
		this.endedListenersByType = null;
		this.unbind();
	}
}
