
/* Custom Instrument Interfaces */

export interface Envelope {
    attack: number;  // seconds
    decay: number;   // seconds
    sustain: number; // level (0.0 to 1.0)
    release: number; // seconds
}

export interface VibratoParams {
    rate: number;  // in Hz
    depth: number; // in semitones
}

export interface PitchSlideParams {
    targetFrequency: number; // final frequency in Hz
    duration: number;        // slide duration in seconds
}

/**
 * The Instrument interface defines a custom PSG instrument.
 * When noiseEnabled is true, noiseRegister (0–31) is used to update the noise clock.
 */
export interface Instrument {
    id: number;
    name: string;
    toneEnabled: boolean;
    noiseEnabled: boolean;
    envelope?: Envelope;
    vibrato?: VibratoParams;
    pitchSlide?: PitchSlideParams;
    noiseRegister?: number;  // 5-bit value (0–31) for noise period
    // Additional per-step modulation could be added later.
}

/* Example snare instrument: a percussive noise burst on channel 2. */
export const snareInstrument: Instrument = {
    id: 1,
    name: "Snare",
    toneEnabled: false,
    noiseEnabled: true,
    envelope: { attack: 0.005, decay: 0.03, sustain: 0, release: 0.005 },
    noiseRegister: 6,
};

export const pianoInstrument: Instrument = {
    id: 2,
    name: "Piano",
    toneEnabled: true,
    noiseEnabled: false,
    envelope: { attack: 0.005, decay: 0.1, sustain: 0.4, release: 0.2 },
    // vibrato and pitchSlide could be added if desired.
};

/**
 * PSG class – a simple PSG emulator using WebAudio.
 * Custom instruments (via the Instrument interface) are played with playCustomInstrument.
 */
export class PSG {
    private static sndContext: AudioContext;
    private static gainNode: GainNode;

    // PSG tone channels: each channel has an oscillator (tone), a toneGain, a noiseGain, and a mixer.
    private static psgInitialized: boolean = false;
    private static psgChannels: {
        oscillator: OscillatorNode;
        toneGain: GainNode;
        noiseGain: GainNode;
        mixer: GainNode;
    }[] = [];

    // Noise generator: a looping white-noise AudioBufferSourceNode.
    private static noiseSource: AudioBufferSourceNode;
    // We adjust its playbackRate (which emulates the noise register clock)
    // via setAYNoiseRegister.

