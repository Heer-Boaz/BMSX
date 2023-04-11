class PSGChannel {
	public audioContext: AudioContext;
	private gainNode: GainNode;
	private envelopeNode: GainNode;
	private oscillator: OscillatorNode;
	private noiseNode: AudioBufferSourceNode;
	private mixer: GainNode;
	private amplitudeValues: number[] = [0, 0.0625, 0.125, 0.1875, 0.25, 0.3125, 0.375, 0.4375, 0.5, 0.5625, 0.625, 0.6875, 0.75, 0.8125, 0.875, 0.9375];

	constructor(audioContext: AudioContext) {
		this.audioContext = audioContext;
		this.gainNode = this.audioContext.createGain();
		this.noiseNode = null;
		this.envelopeNode = null;
		this.oscillator = this.audioContext.createOscillator();
		this.mixer = this.audioContext.createGain();

		this.connectOscillator();
		this.mixer.connect(this.gainNode);
	}

	connect(destination: AudioNode): void {
		this.gainNode.connect(destination);
	}

	disconnect(destination: AudioNode): void {
		this.gainNode.disconnect(destination);
	}

	disconnectOscillator(): void {
		this.oscillator.disconnect();
	}

	connectOscillator(): void {
		this.oscillator.connect(this.mixer);
	}

	// setVolume(volume: number, time: number): void {
	//     this.gainNode.gain.setValueAtTime(volume / 15, time);
	// }
	setVolume(volume: number, time: number): void {
		const amplitudeIndex = Math.floor(volume * this.amplitudeValues.length / 16);
		const amplitude = this.amplitudeValues[amplitudeIndex];
		this.gainNode.gain.setValueAtTime(amplitude, time);
	}

	setFrequency(frequency: number, time: number): void {
		this.oscillator.frequency.setValueAtTime(frequency, time);
	}

	setWaveType(waveType: number, time: number): void {
		switch (waveType) {
			case 0: // Square wave (SoftOnly and NoSoftNoHard)
				this.oscillator.type = "square";
				break;
			case 1: // Custom square wave (SoftToHard)
				const real1 = new Float32Array([0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
				const imag1 = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
				const wave1 = this.audioContext.createPeriodicWave(real1, imag1);
				this.oscillator.setPeriodicWave(wave1);
				break;
			case 2: // Sawtooth wave (HardOnly)
				const real2 = new Float32Array([0, -0.5, -1, -1.5, -2, -2.5, -3, -3.5, 0, 0, 0]);
				const imag2 = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
				const wave2 = this.audioContext.createPeriodicWave(real2, imag2);
				this.oscillator.setPeriodicWave(wave2);
				break;
			case 3: // Triangle wave (HardToSoft)
				const real3 = new Float32Array([0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0, 0, 0]);
				const imag3 = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
				const wave3 = this.audioContext.createPeriodicWave(real3, imag3);
				this.oscillator.setPeriodicWave(wave3);
				break;
			case 4: // Custom wave for autonomous software and hardware sounds (HardAndSoft)
				const real4 = new Float32Array([0, 1, 1, 0.6, 0.6, 1, 1, 0.6, 0.6, 1, 1]);
				const imag4 = new Float32Array([0, 0, 0, -0.8, 0.8, 0, 0, 0.8, -0.8, 0, 0]);
				const wave4 = this.audioContext.createPeriodicWave(real4, imag4);
				this.oscillator.setPeriodicWave(wave4);
				break;
			default:
				console.error("Invalid wave type:", waveType);
		}
	}

	setNoise(noise: number, duration: number, time: number): void {
		if (this.noiseNode) {
			this.noiseNode.stop();
			this.noiseNode.disconnect(this.mixer);
			this.noiseNode = null;
		}
		if (this.envelopeNode) {
			this.envelopeNode.disconnect(this.mixer);
			this.envelopeNode = null;
		}
		const noiseLevel = Math.max(1, Math.min(31, noise));
		const bufferSize = 4096;
		const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
		const output = noiseBuffer.getChannelData(0);

		const noisePeriod = Math.max(1, (noiseLevel & 0x1f) * 2);
		let shiftRegister = 0x1ffff;
		for (let i = 0; i < bufferSize; i++) {
			if ((shiftRegister & 1) === 0) {
				shiftRegister ^= 0x24000;
			}
			shiftRegister >>= 1;
			output[i] = (shiftRegister & 1) === 0 ? -1 : 1;
			if (i % noisePeriod === noisePeriod - 1) {
				shiftRegister = 0x1ffff;
			}
		}

		this.envelopeNode = this.audioContext.createGain();
		this.envelopeNode.gain.setValueAtTime(noiseLevel, time);
		this.envelopeNode.gain.linearRampToValueAtTime(0, time + duration);

		this.noiseNode = this.audioContext.createBufferSource();
		this.noiseNode.buffer = noiseBuffer;
		this.noiseNode.loop = true;
		this.noiseNode.connect(this.mixer);
		this.envelopeNode.connect(this.mixer);
		this.noiseNode.start(time);
	}

	setNoiseFrequency(frequency: number, time: number): void {
		if (this.noiseNode) {
			this.noiseNode.playbackRate.setValueAtTime(frequency, time);
		}
	}
	start(): void {
		this.oscillator.start();
		this.noiseNode?.start();
	}

	stop(): void {
		this.oscillator.stop();
		this.noiseNode?.stop();
	}
}

const frequencyTable: { [key: string]: number[]; } = {
	'C': [16.35, 32.70, 65.41, 130.81, 261.63, 523.25, 1046.50, 2093.00, 4186.01],
	'C#': [17.32, 34.65, 69.30, 138.59, 277.18, 554.37, 1108.73, 2217.46, 4434.92],
	'D': [18.35, 36.71, 73.42, 146.83, 293.66, 587.33, 1174.66, 2349.32, 4698.64],
	'D#': [19.45, 38.89, 77.78, 155.56, 311.13, 622.25, 1244.51, 2489.02, 4978.03],
	'E': [20.60, 41.20, 82.41, 164.81, 329.63, 659.26, 1318.51, 2637.02, 5274.04],
	'F': [21.83, 43.65, 87.31, 174.61, 349.23, 698.46, 1396.91, 2793.83, 5587.65],
	'F#': [23.12, 46.25, 92.50, 185.00, 369.99, 739.99, 1479.98, 2959.96, 5919.91],
	'G': [24.50, 49.00, 98.00, 196.00, 392.00, 783.99, 1567.98, 3135.96, 6271.93],
	'G#': [25.96, 51.91, 103.83, 207.65, 415.30, 830.61, 1661.22, 3322.44, 6644.88],
	'A': [27.50, 55.00, 110.00, 220.00, 440.00, 880.00, 1760.00, 3520.00, 7040.00],
	'A#': [29.14, 58.27, 116.54, 233.08, 466.16, 932.33, 1864.66, 3729.31, 7458.62],
	'B': [30.87, 61.74, 123.47, 246.94, 493.88, 987.77, 1975.53, 3951.07, 7902.13],
};

class PSG {
	audioContext: AudioContext;
	channels: PSGChannel[];
	masterVolume: number;
	gainNode: GainNode;
	msxFrequencyTable: number[];

	constructor() {
		this.audioContext = new AudioContext();
		this.gainNode = this.audioContext.createGain();
		this.gainNode.connect(this.audioContext.destination);
		// Add the following line to load the processor
		this.channels = [
			new PSGChannel(this.audioContext),
			new PSGChannel(this.audioContext),
			new PSGChannel(this.audioContext),
		];

		for (const channel of this.channels) {
			channel.connect(this.gainNode);
			channel.setVolume(0, 0);
			channel.start();
		}
		this.volume = 1;
	}

	get volume(): number {
		return this.masterVolume;
	}

	set volume(volume: number) {
		this.masterVolume = volume;
		this.gainNode.gain.setValueAtTime(volume, this.audioContext.currentTime);
	}

	getNoteFrequency(note: string, octave: number): number {
		if (frequencyTable.hasOwnProperty(note) && octave >= 0 && octave < frequencyTable[note].length) {
			return frequencyTable[note][octave];
		} else {
			throw new Error(`Invalid note or octave: ${note}, ${octave}`);
		}
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
			row.forEach((cell, columnIndex) => {
				if (cell && cell.note) {
					const instrument = this.instruments[cell.instrument];
					if (instrument) {
						const time = this.psg.audioContext.currentTime + duration * rowIndex;
						const frequency = this.psg.getNoteFrequency(cell.note, cell.octave);
						instrument.play(this.psg.channels[cell.channelIndex], duration, frequency, time);
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
	HardAndSoft = 5
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
				psgChannel.setNoise(cell.noise, duration / this.cells.length, eventTime);
				psgChannel.setNoiseFrequency(0x2000 / cell.noise, eventTime); // Adjust the divisor based on noise value
			} else {
				psgChannel.setNoise(0, 0, eventTime);
			}

			const pitchOffset = cell.pitch || 0;
			psgChannel.setFrequency(frequency + pitchOffset, eventTime);

			// Implement sound generation logic based on the cell type
			switch (cell.cellType) {
				case CellType.NoSoftNoHard:
					// Generate noise, stop sound, or handle special effects
					psgChannel.setWaveType(0, eventTime);
					psgChannel.disconnectOscillator();
					break;
				case CellType.SoftOnly:
					// Generate rectangular sound wave with volume, arpeggio, and pitch
					psgChannel.setWaveType(0, eventTime);
					psgChannel.connectOscillator();
					break;
				case CellType.SoftToHard:
					psgChannel.setWaveType(1, eventTime);
					psgChannel.connectOscillator();
					break;
				case CellType.HardOnly:
					// Generate hardware curve (sawtooth or triangle wave)
					psgChannel.setWaveType(2, eventTime);
					psgChannel.connectOscillator();
					break;
				case CellType.HardToSoft:
					// Generate "still" result and desynchronize for interesting sounds
					psgChannel.setWaveType(3, eventTime);
					psgChannel.connectOscillator();
					break;
				case CellType.HardAndSoft:
					// Generate autonomous software and hardware sounds
					psgChannel.setWaveType(4, eventTime);
					psgChannel.connectOscillator();
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

type Cell = {
	note: string;
	octave: number;
	instrument: number;
	channelIndex: number;
} | null;

type Pattern = Cell[][];

function parseTrackerCode(code: string): Pattern {
	const lines = code.trim().split('\n');
	const patternLength = lines.length - 1; // Subtract 1 to ignore the pattern header
	const pattern: Pattern = [];

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
				pattern[i - 1].push({ note, octave, instrument: instrumentIndex, channelIndex: j });
			} else {
				pattern[i - 1].push(null);
			}
		}
	}

	return pattern;
}

function main() {
	const psg = new PSG();
	psg.volume = .5;
	const code = `
Pattern 0
  Row 0: C-4 01 --- | C-0 02 --- | --- -- ---
  Row 1: D-4 01 --- | C-1 02 --- | --- -- ---
  Row 2: E-4 01 --- | C-2 02 --- | --- -- ---
  Row 3: F-4 01 --- | C-3 02 --- | --- -- ---
  Row 4: G-4 01 --- | C-4 02 --- | --- -- ---
  Row 5: A-4 01 --- | C-5 02 --- | --- -- ---
  Row 6: B-4 01 --- | C-6 02 --- | --- -- ---
  Row 7: C-5 01 --- | C-7 02 --- | --- -- ---
`;
	const tempo = 300; // Beats per minute
	const pattern = parseTrackerCode(code);
	const song = new Song(psg, pattern, tempo, instruments);
	console.log(pattern);
	song.play();
}
