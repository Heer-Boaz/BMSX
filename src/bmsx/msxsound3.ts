declare class AudioWorkletProcessor {
    constructor(options?: AudioWorkletNodeOptions);
    readonly port: MessagePort;
    process(
        inputs: Float32Array[][],
        outputs: Float32Array[][],
        parameters: Record<string, Float32Array>
    ): boolean;
}

interface AudioWorkletProcessorConstructor {
    new(options?: AudioWorkletNodeOptions): AudioWorkletProcessor;
    prototype: AudioWorkletProcessor;
}

declare function registerProcessor(name: string, processorCtor: AudioWorkletProcessorConstructor): void;

class PSGChannel {
    public audioContext: AudioContext;
    private node: AudioWorkletNode;

    constructor(audioContext: AudioContext) {
        this.audioContext = audioContext;
        const options: AudioWorkletNodeOptions = {
            numberOfOutputs: 1,
            outputChannelCount: [1],
            parameterData: {
                volume: 1,
                frequency: 440,
                waveType: 0,
                noiseEnabled: 0,
                noiseFrequency: 1000,
                mix: 0.5,
                sampleRate: audioContext.sampleRate,
            }
        };
        this.node = new AudioWorkletNode(this.audioContext, 'psg-channel-processor', options);
    }

    connect(destination: AudioNode): void {
        this.node.connect(destination);
    }

    disconnect(destination: AudioNode): void {
        this.node.disconnect(destination);
    }

    setVolume(volume: number, time: number): void {
        this.node.port.postMessage({ command: 'setVolume', volume, time });
    }

    setFrequency(frequency: number, time: number): void {
        this.node.port.postMessage({ command: 'setFrequency', frequency, time });
    }

    setWaveType(waveType: number, time: number): void {
        this.node.port.postMessage({ command: 'setWaveType', waveType, time });
    }

    setNoise(noise: number, time: number): void {
        this.node.port.postMessage({ command: 'setNoise', noise, time });
    }

    setNoiseFrequency(frequency: number, time: number): void {
        this.node.port.postMessage({ command: 'setNoiseFrequency', frequency, time });
    }
}

type Cell = {
    note: string;
    octave: number;
    instrument: number;
} | null;

type Pattern = Cell[][];

class PSG {
    audioContext: AudioContext;
    channels: PSGChannel[];
    masterVolume: number;
    gainNode: GainNode;

    constructor() {
        this.audioContext = new AudioContext();
    }

    async init() {
        this.gainNode = this.audioContext.createGain();
        this.gainNode.connect(this.audioContext.destination);
        // Add the following line to load the processor
        await this.audioContext.audioWorklet.addModule('psg-channel-processor.js');
        this.channels = [
            new PSGChannel(this.audioContext),
            new PSGChannel(this.audioContext),
            new PSGChannel(this.audioContext),
        ];

        for (const channel of this.channels) {
            channel.connect(this.gainNode);
            channel.setVolume(1, 0);
        }
    }

    getMasterVolume(): number {
        return this.masterVolume;
    }

    setMasterVolume(volume: number): void {
        this.masterVolume = volume;
        this.gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
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
                    const instrument = this.instruments[cell.instrument];
                    if (instrument) {
                        const time = this.psg.audioContext.currentTime + duration * rowIndex;
                        const frequency = noteToFrequency(cell.note, cell.octave);
                        instrument.play(this.psg.channels[channelIndex], duration, frequency, time);
                    } else if (cell.instrument !== 0) {
                        throw `Instrument "${cell.instrument}" not recognized!!`;
                    }
                }
            });
        });
    }
}

enum CellType {
    NoSoftNoHard = 0,
    SoftOnly = 1,
    SoftToHard = 2,
    HardOnly = 3,
    HardToSoft = 4,
    HardAndSoft = 5,
}

interface CellSpec {
    cellType: CellType;
    volume: number;
    noise: number;
    pitch: number;
}

class Instrument {
    protected cells: CellSpec[];

    constructor(cells: CellSpec[]) {
        this.cells = cells;
    }

    play(psgChannel: PSGChannel, duration: number, frequency: number, time: number): void {
        this.cells.forEach((cell, step) => {
            const eventTime = time + step * (duration / this.cells.length);
            psgChannel.setWaveType(cell.cellType, eventTime);
            psgChannel.setVolume(cell.volume, eventTime);

            if (cell.noise > 0) {
                psgChannel.setNoise(cell.noise, eventTime);
                psgChannel.setNoiseFrequency(0x2000 / cell.noise, eventTime); // Adjust the divisor based on noise value
            } else {
                psgChannel.setNoise(0, eventTime);
            }

            const pitchOffset = cell.pitch || 0;
            psgChannel.setFrequency(frequency + pitchOffset, eventTime);

            // Implement sound generation logic based on the cell type
            switch (cell.cellType) {
                case CellType.NoSoftNoHard:
                    // Generate noise, stop sound, or handle special effects
                    psgChannel.setWaveType(0, eventTime);
                    break;
                case CellType.SoftOnly:
                    // Generate rectangular sound wave with volume, arpeggio, and pitch
                    psgChannel.setWaveType(0, eventTime);
                    break;
                case CellType.SoftToHard:
                    psgChannel.setWaveType(1, eventTime);
                    break;
                case CellType.HardOnly:
                    // Generate hardware curve (sawtooth or triangle wave)
                    psgChannel.setWaveType(2, eventTime);
                    break;
                case CellType.HardToSoft:
                    // Generate "still" result and desynchronize for interesting sounds
                    psgChannel.setWaveType(3, eventTime);
                    break;
                case CellType.HardAndSoft:
                    // Generate autonomous software and hardware sounds
                    psgChannel.setWaveType(4, eventTime);
                    break;
            }
        });

        psgChannel.setVolume(0, time + duration);
    }
}

const keySpikeSpec: CellSpec[] = Array.from({ length: 16 }, (_, index) => ({
    volume: 15 - index,
    noise: 0,
    pitch: 0,
    cellType: CellType.SoftOnly, // Use the InstrumentType enum here
}));

const bassdrumSpec: CellSpec[] = [
    { cellType: CellType.NoSoftNoHard, volume: 15, noise: 1, pitch: 0, },
    { cellType: CellType.SoftOnly, volume: 14, noise: 0, pitch: -0x96, },
    { cellType: CellType.SoftOnly, volume: 13, noise: 0, pitch: -0x12c, },
    { cellType: CellType.SoftOnly, volume: 12, noise: 0, pitch: -0x190, },
    { cellType: CellType.SoftOnly, volume: 11, noise: 0, pitch: -0x1f4, },
    { cellType: CellType.SoftOnly, volume: 10, noise: 0, pitch: -0x258, },
];

const instruments = [
    null, // Instrument 0 = No instrument
    new Instrument(keySpikeSpec),
    new Instrument(bassdrumSpec),
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

async function main() {
    const psg = new PSG();
    await psg.init();
    psg.setMasterVolume(1);

    const code = `
Pattern 0
  Row 0: C-1 01 --- | A-4 01 --- | C-5 01 ---
  Row 1: C-1 01 --- | B-4 01 --- | D-5 01 ---
  Row 2: C-1 01 --- | C-4 01 --- | E-5 01 ---
  Row 3: C-1 01 --- | D-4 01 --- | F-5 01 ---
`;

    const tempo = 300; // Beats per minute
    const pattern = parseTrackerCode(code);
    const song = new Song(psg, pattern, tempo, instruments);
    console.log(pattern);
    song.play();
}

main();