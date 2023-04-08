// type Note = {
//     pitch: string;
//     duration: number;
// };

// class SimpleABCParser {
//     private static pitchRegex = /[A-Ga-g][',]?/g;
//     private static durationRegex = /\d*(?=\/\d)/g;
//     private static fractionRegex = /\d*(?=\/)/g;

//     public static parse(abcNotation: string): Note[] {
//         const notes = abcNotation.match(/([A-Ga-g]z|[\]^_]?[A-Ga-g][',]*[0-9]?\/?[0-9]?)/g) || [];
//         return notes.map(note => {
//             const isPercussion = note[1] === 'z';
//             const pitch = isPercussion ? note[0] : note;
//             const durationMatch = note.match(/[0-9]+\/?[0-9]+/) || ['1'];
//             const duration = Number(durationMatch[0]) || 1;
//             return { pitch, duration, isPercussion };
//         });
//     }

//     private static extractPitches(abcNotation: string): string[] {
//         return Array.from(abcNotation.matchAll(SimpleABCParser.pitchRegex)).map(m => m[0]);
//     }

//     private static extractDurations(abcNotation: string): number[] {
//         const rawDurations = Array.from(abcNotation.matchAll(SimpleABCParser.durationRegex)).map(m => m[0]);
//         const fractions = rawDurations.map(d => d.match(SimpleABCParser.fractionRegex)).map(m => m ? parseInt(m[0]) : 1);
//         return fractions.map(f => 1 / f);
//     }

//     public static pitchToFrequency(pitch: string): number {
//         const noteFrequencies = {
//             "C": 261.63,
//             "D": 293.66,
//             "E": 329.63,
//             "F": 349.23,
//             "G": 392.00,
//             "A": 440.00,
//             "B": 493.88,
//         };

//         const octave = pitch.toUpperCase() === pitch ? 4 : 5;
//         const baseFrequency = noteFrequencies[pitch.toUpperCase()];

//         return baseFrequency * Math.pow(2, octave - 4);
//     }
// }

// // export default SimpleABCParser;

// const SCCWaveTable = {
//     WaveForms: [
//         // Simple sine wave
//         // new Array(256).fill(0).map((_, i) => 128 * Math.sin((2 * Math.PI * i) / 256)),
//         new Int8Array(32).fill(0).map((_, i) => (i < 16 ? 127 : -128)),
//     ],
// };

// class MSXSound {
//     private audioContext: AudioContext;
//     private psgGain: GainNode;
//     private sccGain: GainNode;
//     private psgOscillators: OscillatorNode[] = [];
//     private sccChannels: {
//         bufferSource: AudioBufferSourceNode;
//         gainNode: GainNode;
//         channelData: Float32Array;
//     }[];

//     constructor(sndcontext: AudioContext) {
//         this.audioContext = sndcontext;
//         this.psgGain = this.audioContext.createGain();
//         this.sccGain = this.audioContext.createGain();
//         this.psgGain.connect(this.audioContext.destination);
//         this.sccGain.connect(this.audioContext.destination);

//         // Initialize the 5 SCC channels
//         this.sccChannels = new Array(5).fill(null).map(() => {
//             const buffer = this.audioContext.createBuffer(1, 32, this.audioContext.sampleRate);
//             const channelData = buffer.getChannelData(0);

//             const bufferSource = this.audioContext.createBufferSource();
//             bufferSource.buffer = buffer;
//             bufferSource.loop = true;

//             const gainNode = this.audioContext.createGain();
//             bufferSource.connect(gainNode);

//             return { bufferSource, gainNode, channelData };
//         });

//         // Connect SCC channels to the main gain node
//         this.sccChannels.forEach(channel => {
//             channel.gainNode.connect(this.sccGain);
//         });
//     }

//     public playABC(abcNotation: string, tempo: number) {
//         const notes = SimpleABCParser.parse(abcNotation);

//         const noteData = notes.map(note => {
//             const frequency = SimpleABCParser.pitchToFrequency(note.pitch);
//             const duration = note.duration * (60 / tempo);
//             const isPercussion = note.pitch.toUpperCase() === 'C'; // Treat the "C" note as percussion
//             return { frequency, duration, isPercussion };
//         });

