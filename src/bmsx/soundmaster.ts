import { AudioMeta, AudioType, id2res } from "./rompack";

/* Additional Interfaces for Custom Instruments */

export interface Envelope {
    attack: number;  // seconds
    decay: number;   // seconds
    sustain: number; // level (0.0 to 1.0)
    release: number; // seconds
}

export interface VibratoParams {
    rate: number;  // vibrato frequency in Hz
    depth: number; // vibrato depth in semitones
}

export interface PitchSlideParams {
    targetFrequency: number; // in Hz, the final frequency
    duration: number;        // in seconds, how long the slide lasts
}

export interface Instrument {
    id: number;
    name: string;
    toneEnabled: boolean;
    noiseEnabled: boolean;
    envelope?: Envelope;
    vibrato?: VibratoParams;
    pitchSlide?: PitchSlideParams;
    // Optionally, you can also include step–based modulations:
    steps?: InstrumentStep[];
}

export interface InstrumentStep {
    time: number;               // Time offset in seconds
    channel: number | 'noise';  // Which “output” to affect: tone channel (0–2) or noise
    frequency?: number;         // For tone channels (Hz)
    noiseFrequency?: number;    // For noise events (Hz)
    volume?: number;            // Level (0.0 to 1.0)
    /**
     * For noise events, if provided, only the indicated channel’s noiseGain is updated.
     */
    targetChannel?: number;
}

/* Example snare instrument definition using the Instrument interface.
   In this case we produce only a noise burst on channel 2.
*/
export const snareInstrument: Instrument = {
    id: 1,
    name: "Snare",
    toneEnabled: false,
    noiseEnabled: true,
    envelope: { attack: 0.005, decay: 0.03, sustain: 0, release: 0.005 },
    steps: [
        { time: 0, channel: 'noise', targetChannel: 2, volume: 1.0, noiseFrequency: 4000 },
        { time: 0.05, channel: 'noise', targetChannel: 2, volume: 0, noiseFrequency: 4000 }
    ]
};

/* --- SM Class with Expanded PSG Emulation Using AudioWorklet Noise --- */

export class SM {
    private static limitToOneEffect: boolean = true;
    private static tracks: id2res;
    private static buffers: Record<string, AudioBuffer>;
    private static sndContext: AudioContext;
    private static currentAudioNodeByType: Record<AudioType, AudioBufferSourceNode>;
    public static currentAudioByType: Record<AudioType, AudioMeta | null>;
    private static gainNode: GainNode;

    // Full PSG channels: each has an oscillator (tone), a toneGain, a noiseGain, and a mixer.
    private static psgInitialized: boolean = false;
    private static psgChannels: {
        oscillator: OscillatorNode;
        toneGain: GainNode;
        noiseGain: GainNode;
        mixer: GainNode;
    }[] = [];
    // Global noise is now produced by an AudioWorkletNode.
    private static psgNoiseFilterNode: BiquadFilterNode;
    private static lfsrNode: AudioWorkletNode; // Reference to the worklet node.

    private static noteFrequencies: { [note: string]: number } = {
        'C2': 65.41, 'C#2': 69.30, 'D2': 73.42, 'D#2': 77.78, 'E2': 82.41,
        'F2': 87.31, 'F#2': 92.50, 'G2': 98.00, 'G#2': 103.83, 'A2': 110.00,
        'A#2': 116.54, 'B2': 123.47,
        'C3': 130.81, 'C#3': 138.59, 'D3': 146.83, 'D#3': 155.56, 'E3': 164.81,
        'F3': 174.61, 'F#3': 185.00, 'G3': 196.00, 'G#3': 207.65, 'A3': 220.00,
        'A#3': 233.08, 'B3': 246.94,
        'C4': 261.63, 'C#4': 277.18, 'D4': 293.66, 'D#4': 311.13, 'E4': 329.63,
        'F4': 349.23, 'F#4': 369.99, 'G4': 392.00, 'G#4': 415.30, 'A4': 440.00,
        'A#4': 466.16, 'B4': 493.88,
        'C5': 523.25, 'C#5': 554.37, 'D5': 587.33, 'D#5': 622.25, 'E5': 659.25,
        'F5': 698.46, 'F#5': 739.99, 'G5': 783.99, 'G#5': 830.61, 'A5': 880.00,
        'A#5': 932.33, 'B5': 987.77,
        'C6': 1046.50,
        'R': 0 // Rest
    };

