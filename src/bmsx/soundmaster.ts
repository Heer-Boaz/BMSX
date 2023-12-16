import { AudioMeta, AudioType, id2res } from "./rompack";

/**
 * The `SM` class provides a set of static methods to manage audio playback in the game.
 */
export class SM {
    /**
     * A boolean value indicating whether only one effect can be played at a time.
     * If true, playing a new effect will stop the currently playing effect.
     * If false, multiple effects can be played simultaneously.
     */
    private static limitToOneEffect: boolean = true;

    /**
     * An object containing the audio resources to be used by the `SM` class.
     */
    private static tracks: id2res;
    /**
     * An object containing the pre-decoded audio buffers for each audio track in the `SM` class.
     */
    private static buffers: Record<string, AudioBuffer>;
    /**
     * The audio context used by the `SM` class for audio playback.
     */
    private static sndContext: AudioContext;

    /**
     * The AudioBufferSourceNode currently playing the music track.
     */
    private static currentMusicNode: AudioBufferSourceNode;
    /**
     * The AudioBufferSourceNode currently playing the sound effect.
     */
    private static currentEffectNode: AudioBufferSourceNode;
    /**
     * The `AudioMeta` object representing the currently playing sound effect.
     * If no sound effect is currently playing, this value is `null`.
     */
    public static currentEffectAudio: AudioMeta | null;
    /**
     * The `AudioMeta` object representing the currently playing music track.
     * If no music track is currently playing, this value is `null`.
     */
    public static currentMusicAudio: AudioMeta | null;
    /**
     * The gain node used by the `SM` class for audio playback.
     */
    private static gainNode: GainNode;

    /**
     * Initializes the `SM` class with the given audio resources, audio context and gain node.
     * @param _audioResources An object containing the audio resources to be used by the `SM` class.
     * @param sndcontext The audio context to be used by the `SM` class.
     * @param gainnode An optional gain node to be used by the `SM` class. If not provided, a new gain node will be created and connected to the audio context destination.
     */
    public static init(_audioResources: id2res, sndcontext: AudioContext, gainnode?: GainNode) {
        SM.sndContext = sndcontext;
        SM.currentEffectAudio = null;
        SM.currentMusicAudio = null;

        SM.sndContext.resume().then(() => {
            if (!gainnode) {
                SM.gainNode = SM.sndContext.createGain();
                SM.gainNode.connect(SM.sndContext.destination);
                SM.volume = 0;
            }
        });

        SM.tracks = _audioResources;
        SM.predecodeTracks();
    }

    /**
     * Pre-decodes all audio tracks in the `SM` class and stores them in the `buffers` object.
     * This method is called during initialization of the `SM` class.
     * WARNING: Pre-decoding tracks might hog memory.
     */
    private static predecodeTracks() {
        SM.buffers = {};
        Object.keys(SM.tracks).forEach(id => {
            SM.decode(global.rom['rom'].slice(SM.tracks[id]['start'], SM.tracks[id]['end'])).then(decoded => SM.buffers[id] = decoded);
        });
    }

    /**
     * Decodes an ArrayBuffer containing audio data into an AudioBuffer.
     * @param audioData The ArrayBuffer containing the audio data to be decoded.
     * @returns A Promise that resolves with the decoded AudioBuffer.
     */
    private static async decode(audioData: ArrayBuffer): Promise<AudioBuffer> {
        if (SM.sndContext.decodeAudioData.length === 2) { // Safari
            return new Promise(resolve => {
                SM.sndContext.decodeAudioData(audioData, buffer => {
                    resolve(buffer);
                });
            });
        } else return SM.sndContext.decodeAudioData(audioData);
    }

    /**
     * Creates an AudioBufferSourceNode for the given audio track ID.
     * @param id The ID of the audio track to create a node for.
     * @returns A Promise that resolves with the created AudioBufferSourceNode.
     */
    private static async createNode(id: string): Promise<AudioBufferSourceNode> {
        // If no node is available in the pool, create a new one
        const node = SM.sndContext.createBufferSource();
        return new Promise<AudioBufferSourceNode>((resolve, reject) => {
            // WARNING! Predecoding tracks might hog memory.
            // ? Make optional when memory gets hogged?
            // SM.decode(global.rom['rom'].slice(SM.tracks[id]['start'], SM.tracks[id]['end'])).then(buffer => srcnode.buffer = buffer).then(() => resolve(srcnode))
            Promise.resolve(node.buffer = SM.buffers[id]).then(() => resolve(node))
                .catch(e => reject(e));
        });
    }

    private static nodeEndedHandler(node: AudioBufferSourceNode, type: AudioType) {
        switch (type) {
            case AudioType.effect:
                SM.currentEffectAudio = null;
                break;
            case AudioType.music:
                SM.currentMusicAudio = null;
                break;
        }
        SM.releaseNode(node);
    }