//         this.playNotes(noteData);
//     }

//     private playNotes(notes: { frequency: number; duration: number; isPercussion: boolean; }[]) {
//         let startTime = this.audioContext.currentTime;

//         notes.forEach((note, index) => {
//             const channelIndex = index % 5;
//             const waveform = new Int8Array(32).fill(0).map((_, i) => (i < 16 ? 127 : -128));

//             if (note.isPercussion) {
//                 const frequency = 200; // Fixed frequency for percussion
//                 const volume = 5; // Set lower volume for percussion
//                 this.playPSG(frequency, note.duration, startTime, volume, true);
//             } else {
//                 const volume = 15; // Set default volume for non-percussion notes
//                 this.playSCC(channelIndex, waveform, note.frequency, note.duration, startTime, volume);
//             }
//             startTime += note.duration;
//         });
//     }

//     private playPSG(
//         frequency: number,
//         duration: number,
//         startTime: number,
//         volume: number,
//         noise: boolean = false
//     ) {
//         const oscillator = this.audioContext.createOscillator();
//         const gainNode = this.audioContext.createGain();

//         oscillator.type = noise ? 'square' : 'sawtooth';
//         oscillator.frequency.setValueAtTime(frequency, startTime);

//         gainNode.gain.setValueAtTime(1, startTime);
//         gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

//         oscillator.connect(gainNode);
//         gainNode.connect(this.psgGain);

//         oscillator.start(startTime);
//         oscillator.stop(startTime + duration);

//         // Disconnect the oscillator after it has finished playing
//         oscillator.onended = () => {
//             oscillator.disconnect(gainNode);
//             gainNode.disconnect(this.psgGain);
//         };
//     }

//     private playSCC(
//         channelIndex: number,
//         waveform: Int8Array,
//         frequency: number,
//         duration: number,
//         startTime: number,
//         volume: number
//     ) {
//         if (!Number.isFinite(frequency) || frequency <= 0) {
//             console.warn('Invalid frequency value:', frequency);
//             return;
//         }
//         const { gainNode, channelData } = this.sccChannels[channelIndex];

//         // Create a new buffer source each time the playSCC function is called
//         const bufferSource = this.audioContext.createBufferSource();
//         const buffer = this.audioContext.createBuffer(1, 32, this.audioContext.sampleRate);

//         for (let i = 0; i < waveform.length; i++) {
//             channelData[i] = waveform[i] / 128;
//         }

//         buffer.copyToChannel(channelData, 0);
//         bufferSource.buffer = buffer;
//         bufferSource.loop = true;
//         bufferSource.playbackRate.setValueAtTime((3579545 / 32) / frequency, startTime);

//         gainNode.gain.setValueAtTime(volume / 15, startTime);
//         gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

//         bufferSource.connect(gainNode);
//         bufferSource.start(startTime);
//         bufferSource.stop(startTime + duration);

//         // Disconnect the buffer source after it has finished playing
//         bufferSource.onended = () => {
//             bufferSource.disconnect(gainNode);
//         };
//     }
// }

// // export default MSXSound;

// const context: AudioContext = new AudioContext({
//     latencyHint: 'interactive',
//     sampleRate: 44100,
// }) as AudioContext;

// const msxSound = new MSXSound(context);

// // const abcNotation = `
// // X:1
// // T:Example
// // M:4/4
// // L:1/4
// // Q:1/4=120
// // K:C
// // C D E F | G A B c | d e f g | a b c' d' |
// // `;
// const abcNotation = "XzC/2D/2E/2F/2G/2A/2B/2c/2d/2e/2";

// msxSound.playABC(abcNotation, 120);

// class MSXSound {
//     private channels: { [key: number]: { mml: string; index: number; octave: number; defaultLength: number, volume: number; }; };
//     private tempo: number;
//     private audioContext: AudioContext;
//     private oscillators: { [key: number]: OscillatorNode; };
//     private gainers: { [key: number]: GainNode; };