    //======================================================================
    // Initialization
    //======================================================================
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

        SM.initPSG();
        await SM.initPSGWithLFSRNoise();
    }

    /**
     * Initializes the PSG emulation.
     * Creates 3 tone channels (each with oscillator, toneGain, noiseGain, mixer).
     */
    private static initPSG() {
        if (SM.psgInitialized) return;

        for (let i = 0; i < 3; i++) {
            const osc = SM.sndContext.createOscillator();
            osc.type = 'square';
            const toneGain = SM.sndContext.createGain();
            toneGain.gain.value = 0;
            const noiseGain = SM.sndContext.createGain();
            noiseGain.gain.value = 0;
            const mixer = SM.sndContext.createGain();
            toneGain.connect(mixer);
            noiseGain.connect(mixer);
            mixer.connect(SM.gainNode);
            osc.connect(toneGain);
            osc.start();
            SM.psgChannels.push({ oscillator: osc, toneGain, noiseGain, mixer });
        }
        // We remove the old random-buffer noise generator.
        SM.psgInitialized = true;
    }

    /**
     * Initializes the LFSR–based noise generator worklet.
     * Loads AYNoiseProcessor.js, creates an AudioWorkletNode,
     * and connects its output to each channel’s noiseGain.
     */
    public static async initPSGWithLFSRNoise() {
        await SM.sndContext.audioWorklet.addModule('AYNoiseProcessor.js');
        const noiseWorklet = new AudioWorkletNode(SM.sndContext, 'ay-noise-processor');
        noiseWorklet.connect(SM.gainNode); // In case no channel uses noise.
        // Now, connect the worklet output to each channel’s noiseGain:
        SM.psgChannels.forEach(ch => {
            noiseWorklet.connect(ch.noiseGain);
        });
        SM.lfsrNode = noiseWorklet;
    }

    /**
     * Sets the noise period in samples by posting a message to the worklet.
     */
    public static setNoisePeriod(periodInSamples: number) {
        SM.lfsrNode?.port.postMessage({ param: 'setNoisePeriod', value: periodInSamples });
    }

    /**
     * Sets the AY noise register.
     * The AY noise register is a 5-bit value (0..31).
     * The effective noise period (in cycles) is 16*(value+1).
     * We then compute the number of audio samples per LFSR shift.
     */
    public static setAYNoiseRegister(value: number) {
        if (!SM.lfsrNode) return;
        value = Math.max(0, Math.min(31, value));
        const AYClock = 1789000;
        const updateRate = AYClock / (16 * (value + 1));
        const spShift = SM.sndContext.sampleRate / updateRate;
        SM.lfsrNode.port.postMessage({ param: 'setNoisePeriod', value: spShift });
    }

    //======================================================================
    // PSG Channel Control
    //======================================================================
    public static setPSGChannelFrequency(channel: number, frequency: number) {
        if (!SM.psgInitialized) SM.initPSG();
        if (channel < 0 || channel > 2) {
            console.warn(`Invalid channel number: ${channel}`);
            return;
        }
        SM.psgChannels[channel].oscillator.frequency.setValueAtTime(frequency, SM.sndContext.currentTime);
    }

    public static setPSGChannelToneVolume(channel: number, volume: number) {
        if (!SM.psgInitialized) SM.initPSG();
        if (channel < 0 || channel > 2) {
            console.warn(`Invalid channel number: ${channel}`);
            return;
        }
        SM.psgChannels[channel].toneGain.gain.setValueAtTime(volume, SM.sndContext.currentTime);
    }

    public static setPSGChannelNoiseVolume(channel: number, volume: number) {
        if (!SM.psgInitialized) SM.initPSG();
        if (channel < 0 || channel > 2) {
            console.warn(`Invalid channel number: ${channel}`);
            return;
        }
        SM.psgChannels[channel].noiseGain.gain.setValueAtTime(volume, SM.sndContext.currentTime);
    }

    public static setChannelMix(channel: number, toneVolume: number, noiseVolume: number) {
        SM.setPSGChannelToneVolume(channel, toneVolume);
        SM.setPSGChannelNoiseVolume(channel, noiseVolume);
    }

    //======================================================================
    // Playback: Instruments & Sequences
    //======================================================================

    /**
     * Plays a sequence of InstrumentStep events.
     * (This is your legacy step-based instrument playback.)
     */
    public static playInstrument(
        instrumentSteps: InstrumentStep[],
        startTime?: number
    ) {
        if (!SM.psgInitialized) SM.initPSG();
        const baseTime = startTime !== undefined ? startTime : SM.sndContext.currentTime;
        instrumentSteps.forEach(step => {
            const currentTime = baseTime + step.time;
            if (step.channel === 'noise') {
                if (step.noiseFrequency !== undefined) {
                    SM.psgNoiseFilterNode.frequency.setValueAtTime(step.noiseFrequency, currentTime);
                }
                if (step.volume !== undefined) {
                    if (step.targetChannel !== undefined) {
                        SM.psgChannels[step.targetChannel].noiseGain.gain.setValueAtTime(step.volume, currentTime);
                        SM.psgChannels[step.targetChannel].noiseGain.gain.linearRampToValueAtTime(0, currentTime + 0.03);
                    } else {
                        SM.psgChannels.forEach(ch => {
                            ch.noiseGain.gain.setValueAtTime(step.volume, currentTime);
                            ch.noiseGain.gain.linearRampToValueAtTime(0, currentTime + 0.03);
                        });
                    }
                }
            } else if (typeof step.channel === 'number' && step.channel >= 0 && step.channel <= 2) {
                if (step.frequency !== undefined) {
                    SM.psgChannels[step.channel].oscillator.frequency.setValueAtTime(step.frequency, currentTime);
                }
                if (step.volume !== undefined) {
                    SM.psgChannels[step.channel].toneGain.gain.setValueAtTime(step.volume, currentTime);
                }
            } else {
                console.warn(`Invalid channel: ${step.channel}`);
            }
        });
    }

    /**
     * Plays multiple sequences on their respective channels.
     */
    public static playSequences(
        sequences: { channel: number | 'noise', sequence: { note: string; duration: number; volume?: number; frequency?: number }[] }[],
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
     * Plays a sequence of note objects.
     */
    public static playNoteSequence(
        channel: number | 'noise',
        sequence: { note: string; duration: number; volume?: number; frequency?: number }[],
        tempo: number = 120,
        startTime?: number
    ) {
        if (!SM.psgInitialized) SM.initPSG();
        const beatsPerSecond = tempo / 60;
        let currentTime = startTime !== undefined ? startTime : SM.sndContext.currentTime;
        sequence.forEach(noteObj => {
            const { note, duration, volume, frequency } = noteObj;
            const freq = frequency ?? (SM.noteFrequencies[note.toUpperCase()] || 0);
            const durationInSeconds = duration / beatsPerSecond;
            if (channel === 'noise') {
                if (note.toUpperCase() !== 'R') {
                    SM.psgNoiseFilterNode.frequency.setValueAtTime(freq || 1000, currentTime);
                    SM.psgChannels.forEach(ch => ch.noiseGain.gain.setValueAtTime(volume ?? 0.5, currentTime));
                } else {
                    SM.psgChannels.forEach(ch => ch.noiseGain.gain.setValueAtTime(0, currentTime));
                }
            } else if (typeof channel === 'number' && channel >= 0 && channel <= 2) {
                SM.psgChannels[channel].oscillator.frequency.setValueAtTime(freq, currentTime);
                if (volume !== undefined) {
                    SM.psgChannels[channel].toneGain.gain.setValueAtTime(volume, currentTime);
                } else {
                    SM.applyEnvelope(SM.psgChannels[channel].toneGain, currentTime, durationInSeconds);
                }
            } else {
                console.warn(`Invalid channel: ${channel}`);
                return;
            }
            currentTime += durationInSeconds;
        });
    }

    /**
     * Applies a simple default envelope to a GainNode.
     */
    private static applyEnvelope(gainNode: GainNode, startTime: number, duration: number) {
        let attackTime = 0.01;
        let decayTime = 0.1;
        const sustainLevel = 0.7;
        let releaseTime = 0.1;
        const totalEnvelopeTime = attackTime + decayTime + releaseTime;
        let sustainTime = duration - totalEnvelopeTime;
        if (sustainTime < 0) {
            const scale = duration / totalEnvelopeTime;
            attackTime *= scale;
            decayTime *= scale;
            releaseTime *= scale;
            sustainTime = 0;
        }
        const peakVolume = 0.5;
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(peakVolume, startTime + attackTime);
        gainNode.gain.linearRampToValueAtTime(sustainLevel * peakVolume, startTime + attackTime + decayTime);
        gainNode.gain.setValueAtTime(sustainLevel * peakVolume, startTime + attackTime + decayTime + sustainTime);
        gainNode.gain.linearRampToValueAtTime(0, startTime + attackTime + decayTime + sustainTime + releaseTime);
    }

    /**
     * Applies a custom envelope defined by an Envelope object.
     */
    private static applyEnvelopeCustom(gainNode: GainNode, startTime: number, duration: number, env: Envelope) {
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(1, startTime + env.attack);
        gainNode.gain.linearRampToValueAtTime(env.sustain, startTime + env.attack + env.decay);
        const sustainTime = duration - (env.attack + env.decay + env.release);
        if (sustainTime > 0) {
            gainNode.gain.setValueAtTime(env.sustain, startTime + env.attack + env.decay + sustainTime);
        }
        gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
    }

    /**
     * Applies vibrato to an oscillator by scheduling discrete frequency changes.
     * vibrato.depth is in semitones.
     */
    private static applyVibratoToChannel(osc: OscillatorNode, startTime: number, duration: number, vibrato: VibratoParams, baseFrequency: number) {
        const sampleInterval = 0.02;
        const numSamples = Math.floor(duration / sampleInterval);
        for (let i = 0; i <= numSamples; i++) {
            const t = i * sampleInterval;
            const mod = Math.sin(2 * Math.PI * vibrato.rate * t) * vibrato.depth;
            const modFactor = Math.pow(2, mod / 12);
            const modFrequency = baseFrequency * modFactor;
            osc.frequency.setValueAtTime(modFrequency, startTime + t);
        }
    }

    /**
     * Plays a custom instrument as defined by the Instrument interface.
     * @param instrument The custom instrument to play.
     * @param baseFrequency The base frequency for the note.
     * @param startTime Optional start time.
     * @param noteDuration Duration of the note.
     */
    public static playCustomInstrument(instrument: Instrument, baseFrequency: number, startTime?: number, noteDuration?: number) {
        if (!SM.psgInitialized) SM.initPSG();
        const t0 = startTime !== undefined ? startTime : SM.sndContext.currentTime;
        const duration = noteDuration !== undefined ? noteDuration : 1;
        const channel = 0; // For tone events, use channel 0 (this is an arbitrary choice)
        if (instrument.toneEnabled) {
            SM.psgChannels[channel].oscillator.frequency.setValueAtTime(baseFrequency, t0);
            if (instrument.envelope) {
                SM.applyEnvelopeCustom(SM.psgChannels[channel].toneGain, t0, duration, instrument.envelope);
            } else {
                SM.applyEnvelope(SM.psgChannels[channel].toneGain, t0, duration);
            }
            if (instrument.vibrato) {
                SM.applyVibratoToChannel(SM.psgChannels[channel].oscillator, t0, duration, instrument.vibrato, baseFrequency);
            }
            if (instrument.pitchSlide) {
                SM.psgChannels[channel].oscillator.frequency.linearRampToValueAtTime(
                    instrument.pitchSlide.targetFrequency,
                    t0 + instrument.pitchSlide.duration
                );
            }
        } else {
            SM.psgChannels[channel].toneGain.gain.setValueAtTime(0, t0);
        }
        if (instrument.noiseEnabled) {
            // Use channel 2 for noise (as an example).
            const noiseChannel = 2;
            SM.lfsrNode.port.postMessage({ param: 'setNoisePeriod', value: 800 }); // example period
            SM.psgChannels[noiseChannel].noiseGain.gain.setValueAtTime(1.0, t0);
            SM.psgChannels[noiseChannel].noiseGain.gain.linearRampToValueAtTime(0, t0 + 0.05);
        } else {
            SM.psgChannels.forEach(ch => ch.noiseGain.gain.setValueAtTime(0, t0));
        }
    }

    //======================================================================
    // (Methods for predecoding tracks, buffer playback, node handling, etc. remain unchanged.)
    //======================================================================
    private static predecodeTracks() {
        SM.buffers = {};
        Object.keys(SM.tracks).forEach(id => {
            SM.decode(global.rom['rom'].slice(SM.tracks[id]['start'], SM.tracks[id]['end'])).then(decoded => SM.buffers[id] = decoded);
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
