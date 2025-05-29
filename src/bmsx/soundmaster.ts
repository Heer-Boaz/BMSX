import { AudioMeta, AudioType, id2res } from "./rompack";

export interface AudioMeta2 extends AudioMeta {
    id: string; // The ID of the audio asset.
}

export class SM {
    private static limitToOneEffect: boolean = true;
    private static tracks: id2res;
    private static buffers: Record<string, AudioBuffer>;
    private static sndContext: AudioContext;
    private static currentAudioNodeByType: Record<AudioType, AudioBufferSourceNode>;
    public static currentAudioByType: Record<AudioType, AudioMeta2 | null>;
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
            SM.decode(global.rom['rom'].slice(SM.tracks[id]['start'], SM.tracks[id]['end']))
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
            SM.releaseNode(node);
            SM.currentAudioNodeByType[type] = null;
        } else {
            // Node is stale, just release it
            SM.releaseNode(node);
        }
    }

    private static playNode(_track: AudioMeta, node: AudioBufferSourceNode, offset?: number): void {
        try {
            node.connect(SM.gainNode);
            const buffer = node.buffer;
            let startOffset = 0;
            if (_track['loop'] !== null) {
                node.loop = true;
                node.loopStart = _track['loop']!;
            } else {
                node.loop = false;
            }
            if (typeof offset === 'number' && buffer) {
                if (node.loop) {
                    // For looping, wrap offset
                    startOffset = ((offset % buffer.duration) + buffer.duration) % buffer.duration;
                } else {
                    // For non-looping, clamp
                    startOffset = Math.max(0, Math.min(offset, buffer.duration - 0.001));
                }
            }
            // Track when and at what offset this node started
            SM.nodeStartTime[_track['audiotype']] = SM.sndContext.currentTime;
            SM.nodeStartOffset[_track['audiotype']] = startOffset;
            node.start(0, startOffset);
            node.onended = () => SM.nodeEndedHandler(node, _track['audiotype']);
        } catch (error) {
            console.warn(error);
        }
    }

    private static releaseNode(node: AudioBufferSourceNode) {
        if (!node) {
            console.warn(`SoundMaster: Attempted to release null node. Skipping.`);
            return;
        }
        node.stop();
        node.disconnect();
        node.buffer = null;
    }

    public static play(id: string, offset?: number): void {
        const track = SM.tracks[id]?.['audiometa'];
        if (!track) {
            console.warn(`SoundMaster: Attempted to play unknown track with id = "${id}". Skipping.`);
            return;
        }
        const audiotype = track['audiotype'];
        if (audiotype === 'sfx' && SM.limitToOneEffect && SM.currentAudioByType[audiotype] && track['priority'] < SM.currentAudioByType[audiotype]['priority'])
            return;
        SM.currentAudioByType[audiotype] = { ...track, id: id };
        SM.stop(id); // Stop previous node before creating a new one
        const playCallback = (node: AudioBufferSourceNode) => {
            SM.currentAudioNodeByType[audiotype] = node; // Track the node before playback
            SM.playNode(track, node, offset);
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

    public static get currentEffectTime(): number | null {
        const node = SM.currentAudioNodeByType['sfx'];
        if (node) {
            // Calculate true playback position
            return (node.context.currentTime - SM.nodeStartTime['sfx']) + SM.nodeStartOffset['sfx'];
        }
        return null;
    }

    public static get currentMusicTime(): number | null {
        const node = SM.currentAudioNodeByType['music'];
        if (node) {
            // Calculate true playback position
            return (node.context.currentTime - SM.nodeStartTime['music']) + SM.nodeStartOffset['music'];
        }
        return null;
    }

    public static get currentEffect(): AudioMeta2 | null {
        return SM.currentAudioByType['sfx'];
    }

    public static get currentMusic(): AudioMeta2 | null {
        return SM.currentAudioByType['music'];
    }

}