//     constructor() {
//         this.channels = {
//             1: { mml: "", index: 0, octave: 4, defaultLength: 4, volume: 15 },
//             2: { mml: "", index: 0, octave: 4, defaultLength: 4, volume: 15 },
//         };
//         this.tempo = 120;
//         this.audioContext = new AudioContext();
//         this.oscillators = {};
//         this.gainers = {};
//     }

//     public playMML(channel: number, mml: string): void {
//         this.channels[channel].mml = mml;
//         this.channels[channel].index = 0;
//         this.processMML(channel);
//     }

//     private processMML(channel: number): void {
//         const ch = this.channels[channel];
//         if (ch.index >= ch.mml.length) return;

//         const command = ch.mml[ch.index++];
//         let value = "";
//         while (ch.index < ch.mml.length && !isNaN(parseInt(ch.mml[ch.index], 10))) {
//             value += ch.mml[ch.index++];
//         }

//         switch (command) {
//             case "o":
//                 ch.octave = parseInt(value, 10);
//                 break;
//             case "l":
//                 ch.defaultLength = parseInt(value, 10);
//                 break;
//             case "t":
//                 this.tempo = parseInt(value, 10);
//                 break;
//             case "c":
//             case "d":
//             case "e":
//             case "f":
//             case "g":
//             case "a":
//             case "b":
//                 const noteLength = value === "" ? ch.defaultLength : parseInt(value, 10);
//                 this.playNote(channel, command, ch.octave, noteLength);
//                 break;
//             case "r":
//                 const restLength = value === "" ? ch.defaultLength : parseInt(value, 10);
//                 this.rest(channel, restLength);
//                 break;
//             // For volume control, add a case for the 'v' command:
//             case 'v':
//                 const volume = parseInt(value);
//                 this.channels[channel].volume = volume;
//                 break;
//         }

//         const delay = 60 / this.tempo;
//         setTimeout(() => this.processMML(channel), delay * 1000);
//     }

//     private setVolume(channel: number, volume: number): void {
//         if (!this.gainers[channel]) {
//             const gainNode = this.audioContext.createGain();
//             this.gainers[channel] = gainNode;
//             this.oscillators[channel]?.connect(gainNode);
//             gainNode.connect(this.audioContext.destination);
//         }
//         this.gainers[channel].gain.setValueAtTime(this.channels[channel].volume / 15, this.audioContext.currentTime);
//     }

//     private playNote(channel: number, note: string, octave: number, length: number): void {
//         const frequency = this.noteToFrequency(note, octave);
//         const duration = this.lengthToDuration(length);

//         const oscillator = this.audioContext.createOscillator();
//         oscillator.type = "square";
//         oscillator.frequency.value = frequency;
//         // oscillator.connect(this.audioContext.destination);
//         this.oscillators[channel] = oscillator;
//         this.setVolume(channel, this.channels[channel].volume);

//         oscillator.start();


//         setTimeout(() => {
//             oscillator.stop();
//             this.oscillators[channel] = null;
//         }, duration * 1000);
//     }

//     private rest(channel: number, length: number): void {
//         if (this.oscillators[channel]) {
//             this.oscillators[channel].stop();
//             this.oscillators[channel] = null;
//         }

//         const duration = this.lengthToDuration(length);
//         setTimeout(() => {
//             this.processMML(channel);
//         }, duration * 1000);
//     }

//     private noteToFrequency(note: string, octave: number): number {
//         const noteToSemitone: { [key: string]: number; } = {
//             c: 0,
//             d: 2,
//             e: 4,
//             f: 5,
//             g: 7,
//             a: 9,
//             b: 11,
//         };
//         const semitone = noteToSemitone[note] + octave * 12;
//         const frequency = 440 * Math.pow(2, (semitone - 69) / 12);

//         return frequency;
//     }

//     private lengthToDuration(length: number): number {
//         const duration = (4 / length) * (60 / this.tempo);
//         return duration;
//     }
// }