    /**
     * Connects the given AudioBufferSourceNode to the gain node and starts playback.
     * If the given AudioMeta has a loop point, the node will loop from the loop point.
     * @param _track The AudioMeta object for the track being played.
     * @param node The AudioBufferSourceNode to be played.
     */
    private static playNode(_track: AudioMeta, node: AudioBufferSourceNode): void {
        try {
            node.connect(SM.gainNode);
            if (_track['loop'] !== null) {
                node.loop = true;
                node.loopStart = _track['loop']!;
            }
            else node.loop = false;
            node.start();
            node.onended = () => SM.nodeEndedHandler(node, _track['audiotype']);
        } catch (error) {
            console.warn(error);
        }
    }

    private static releaseNode(node: AudioBufferSourceNode) {
        if (!node) return;
        node.disconnect();
        node.stop();
        node.buffer = null;
    }

    /**
     * Plays the audio track with the given ID.
     * If the track is an effect and `limitToOneEffect` is true, only the effect with the highest priority will play.
     * If another effect is currently playing and has a higher priority, the new effect will not play.
     * If the track is a music track, any currently playing music track will stop and the new track will start playing.
     * @param id The ID of the audio track to be played.
     */
    public static play(id: string): void {
        let track = SM.tracks[id]?.['audiometa'];
        if (!track) {
            console.warn(`SoundMaster: Attempted to play unknown track with id = "${id}". Skipping.`);
            return;
        }

        switch (track['audiotype']) {
            case AudioType.effect:
                if (SM.limitToOneEffect && SM.currentEffectAudio && track['priority'] < SM.currentEffectAudio['priority']) return;
                SM.stopEffect();
                SM.createNode(id).then(node => {
                    SM.currentEffectNode = node;
                    SM.currentEffectAudio = track;
                    SM.playNode(track, node);
                })
                    .catch(e => console.error(e.message));
                break;
            case AudioType.music:
                SM.stopMusic();
                SM.createNode(id).then(node => {
                    SM.currentMusicNode = node;
                    SM.currentMusicAudio = track;
                    SM.playNode(track, node);
                })
                    .catch(e => console.error(e.message));
                break;
        }
    }

    /**
     * Stops the audio track with the given ID.
     * If the track is an effect, the currently playing effect will stop.
     * If the track is a music track, the currently playing music track will stop.
     * @param id The ID of the audio track to be stopped.
     */
    private static stop(id: string): void {
        switch (SM.tracks[id]?.['audiometa']['audiotype']) {
            case AudioType.effect: SM.stopEffect(); break;
            case AudioType.music: SM.stopMusic(); break;
        }
    }

    /**
     * Stops the currently playing effect track, if there is one.
     * If there is no effect track currently playing, this method does nothing.
     */
    public static stopEffect(): void {
        try {
            if (SM.currentEffectAudio) SM.releaseNode(SM.currentEffectNode);
        } catch (e) { console.warn(e); }
        SM.currentEffectNode = null;
    }

    /**
     * Stops the currently playing music track, if there is one.
     * If there is no music track currently playing, this method does nothing.
     */
    public static stopMusic(): void {
        try {
            if (SM.currentMusicAudio) SM.releaseNode(SM.currentMusicNode);
        } catch (e) { console.warn(e); }
        SM.currentMusicNode = null;
    }

    /**
     * Pauses the audio context if it is currently running.
     * This method is asynchronous and returns immediately.
     */
    public static pause(): void {
        if (SM.sndContext.state === 'running') {
            SM.sndContext.suspend();
        }
    }

    /**
     * Resumes the audio context if it is currently suspended.
     * This method is asynchronous and returns immediately.
     */
    public static resume(): void {
        if (SM.sndContext.state === 'suspended') {
            SM.sndContext.resume();
        }
    }

    /**
     * The volume of the audio output.
     * Setting this property adjusts the gain of the audio output.
     * Getting this property returns the current gain value.
     */
    public static get volume(): number {
        return parseFloat(SM.gainNode.gain.value.toFixed(1)); // Remove unnecessary digits from float
    }

    /**
     * The volume of the audio output.
     * Setting this property adjusts the gain of the audio output.
     * Getting this property returns the current gain value.
     */
    public static set volume(_v: number) {
        let v = parseFloat(_v.toFixed(1)); // Remove unnecessary digits from float
        // SM.gainNode.gain.setValueAtTime(SM.gainNode.gain.defaultValue * v, SM.sndContext.currentTime + .0);
        SM.gainNode.gain.value = SM.gainNode.gain.defaultValue * v;
    }
}
