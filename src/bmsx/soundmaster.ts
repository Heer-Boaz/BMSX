import { AudioMeta, AudioType, id2res } from "./rompack";

export class SM {
    private static limitToOneEffect: boolean = true;
    private static tracks: id2res;
    private static buffers: Record<string, AudioBuffer>;
    private static sndContext: AudioContext;
    private static currentAudioNodeByType: Record<AudioType, AudioBufferSourceNode>;
    public static currentAudioByType: Record<AudioType, AudioMeta | null>;
    private static gainNode: GainNode;

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
        SM.currentAudioByType[type] = null;
        SM.releaseNode(node);
    }

    private static playNode(_track: AudioMeta, node: AudioBufferSourceNode): void {
        try {
            node.connect(SM.gainNode);
            if (_track['loop'] !== null) {
                node.loop = true;
                node.loopStart = _track['loop']!;
            } else {
                node.loop = false;
            }
            node.start();
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

    public static play(id: string): void {
        const track = SM.tracks[id]?.['audiometa'];
        if (!track) {
            console.warn(`SoundMaster: Attempted to play unknown track with id = "${id}". Skipping.`);
            return;
        }
        const audiotype = track['audiotype'];
        if (audiotype === 'sfx' && SM.limitToOneEffect && SM.currentAudioByType[audiotype] && track['priority'] < SM.currentAudioByType[audiotype]['priority'])
            return;
        SM.currentAudioByType[audiotype] = track;
        const playCallback = (node: AudioBufferSourceNode) => {
            SM.stop(id);
            SM.playNode(track, node);
            SM.currentAudioNodeByType[audiotype] = node;
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
}