// // Usage example:
// const msxSound = new MSXSound();
// msxSound.playMML(1, "v15t180l16o5g16a32g16a32g16a32g16a32g16a32g16a32g16a32g16a32");
// msxSound.playMML(2, "v1t180l4o3g1.&g2.&g1.&g2.&g1.&g2.&g1.&g2.");

// class MSXSound {
//     private channels: {
//         [key: number]: {
//             mml: string;
//             index: number;
//             octave: number;
//             defaultLength: number;
//             volume: number;
//         };
//     };
//     private tempo: number;
//     private audioContext: AudioContext;
//     private oscillators: { [key: number]: OscillatorNode; };
//     private gainers: { [key: number]: GainNode; };

//     constructor() {
//         this.channels = {
//             1: { mml: "", index: 0, octave: 4, defaultLength: 4, volume: 15 },
//             2: { mml: "", index: 0, octave: 4, defaultLength: 4, volume: 15 },
//         };
//         this.tempo = 120;
//         this.audioContext = new AudioContext();
//         this.oscillators = {};
//         this.gainers = {};
//     }

//     public playMML(channel: number, mml: string): void {
//         this.channels[channel].mml = mml;
//         this.channels[channel].index = 0;
//         this.processMML(channel);
//     }

//     private processMML(channel: number): void {
//         const ch = this.channels[channel];
//         if (ch.index >= ch.mml.length) return;

//         const command = ch.mml[ch.index++];
//         let value = "";
//         while (ch.index < ch.mml.length && !isNaN(parseInt(ch.mml[ch.index], 10))) {
//             value += ch.mml[ch.index++];
//         }

//         switch (command) {
//             case "o":
//                 ch.octave = parseInt(value, 10);
//                 break;
//             case "l":
//                 ch.defaultLength = parseInt(value, 10);
//                 break;
//             case "t":
//                 this.tempo = parseInt(value, 10);
//                 break;
//             case "c":
//             case "d":
//             case "e":
//             case "f":
//             case "g":
//             case "a":
//             case "b":
//                 const noteLength = value === "" ? ch.defaultLength : parseInt(value, 10);
//                 this.playNote(channel, command, ch.octave, noteLength);
//                 break;
//             case "r":
//                 const restLength = value === "" ? ch.defaultLength : parseInt(value, 10);
//                 this.rest(channel, restLength);
//                 break;
//             case "v":
//                 const volume = parseInt(value);
//                 // Make sure the volume value is between 0 and 15:
//                 this.channels[channel].volume = Math.min(Math.max(volume, 0), 15);
//                 this.setVolume(channel, this.channels[channel].volume);
//                 break;
//         }

//         const delay = 60 / this.tempo;
//         setTimeout(() => this.processMML(channel), delay * 1000);
//     }

//     private setVolume(channel: number, volume: number): void {
//         if (!this.gainers[channel]) {
//             const gainNode = this.audioContext.createGain();
//             this.gainers[channel] = gainNode;
//             this.oscillators[channel]?.connect(gainNode);
//             gainNode.connect(this.audioContext.destination);
//         }
//         // Set the gain value according to the volume value:
//         this.gainers[channel].gain.setValueAtTime(volume / 15, this.audioContext.currentTime);
//     }

//     private playNote(channel: number, note: string, octave: number, length: number): void {
//         const frequency = this.noteToFrequency(note, octave);
//         const duration = this.lengthToDuration(length);

//         const oscillator = this.audioContext.createOscillator();
//         oscillator.type = "square";
//         oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
//         this.oscillators[channel] = oscillator;

//         if (!this.gainers[channel]) {
//             const gainNode = this.audioContext.createGain();
//             this.gainers[channel] = gainNode;
//             oscillator.connect(gainNode);
//             gainNode.connect(this.audioContext.destination);
//         } else {
//             oscillator.connect(this.gainers[channel]);
//         }

//         oscillator.start();

//         setTimeout(() => {
//             oscillator.stop();
//             this.oscillators[channel] = null;
//         }, duration * 1000);
//     }

//     private rest(channel: number, length: number): void {
//         if (this.oscillators[channel]) {
//             this.oscillators[channel].stop();
//             this.oscillators[channel] = null;
//         }
//         const duration = this.lengthToDuration(length);
//         setTimeout(() => {
//             this.processMML(channel);
//         }, duration * 1000);
//     }

