import { AudioMeta, AudioType, id2res } from "../rompack/rompack";

export interface AudioMetadataWithID extends AudioMeta {
    id: string; // The ID of the audio asset.
}

export interface PlayParamOptions {
    /** Offset in seconds to start playback from (not random!) */
    offset?: number;
    /** Random pitch variation expressed as a fraction (0.05 = ±5%) */
    pitchRandom?: number;
    /** Random extra offset in seconds added to the starting position */
    startOffsetRandom?: number;
    /** Random volume variation in decibels (0.0–3.0 is typical) */
    volumeRandom?: number;
    /** Base playback rate (used for velocity-based stretching) */
    playbackRate?: number;
    /** Optional filter to apply to the sound */
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

    private static playNode(_track: AudioMeta, node: AudioBufferSourceNode, options: PlayParamOptions = {}): void {
        try {
            let destination: AudioNode = SM.gainNode;
            const extras: { gain?: GainNode; filter?: BiquadFilterNode } = {};

            if (options.filter) {
                const filter = SM.sndContext.createBiquadFilter();
                if (options.filter.type) filter.type = options.filter.type;
                if (options.filter.frequency !== undefined) filter.frequency.value = options.filter.frequency;
                if (options.filter.q !== undefined) filter.Q.value = options.filter.q;
                if (options.filter.gain !== undefined) filter.gain.value = options.filter.gain;
                filter.connect(destination);
                destination = filter;
                extras.filter = filter;
            }

            if (options.volumeRandom !== undefined) {
                const gain = SM.sndContext.createGain();
                const dB = (Math.random() * 2 - 1) * options.volumeRandom;
                gain.gain.value = Math.pow(10, dB / 20);
                gain.connect(destination);
                destination = gain;
                extras.gain = gain;
            }

            node.connect(destination);
            SM.nodeExtras.set(node, extras);

            const buffer = node.buffer;
            let startOffset = (options.offset ?? 0) + (options.startOffsetRandom ? Math.random() * options.startOffsetRandom : 0);
            if (startOffset < 0) {
                startOffset = 0;
            } else if (buffer && startOffset > buffer.duration) {
                startOffset = buffer.duration - 0.001; // Avoid issues with very small durations
            }

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

            const baseRate = options.playbackRate ?? 1;
            let randFactor = 1;
            if (options.pitchRandom) {
                randFactor += (Math.random() * 2 - 1) * options.pitchRandom;
            }
            node.playbackRate.value = baseRate * randFactor;

            SM.nodeStartTime[_track['audiotype']] = SM.sndContext.currentTime;
            SM.nodeStartOffset[_track['audiotype']] = startOffset;
            node.start(0, startOffset);
            node.onended = () => SM.nodeEndedHandler(node, _track['audiotype']);
        } catch (error) {
            console.error(error);
        }
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

    public static play(id: string, options: PlayParamOptions = {}): void {
        const track = SM.tracks[id]?.['audiometa'];
        if (!track) {
            console.error(`SoundMaster: Attempted to play unknown track with id = "${id}". Skipping.`);
            return;
        }
        const audiotype = track['audiotype'];
        if (audiotype === 'sfx' && SM.limitToOneEffect && SM.currentAudioByType[audiotype] && track['priority'] < SM.currentAudioByType[audiotype]['priority'])
            return;
        const playCallback = (node: AudioBufferSourceNode) => {
            SM.stop(id); // Stop previous node before attaching a new one
            SM.currentAudioNodeByType[audiotype] = node; // Track the node before playback
            SM.currentAudioByType[audiotype] = { ...track, id: id };
            SM.playNode(track, node, options);
        };
        SM.createNode(id)
            .then(playCallback)
            .catch(e => console.error(e.message));
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
