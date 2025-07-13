import { AudioMeta, AudioType, id2res } from "../rompack/rompack";

export interface AudioMetadataWithID extends AudioMeta {
	id: string; // The ID of the audio asset.
}

export interface RandomModulationParams {
	// pitch tussen pitchMin en pitchMax
	pitchMin?: number;
	pitchMax?: number;
	// volume (dB) tussen volumeMin en volumeMax
	volumeMin?: number;
	volumeMax?: number;
	// offset (s) tussen offsetMin en offsetMax
	offsetMin?: number;
	offsetMax?: number;
	// playback rate vaste waarde (geen range)
	playbackRate?: number;
	// filter-settings (exact gelijk aan resolved variant)
	filter?: {
		type?: BiquadFilterType;
		frequency?: number;
		q?: number;
		gain?: number;
	};
}

export interface ModulationParams {
	pitchDelta?: number;
	volumeDelta?: number;
	offset?: number;
	playbackRate?: number;
	filter?: {
		type?: BiquadFilterType;
		frequency?: number;
		q?: number;
		gain?: number;
	};
}

// TODO: ALSO ADD FUNCTIONALITY TO STORE THE CURRENT PLAYPARAMOPTIONS (e.g. volume, pitch, etc.) FOR EACH AUDIO TYPE FOR SERIALIZATION AND DESERIALIZATION! THAT MEANS THAT THE RESULTING OPTIONS NEED TO BE STORED AND NOT THE GIVEN OPTIONS, AS THEY CONTAIN RANGES FOR RANDOM VALUES AND NOT THE ACTUAL VALUES USED DURING PLAYBACK!

export class SM {
	private static limitToOneEffect: boolean = true;
	private static tracks: id2res;
	private static buffers: Record<string, AudioBuffer>;
	private static sndContext: AudioContext;
	private static currentAudioNodeByType: Record<AudioType, AudioBufferSourceNode>;
	private static currentPlayParamsByType: Record<AudioType, ModulationParams | null> = { sfx: null, music: null };
	private static nodeExtras: WeakMap<AudioBufferSourceNode, { gain?: GainNode; filter?: BiquadFilterNode }> = new WeakMap();
	public static currentAudioByType: Record<AudioType, AudioMetadataWithID | null> = { sfx: null, music: null };
	private static gainNode: GainNode;
	private static nodeStartTime: Record<AudioType, number> = { sfx: 0, music: 0 };
	private static nodeStartOffset: Record<AudioType, number> = { sfx: 0, music: 0 };

	public static async init(
		_audioResources: id2res,
		sndcontext: AudioContext,
		startingVolume: number,
		gainnode?: GainNode
	) {
		SM.sndContext = sndcontext;
		SM.currentAudioByType = { sfx: null, music: null };
		SM.currentAudioNodeByType = { sfx: null, music: null };

		SM.tracks = _audioResources;
		SM.predecodeTracks();

		await SM.sndContext.resume();

		if (!gainnode) {
			SM.gainNode = SM.sndContext.createGain();
			SM.gainNode.connect(SM.sndContext.destination);
		} else {
			SM.gainNode = gainnode;
		}
		SM.volume = startingVolume ?? 0;
	}

	private static predecodeTracks() {
		SM.buffers = {};
		Object.keys(SM.tracks).forEach(id => {
			SM.decode(global.$rom['rom'].slice(SM.tracks[id]['start'], SM.tracks[id]['end']))
				.then(decoded => SM.buffers[id] = decoded);
		});
	}

	private static async decode(audioData: ArrayBuffer): Promise<AudioBuffer> {
		if (SM.sndContext.decodeAudioData.length === 2) {
			return new Promise(resolve => {
				SM.sndContext.decodeAudioData(audioData, buffer => resolve(buffer));
			});
		} else {
			return SM.sndContext.decodeAudioData(audioData);
		}
	}

	private static async createNode(id: string): Promise<AudioBufferSourceNode> {
		const node = SM.sndContext.createBufferSource();
		return new Promise<AudioBufferSourceNode>((resolve, reject) => {
			Promise.resolve(node.buffer = SM.buffers[id]).then(() => resolve(node))
				.catch(e => reject(e));
		});
	}

	private static nodeEndedHandler(node: AudioBufferSourceNode, type: AudioType) {
		// Only clear if this node is still the current one for this type
		if (SM.currentAudioNodeByType[type] === node) {
			SM.currentAudioByType[type] = null;
			SM.currentAudioNodeByType[type] = null;
		}
		SM.releaseNode(node);
	}

	private static resolvePlayParams(options: RandomModulationParams | ModulationParams): ModulationParams {
		if (!options) return {};
		const anyOptions = options as any;
		return {
			offset: (anyOptions.offset ?? 0) + (anyOptions.startOffsetRandom ? Math.random() * anyOptions.startOffsetRandom : 0),
			pitchDelta: (anyOptions.pitchRandom ? (Math.random() * 2 - 1) * anyOptions.pitchRandom : 0),
			volumeDelta: (anyOptions.volumeRandom ? (Math.random() * 2 - 1) * anyOptions.volumeRandom : 0),
			playbackRate: anyOptions.playbackRate ?? 1,
			filter: anyOptions.filter ? { ...anyOptions.filter } : undefined,
		};
	}