//     private noteToFrequency(note: string, octave: number): number {
//         const noteToSemitone: { [key: string]: number; } = {
//             c: 0,
//             d: 2,
//             e: 4,
//             f: 5,
//             g: 7,
//             a: 9,
//             b: 11,
//         };
//         const semitone = noteToSemitone[note] + octave * 12;
//         const frequency = 440 * Math.pow(2, (semitone - 69) / 12);
//         return frequency;
//     }

//     private lengthToDuration(length: number): number {
//         const duration = (4 / length) * (60 / this.tempo);
//         return duration;
//     }
// }

// // Usage example:
// const msxSound = new MSXSound();
// msxSound.playMML(1, "v15t180l16o5g16a32g16a32g16a32g16a32g16a32g16a32g16a32g16a32");
// msxSound.playMML(2, "v1t180l4o3g1.&g2.&g1.&g2.&g1.&g2.&g1.&g2.");

class MSXSound {
    private channels: {
        [key: number]: {
            mml: string;
            index: number;
            octave: number;
            defaultLength: number;
            volume: number;
            noise: boolean;
            tied: boolean;
            remainingTiedDuration: number,
        };
    };
    private tempo: number;
    private audioContext: AudioContext;
    private oscillators: { [key: number]: OscillatorNode; };
    private gainers: { [key: number]: GainNode; };
    private noiseGainers: { [key: number]: GainNode; };

    constructor() {
        this.channels = {
            1: {
                mml: "",
                index: 0,
                octave: 4,
                defaultLength: 4,
                volume: 15,
                noise: false,
                tied: false,
                remainingTiedDuration: 0,
            },
            2: {
                mml: "",
                index: 0,
                octave: 4,
                defaultLength: 4,
                volume: 15,
                noise: false,
                tied: false,
                remainingTiedDuration: 0,
            },
            3: {
                mml: "",
                index: 0,
                octave: 4,
                defaultLength: 4,
                volume: 15,
                noise: false,
                tied: false,
                remainingTiedDuration: 0,
            },
            4: {
                mml: "",
                index: 0,
                octave: 4,
                defaultLength: 4,
                volume: 15,
                noise: true,
                tied: false,
                remainingTiedDuration: 0,
            },
        };
        this.tempo = 120;
        this.audioContext = new AudioContext();
        this.oscillators = {};
        this.gainers = {};
        this.noiseGainers = {};
    }

    public playMML(channel: number, mml: string): void {
        this.channels[channel].mml = mml;
        this.channels[channel].index = 0;
        this.processMML(channel);
    }

    private processMML(channel: number): void {
        const ch = this.channels[channel];
        if (ch.index >= ch.mml.length) return;

        const command = ch.mml[ch.index++];
        let value = "";
        while (ch.index < ch.mml.length && !isNaN(parseInt(ch.mml[ch.index], 10))) {
            value += ch.mml[ch.index++];
        }

        switch (command) {
            case "o":
                ch.octave = parseInt(value, 10);
                break;
            case "l":
                ch.defaultLength = parseInt(value, 10);
                break;
            case "t":
                this.tempo = parseInt(value, 10);
                break;
            case "c":
            case "d":
            case "e":
            case "f":
            case "g":
            case "a":
            case "b":
                const noteLength = value === "" ? ch.defaultLength : parseInt(value, 10);
                this.playNote(channel, command, ch.octave, noteLength);
                break;
            case "r":
                const restLength = value === "" ? ch.defaultLength : parseInt(value, 10);
                this.rest(channel, restLength);
                break;
            case "n":
                this.playNoise(channel, parseInt(value, 10));
                break;
            case "v":
                const volume = parseInt(value);
                ch.volume = Math.max(0, Math.min(15, volume));
                break;
            case "&": {
                const noteLength = value === "" ? ch.defaultLength : parseInt(value, 10);
                if (ch.tied) {
                    ch.tied = false;
                    this.rest(channel, noteLength);
                } else {
                    this.playNote(channel, command, ch.octave, noteLength);
                }

                if (ch.mml[ch.index] === "&") {
                    ch.tied = true;
                    ch.index++;
                }
                else ch.tied = false;
                break;
            }
        }

        const delay = 60 / this.tempo;
        setTimeout(() => this.processMML(channel), delay * 1000);
    }

