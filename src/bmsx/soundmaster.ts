import { AudioMeta, AudioType, id2res } from "./rompack";

interface InstrumentStep {
    time: number; // Time offset in seconds
    channel: number | 'noise';
    frequency?: number; // For tone channels
    noiseFrequency?: number; // For noise channel
    volume?: number; // Volume level (0.0 to 1.0)
}

// @ts-ignore
export const snareInstrument: InstrumentStep[] = [
    // Start with a burst of noise and a low-frequency tone
    { time: 0, channel: 'noise', volume: 0.8, noiseFrequency: 4000 },
    { time: 0, channel: 2, frequency: 200, volume: 0.5 },

    // Decay over time
    { time: 0.05, channel: 'noise', volume: 0.6, noiseFrequency: 3500 },
    { time: 0.05, channel: 2, frequency: 180, volume: 0.4 },

    { time: 0.1, channel: 'noise', volume: 0.4, noiseFrequency: 3000 },
    { time: 0.1, channel: 2, frequency: 160, volume: 0.3 },

    { time: 0.15, channel: 'noise', volume: 0.2, noiseFrequency: 2500 },
    { time: 0.15, channel: 2, frequency: 140, volume: 0.2 },

    // End of the sound
    { time: 0.2, channel: 'noise', volume: 0, noiseFrequency: 2000 },
    { time: 0.2, channel: 2, volume: 0 },
];

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
     * The AudioBufferSourceNode currently playing the sound effect.
     */
    private static currentAudioNodeByType: Record<AudioType, AudioBufferSourceNode>;
    /**
     * The `AudioMeta` object representing the currently playing sound effect.
     * If no sound effect is currently playing, this value is `null`.
     */
    public static currentAudioByType: Record<AudioType, AudioMeta | null>;
    /**
     * The gain node used by the `SM` class for audio playback.
     */
    private static gainNode: GainNode;

    private static psgInitialized: boolean = false;
    private static psgChannels: { oscillator: OscillatorNode; gainNode: GainNode }[] = [];
    private static psgNoiseNode: AudioBufferSourceNode;
    private static psgNoiseGainNode: GainNode;
    private static psgNoiseFilterNode: BiquadFilterNode;

    private static noteFrequencies: { [note: string]: number } = {
        'C2': 65.41,
        'C#2': 69.30,
        'D2': 73.42,
        'D#2': 77.78,
        'E2': 82.41,
        'F2': 87.31,
        'F#2': 92.50,
        'G2': 98.00,
        'G#2': 103.83,
        'A2': 110.00,
        'A#2': 116.54,
        'B2': 123.47,
        'C3': 130.81,
        'C#3': 138.59,
        'D3': 146.83,
        'D#3': 155.56,
        'E3': 164.81,
        'F3': 174.61,
        'F#3': 185.00,
        'G3': 196.00,
        'G#3': 207.65,
        'A3': 220.00,
        'A#3': 233.08,
        'B3': 246.94,
        'C4': 261.63,
        'C#4': 277.18,
        'D4': 293.66,
        'D#4': 311.13,
        'E4': 329.63,
        'F4': 349.23,
        'F#4': 369.99,
        'G4': 392.00,
        'G#4': 415.30,
        'A4': 440.00,
        'A#4': 466.16,
        'B4': 493.88,
        'C5': 523.25,
        'C#5': 554.37,
        'D5': 587.33,
        'D#5': 622.25,
        'E5': 659.25,
        'F5': 698.46,
        'F#5': 739.99,
        'G5': 783.99,
        'G#5': 830.61,
        'A5': 880.00,
        'A#5': 932.33,
        'B5': 987.77,
        'C6': 1046.50,
        'C#6': 1108.73,
        'D6': 1174.66,
        'D#6': 1244.51,
        'E6': 1318.51,
        'F6': 1396.91,
        'F#6': 1479.98,
        'G6': 1567.98,
        'G#6': 1661.22,
        'A6': 1760.00,
        'A#6': 1864.66,
        'B6': 1975.53,
        'C7': 2093.00,
        'C#7': 2217.46,
        'D7': 2349.32,
        'D#7': 2489.02,
        'E7': 2637.02,
        'F7': 2793.83,
        'F#7': 2959.96,
        'G7': 3135.96,
        'G#7': 3322.44,
        'A7': 3520.00,
        'A#7': 3729.31,
        'B7': 3951.07,
        'C8': 4186.01,
        'R': 0, // Rest
    };

    /**
     * Initializes the `SM` class with the given audio resources, audio context and gain node.
     * Also initializes the PSG emulation.
     * @param _audioResources An object containing the audio resources to be used by the `SM` class.
     * @param sndcontext The audio context to be used by the `SM` class.
     * @param gainnode An optional gain node to be used by the `SM` class. If not provided, a new gain node will be created and connected to the audio context destination.
     */
    public static async init(
        _audioResources: id2res,
        sndcontext: AudioContext,
        startingVolume: number,
        gainnode?: GainNode
    ) {
        SM.sndContext = sndcontext;
        SM.currentAudioByType = { sfx: null, music: null };
        SM.currentAudioNodeByType = { sfx: null, music: null };

        // Initialize tracks and buffers
        SM.tracks = _audioResources;
        SM.predecodeTracks();

        // Resume the audio context and initialize gain nodes
        await SM.sndContext.resume();

        if (!gainnode) {
            SM.gainNode = SM.sndContext.createGain();
            SM.gainNode.connect(SM.sndContext.destination);
        } else {
            SM.gainNode = gainnode;
        }
        SM.volume = startingVolume ?? 0;

        // Initialize PSG emulation AFTER gainNode has been set up
        SM.initPSG();
    }

    /**

     * Initializes the PSG emulation by setting up oscillators and gain nodes for each channel.
     */
    private static initPSG() {
        if (SM.psgInitialized) return;

        // Initialize PSG channels (A, B, C)
        for (let i = 0; i < 3; i++) {
            const osc = SM.sndContext.createOscillator();
            osc.type = 'square'; // AY-3-8910 uses square waves
            const gain = SM.sndContext.createGain();
            gain.gain.value = 0; // Start with volume at 0
            osc.connect(gain);
            gain.connect(SM.gainNode);
            osc.start();
            SM.psgChannels.push({ oscillator: osc, gainNode: gain });
        }

        // Initialize noise generator
        const bufferSize = 2 * SM.sndContext.sampleRate;
        const noiseBuffer = SM.sndContext.createBuffer(1, bufferSize, SM.sndContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }

        const noiseNode = SM.sndContext.createBufferSource();
        noiseNode.buffer = noiseBuffer;
        noiseNode.loop = true;
        const noiseGain = SM.sndContext.createGain();
        noiseGain.gain.value = 0; // Start with volume at 0

        // Create a bandpass filter to simulate noise frequency control
        const noiseFilter = SM.sndContext.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = 1000; // Default frequency
        SM.psgNoiseFilterNode = noiseFilter;

        noiseNode.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(SM.gainNode);
        noiseNode.start();

        SM.psgNoiseNode = noiseNode;
        SM.psgNoiseGainNode = noiseGain;

        SM.psgInitialized = true;
    }

    /**
     * Sets the frequency of the specified PSG channel (0, 1, or 2).
     * @param channel The channel number (0, 1, or 2).
     * @param frequency The frequency in Hz.
     */
    public static setPSGChannelFrequency(channel: number, frequency: number) {
        if (!SM.psgInitialized) SM.initPSG();
        if (channel < 0 || channel > 2) {
            console.warn(`Invalid channel number: ${channel}`);
            return;
        }
        SM.psgChannels[channel].oscillator.frequency.setValueAtTime(frequency, SM.sndContext.currentTime);
    }

    /**
     * Sets the volume of the specified PSG channel (0, 1, or 2).
     * @param channel The channel number (0, 1, or 2).
     * @param volume The volume (0.0 to 1.0).
     */
    public static setPSGChannelVolume(channel: number, volume: number) {
        if (!SM.psgInitialized) SM.initPSG();
        if (channel < 0 || channel > 2) {
            console.warn(`Invalid channel number: ${channel}`);
            return;
        }
        SM.psgChannels[channel].gainNode.gain.setValueAtTime(volume, SM.sndContext.currentTime);
    }

    /**
     * Sets the noise volume.
     * @param volume The volume (0.0 to 1.0).
     */
    public static setPSGNoiseVolume(volume: number) {
        if (!SM.psgInitialized) SM.initPSG();
        SM.psgNoiseGainNode.gain.setValueAtTime(volume, SM.sndContext.currentTime);
    }

    /**
     * Stops the PSG emulation.
     */
    public static stopPSG() {
        if (!SM.psgInitialized) return;

        // Stop oscillators and disconnect nodes
        for (let i = 0; i < 3; i++) {
            SM.psgChannels[i].oscillator.stop();
            SM.psgChannels[i].oscillator.disconnect();
            SM.psgChannels[i].gainNode.disconnect();
        }
        SM.psgChannels = [];

        // Stop noise generator
        SM.psgNoiseNode.stop();
        SM.psgNoiseNode.disconnect();
        SM.psgNoiseGainNode.disconnect();

        SM.psgNoiseNode = null;
        SM.psgNoiseGainNode = null;

        SM.psgInitialized = false;
    }

    /**
     * Plays an instrument by scheduling parameter changes over time.
     * @param instrumentSteps An array of InstrumentStep defining the instrument.
     * @param startTime The time to start the instrument (optional).
     */
    public static playInstrument(
        instrumentSteps: InstrumentStep[],
        startTime?: number
    ) {
        if (!SM.psgInitialized) SM.initPSG();

        const baseTime = startTime !== undefined ? startTime : SM.sndContext.currentTime;

        instrumentSteps.forEach((step) => {
            const currentTime = baseTime + step.time;

            if (step.channel === 'noise') {
                if (step.volume !== undefined) {
                    SM.psgNoiseGainNode.gain.setValueAtTime(step.volume, currentTime);
                }
                if (step.noiseFrequency !== undefined && SM.psgNoiseFilterNode) {
                    SM.psgNoiseFilterNode.frequency.setValueAtTime(step.noiseFrequency, currentTime);
                }
            } else if (typeof step.channel === 'number' && step.channel >= 0 && step.channel <= 2) {
                if (step.frequency !== undefined) {
                    SM.psgChannels[step.channel].oscillator.frequency.setValueAtTime(
                        step.frequency,
                        currentTime
                    );
                }
                if (step.volume !== undefined) {
                    SM.psgChannels[step.channel].gainNode.gain.setValueAtTime(
                        step.volume,
                        currentTime
                    );
                }
            } else {
                console.warn(`Invalid channel: ${step.channel}`);
            }
        });
    }

    /**
     * Plays multiple sequences on their respective PSG channels.
     * @param sequences An array of objects, each containing a channel and a sequence of notes.
     * @param tempo The tempo in beats per minute (optional, default is 120 BPM).
     * @param startTime The start time for playback (optional).
     */
    public static playSequences(
        sequences: {
            channel: number | 'noise',
            sequence: { note: string; duration: number }[]
        }[],
        tempo: number = 120,
        startTime?: number
    ) {
        if (!SM.psgInitialized) SM.initPSG();

        const sharedStartTime = startTime !== undefined ? startTime : SM.sndContext.currentTime;

        sequences.forEach(({ channel, sequence }) => {
            SM.playNoteSequence(channel, sequence, tempo, sharedStartTime);
        });
    }

    /**
     * Plays a sequence of notes on a specified PSG channel.
     * @param channel The PSG channel number (0, 1, 2 for tone, 'noise' for noise channel).
     * @param sequence An array of note objects with 'note' and 'duration' properties.
     * @param tempo The tempo in beats per minute (optional, default is 120 BPM).
     */
    public static playNoteSequence(
        channel: number | 'noise',
        sequence: { note: string; duration: number }[],
        tempo: number = 120,
        startTime?: number
    ) {
        if (!SM.psgInitialized) SM.initPSG();

        const beatsPerSecond = tempo / 60;
        let currentTime = SM.sndContext.currentTime + (startTime ?? 0);

        sequence.forEach((noteObj) => {
            const { note, duration } = noteObj;
            const frequency = SM.noteFrequencies[note.toUpperCase()] || 0;
            const durationInSeconds = duration / beatsPerSecond;

            if (channel === 'noise') {
                // Schedule noise volume
                if (note.toUpperCase() !== 'R') {
                    SM.psgNoiseGainNode.gain.setValueAtTime(
                        0.5,
                        currentTime
                    );
                    // Optionally, vary the noise characteristics here
                } else {
                    SM.psgNoiseGainNode.gain.setValueAtTime(0, currentTime);
                }
                // Schedule the end of the note
                SM.psgNoiseGainNode.gain.setValueAtTime(
                    0,
                    currentTime + durationInSeconds
                );
            } else if (typeof channel === 'number' && channel >= 0 && channel <= 2) {
                // Schedule the note
                SM.psgChannels[channel].oscillator.frequency.setValueAtTime(
                    frequency,
                    currentTime
                );

                if (frequency > 0) {
                    // Apply envelope to the gain node
                    SM.applyEnvelope(
                        SM.psgChannels[channel].gainNode,
                        currentTime,
                        durationInSeconds
                    );
                } else {
                    // It's a rest; ensure gain is zero
                    SM.psgChannels[channel].gainNode.gain.setValueAtTime(
                        0,
                        currentTime
                    );
                }
            } else {
                console.warn(`Invalid channel: ${channel}`);
                return;
            }

            currentTime += durationInSeconds;
        });
    }

    /**
     * Applies a simple volume envelope to the gain node.
     * @param gainNode The gain node to apply the envelope to.
     * @param startTime The time to start the envelope.
     * @param duration The duration of the note.
     */
    private static applyEnvelope(
        gainNode: GainNode,
        startTime: number,
        duration: number
    ) {
        let attackTime = 0.01; // 10 ms attack
        let decayTime = 0.1; // 100 ms decay
        const sustainLevel = 0.7; // Sustain at 70% volume
        let releaseTime = 0.1; // 100 ms release

        const totalEnvelopeTime = attackTime + decayTime + releaseTime;
        let sustainTime = duration - totalEnvelopeTime;

        if (sustainTime < 0) {
            // Adjust times proportionally
            const scale = duration / totalEnvelopeTime;
            attackTime *= scale;
            decayTime *= scale;
            releaseTime *= scale;
            sustainTime = 0;
        }

        const peakVolume = 0.5;

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(
            peakVolume,
            startTime + attackTime
        );
        gainNode.gain.linearRampToValueAtTime(
            sustainLevel * peakVolume,
            startTime + attackTime + decayTime
        );
        gainNode.gain.setValueAtTime(
            sustainLevel * peakVolume,
            startTime + attackTime + decayTime + sustainTime
        );
        gainNode.gain.linearRampToValueAtTime(
            0,
            startTime +
            attackTime +
            decayTime +
            sustainTime +
            releaseTime
        );
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
        SM.currentAudioByType[type] = null;
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
        if (!node) {
            console.warn(`SoundMaster: Attempted to release null node. Skipping.`);
            return;
        }
        node.stop();
        node.disconnect();
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
        const track = SM.tracks[id]?.['audiometa'];
        if (!track) {
            console.warn(`SoundMaster: Attempted to play unknown track with id = "${id}". Skipping.`);
            return;
        }
        const audiotype = track['audiotype'];
        if (audiotype === 'sfx' && SM.limitToOneEffect && SM.currentAudioByType[audiotype] && track['priority'] < SM.currentAudioByType[audiotype]['priority']) return;
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

    /**
     * Stops the audio track with the given ID.
     * If the track is an effect, the currently playing effect will stop.
     * If the track is a music track, the currently playing music track will stop.
     * @param id The ID of the audio track to be stopped.
     */
    // @ts-ignore
    private static stop(id: string): void {
        const audiotype = SM.tracks[id]?.['audiometa']['audiotype'];
        SM.stopByType(audiotype);
    }

    /**
     * Stops the currently playing effect track, if there is one.
     * If there is no effect track currently playing, this method does nothing.
     */
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

    /**
     * Stops the currently playing music track, if there is one.
     * If there is no music track currently playing, this method does nothing.
     */
    public static stopMusic(): void {
        SM.stopByType('music');
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
