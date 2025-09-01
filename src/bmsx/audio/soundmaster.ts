import { Registry } from '../core/registry';
import { asset_id, AudioMeta, AudioType, id2res, RegisterablePersistent } from "../rompack/rompack";

export interface AudioMetadataWithID extends AudioMeta {
	id: asset_id; // The ID of the audio asset.
}

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
	private static _instance: SoundMaster;

	public static get instance(): SoundMaster {
		if (!SoundMaster._instance) {
			SoundMaster._instance = new SoundMaster();
		}
		return SoundMaster._instance;
	}

	private tracks: id2res;
	private buffers: Record<string, AudioBuffer>;
	private sndContext: AudioContext;
	private currentAudioNodeByType: Record<AudioType, AudioBufferSourceNode>;
	private currentPlayParamsByType: Record<AudioType, ModulationParams | null>;
	private nodeExtras: WeakMap<AudioBufferSourceNode, { gain?: GainNode; filter?: BiquadFilterNode }>;
	public currentAudioByType: Record<AudioType, AudioMetadataWithID | null>;
	private gainNode: GainNode;
	private nodeStartTime: Record<AudioType, number>;
	private nodeStartOffset: Record<AudioType, number>;

	constructor() {
		Registry.instance.register(this);
		this.tracks = {};
		this.buffers = {};
		this.sndContext = null; // Passed externally via the init method
		this.currentAudioNodeByType = { sfx: null, music: null };
		this.currentPlayParamsByType = { sfx: null, music: null };
		this.nodeExtras = new WeakMap();
		this.currentAudioByType = { sfx: null, music: null };
		this.gainNode = null; // Passed externally via the init method
		this.nodeStartTime = { sfx: 0, music: 0 };
		this.nodeStartOffset = { sfx: 0, music: 0 };
	}

	public async init(audioResources: id2res, sndcontext: AudioContext, startingVolume: number, gainnode?: GainNode) {
		this.sndContext = sndcontext;
		this.currentAudioByType = { sfx: null, music: null };
		this.currentAudioNodeByType = { sfx: null, music: null };

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

	private predecodeTracks() {
		this.buffers = {};
		Object.keys(this.tracks).forEach(id => {
			this.decode(global.$rom['rom'].slice(this.tracks[id]['start'], this.tracks[id]['end']))
				.then(decoded => this.buffers[id] = decoded);
		});
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

	private async createNode(id: asset_id): Promise<AudioBufferSourceNode> {
		const node = this.sndContext.createBufferSource();
		return new Promise<AudioBufferSourceNode>((resolve, reject) => {
			Promise.resolve(node.buffer = this.buffers[id]).then(() => resolve(node))
				.catch(e => reject(e));
		});
	}

	private nodeEndedHandler(node: AudioBufferSourceNode, type: AudioType) {
		// Only clear if this node is still the current one for this type
		if (this.currentAudioNodeByType[type] === node) {
			this.currentAudioByType[type] = null;
			this.currentAudioNodeByType[type] = null;
		}
		this.releaseNode(node);
	}

	private resolvePlayParams(options: RandomModulationParams | ModulationParams): ModulationParams {
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

	private playNodeWithParams(_track: AudioMeta, node: AudioBufferSourceNode, params: ModulationParams): void {
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

			if (params.volumeDelta !== undefined) {
				const gain = this.sndContext.createGain();
				gain.gain.value = Math.pow(10, params.volumeDelta / 20);
				gain.connect(destination);
				destination = gain;
				extras.gain = gain;
			}

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
		} catch (error) {
			console.error(error);
		}
	}

	public play(id: asset_id, options?: ModulationParams | RandomModulationParams): void {
		const params = this.resolvePlayParams(options);
		const track = this.tracks[id]?.['audiometa'];
		if (!track) {
			console.error(`SoundMaster: Attempted to play unknown track with id = "${id}". Skipping.`);
			return;
		}
		const audiotype = track['audiotype'];
		const playCallback = (node: AudioBufferSourceNode) => {
			this.stop(id);
			this.currentAudioNodeByType[audiotype] = node;
			this.currentAudioByType[audiotype] = { ...track, id: id };
			this.currentPlayParamsByType[audiotype] = params;
			this.playNodeWithParams(track, node, params);
		};
		this.createNode(id)
			.then(playCallback)
			.catch(e => console.error(e.message));
	}

	private releaseNode(node: AudioBufferSourceNode) {
		if (!node) {
			console.warn(`SoundMaster: Attempted to release null node. Skipping.`);
			return;
		}
		const extra = this.nodeExtras.get(node);
		try {
			node.stop();
		} catch { /* ignored */ }
		node.disconnect();
		if (extra?.gain) extra.gain.disconnect();
		if (extra?.filter) extra.filter.disconnect();
		this.nodeExtras.delete(node);
		try { node.buffer = null; } catch { } // Some browsers may not allow setting buffer to null, and we can safely ignore this error
	}

	private stop(id: asset_id): void {
		const audiotype = this.tracks[id]?.['audiometa']['audiotype'];
		this.stopByType(audiotype);
	}

	private stopByType(type: AudioType): void {
		try {
			const node = this.currentAudioNodeByType[type];
			if (node && node.context.state !== 'closed') {
				this.releaseNode(node);
			}
		} catch (e) { console.warn(e); }
		this.currentAudioNodeByType[type] = null;
		this.currentAudioByType[type] = null;
	}

	public stopEffect(): void {
		this.stopByType('sfx');
	}

	public stopMusic(): void {
		this.stopByType('music');
	}

	public pause(): void {
		if (this.sndContext.state === 'running') {
			this.sndContext.suspend();
		}
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
		let v = parseFloat(_v.toFixed(1));
		this.gainNode.gain.value = this.gainNode.gain.defaultValue * v;
	}

	public currentTimeByType(type: AudioType): number | null {
		if (this.currentAudioByType[type] === null) {
			return null; // No audio is currently playing for this type
		}
		const node = this.currentAudioNodeByType[type];
		if (node) {
			// Calculate true playback position
			return (node.context.currentTime - this.nodeStartTime[type]) + (this.nodeStartOffset[type] ?? 0);
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
	}
}