    private setNoiseVolume(channel: number, volume: number): void {
        if (!this.noiseGainers[channel]) {
            const gainNode = this.audioContext.createGain();
            this.noiseGainers[channel] = gainNode;
            gainNode.connect(this.audioContext.destination);
        }
        this.noiseGainers[channel].gain.setValueAtTime(
            this.channels[channel].volume / 15,
            this.audioContext.currentTime
        );
    }

    private playNote(
        channel: number,
        note: string,
        octave: number,
        length: number
    ): void {
        const ch = this.channels[channel];
        const osc = this.oscillators[channel];
        const frequency = this.noteToFrequency(note, octave);
        const duration = this.lengthToDuration(length);

        if (!ch.tied) {
            if (osc) {
                osc.stop();
            }
            const oscillator = this.audioContext.createOscillator();
            oscillator.type = "square";
            this.oscillators[channel] = oscillator;

            if (ch.noise) {
                // ...
            } else {
                if (!this.gainers[channel]) {
                    const gainNode = this.audioContext.createGain();
                    this.gainers[channel] = gainNode;
                    oscillator.connect(gainNode);
                    gainNode.connect(this.audioContext.destination);
                } else {
                    oscillator.connect(this.gainers[channel]);
                }
            }

            oscillator.start();
        }

        this.oscillators[channel].frequency.setValueAtTime(
            frequency,
            this.audioContext.currentTime
        );

        setTimeout(() => {
            if (!ch.tied) {
                this.oscillators[channel].stop();
            }
        }, duration * 1000);
    }

    private playNoise(channel: number, length: number): void {
        const duration = this.lengthToDuration(length);
        if (this.channels[channel].noise) return;

        this.channels[channel].noise = true;
        this.setNoiseVolume(channel, this.channels[channel].volume);

        setTimeout(() => {
            this.channels[channel].noise = false;
            this.oscillators[channel]?.disconnect(this.noiseGainers[channel]);
            this.noiseGainers[channel]?.disconnect(this.audioContext.destination);
        }, duration * 1000);
    }

    private rest(channel: number, length: number): void {
        if (this.channels[channel].noise) {
            this.channels[channel].noise = false;
            this.oscillators[channel]?.disconnect(this.noiseGainers[channel]);
            this.noiseGainers[channel]?.disconnect(this.audioContext.destination);
        }
        if (this.oscillators[channel]) {
            this.oscillators[channel].stop();
            this.oscillators[channel] = null;
        }

        const duration = this.lengthToDuration(length);
        setTimeout(() => {
            this.processMML(channel);
        }, duration * 1000);
    }

    private noteToFrequency(note: string, octave: number): number {
        const noteToSemitone: { [key: string]: number; } = {
            c: 0,
            d: 2,
            e: 4,
            f: 5,
            g: 7,
            a: 9,
            b: 11,
        };
        const semitone = noteToSemitone[note] + octave * 12;
        const frequency = 440 * Math.pow(2, (semitone - 69) / 12);
        return frequency;
    }

    private lengthToDuration(length: number): number {
        const duration = (4 / length) * (60 / this.tempo);
        return duration;
    }

    private createNoiseBuffer(): AudioBuffer {
        const bufferSize = this.audioContext.sampleRate * 0.1;
        const buffer = this.audioContext.createBuffer(
            1,
            bufferSize,
            this.audioContext.sampleRate
        );
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        return buffer;
    }
}

const msxSound = new MSXSound();
msxSound.playMML(1, "v15t180l16o5g16a32g16a32g16a32g16a32g16a32g16a32g16a32g16a32");
msxSound.playMML(2, "v1t180l4o3g1.&g2.&g1.&g2.&g1.&g2.&g1.&g2.");