    // Default note frequencies.
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
        'R': 0  // Rest
    };

    //======================================================================
    // Initialization
    //======================================================================
    public static async init(
        sndcontext: AudioContext,
        startingVolume: number,
        gainnode?: GainNode
    ) {
        PSG.sndContext = sndcontext;
        if (!gainnode) {
            PSG.gainNode = PSG.sndContext.createGain();
            PSG.gainNode.connect(PSG.sndContext.destination);
        } else {
            PSG.gainNode = gainnode;
        }
        PSG.gainNode.gain.value = startingVolume;
        PSG.initPSG();
        PSG.initPSGNoise();
    }

    /**
     * Initializes the PSG tone channels.
     * Creates 3 tone channels (each with an oscillator, toneGain, noiseGain, and mixer).
     */
    private static initPSG() {
        if (PSG.psgInitialized) return;
        for (let i = 0; i < 3; i++) {
            const osc = PSG.sndContext.createOscillator();
            osc.type = 'square';
            const toneGain = PSG.sndContext.createGain();
            toneGain.gain.value = 0;
            const noiseGain = PSG.sndContext.createGain();
            noiseGain.gain.value = 0;
            const mixer = PSG.sndContext.createGain();
            toneGain.connect(mixer);
            noiseGain.connect(mixer);
            mixer.connect(PSG.gainNode);
            osc.connect(toneGain);
            osc.start();
            PSG.psgChannels.push({ oscillator: osc, toneGain, noiseGain, mixer });
        }
        PSG.psgInitialized = true;
    }

    /**
     * Initializes the noise generator.
     * Creates a short white-noise buffer, loops it continuously,
     * and routes its output to each channel’s noiseGain.
     */
    private static initPSGNoise() {
        const durationSeconds = 0.1;  // 100 ms noise sample
        const sampleRate = PSG.sndContext.sampleRate;
        const frameCount = durationSeconds * sampleRate;
        const noiseBuffer = PSG.sndContext.createBuffer(1, frameCount, sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < frameCount; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        PSG.noiseSource = PSG.sndContext.createBufferSource();
        PSG.noiseSource.buffer = noiseBuffer;
        PSG.noiseSource.loop = true;
        // The playbackRate will be modulated by setAYNoiseRegister.
        PSG.noiseSource.playbackRate.value = 1.0;
        // Route noise only to each channel’s noiseGain (no global connection).
        PSG.psgChannels.forEach(ch => {
            PSG.noiseSource.connect(ch.noiseGain);
        });
        PSG.noiseSource.start();
    }

    /**
     * Sets the noise period by adjusting the playbackRate of the noise source.
     * (Higher period value means slower noise clock.)
     */
    public static setNoisePeriod(periodInSamples: number) {
        // For a default period of 800 samples, factor = default / new.
        const defaultPeriod = 800;
        const factor = defaultPeriod / periodInSamples;
        PSG.noiseSource.playbackRate.setValueAtTime(factor, PSG.sndContext.currentTime);
    }

    /**
     * Sets the AY noise register.
     * For a 5-bit value (0..31), the effective noise period (in cycles) = 16*(value+1).
     * We then compute the number of samples per noise shift and update via setNoisePeriod.
     */
    public static setAYNoiseRegister(value: number) {
        value = Math.max(0, Math.min(31, value));
        const AYClock = 1789000; // cycles per second (typical AY clock)
        const updateRate = AYClock / (16 * (value + 1));
        const spShift = PSG.sndContext.sampleRate / updateRate;
        PSG.setNoisePeriod(spShift);
    }

    //======================================================================
    // Helper Methods (Envelopes, Vibrato, Pitch Slide)
    //======================================================================
    private static applyEnvelope(gainNode: GainNode, startTime: number, duration: number) {
        // A default envelope: quick attack, decay, sustain, and release.
        let attack = 0.01, decay = 0.1, release = 0.1;
        const sustainTime = Math.max(0, duration - (attack + decay + release));
        const peak = 0.5;
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(peak, startTime + attack);
        gainNode.gain.linearRampToValueAtTime(peak * 0.7, startTime + attack + decay);
        gainNode.gain.setValueAtTime(peak * 0.7, startTime + attack + decay + sustainTime);
        gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
    }

    private static applyEnvelopeCustom(gainNode: GainNode, startTime: number, duration: number, env: Envelope) {
        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(1, startTime + env.attack);
        gainNode.gain.linearRampToValueAtTime(env.sustain, startTime + env.attack + env.decay);
        const sustainTime = Math.max(0, duration - (env.attack + env.decay + env.release));
        gainNode.gain.setValueAtTime(env.sustain, startTime + env.attack + env.decay + sustainTime);
        gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
    }

    private static applyVibratoToChannel(osc: OscillatorNode, startTime: number, duration: number, vibrato: VibratoParams, baseFrequency: number) {
        const interval = 0.02;
        const steps = Math.floor(duration / interval);
        for (let i = 0; i <= steps; i++) {
            const t = i * interval;
            const mod = Math.sin(2 * Math.PI * vibrato.rate * t) * vibrato.depth;
            const modFactor = Math.pow(2, mod / 12);
            const modFreq = baseFrequency * modFactor;
            osc.frequency.setValueAtTime(modFreq, startTime + t);
        }
    }

    //======================================================================
    // Custom Instrument Playback
    //======================================================================
    /**
     * Plays a custom instrument defined by the Instrument interface.
     * If noise is enabled, its noiseRegister is automatically applied.
     * For tone, envelope, vibrato, and pitch slide are applied.
     */
    public static playCustomInstrument(instrument: Instrument, baseFrequency: number, startTime?: number, noteDuration?: number) {
        if (!PSG.psgInitialized) PSG.initPSG();
        const t0 = startTime !== undefined ? startTime : PSG.sndContext.currentTime;
        const duration = noteDuration !== undefined ? noteDuration : 1;
        const toneChannel = 0; // Use channel 0 for tone events.
        if (instrument.toneEnabled) {
            PSG.psgChannels[toneChannel].oscillator.frequency.setValueAtTime(baseFrequency, t0);
            if (instrument.envelope) {
                PSG.applyEnvelopeCustom(PSG.psgChannels[toneChannel].toneGain, t0, duration, instrument.envelope);
            } else {
                PSG.applyEnvelope(PSG.psgChannels[toneChannel].toneGain, t0, duration);
            }
            if (instrument.vibrato) {
                PSG.applyVibratoToChannel(PSG.psgChannels[toneChannel].oscillator, t0, duration, instrument.vibrato, baseFrequency);
            }
            if (instrument.pitchSlide) {
                PSG.psgChannels[toneChannel].oscillator.frequency.linearRampToValueAtTime(
                    instrument.pitchSlide.targetFrequency,
                    t0 + instrument.pitchSlide.duration
                );
            }
        } else {
            PSG.psgChannels[toneChannel].toneGain.gain.setValueAtTime(0, t0);
        }
        if (instrument.noiseEnabled) {
            // Automatically set the noise register.
            const noiseReg = instrument.noiseRegister !== undefined ? instrument.noiseRegister : 6;
            PSG.setAYNoiseRegister(noiseReg);
            // Use channel 2 for noise as an example.
            const noiseChannel = 2;
            PSG.psgChannels[noiseChannel].noiseGain.gain.setValueAtTime(1.0, t0);
            PSG.psgChannels[noiseChannel].noiseGain.gain.linearRampToValueAtTime(0, t0 + 0.05);
        } else {
            PSG.psgChannels.forEach(ch => ch.noiseGain.gain.setValueAtTime(0, t0));
        }
    }

    // NEW: playSong() schedules a series of note events using a custom instrument.
    // Each event specifies a note (as a string) and a duration (in seconds).
    public static playSong(
        song: { note: string; duration: number }[],
        instrument: Instrument,
        startTime?: number
    ) {
        let t = startTime !== undefined ? startTime : PSG.sndContext.currentTime;
        for (const event of song) {
            // Look up the frequency from the noteFrequencies mapping.
            const freq = PSG.noteFrequencies[event.note.toUpperCase()];
            if (freq === undefined) {
                console.warn(`Note "${event.note}" not found in noteFrequencies.`);
                continue;
            }
            // Use playCustomInstrument to schedule the note.
            PSG.playCustomInstrument(instrument, freq, t, event.duration);
            t += event.duration;
        }
    }

    //======================================================================
    // Utility: Pause/Resume & Volume
    //======================================================================
    public static pause(): void {
        if (PSG.sndContext.state === "running") PSG.sndContext.suspend();
    }
    public static resume(): void {
        if (PSG.sndContext.state === "suspended") PSG.sndContext.resume();
    }
    public static get volume(): number {
        return PSG.gainNode.gain.value;
    }
    public static set volume(v: number) {
        PSG.gainNode.gain.value = v;
    }
}