	private static playNodeWithParams(_track: AudioMeta, node: AudioBufferSourceNode, params: ModulationParams): void {
		try {
			let destination: AudioNode = SM.gainNode;
			const extras: { gain?: GainNode; filter?: BiquadFilterNode } = {};

			if (params.filter) {
				const filter = SM.sndContext.createBiquadFilter();
				if (params.filter.type) filter.type = params.filter.type;
				if (params.filter.frequency !== undefined) filter.frequency.value = params.filter.frequency;
				if (params.filter.q !== undefined) filter.Q.value = params.filter.q;
				if (params.filter.gain !== undefined) filter.gain.value = params.filter.gain;
				filter.connect(destination);
				destination = filter;
				extras.filter = filter;
			}

			if (params.volumeDelta !== undefined) {
				const gain = SM.sndContext.createGain();
				gain.gain.value = Math.pow(10, params.volumeDelta / 20);
				gain.connect(destination);
				destination = gain;
				extras.gain = gain;
			}

			node.connect(destination);
			SM.nodeExtras.set(node, extras);

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

			SM.nodeStartTime[_track['audiotype']] = SM.sndContext.currentTime;
			SM.nodeStartOffset[_track['audiotype']] = startOffset;
			node.start(0, startOffset);
			node.onended = () => SM.nodeEndedHandler(node, _track['audiotype']);
		} catch (error) {
			console.error(error);
		}
	}

	public static play(id: string, options?: ModulationParams | RandomModulationParams): void {
		const params = SM.resolvePlayParams(options);
		const track = SM.tracks[id]?.['audiometa'];
		if (!track) {
			console.error(`SoundMaster: Attempted to play unknown track with id = "${id}". Skipping.`);
			return;
		}
		const audiotype = track['audiotype'];
		const playCallback = (node: AudioBufferSourceNode) => {
			SM.stop(id);
			SM.currentAudioNodeByType[audiotype] = node;
			SM.currentAudioByType[audiotype] = { ...track, id: id };
			SM.currentPlayParamsByType[audiotype] = params;
			SM.playNodeWithParams(track, node, params);
		};
		SM.createNode(id)
			.then(playCallback)
			.catch(e => console.error(e.message));
	}

	private static releaseNode(node: AudioBufferSourceNode) {
		if (!node) {
			console.warn(`SoundMaster: Attempted to release null node. Skipping.`);
			return;
		}
		const extra = SM.nodeExtras.get(node);
		try {
			node.stop();
		} catch { /* ignored */ }
		node.disconnect();
		if (extra?.gain) extra.gain.disconnect();
		if (extra?.filter) extra.filter.disconnect();
		SM.nodeExtras.delete(node);
		try { node.buffer = null; } catch { } // Some browsers may not allow setting buffer to null, and we can safely ignore this error
	}

	private static stop(id: string): void {
		const audiotype = SM.tracks[id]?.['audiometa']['audiotype'];
		SM.stopByType(audiotype);
	}

	private static stopByType(type: AudioType): void {
		try {
			const node = SM.currentAudioNodeByType[type];
			if (node && node.context.state !== 'closed') {
				SM.releaseNode(node);
			}
		} catch (e) { console.warn(e); }
		SM.currentAudioNodeByType[type] = null;
		SM.currentAudioByType[type] = null;
	}

	public static stopEffect(): void {
		SM.stopByType('sfx');
	}

	public static stopMusic(): void {
		SM.stopByType('music');
	}

	public static pause(): void {
		if (SM.sndContext.state === 'running') {
			SM.sndContext.suspend();
		}
	}

	public static resume(): void {
		if (SM.sndContext.state === 'suspended') {
			SM.sndContext.resume();
		}
	}

	public static get volume(): number {
		return parseFloat(SM.gainNode.gain.value.toFixed(1));
	}

	public static set volume(_v: number) {
		let v = parseFloat(_v.toFixed(1));
		SM.gainNode.gain.value = SM.gainNode.gain.defaultValue * v;
	}

	public static currentTimeByType(type: AudioType): number | null {
		if (SM.currentAudioByType[type] === null) {
			return null; // No audio is currently playing for this type
		}
		const node = SM.currentAudioNodeByType[type];
		if (node) {
			// Calculate true playback position
			return (node.context.currentTime - SM.nodeStartTime[type]) + SM.nodeStartOffset[type];
		}
		return null;
	}

	public static currentTrackByType(type: AudioType): string | null {
		const audioMeta = SM.currentAudioByType[type];
		return audioMeta ? audioMeta.id : null;
	}
}
