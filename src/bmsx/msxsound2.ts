type Cell = {
    note: string;
    octave: number;
    instrument: number;
} | null;

type Pattern = Cell[][];

class PSGChannel {
    public audioContext: AudioContext;
    private gainNode: GainNode;
    private oscillator: OscillatorNode;
    private noiseNode: AudioBufferSourceNode;
    private mixer: GainNode;

    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext;
        this.gainNode = this.audioContext.createGain();
        this.oscillator = this.audioContext.createOscillator();
        // this.noiseNode = this.audioContext.createBufferSource();
        this.mixer = this.audioContext.createGain();

        this.oscillator.connect(this.mixer);
        // this.noiseNode.connect(this.mixer);
        this.mixer.connect(this.gainNode);
    }

    connect(destination: AudioNode): void {
        this.gainNode.connect(destination);
    }

    disconnect(destination: AudioNode): void {
        this.gainNode.disconnect(destination);
    }

    setVolume(volume: number, time: number): void {
        this.gainNode.gain.setValueAtTime(volume / 15, time);
    }

    setFrequency(frequency: number, time: number): void {
        this.oscillator.frequency.setValueAtTime(frequency, time);
    }
    // setFrequency(value: number): void {
    //     const clock = 1000000;
    //     const frequency = clock / (16 * (value + 1));
    //     this.oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
    // }

    setWaveType(waveType: number, time: number): void {
        switch (waveType) {
            case 0: // Square wave, type 1
                this.oscillator.type = "square";
                break;
            case 1: // Square wave, type 2
                // We can't exactly replicate type 2 with the Web Audio API's built-in waveforms,
                // so we'll use a custom periodic wave that approximates it.
                const real = new Float32Array(2);
                const imag = new Float32Array(2);
                real[0] = 0;
                real[1] = 1;
                imag[0] = 0;
                imag[1] = 0;
                const wave = this.audioContext.createPeriodicWave(real, imag);
                this.oscillator.setPeriodicWave(wave);
                break;
            default:
                console.error("Invalid wave type:", waveType);
        }
    }

    setNoise(noise: number, time: number): void {
        if (noise === 0) {
            if (this.noiseNode) {
                this.noiseNode.stop();
                this.noiseNode.disconnect(this.mixer);
                this.noiseNode = null;
            }
            return;
        }

        const bufferSize = 4096;
        const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
        const output = noiseBuffer.getChannelData(0);

        // Generate the AY-3-8910 noise by XORing the bits of a 17-bit shift register
        let shiftRegister = 0x1ffff;
        for (let i = 0; i < bufferSize; i++) {
            const bit = ((shiftRegister >> 0) ^ (shiftRegister >> 3) ^ (shiftRegister >> 14) ^ (shiftRegister >> 16)) & 1;
            shiftRegister = (shiftRegister >> 1) | (bit << 16);
            output[i] = (bit * 2 - 1) * noise;
        }

        if (this.noiseNode) {
            this.noiseNode.stop();
            this.noiseNode.disconnect(this.mixer);
        }

        this.noiseNode = this.audioContext.createBufferSource();
        this.noiseNode.buffer = noiseBuffer;
        this.noiseNode.loop = true;
        this.noiseNode.connect(this.mixer);
        this.noiseNode.start(time);
    }

    setNoiseFrequency(frequency: number, time: number): void {
        if (this.noiseNode) {
            this.noiseNode.playbackRate.setValueAtTime(frequency, time);
        }
    }

    start(): void {
        this.oscillator.start();
        if (this.noiseNode) this.noiseNode.start();
    }

    stop(): void {
        this.oscillator.stop();
        if (this.noiseNode) this.noiseNode.stop();
    }
}

class PSG {
    audioContext: AudioContext;
    channels: PSGChannel[];

    constructor() {
        this.audioContext = new AudioContext();
        this.channels = [
            new PSGChannel(this.audioContext),
            new PSGChannel(this.audioContext),
            new PSGChannel(this.audioContext),
        ];

        for (const channel of this.channels) {
            channel.connect(this.audioContext.destination);
            channel.setVolume(0, this.audioContext.currentTime);
            channel.start();
        }
    }

    setChannelVolume(channel: number, volume: number) {
        this.channels[channel].setVolume(volume, this.audioContext.currentTime);
    }

    setChannelFrequency(channel: number, frequency: number) {
        this.channels[channel].setFrequency(frequency, this.audioContext.currentTime);
    }
}

class Song {
    pattern: Pattern;
    tempo: number;
    instruments: Instrument[];
    psg: PSG;

    constructor(psg: PSG, pattern: Pattern, tempo: number, instruments: Instrument[]) {
        this.pattern = pattern;
        this.tempo = tempo;
        this.instruments = instruments;
        this.psg = psg;
    }

    play(): void {
        const duration = 60 / this.tempo; // Duration of a single row in seconds

        this.pattern.forEach((row, rowIndex) => {
            row.forEach((cell, channelIndex) => {
                if (cell && cell.note) {
                    const time = this.psg.audioContext.currentTime + duration * rowIndex;
                    const frequency = noteToFrequency(cell.note, cell.octave);
                    const instrument = this.instruments[cell.instrument];
                    if (instrument) {
                        instrument.play(this.psg.channels[channelIndex], duration, frequency, time);
                    } else if (cell.instrument !== 0) {
                        throw `Instrument "${cell.instrument}" not recognized!!`;
                    }
                }
            });
        });
    }
}


