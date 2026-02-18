import { $ } from '../core/engine_core';
import { AudioPlaybackParams, AudioService, AudioClipHandle, VoiceHandle, VoiceEndedEvent, AudioFilterParams, RngService, SubscriptionHandle, createSubscriptionHandle } from '../platform';
import { Registry } from '../core/registry';
import { asset_id, AudioMeta, AudioType, AudioTypes, CartridgeLayerId, id2res, RegisterablePersistent, RomAsset } from '../rompack/rompack';
import { clamp, clamp01 } from '../utils/clamp';

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
	stream: StreamTrackData;
	byteLeaseId: asset_id;
	decoder: BadpDecoderCursor;
	stepFrames: number;
	positionFrames: number;
	loopEnabled: boolean;
	loopStartFrames: number;
	loopEndFrames: number;
	gainLinear: number;
	targetGainLinear: number;
	gainRampRemainingFrames: number;
	gainRampDelta: number;
	finalized: boolean;
}

const MIN_GAIN = 0.0001;
const DEFAULT_MAX_VOICES: Record<AudioType, number> = { sfx: 16, music: 1, ui: 8 };
const BADP_HEADER_SIZE = 48;
const BADP_VERSION = 1;
const BADP_NO_LOOP = 0xffffffff;
const MIX_MINIMAL_OVERHEAD_SEC = 0.002;
const MIX_LOW_OVERHEAD_SEC = 0.004;
const MIX_BALANCED_OVERHEAD_SEC = 0.006;
const MIX_SAFE_OVERHEAD_SEC = 0.012;
const MIX_CHUNK_FRAMES = 128;
const MIX_MAX_PUMP_BUDGET_FRAMES = 8192;
const MIX_TARGET_MIN_FRAMES = 384;
const MIX_TARGET_MAX_FRAMES = 4096;
const MIX_TARGET_MIN_FRAMES_IOS = 768;
const MIX_TARGET_MAX_FRAMES_IOS = 4096;
const PCM_SCALE = 1 / 32768;
const PCM_INT16_MIN = -32768;
const PCM_INT16_MAX = 32767;
const ADPCM_STEP_TABLE = [
	7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
	19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
	50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
	130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
	337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
	876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
	2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
	5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
	15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
const ADPCM_INDEX_TABLE = [
	-1, -1, -1, -1, 2, 4, 6, 8,
	-1, -1, -1, -1, 2, 4, 6, 8,
];

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

type StreamTrackData = {
	id: asset_id;
	channels: number;
	sampleRate: number;
	frames: number;
	durationSec: number;
	loopStartFrame: number;
	loopEndFrame: number;
	dataOffset: number;
	seekFrames: Uint32Array;
	seekOffsets: Uint32Array;
};

class StreamClipHandle implements AudioClipHandle {
	public constructor(
		public readonly duration: number,
	) { }
	public dispose(): void {
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

	public setFilter(_filter: AudioFilterParams): void {
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

class BadpDecoderCursor {
	private readonly view: DataView;
	private readonly bytes: Uint8Array;
	private readonly predictors = new Int32Array(2);
	private readonly stepIndices = new Int32Array(2);
	private nextFrame = 0;
	private blockEnd = 0;
	private blockFrames = 0;
	private blockFrameIndex = 0;
	private payloadOffset = 0;
	private nibbleCursor = 0;
	private decodedFrame = -1;
	private decodedLeft = 0;
	private decodedRight = 0;

	public constructor(
		private readonly track: StreamTrackData,
		bytes: Uint8Array,
	) {
		this.bytes = bytes;
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		this.seekToFrame(0);
	}

	public readFrameAt(frame: number, out: Int16Array): boolean {
		if (frame < 0 || frame >= this.track.frames) {
			return false;
		}
		if (frame === this.decodedFrame) {
			out[0] = this.decodedLeft;
			out[1] = this.decodedRight;
			return true;
		}
		if (frame < this.nextFrame) {
			this.seekToFrame(frame);
		}
		while (this.nextFrame <= frame) {
			this.decodeNextFrame();
		}
		out[0] = this.decodedLeft;
		out[1] = this.decodedRight;
		return true;
	}

	private seekToFrame(frame: number): void {
		if (frame < 0 || frame > this.track.frames) {
			throw new Error('[SoundMaster] BADP seek frame is out of range.');
		}
		if (frame === this.track.frames) {
			this.nextFrame = frame;
			this.decodedFrame = frame - 1;
			this.decodedLeft = 0;
			this.decodedRight = 0;
			return;
		}
		let seekIndex = 0;
		let lo = 0;
		let hi = this.track.seekFrames.length - 1;
		while (lo <= hi) {
			const mid = (lo + hi) >> 1;
			if (this.track.seekFrames[mid] <= frame) {
				seekIndex = mid;
				lo = mid + 1;
			} else {
				hi = mid - 1;
			}
		}
		let currentFrame = this.track.seekFrames[seekIndex];
		let cursor = this.track.dataOffset + this.track.seekOffsets[seekIndex];
		this.loadBlock(cursor);
		while (currentFrame + this.blockFrames <= frame) {
			currentFrame += this.blockFrames;
			cursor = this.blockEnd;
			this.loadBlock(cursor);
		}
		this.nextFrame = currentFrame;
		this.decodedFrame = currentFrame - 1;
		while (this.nextFrame <= frame) {
			this.decodeNextFrame();
		}
	}

	private loadBlock(offset: number): void {
		if (offset + 4 > this.bytes.byteLength) {
			throw new Error('[SoundMaster] BADP block header exceeds track bounds.');
		}
		const blockFrames = this.view.getUint16(offset, true);
		const blockBytes = this.view.getUint16(offset + 2, true);
		if (blockFrames <= 0) {
			throw new Error('[SoundMaster] BADP block has zero frames.');
		}
		const blockHeaderBytes = 4 + this.track.channels * 4;
		if (blockBytes < blockHeaderBytes) {
			throw new Error('[SoundMaster] BADP block header length is invalid.');
		}
		const blockEnd = offset + blockBytes;
		if (blockEnd > this.bytes.byteLength) {
			throw new Error('[SoundMaster] BADP block exceeds track bounds.');
		}
		let cursor = offset + 4;
		for (let channel = 0; channel < this.track.channels; channel += 1) {
			const predictor = this.view.getInt16(cursor, true);
			const stepIndex = this.view.getUint8(cursor + 2);
			if (stepIndex < 0 || stepIndex > 88) {
				throw new Error('[SoundMaster] BADP step index out of range.');
			}
			this.predictors[channel] = predictor;
			this.stepIndices[channel] = stepIndex;
			cursor += 4;
		}
		this.blockEnd = blockEnd;
		this.blockFrames = blockFrames;
		this.blockFrameIndex = 0;
		this.payloadOffset = offset + blockHeaderBytes;
		this.nibbleCursor = 0;
	}

	private decodeNextFrame(): void {
		if (this.nextFrame >= this.track.frames) {
			throw new Error('[SoundMaster] BADP decode advanced beyond track frame count.');
		}
		if (this.blockFrameIndex >= this.blockFrames) {
			this.loadBlock(this.blockEnd);
		}
		let left = 0;
		let right = 0;
		for (let channel = 0; channel < this.track.channels; channel += 1) {
			const payloadIndex = this.payloadOffset + (this.nibbleCursor >> 1);
			if (payloadIndex >= this.blockEnd) {
				throw new Error('[SoundMaster] BADP payload underrun.');
			}
			const packed = this.bytes[payloadIndex];
			const code = (this.nibbleCursor & 1) === 0 ? ((packed >> 4) & 0x0f) : (packed & 0x0f);
			this.nibbleCursor += 1;
			const step = ADPCM_STEP_TABLE[this.stepIndices[channel]];
			let diff = step >> 3;
			if ((code & 4) !== 0) diff += step;
			if ((code & 2) !== 0) diff += step >> 1;
			if ((code & 1) !== 0) diff += step >> 2;
			if ((code & 8) !== 0) {
				this.predictors[channel] -= diff;
			} else {
				this.predictors[channel] += diff;
			}
			if (this.predictors[channel] < -32768) this.predictors[channel] = -32768;
			if (this.predictors[channel] > 32767) this.predictors[channel] = 32767;
			this.stepIndices[channel] += ADPCM_INDEX_TABLE[code];
			if (this.stepIndices[channel] < 0) this.stepIndices[channel] = 0;
			if (this.stepIndices[channel] > 88) this.stepIndices[channel] = 88;
			if (channel === 0) {
				left = this.predictors[channel];
			} else {
				right = this.predictors[channel];
			}
		}
		if (this.track.channels === 1) {
			right = left;
		}
		this.blockFrameIndex += 1;
		this.nextFrame += 1;
		this.decodedFrame = this.nextFrame - 1;
		this.decodedLeft = left;
		this.decodedRight = right;
	}
}

type MusicTransitionStingerSync = { stinger: asset_id; return_to?: asset_id; return_to_previous?: boolean };
type MusicTransitionDelaySync = { delay_ms: number };
type MusicTransitionSync = 'immediate' | 'loop' | MusicTransitionDelaySync | MusicTransitionStingerSync;

function isMusicTransitionStingerSync(sync: MusicTransitionSync): sync is MusicTransitionStingerSync {
	return typeof sync === 'object' && (sync as MusicTransitionStingerSync).stinger !== undefined;
}

function isMusicTransitionDelaySync(sync: MusicTransitionSync): sync is MusicTransitionDelaySync {
	return typeof sync === 'object' && (sync as MusicTransitionDelaySync).delay_ms !== undefined;
}

export class SoundMaster implements RegisterablePersistent {
	public get id(): 'sm' { return 'sm'; }
	public get registrypersistent(): true { return true; }

	public static readonly instance: SoundMaster = new SoundMaster();

	private globalSuspensions: Set<string>;
	private tracks: Record<asset_id, RomAudioResource>;
	private streamTracks: Record<string, StreamTrackData>;
	private streamActiveBytes: Record<string, { bytes: Uint8Array; refs: number }>;
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
	private endedListenersByType: Record<AudioType, Set<(info: ActiveVoiceInfo) => void>>;
	private nextVoiceId: VoiceId;
	private musicTransitionTimer: ReturnType<typeof setTimeout>;
	private pendingStingerReturnTo: asset_id;
	private maxVoicesByType: Record<AudioType, number>;
	private voiceRecordByHandle: WeakMap<VoiceHandle, ActiveVoiceRecord>;
	private mixSampleRate: number;
	private mixFps: number;
	private mixLatencyProfile: MixLatencyProfile;
	private mixTargetAheadSec: number;
	private readonly mixChunk: Int16Array;
	private readonly mixChunkViews: Int16Array[];
	private readonly mixDecodeScratch0: Int16Array;
	private readonly mixDecodeScratch1: Int16Array;
	private mixSampledL: number;
	private mixSampledR: number;
	private readonly onCoreNeed: () => void;

	private constructor() {
		this.globalSuspensions = new Set();
		this.tracks = {};
		this.streamTracks = {};
		this.streamActiveBytes = {};
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
		this.endedListenersByType = { sfx: new Set(), music: new Set(), ui: new Set() };
		this.nextVoiceId = 1;
		this.musicTransitionTimer = null;
		this.pendingStingerReturnTo = null;
		this.maxVoicesByType = { sfx: DEFAULT_MAX_VOICES.sfx, music: DEFAULT_MAX_VOICES.music, ui: DEFAULT_MAX_VOICES.ui };
		this.voiceRecordByHandle = new WeakMap();
		this.mixSampleRate = 0;
		this.mixFps = 50;
		this.mixLatencyProfile = 'balanced';
		this.mixTargetAheadSec = 0;
		this.mixChunk = new Int16Array(MIX_CHUNK_FRAMES * 2);
		this.mixChunkViews = new Array<Int16Array>(MIX_CHUNK_FRAMES + 1);
		for (let frames = 0; frames <= MIX_CHUNK_FRAMES; frames += 1) {
			this.mixChunkViews[frames] = this.mixChunk.subarray(0, frames * 2);
		}
		this.mixDecodeScratch0 = new Int16Array(2);
		this.mixDecodeScratch1 = new Int16Array(2);
		this.mixSampledL = 0;
		this.mixSampledR = 0;
		this.onCoreNeed = () => {
			this.pumpCoreAudio();
		};
		this.setLatencyProfile(isIOSAudioTarget() ? 'safe' : 'balanced');
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

	public async init(audioResources: id2res, startingVolume: number, resolver: ModulationPresetResolver | null, audioResolver: AudioBytesResolver) {
		this.audio = $.platform.audio;
		this.rng = $.platform.rng;
		this.modulationResolver = resolver;
		this.audioResolver = audioResolver;
		this.modulationPresetCache.clear();

		await this.A.resume();

		this.tracks = this.coerceAudioResources(audioResources);
		this.streamTracks = {};
		this.streamActiveBytes = {};
		this.streamClips = {};
		this.streamClipLoads = {};
		this.resetVoiceState();
		this.mixSampleRate = this.A.sampleRate();
		if (!Number.isFinite(this.mixSampleRate) || this.mixSampleRate <= 0) {
			throw new Error('[SoundMaster] Audio sample rate must be a positive finite value.');
		}
		this.setMixerFps($.target_fps);
		this.startMixer();

		this.volume = clamp01(startingVolume);
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

	public bind(): void {
		Registry.instance.register(this);
	}

	public unbind(): void {
		Registry.instance.deregister(this, true);
	}

	private resetVoiceState(): void {
		if (this.musicTransitionTimer !== null) {
			clearTimeout(this.musicTransitionTimer);
		}
		this.musicTransitionTimer = null;
		this.pendingStingerReturnTo = null;
		this.stopAllVoices();
		this.voicesByType = { sfx: [], music: [], ui: [] };
		this.currentVoiceByType = { sfx: null, music: null, ui: null };
		this.currentPlayParamsByType = { sfx: null, music: null, ui: null };
		this.currentAudioByType = { sfx: null, music: null, ui: null };
		this.pausedByType = { sfx: [], music: [], ui: [] };
		this.nextVoiceId = 1;
		this.voiceRecordByHandle = new WeakMap();
		this.streamActiveBytes = {};
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

	private acquireRuntimeBytes(id: asset_id): Uint8Array {
		const entry = this.streamActiveBytes[id];
		if (entry) {
			entry.refs += 1;
			return entry.bytes;
		}
		const bytes = this.getRuntimeBytes(id);
		this.streamActiveBytes[id] = { bytes, refs: 1 };
		return bytes;
	}

	private releaseRuntimeBytes(id: asset_id): void {
		const entry = this.streamActiveBytes[id];
		if (!entry) {
			return;
		}
		entry.refs -= 1;
		if (entry.refs <= 0) {
			this.streamActiveBytes[id] = undefined;
		}
	}

	private parseBadpTrack(id: asset_id): StreamTrackData {
		const bytes = this.getRuntimeBytes(id);
		if (bytes.byteLength < BADP_HEADER_SIZE) {
			throw new Error(`[SoundMaster] Audio asset '${String(id)}' is too small for BADP.`);
		}
		if (bytes[0] !== 0x42 || bytes[1] !== 0x41 || bytes[2] !== 0x44 || bytes[3] !== 0x50) {
			throw new Error(`[SoundMaster] Audio asset '${String(id)}' is not BADP.`);
		}
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const version = view.getUint16(4, true);
		if (version !== BADP_VERSION) {
			throw new Error(`[SoundMaster] BADP version ${version} is unsupported for '${String(id)}'.`);
		}
		const channels = view.getUint16(6, true);
		const sampleRate = view.getUint32(8, true);
		const frames = view.getUint32(12, true);
		const loopStartFrame = view.getUint32(16, true);
		const loopEndFrame = view.getUint32(20, true);
		const seekEntryCount = view.getUint32(28, true);
		const seekTableOffset = view.getUint32(32, true);
		const dataOffset = view.getUint32(36, true);
		if (channels <= 0 || channels > 2) {
			throw new Error(`[SoundMaster] BADP channels must be 1 or 2 for '${String(id)}'.`);
		}
		if (sampleRate <= 0) {
			throw new Error(`[SoundMaster] BADP sampleRate must be positive for '${String(id)}'.`);
		}
		if (dataOffset < BADP_HEADER_SIZE || dataOffset > bytes.byteLength) {
			throw new Error(`[SoundMaster] BADP dataOffset is invalid for '${String(id)}'.`);
		}
		if (seekEntryCount > 0 && (seekTableOffset < BADP_HEADER_SIZE || seekTableOffset >= dataOffset)) {
			throw new Error(`[SoundMaster] BADP seek table offset is invalid for '${String(id)}'.`);
		}
		const seekFrames = new Uint32Array(seekEntryCount > 0 ? seekEntryCount : 1);
		const seekOffsets = new Uint32Array(seekEntryCount > 0 ? seekEntryCount : 1);
		if (seekEntryCount > 0) {
			let cursor = seekTableOffset;
			for (let index = 0; index < seekEntryCount; index += 1) {
				if (cursor + 8 > dataOffset) {
					throw new Error(`[SoundMaster] BADP seek table exceeds bounds for '${String(id)}'.`);
				}
				seekFrames[index] = view.getUint32(cursor, true);
				seekOffsets[index] = view.getUint32(cursor + 4, true);
				cursor += 8;
			}
		} else {
			seekFrames[0] = 0;
			seekOffsets[0] = 0;
		}
		return {
			id,
			channels,
			sampleRate,
			frames,
			durationSec: frames / sampleRate,
			loopStartFrame,
			loopEndFrame,
			dataOffset,
			seekFrames,
			seekOffsets,
		};
	}

	private streamTrackFor(id: asset_id): StreamTrackData {
		const cached = this.streamTracks[id];
		if (cached) {
			return cached;
		}
		const parsed = this.parseBadpTrack(id);
		this.streamTracks[id] = parsed;
		return parsed;
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
		const task = Promise.resolve().then(() => {
			const stream = this.streamTrackFor(id);
			const clip = new StreamClipHandle(stream.durationSec);
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
		const clip = this.streamClips[id];
		if (clip) {
			clip.dispose();
		}
		this.streamTracks[id] = undefined;
		this.streamActiveBytes[id] = undefined;
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
		onStarted: ((voice: StreamVoiceHandle, record: ActiveVoiceRecord) => void),
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

		const stream = this.streamTrackFor(id);
		const hasHeaderLoop = stream.loopStartFrame !== BADP_NO_LOOP
			&& stream.loopEndFrame !== BADP_NO_LOOP
			&& stream.loopEndFrame > stream.loopStartFrame;
		const loopEnabled = playback.loop !== null || hasHeaderLoop;
		const loopStartFrames = playback.loop !== null
			? this.clampFrames(Math.floor(playback.loop.start * stream.sampleRate), stream.frames)
			: (hasHeaderLoop ? this.clampFrames(stream.loopStartFrame, stream.frames) : 0);
		const loopEndFrames = playback.loop !== null
			? this.clampFrames(Math.floor((playback.loop.end !== undefined ? playback.loop.end : clip.duration) * stream.sampleRate), stream.frames)
			: (hasHeaderLoop ? this.clampFrames(stream.loopEndFrame, stream.frames) : stream.frames);
		if (loopEnabled && loopEndFrames <= loopStartFrames) {
			throw new Error('[SoundMaster] Loop end must be greater than loop start.');
		}
		let positionFrames = playback.offset * stream.sampleRate;
		if (loopEnabled) {
			positionFrames = this.wrapLoopFrame(positionFrames, loopStartFrames, loopEndFrames);
		} else {
			if (positionFrames < 0) positionFrames = 0;
			if (positionFrames > stream.frames) positionFrames = stream.frames;
		}
		const voiceId = this.nextVoiceId++;
		const startedAt = this.A.currentTime() + (this.A.coreQueuedFrames() / this.mixSampleRate);
		const startOffset = playback.offset;
		const voice = new StreamVoiceHandle(this, voiceId, startedAt, startOffset);
		const stepFrames = (stream.sampleRate / this.mixSampleRate) * playback.rate;
		if (stepFrames <= 0) {
			throw new Error('[SoundMaster] Playback rate must be positive.');
		}
		const runtimeBytes = this.acquireRuntimeBytes(id);
		let decoder: BadpDecoderCursor;
		try {
			decoder = new BadpDecoderCursor(stream, runtimeBytes);
		} catch (error) {
			this.releaseRuntimeBytes(id);
			throw error;
		}
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
			stream,
			byteLeaseId: id,
			decoder,
			stepFrames,
			positionFrames,
			loopEnabled,
			loopStartFrames,
			loopEndFrames,
			gainLinear: playback.gainLinear,
			targetGainLinear: playback.gainLinear,
			gainRampRemainingFrames: 0,
			gainRampDelta: 0,
			finalized: false,
		};

		pool.push(record);
		this.voiceRecordByHandle.set(voice, record);
		this.currentVoiceByType[type] = voice;
		this.currentAudioByType[type] = { ...meta, id };
		this.currentPlayParamsByType[type] = params;
		this.pumpCoreAudio();

		if (onStarted) onStarted(voice, record);

		return voiceId;
	}

	private finalizeVoiceEnd(type: AudioType, record: ActiveVoiceRecord): void {
		if (record.finalized) return;
		record.finalized = true;
		this.voiceRecordByHandle.delete(record.handle);
		this.releaseRuntimeBytes(record.byteLeaseId);
		record.handle.emitEnded(this.A.currentTime());
		record.handle.disconnect();

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

	private clampFrames(frame: number, maxFrames: number): number {
		if (frame < 0) {
			return 0;
		}
		if (frame > maxFrames) {
			return maxFrames;
		}
		return frame;
	}

	private wrapLoopFrame(positionFrames: number, loopStartFrames: number, loopEndFrames: number): number {
		const length = loopEndFrames - loopStartFrames;
		if (length <= 0) {
			return loopStartFrames;
		}
		let wrapped = (positionFrames - loopStartFrames) % length;
		if (wrapped < 0) {
			wrapped += length;
		}
		return loopStartFrames + wrapped;
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
		const clamped = clamp01(gain);
		found.record.gainLinear = clamped;
		found.record.targetGainLinear = clamped;
		found.record.gainRampRemainingFrames = 0;
		found.record.gainRampDelta = 0;
	}

	public rampVoiceGainLinear(voiceId: VoiceId, target: number, seconds: number): void {
		const found = this.findRecordByVoiceId(voiceId);
		if (!found) {
			return;
		}
		if (!Number.isFinite(seconds) || seconds <= 0) {
			throw new Error('[SoundMaster] Gain ramp duration must be positive and finite.');
		}
		const clamped = clamp01(target);
		const frames = Math.max(1, Math.floor(seconds * this.mixSampleRate));
		found.record.targetGainLinear = clamped;
		found.record.gainRampRemainingFrames = frames;
		found.record.gainRampDelta = (clamped - found.record.gainLinear) / frames;
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
		record.stepFrames = (record.stream.sampleRate / this.mixSampleRate) * rate;
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
			this.pumpCoreAudio();
		}
	}

	public getLatencyProfile(): MixLatencyProfile {
		return this.mixLatencyProfile;
	}

	public finishFrame(): void {
		if (this.globalSuspensions.size === 0) {
			this.pumpCoreAudio();
		}
	}

	private computeMixTargetFrames(): number {
		const requested = Math.ceil(this.mixTargetAheadSec * this.mixSampleRate);
		if (isIOSAudioTarget()) {
			return clamp(requested, MIX_TARGET_MIN_FRAMES_IOS, MIX_TARGET_MAX_FRAMES_IOS);
		}
		return clamp(requested, MIX_TARGET_MIN_FRAMES, MIX_TARGET_MAX_FRAMES);
	}

	private sampleVoiceFrame(record: ActiveVoiceRecord): boolean {
		let positionFrames = record.positionFrames;
		let frame = Math.floor(positionFrames);
		if (record.loopEnabled) {
			if (frame >= record.loopEndFrames || frame < record.loopStartFrames) {
				positionFrames = this.wrapLoopFrame(positionFrames, record.loopStartFrames, record.loopEndFrames);
				frame = Math.floor(positionFrames);
			}
		} else if (frame >= record.stream.frames) {
			return false;
		}

		if (!record.decoder.readFrameAt(frame, this.mixDecodeScratch0)) {
			return false;
		}

		const frac = positionFrames - frame;
		let frameNext = frame + 1;
		if (record.loopEnabled) {
			if (frameNext >= record.loopEndFrames) {
				frameNext = record.loopStartFrames + (frameNext - record.loopEndFrames);
			}
		} else if (frameNext >= record.stream.frames) {
			frameNext = frame;
		}

		if (frameNext !== frame) {
			if (!record.decoder.readFrameAt(frameNext, this.mixDecodeScratch1)) {
				return false;
			}
			const left0 = this.mixDecodeScratch0[0];
			const right0 = this.mixDecodeScratch0[1];
			this.mixSampledL = (left0 + (this.mixDecodeScratch1[0] - left0) * frac) * PCM_SCALE;
			this.mixSampledR = (right0 + (this.mixDecodeScratch1[1] - right0) * frac) * PCM_SCALE;
		} else {
			this.mixSampledL = this.mixDecodeScratch0[0] * PCM_SCALE;
			this.mixSampledR = this.mixDecodeScratch0[1] * PCM_SCALE;
		}

		record.positionFrames = positionFrames + record.stepFrames;
		return true;
	}

	private mixAndPushCoreFrames(frameCount: number): void {
		const frames = clamp(frameCount, 1, MIX_CHUNK_FRAMES);
		let dst = 0;
		for (let frame = 0; frame < frames; frame += 1) {
			let mixedL = 0;
			let mixedR = 0;
			for (let typeIndex = 0; typeIndex < AudioTypes.length; typeIndex += 1) {
				const type = AudioTypes[typeIndex];
				const pool = this.voicesByType[type];
				for (let voiceIndex = pool.length - 1; voiceIndex >= 0; voiceIndex -= 1) {
					const record = pool[voiceIndex];
					if (!this.sampleVoiceFrame(record)) {
						this.stopVoiceRecord(type, record);
						continue;
					}
					mixedL += this.mixSampledL * record.gainLinear;
					mixedR += this.mixSampledR * record.gainLinear;
					if (record.gainRampRemainingFrames > 0) {
						record.gainLinear += record.gainRampDelta;
						record.gainRampRemainingFrames -= 1;
						if (record.gainRampRemainingFrames === 0) {
							record.gainLinear = record.targetGainLinear;
							record.gainRampDelta = 0;
						}
					}
				}
			}

			const clampedL = clamp(mixedL, -1, 1);
			const clampedR = clamp(mixedR, -1, 1);
			const pcmL = clampedL < 0 ? Math.round(clampedL * 32768) : Math.round(clampedL * 32767);
			const pcmR = clampedR < 0 ? Math.round(clampedR * 32768) : Math.round(clampedR * 32767);
			this.mixChunk[dst] = clamp(pcmL, PCM_INT16_MIN, PCM_INT16_MAX);
			this.mixChunk[dst + 1] = clamp(pcmR, PCM_INT16_MIN, PCM_INT16_MAX);
			dst += 2;
		}

		this.A.pushCoreFrames(this.mixChunkViews[frames], 2, this.mixSampleRate);
	}

	private pumpCoreAudio(): void {
		const targetFrames = this.computeMixTargetFrames();
		let queuedFrames = this.A.coreQueuedFrames();
		let budgetFrames = MIX_MAX_PUMP_BUDGET_FRAMES;
		while (queuedFrames < targetFrames && budgetFrames > 0) {
			const deficit = targetFrames - queuedFrames;
			const chunkFrames = Math.min(MIX_CHUNK_FRAMES, deficit, budgetFrames);
			this.mixAndPushCoreFrames(chunkFrames);
			budgetFrames -= chunkFrames;
			queuedFrames = this.A.coreQueuedFrames();
		}
	}

	private startMixer(): void {
		this.A.clearCoreStream();
		this.A.setFrameTimeSec(this.mixTargetAheadSec);
		this.A.setCoreNeedHandler(this.onCoreNeed);
		this.pumpCoreAudio();
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
		this.resumeAll('pause');
	}

	public resumeType(type: AudioType): void {
		const paused = this.drainPausedSnapshots(type);
		for (let i = 0; i < paused.length; i++) {
			const snapshot = paused[i];
			const params: ModulationParams = { ...snapshot.params, offset: snapshot.offset };
			void this.play(snapshot.id, { params, priority: snapshot.priority });
		}
	}

	public suspendAll(tag: string): void {
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
		start_at_loop_start?: boolean;
		start_fresh?: boolean;
	}): void {
		const sync = opts.sync !== undefined ? opts.sync : 'immediate';
		const fade_ms = opts.fade_ms !== undefined ? opts.fade_ms : 250;
		const start_at_loop_start = opts.start_at_loop_start !== undefined ? opts.start_at_loop_start : false;
		const start_fresh = opts.start_fresh !== undefined ? opts.start_fresh : false;

		if (this.musicTransitionTimer !== null) {
			clearTimeout(this.musicTransitionTimer);
			this.musicTransitionTimer = null;
		}

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
					if (voiceId === null) return;
					const unsub = this.addEndedListener(stingerType, info => {
						if (info.voiceId !== voiceId) return;
						unsub();
						const target = this.pendingStingerReturnTo;
						this.pendingStingerReturnTo = null;
						if (target !== null) {
							this.startMusicWithFade(target, fade_ms, start_at_loop_start, previousOffset);
						}
					});
				}).catch(() => {});
				return;
			}
			const returnTarget = sync.return_to !== undefined ? sync.return_to : opts.to;
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
						this.startMusicWithFade(target, fade_ms, start_at_loop_start);
					}
				});
			}).catch(() => {});
			return;
		}

		if (sync === 'immediate') {
			this.startMusicWithFade(opts.to, fade_ms, start_at_loop_start, start_fresh ? 0 : undefined);
			return;
		}

		if (isMusicTransitionDelaySync(sync)) {
			const delay_ms = sync.delay_ms >= 0 ? sync.delay_ms : 0;
			this.musicTransitionTimer = setTimeout(() => {
				this.musicTransitionTimer = null;
				this.startMusicWithFade(opts.to, fade_ms, start_at_loop_start, start_fresh ? 0 : undefined);
			}, delay_ms);
			return;
		}

		const currentRecord = this.getCurrentRecord('music');
		if (!currentRecord) {
			this.startMusicWithFade(opts.to, fade_ms, start_at_loop_start, start_fresh ? 0 : undefined);
			return;
		}

		const duration = currentRecord.clip.duration;
		if (!(duration > 0)) {
			this.startMusicWithFade(opts.to, fade_ms, start_at_loop_start, start_fresh ? 0 : undefined);
			return;
		}

		const nowOffset = this.currentTimeByType('music');
		if (nowOffset === null) {
			this.startMusicWithFade(opts.to, fade_ms, start_at_loop_start, start_fresh ? 0 : undefined);
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
			this.startMusicWithFade(opts.to, fade_ms, start_at_loop_start, start_fresh ? 0 : undefined);
		}, Math.floor(delaySec * 1000));
	}

	private getCurrentRecord(type: AudioType): ActiveVoiceRecord {
		const handle = this.currentVoiceByType[type];
		if (!handle) return null;
		const record = this.voiceRecordByHandle.get(handle);
		return record && !record.finalized ? record : null;
	}

	private startMusicWithFade(target: asset_id, fade_ms: number, start_at_loop_start: boolean, startAtSeconds?: number): void {
		const meta = this.getAudioMetaOrThrow(target);
		const baseOffset = startAtSeconds !== undefined ? startAtSeconds : ((start_at_loop_start && meta.loop !== undefined && meta.loop !== null) ? meta.loop : 0);
		const fadeSec = Math.max(0, fade_ms) / 1000;
		const oldHandle = this.currentVoiceByType.music;
		const oldRecord = oldHandle ? this.voiceRecordByHandle.get(oldHandle) : undefined;
		void (async () => {
			try {
				const clip = await this.clipFor(target);
				const params: ModulationParams = { offset: baseOffset };
				const playback = this.createVoiceParams(meta, params, clip);
				playback.gainLinear = MIN_GAIN;
				const priority = meta.priority !== undefined ? meta.priority : 0;
				const voiceId = this.startVoice('music', target, meta, clip, params, priority, playback, (voice) => {
					voice.rampGainLinear(1.0, fadeSec);
				});
				if (voiceId !== null && oldRecord && !oldRecord.finalized) {
					oldRecord.handle.rampGainLinear(MIN_GAIN, fadeSec);
					if (fade_ms > 0) {
						setTimeout(() => this.stopVoiceRecord('music', oldRecord), fade_ms);
					} else {
						this.stopVoiceRecord('music', oldRecord);
					}
				}
			} catch (error) {
				console.error(error);
			}
		})();
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
		this.streamTracks = {};
		this.streamActiveBytes = {};
		this.streamClips = {};
		this.streamClipLoads = {};
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