interface CellSpec {
    waveType: number;
    volume: number;
    noise: number;
    pitch: number;
}

class Instrument {
    protected spec: CellSpec[];

    constructor(spec: CellSpec[]) {
        this.spec = spec;
    }

    play(psgChannel: PSGChannel, duration: number, frequency: number, time: number): void {
        this.spec.forEach((cell, step) => {
            const eventTime = time + step * (duration / this.spec.length);
            psgChannel.setWaveType(cell.waveType, eventTime);
            psgChannel.setVolume(cell.volume, eventTime);
            psgChannel.setNoise(cell.noise, eventTime);
            psgChannel.setFrequency(frequency + cell.pitch, eventTime);
            if (cell.noise > 0) {
                psgChannel.setNoiseFrequency(frequency, eventTime);
            }
        });

        psgChannel.setVolume(0, time + duration);
    }
}

const keySpikeSpec: CellSpec[] = Array.from({ length: 16 }, (_, index) => ({
    waveType: 0,
    volume: 15 - index,
    noise: 0,
    pitch: 0,
}));

const bassdrumSpec: CellSpec[] = [
    { waveType: 0, volume: 15, noise: 1, pitch: 0 },
    { waveType: 1, volume: 14, noise: 0, pitch: -0x96 },
    { waveType: 1, volume: 13, noise: 0, pitch: -0x12c },
    { waveType: 1, volume: 13, noise: 0, pitch: -0x190 },
    { waveType: 1, volume: 12, noise: 0, pitch: -0x1f4 },
    { waveType: 1, volume: 10, noise: 0, pitch: -0x258 },
];

// const bassdrumSpec: CellSpec[] = [
//     { waveType: 0, volume: 15, noise: 1, pitch: 0 },
//     { waveType: 1, volume: 14, noise: 0.7, pitch: -0x96 },
//     { waveType: 1, volume: 13, noise: 0.5, pitch: -0x12c },
//     { waveType: 1, volume: 13, noise: 0.3, pitch: -0x190 },
//     { waveType: 1, volume: 12, noise: 0.1, pitch: -0x1f4 },
//     { waveType: 1, volume: 10, noise: 0, pitch: -0x258 },
// ];

// const bassdrumSpec: CellSpec[] = [
//     { waveType: 0, volume: 15, noise: 1, pitch: 0 },
//     { waveType: 1, volume: 14, noise: 0.7, pitch: 150 },
//     { waveType: 1, volume: 13, noise: 0.5, pitch: 300 },
//     { waveType: 1, volume: 13, noise: 0.3, pitch: 450 },
//     { waveType: 1, volume: 12, noise: 0.1, pitch: 600 },
//     { waveType: 1, volume: 10, noise: 0, pitch: 750 },
// ];


const instruments = [
    null, // Instrument 0 = No instrument
    new Instrument(keySpikeSpec),
    new Instrument(bassdrumSpec),
    // Add more instruments with their respective specs here
];

function noteToFrequency(note: string, octave: number): number {
    const noteToSemitone: { [key: string]: number; } = {
        C: 0,
        'C#': 1,
        D: 2,
        'D#': 3,
        E: 4,
        F: 5,
        'F#': 6,
        G: 7,
        'G#': 8,
        A: 9,
        'A#': 10,
        B: 11,
    };
    const semitone = noteToSemitone[note] + (octave + 1) * 12;
    const frequency = 440 * Math.pow(2, (semitone - 69) / 12);
    return frequency;
}

function parseTrackerCode(code: string) {
    const lines = code.trim().split('\n');
    const patternLength = lines.length - 1; // Subtract 1 to ignore the pattern header
    const pattern = [];

    for (let i = 0; i < patternLength; i++) {
        pattern.push([]);
    }

    for (let i = 1; i < lines.length; i++) { // Start from index 1 to ignore the pattern header
        const line = lines[i];
        const fields = line.trim().split('|');
        for (let j = 0; j < fields.length; j++) {
            const field = fields[j].trim();
            const match = field.match(/^(?:Row\s+\d+:\s+)?([A-G])-?(\d+)\s+(\d+)?/);
            if (match) {
                const note = match[1];
                const octave = parseInt(match[2] || '4', 10);
                const instrumentIndex = parseInt(match[3] || '0', 10);
                pattern[i - 1].push({ note, octave, instrument: instrumentIndex });
            } else {
                pattern[i - 1].push(null);
            }
        }
    }

    return pattern;
}


const psg = new PSG();

const code = `
Pattern 0
  Row 0: --- -- --- | --- -- --- | C-5 01 ---
  Row 1: --- -- --- | --- -- --- | C-5 01 ---
  Row 2: --- -- --- | --- -- --- | C-5 01 ---
  Row 3: --- -- --- | --- -- --- | C-5 01 ---
`;

const tempo = 200; // Beats per minute
const pattern = parseTrackerCode(code);
const song = new Song(psg, pattern, tempo, instruments);
console.log(pattern);
song.play();
