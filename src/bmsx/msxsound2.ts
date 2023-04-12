// Constants for AY-3-8910 noise generation
const NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160];
const NOISE_FEEDBACK = 0x9;

class PSGChannelEmulator {
	public audioContext: AudioContext;
	private gainNode: GainNode;
	private envelopeNode: GainNode;
	private oscillator: OscillatorNode;
	private noiseNode: AudioBufferSourceNode;
	private noiseGainNode: GainNode;
	private lowPassFilter: BiquadFilterNode;
	private mixer: GainNode;
	private currentNoiseFrequency: number;
	private amplitudeValues: number[] = [0, 0.0625, 0.125, 0.1875, 0.25, 0.3125, 0.375, 0.4375, 0.5, 0.5625, 0.625, 0.6875, 0.75, 0.8125, 0.875, 0.9375];

	constructor(audioContext: AudioContext) {
		this.audioContext = audioContext;
		this.currentNoiseFrequency = 0;
		this.gainNode = this.audioContext.createGain();
		this.noiseNode = null;
		this.envelopeNode = this.audioContext.createGain();
		this.oscillator = this.audioContext.createOscillator();
		this.mixer = this.audioContext.createGain();
		this.noiseGainNode = this.audioContext.createGain();
		this.noiseGainNode.gain.value = 0;
		this.lowPassFilter = this.audioContext.createBiquadFilter();
		this.lowPassFilter.type = 'lowpass';
		this.lowPassFilter.frequency.value = 2500; // Adjust the cutoff frequency to control the softness of the noise
		this.lowPassFilter.Q.value = 2;
		this.lowPassFilter.connect(this.mixer);

		this.connectNoiseGain();
		this.mixer.connect(this.gainNode);


		this.connectOscillator();
		this.connectEnveloper();
		this.mixer.connect(this.gainNode);
	}

	connect(destination: AudioNode): void {
		this.gainNode.connect(destination);
	}

	disconnect(destination: AudioNode): void {
		this.gainNode.disconnect(destination);
	}

	private connectNoiseGain(): void {
		this.noiseGainNode.connect(this.mixer);
	}

	connectOscillator(): void {
		this.oscillator.connect(this.mixer);
	}

	disconnectOscillator(): void {
		this.oscillator.disconnect();
	}

	connectEnveloper(): void {
		this.envelopeNode.connect(this.mixer);
	}

	disconnectEnveloper(): void {
		this.envelopeNode.disconnect();
	}

	setVolume(volume: number, time: number): void {
		const amplitudeIndex = Math.floor(volume * this.amplitudeValues.length / 16);
		const amplitude = this.amplitudeValues[amplitudeIndex];
		this.gainNode.gain.setValueAtTime(amplitude, time);
	}

	setToneFrequency(
		frequency: number,
		time: number,
		pitch_software: number = 0,
		pitch_hardware: number = 0
	): void {
		const targetFrequency = frequency * (1 + (pitch_software + pitch_hardware) / 2048);
		// Set the frequency in the oscillator using an exponential ramp
		this.oscillator.frequency.exponentialRampToValueAtTime(targetFrequency, time + 0.01);
	}




	// setToneFrequency(
	// 	frequency: number,
	// 	time: number,
	// 	pitch_software: number = 0,
	// 	pitch_hardware: number = 0,
	// 	amplitude_modulation: boolean = false
	// ): void {
	// 	const targetFrequency = frequency + pitch_software + pitch_hardware;
	// 	const frequencyRatio = targetFrequency / PSGEmulator.PSG_FREQUENCY;
	// 	const coarse = Math.floor(frequencyRatio);
	// 	const fine = Math.floor((targetFrequency - coarse * PSGEmulator.PSG_FREQUENCY) * PSGEmulator.FINE_STEPS_PER_NOTE);

	// 	if (this.oscillator.type === 'square') {
	// 		// For square waves, set the frequency directly and adjust the duty cycle
	// 		this.oscillator.frequency.setValueAtTime(targetFrequency, time);
	// 		if (amplitude_modulation) {
	// 			this.oscillator.width.setValueAtTime(Math.min(1, Math.max(0, this.volume / 15)), time);
	// 		} else {
	// 			const dutyCycle = this.dutyCycle / 31;
	// 			this.oscillator.width.setValueAtTime(dutyCycle, time);
	// 		}
	// 	} else {
	// 		// For other waveforms, use a wave table to adjust the frequency and apply amplitude modulation
	// 		const tableSize = this.oscillator.frequencyBinCount;
	// 		const table = new Float32Array(tableSize);
	// 		for (let i = 0; i < tableSize; i++) {
	// 			const phase = i / tableSize;
	// 			const frequency = (coarse + phase) * PSGEmulator.PSG_FREQUENCY + fine / PSGEmulator.FINE_STEPS_PER_NOTE;
	// 			table[i] = Math.sin(phase * Math.PI * 2) * Math.sin(phase * frequencyRatio * Math.PI * 2);
	// 		}

	// 		const waveTable = this.audioContext.createPeriodicWave(table, [0, 1]);
	// 		this.oscillator.setPeriodicWave(waveTable);

	// 		if (amplitude_modulation) {
	// 			const gainNode = this.amplitudeModulationNode.gain;
	// 			gainNode.setValueAtTime(0, time);
	// 			gainNode.linearRampToValueAtTime(Math.min(1, Math.max(0, this.volume / 15)), time + PSGEmulator.WAVEFORM_PERIOD / 2);
	// 		}
	// 	}

	// 	this.frequency = targetFrequency;
	// }

	// setToneFrequency(
	// 	frequency: number,
	// 	time: number,
	// 	pitch_software: number = 0,
	// 	pitch_hardware: number = 0
	// ): void {
	// 	const targetFrequency = frequency + pitch_software + pitch_hardware;
	// 	// Set the frequency in the oscillator using an exponential ramp
	// 	this.oscillator.frequency.exponentialRampToValueAtTime(targetFrequency, time + 0.01);
	// }

	// setFrequency(
	// 	frequency: number,
	// 	time: number,
	// 	pitch_software: number = 0
	// ): void {
	// 	const targetFrequency = frequency + pitch_software;
	// 	// Set the frequency in the oscillator using an exponential ramp
	// 	this.oscillator.frequency.exponentialRampToValueAtTime(targetFrequency, time + 0.01);
	// }

	resetNote(time: number): void {
		this.setVolume(0, time);
		this.oscillator.type = "sine"; // Set the oscillator type to sine wave
	};

	setWaveType(waveType: number, time: number): void {
		const customWave = (real: number[], imag: number[]): PeriodicWave => {
			return this.audioContext.createPeriodicWave(
				new Float32Array(real),
				new Float32Array(imag)
			);
		};

		switch (waveType) {
			case 0: // Square wave (NoSoftNoHard)
				this.oscillator.type = "square";
				break;
			case 1: // Custom square wave (SoftOnly)
				this.oscillator.setPeriodicWave(customWave([0, 1], [0, 0]));
				break;
			case 2: // Sawtooth wave (SoftToHard)
				this.oscillator.type = "sawtooth";
				break;
			case 3: // Triangle wave (HardOnly)
				this.oscillator.type = "triangle";
				break;
			case 4: // Custom wave for autonomous software and hardware sounds (HardAndSoft)
				this.oscillator.setPeriodicWave(customWave([0, 0.5, 1, 0, -1, -0.5], [0, 0.866, 0, 0, 0, -0.866]));
				break;
			default:
				console.error("Invalid wave type:", waveType);
		}
	}

	setNoise(noise: number, duration: number, time: number): void {
		if (this.noiseNode) {
			this.noiseNode.stop();
			this.noiseNode.disconnect(this.lowPassFilter);
			this.noiseNode = null;
		}
		if (!noise) return;

		const noiseLevel = Math.max(1, Math.min(31, noise));
		const bufferSize = Math.round(PSGEmulator.PSG_FREQUENCY * duration);
		const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
		const output = noiseBuffer.getChannelData(0);

		let noisePeriod = NOISE_PERIODS[(noiseLevel >> 3) & 0x07];
		let shiftRegister = 0x4000;
		let avg = 0;
		let count = 0;
		for (let i = 0; i < bufferSize; i++) {
			output[i] = (shiftRegister & 1) === 0 ? -1 : 1;

			// Update the shift register
			const feedback = ((shiftRegister & NOISE_FEEDBACK) ^ ((shiftRegister >> 1) & NOISE_FEEDBACK)) & 1;
			shiftRegister = ((shiftRegister >> 1) & 0x3fff) | (feedback << 14);

			if (i % noisePeriod === noisePeriod - 1) {
				const diff = output[i] - avg;
				const delta = diff / (count + 1);
				avg += delta;
				count++;
				noisePeriod = NOISE_PERIODS[(noiseLevel + Math.round(avg)) >> 3 & 0x07];
			}
		}

		// Apply the envelope
		const envelope = [
			0, 1, 2, 3, 4, 5, 6, 7,
			8, 9, 10, 11, 12, 13, 14, 15,
			14, 13, 12, 11, 10, 9, 8, 7,
			6, 5, 4, 3, 2, 1, 0, 0,
		];
		const gainNode = this.envelopeNode.gain;
		gainNode.setValueAtTime(0, time);
		for (let i = 0; i < envelope.length; i++) {
			const timeValue = time + i / envelope.length * duration;
			const value = envelope[i] / 15 * noiseLevel;
			gainNode.linearRampToValueAtTime(value, timeValue);
		}
		gainNode.linearRampToValueAtTime(0, time + duration);

		// Resample the noise buffer to match the PSG frequency
		const resampledBuffer = this.resampleBuffer(noiseBuffer, this.audioContext.sampleRate);

		this.noiseNode = this.audioContext.createBufferSource();
		this.noiseNode.buffer = resampledBuffer;
		this.noiseNode.loop = true;

		// Connect the noise node to the low-pass filter and then to the mixer
		this.noiseNode.connect(this.lowPassFilter);
		this.noiseNode.start(time);
	}

	setNoiseFrequency(noise_divider: number, time: number): void {
		if (this.noiseNode) {
			const noise_frequency = noise_divider ? PSGEmulator.PSG_FREQUENCY / (16 * (noise_divider + 1)) : 0;
			this.noiseNode.playbackRate.cancelScheduledValues(time);
			const now = this.audioContext.currentTime;
			const start = now + 0.001;
			this.noiseNode.playbackRate.setValueAtTime(this.currentNoiseFrequency, start);
			this.noiseNode.playbackRate.exponentialRampToValueAtTime(noise_frequency, start + 0.01);
			this.currentNoiseFrequency = noise_frequency;
		}
	}

	// setNoiseFrequency(noise_divider: number, time: number): void {
	// 	if (this.noiseNode) {
	// 		const noise_frequency = noise_divider ? PSGEmulator.PSG_FREQUENCY / (16 * (noise_divider + 1)) : 0;
	// 		this.noiseNode.playbackRate.setValueAtTime(noise_frequency, time);
	// 	}
	// }

	// setNoise(noise: number, duration: number, time: number): void {
	// 	if (this.noiseNode) {
	// 		this.noiseNode.stop();
	// 		this.noiseNode.disconnect(this.lowPassFilter);
	// 		this.noiseNode = null;
	// 	}
	// 	if (!noise) return;

	// 	const noiseLevel = Math.max(1, Math.min(31, noise));
	// 	const bufferSize = Math.round(PSGEmulator.PSG_FREQUENCY * duration);
	// 	const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
	// 	const output = noiseBuffer.getChannelData(0);

	// 	let noisePeriod = NOISE_PERIODS[(noiseLevel >> 3) & 0x07];
	// 	let shiftRegister = 0x4000;
	// 	for (let i = 0; i < bufferSize; i++) {
	// 		output[i] = (shiftRegister & 1) === 0 ? -1 : 1;

	// 		// Update the shift register
	// 		const feedback = ((shiftRegister & NOISE_FEEDBACK) ^ ((shiftRegister >> 1) & NOISE_FEEDBACK)) & 1;
	// 		shiftRegister = ((shiftRegister >> 1) & 0x3fff) | (feedback << 14);

	// 		if (i % noisePeriod === noisePeriod - 1) {
	// 			const avg = output.slice(i - noisePeriod + 1, i + 1).reduce((acc, val) => acc + val, 0) / noisePeriod;
	// 			for (let j = i - noisePeriod + 1; j <= i; j++) {
	// 				output[j] -= avg;
	// 			}
	// 		}
	// 	}

	// 	// Apply the envelope
	// 	// const envelope = this.instrument.envelope;
	// 	const envelope = [
	// 		0, 1, 2, 3, 4, 5, 6, 7,
	// 		8, 9, 10, 11, 12, 13, 14, 15,
	// 		14, 13, 12, 11, 10, 9, 8, 7,
	// 		6, 5, 4, 3, 2, 1, 0, 0,
	// 	];
	// 	const gainNode = this.envelopeNode.gain;
	// 	gainNode.setValueAtTime(0, time);
	// 	for (let i = 0; i < envelope.length; i++) {
	// 		const timeValue = time + i / envelope.length * duration;
	// 		const value = envelope[i] / 15 * noiseLevel;
	// 		gainNode.linearRampToValueAtTime(value, timeValue);
	// 	}
	// 	gainNode.linearRampToValueAtTime(0, time + duration);

	// 	// Resample the noise buffer to match the PSG frequency
	// 	const resampledBuffer = this.resampleBuffer(noiseBuffer, this.audioContext.sampleRate);

	// 	this.noiseNode = this.audioContext.createBufferSource();
	// 	this.noiseNode.buffer = resampledBuffer;
	// 	this.noiseNode.loop = true;

	// 	// Connect the noise node to the low-pass filter and then to the mixer
	// 	this.noiseNode.connect(this.lowPassFilter);
	// 	this.noiseNode.start(time);
	// }


	private resampleBuffer(buffer: AudioBuffer, targetSampleRate: number): AudioBuffer {
		const sourceSampleRate = buffer.sampleRate;
		const sourceChannelData = buffer.getChannelData(0);
		const sourceLength = sourceChannelData.length;
		const targetLength = Math.round(sourceLength * targetSampleRate / sourceSampleRate);
		const targetBuffer = this.audioContext.createBuffer(1, targetLength, targetSampleRate);
		const targetChannelData = targetBuffer.getChannelData(0);
		let sourceIndex = 0;
		for (let i = 0; i < targetLength; i++) {
			const sourceSampleIndex = sourceIndex | 0;
			const fraction = sourceIndex - sourceSampleIndex;

			// Linearly interpolate between the two nearest source samples
			const a = sourceChannelData[sourceSampleIndex];
			const b = sourceChannelData[Math.min(sourceSampleIndex + 1, sourceLength - 1)];
			targetChannelData[i] = a * (1 - fraction) + b * fraction;

			sourceIndex += sourceSampleRate / targetSampleRate;
		}

		return targetBuffer;
	}

	// setNoise(noise: number, duration: number, time: number): void {
	// 	if (this.noiseNode) {
	// 		this.noiseNode.stop();
	// 		this.noiseNode.disconnect(this.lowPassFilter);
	// 		this.noiseNode = null;
	// 	}
	// 	if (!noise) return;

	// 	const noiseLevel = Math.max(1, Math.min(31, noise));
	// 	const bufferSize = Math.ceil(this.audioContext.sampleRate * duration);
	// 	const noiseBuffer = this.audioContext.createBuffer(1, bufferSize, this.audioContext.sampleRate);
	// 	const output = noiseBuffer.getChannelData(0);

	// 	const noisePeriod = Math.max(1, (noiseLevel & 0x1f) * 2);
	// 	let lfsr = 0x7fff;
	// 	for (let i = 0; i < bufferSize; i++) {
	// 		output[i] = (lfsr & 1) === 0 ? -1 : 1;

	// 		// Update the LFSR
	// 		const feedback = ((lfsr & 1) ^ ((lfsr >> 6) & 1)) & 1;
	// 		lfsr = ((lfsr >> 1) & 0x3fff) | (feedback << 14);

	// 		if (i % noisePeriod === noisePeriod - 1) {
	// 			const avg = output.slice(i - noisePeriod + 1, i + 1).reduce((acc, val) => acc + val, 0) / noisePeriod;
	// 			for (let j = i - noisePeriod + 1; j <= i; j++) {
	// 				output[j] -= avg;
	// 			}
	// 		}
	// 	}

	// 	this.envelopeNode.gain.setValueAtTime(noiseLevel, time);
	// 	this.envelopeNode.gain.linearRampToValueAtTime(0, time + duration);
	// 	this.noiseGainNode.gain.setValueAtTime(noiseLevel, time);
	// 	this.noiseGainNode.gain.linearRampToValueAtTime(0, time + duration);

	// 	this.noiseNode = this.audioContext.createBufferSource();
	// 	this.noiseNode.buffer = noiseBuffer;
	// 	this.noiseNode.loop = true;

	// 	// Connect the noise node to the low-pass filter and then to the mixer
	// 	this.noiseNode.connect(this.lowPassFilter);
	// 	this.noiseNode.start(time);
	// }

	// setNoiseFrequency(noise_divider: number, time: number): void {
	// 	if (this.noiseNode) {
	// 		const noise_frequency = noise_divider ? PSGEmulator.PSG_FREQUENCY / (16 * (noise_divider + 1)) : 0;
	// 		this.noiseNode.playbackRate.setValueAtTime(noise_frequency, time);
	// 	}
	// }

	setEnvelope(envelopeType: PSGInstruction_EnvelopeType, time: number, duration: number): void {
		const attackTime = duration * 0.1;
		const decayTime = duration * 0.9;
		this.envelopeNode.gain.setValueAtTime(0, time);

		switch (envelopeType) {
			case PSGInstruction_EnvelopeType.Sawtooth:
				this.envelopeNode.gain.linearRampToValueAtTime(1, time + attackTime);
				this.envelopeNode.gain.linearRampToValueAtTime(0, time + attackTime + decayTime);
				break;
			case PSGInstruction_EnvelopeType.Sawtooth_Mirrored:
				this.envelopeNode.gain.linearRampToValueAtTime(0, time + attackTime);
				this.envelopeNode.gain.linearRampToValueAtTime(1, time + attackTime + decayTime);
				break;
			case PSGInstruction_EnvelopeType.Triangle:
				this.envelopeNode.gain.linearRampToValueAtTime(1, time + attackTime);
				this.envelopeNode.gain.linearRampToValueAtTime(0, time + attackTime + decayTime * 0.5);
				this.envelopeNode.gain.linearRampToValueAtTime(1, time + duration);
				break;
			case PSGInstruction_EnvelopeType.Triangle_Mirrored:
				this.envelopeNode.gain.linearRampToValueAtTime(0, time + attackTime);
				this.envelopeNode.gain.linearRampToValueAtTime(1, time + attackTime + decayTime * 0.5);
				this.envelopeNode.gain.linearRampToValueAtTime(0, time + duration);
				break;
		}
	}

	start(): void {
		this.oscillator.start();
		this.noiseNode?.start();
	};

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

class Instrument {
	protected psgInstructions: PSGInstruction[];

	constructor(instructions: PSGInstruction[]) {
		this.psgInstructions = instructions;
	}

	executePSGInstruction(psgInstruction: PSGInstruction, psgChannel: PSGChannelEmulator, stepDuration: number, frequency: number, time: number) {
		psgChannel.setWaveType(psgInstruction.cellType, time);
		psgChannel.setVolume(psgInstruction.volume, time);

		if (psgInstruction.envelopeType && psgInstruction.cellType === PSGInstructionType.HardOnly || psgInstruction.cellType === PSGInstructionType.HardToSoft || psgInstruction.cellType === PSGInstructionType.HardAndSoft) {
			psgChannel.setEnvelope(psgInstruction.envelopeType, time, stepDuration * 0.8); // Adjust envelope timing
		}

		const pitchOffset = psgInstruction.pitch_software || 0;
		if (psgInstruction.noise) {
			psgChannel.setNoise(psgInstruction.noise, stepDuration, time);
			psgChannel.setNoiseFrequency(psgInstruction.noise, time); // Do not use pitch for noise frequency
		} else {
			psgChannel.setNoise(0, 0, time);
			psgChannel.setNoiseFrequency(0, time);
		}

		psgChannel.setToneFrequency(frequency, time, pitchOffset);

		// Implement sound generation logic based on the cell type
		switch (psgInstruction.cellType) {
			case PSGInstructionType.NoSoftNoHard:
				// Generate noise, stop sound, or handle special effects
				psgChannel.setWaveType(0, time);
				psgChannel.disconnectOscillator();
				break;
			case PSGInstructionType.SoftOnly:
				// Generate rectangular sound wave with volume, arpeggio, and pitch
				psgChannel.setWaveType(0, time);
				psgChannel.connectOscillator();
				break;
			case PSGInstructionType.SoftToHard:
				psgChannel.setWaveType(1, time);
				psgChannel.connectOscillator();
				break;
			case PSGInstructionType.HardOnly:
				// Generate hardware curve (sawtooth or triangle wave)
				psgChannel.setWaveType(2, time);
				psgChannel.connectOscillator();
				// psgChannel.setEnvelope(psgInstruction.envelopeType, time, stepDuration);
				break;
			case PSGInstructionType.HardToSoft:
				// Generate "still" result and desynchronize for interesting sounds
				psgChannel.setWaveType(3, time);
				psgChannel.connectOscillator();
				// psgChannel.setEnvelope(psgInstruction.envelopeType, time, stepDuration);
				break;
			case PSGInstructionType.HardAndSoft:
				// Generate autonomous software and hardware sounds
				psgChannel.setWaveType(4, time);
				psgChannel.connectOscillator();
				// psgChannel.setEnvelope(psgInstruction.envelopeType, time, stepDuration);
				break;
		}
	}

	play(psgChannel: PSGChannelEmulator, duration: number, frequency: number, time: number): void {
		const stepDuration = (duration / this.psgInstructions.length);
		this.psgInstructions.forEach((psgInstruction, step) => {
			const eventTime = time + (step + 0.01) * stepDuration; // Add a small delay to account for the exponential ramp
			setTimeout(() => this.executePSGInstruction(psgInstruction, psgChannel, stepDuration, frequency, eventTime), eventTime);
		});

		psgChannel.setVolume(0, time + duration + (0.01 * this.psgInstructions.length));
	}
}

class PSGEmulator {
	public static readonly PSG_FREQUENCY = 1789772.5; // in Hz;
	audioContext: AudioContext;
	channels: PSGChannelEmulator[];
	masterVolume: number;
	gainNode: GainNode;
	msxFrequencyTable: number[];

	constructor() {
		this.audioContext = new AudioContext();
		this.gainNode = this.audioContext.createGain();
		this.gainNode.connect(this.audioContext.destination);
		// Add the following line to load the processor
		this.channels = [
			new PSGChannelEmulator(this.audioContext),
			new PSGChannelEmulator(this.audioContext),
			new PSGChannelEmulator(this.audioContext),
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
	pattern: SongPattern;
	tempo: number;
	instruments: Instrument[];
	psg: PSGEmulator;
	currentRow: number;
	paused: boolean;

	constructor(psg: PSGEmulator, pattern: SongPattern, tempo: number, instruments: Instrument[]) {
		this.pattern = pattern;
		this.tempo = tempo;
		this.instruments = instruments;
		this.psg = psg;
		this.currentRow = 0;
		this.paused = false;
	}

	playRow(rowIndex: number): void {
		if (rowIndex >= 0 && rowIndex < this.pattern.length) {
			const row = this.pattern[rowIndex];
			const duration = 60 / this.tempo;
			const time = this.psg.audioContext.currentTime;

			row.forEach((trackerCell) => {
				if (trackerCell?.note === 'RST') {
					this.psg.channels[trackerCell.channelIndex].resetNote(time);
				} else {
					if (trackerCell && trackerCell.note) {
						const instrument = this.instruments[trackerCell.instrument];
						if (instrument) {
							const frequency = this.psg.getNoteFrequency(trackerCell.note, trackerCell.octave);
							instrument.play(this.psg.channels[trackerCell.channelIndex], duration, frequency, time);
						} else if (trackerCell.instrument !== 0) {
							throw `Instrument "${trackerCell.instrument}" not recognized!!`;
						}
					}
				}
			});
			this.updateTrackerTable();
		}
	}

	playNextRow(): void {
		if (this.currentRow < this.pattern.length) {
			this.playRow(this.currentRow);
			this.currentRow++;
		}
		this.updateTrackerTable();
	}

	start(): void {
		this.paused = false;
		this.currentRow = 0;
		this.playSong();
	}

	continue(): void {
		this.paused = false;
		this.playSong();
	}

	pause(): void {
		this.paused = true;
	}

	protected playSong(): void {
		if (this.currentRow < this.pattern.length && !this.paused) {
			this.playNextRow();
			const duration = 60 / this.tempo;
			setTimeout(() => this.playSong(), duration * 1000);
		}
	}

	updateTrackerTable(): void {
		const table = document.getElementById('trackerTable') as HTMLTableElement;
		const patternHeader = document.getElementById('patternHeader');
		table.innerHTML = '';
		patternHeader.innerHTML = `Pattern ${0}`;

		this.pattern.forEach((row, rowIndex) => {
			const tableRow = document.createElement('tr');
			if (rowIndex === this.currentRow - 1) {
				tableRow.classList.add('current-row');
			} else if (rowIndex === this.pattern.length - 1) {
				tableRow.classList.add('last-row');
			}

			const stepCell = document.createElement('td');
			stepCell.classList.add('step');
			stepCell.innerText = rowIndex.toString();
			const boundedPlayRow = this.playRow.bind(this);
			stepCell.onclick = (ev => boundedPlayRow(rowIndex));
			tableRow.appendChild(stepCell);

			row.forEach((trackerCell, trackerCellIndex) => {
				const noteCell = document.createElement('td');
				const instrumentCell = document.createElement('td');
				const effectCell = document.createElement('td');

				if (trackerCell) {
					if (trackerCell.note) {
						noteCell.innerText = `${trackerCell.note}${trackerCell.octave}`;
					}
					else {
						noteCell.innerText = '---';
					}
					if (trackerCell.instrument) {
						instrumentCell.innerText = trackerCell.instrument.toString().padStart(2, '0');
					}
					else {
						instrumentCell.innerText = '--';
					}
					effectCell.innerText = '---';
				} else {
					noteCell.innerText = '---';
					instrumentCell.innerText = '--';
					effectCell.innerText = '---';
				}

				if (trackerCellIndex !== 0) {
					noteCell.classList.add('channel-divider');
				}

				tableRow.appendChild(noteCell);
				tableRow.appendChild(instrumentCell);
				tableRow.appendChild(effectCell);
			});

			table.appendChild(tableRow);
		});
	}
}

enum PSGInstructionType {
	NoSoftNoHard = 0, // No software wave and no hardware wave are generated, so that only the noise and volume are available
	SoftOnly = 1, // Produces the nice, rectangular sound that we are all fond about. The volume, an arpeggio and pitch are available.
	SoftToHard = 2, // This is the typical hardware sound you hear in every modern YM/AY music. This is especially used for bass, as it may be quite ugly for high-pitched sound, depending on how you use it. Basically, the frequency is first calculated for the software part. Once it is done, the frequency is transmitted to the hardware part, adding more "life" to the somehow boring rectangular wave. In output, we have a rectangular wave modulated by the hardware curve.
	HardOnly = 3, // The software wave is disabled, so there is no rectangle wave. However, the hardware curve is on: according to the one chosen, you can have sawtooth or triangle wave. It sounds good for both bass and melodies. Two drawbacks: you can't set the volume, as the curve manages the volume itself, according to the hardware curve. And such curves will sound softer than a pure software (rectangle) sound.
	HardToSoft = 4, // This is the opposite of the "Soft to Hard": first, the hardware period is calculated, and the software wave will be generated according to it. The result is a very "still" result, which can be desynced at will, resulting in very interesting sounds, especially for bass. High-pitched sounds will very quickly sound out of key!
	HardAndSoft = 5, // It allows the software and hardware part to be autonomous. You could play a C in the software part, yet another note in the hardware part. With a bit of experiment, you can simulate two channels with just one channel! However, one simple yet effective effect is the "Ben Daglish" sounds: the hardware period is forced to a very low value (1, 2, 3...) yet the software period is normal: you can get funny melodic sounds.
}

enum PSGInstruction_EnvelopeType {
	Sawtooth = 0x8,
	Sawtooth_Mirrored = 0xc,
	Triangle = 0xa,
	Triangle_Mirrored = 0xe,
}

enum TrackerCell_EffectType {
	// Here is the list of all the effects managed in the patterns.
	// All pitch and volume slides continue till a new note is found. No need to spread these effects on several lines for a continuing effect! Use a 0 value to stop them if needed. Pitch effects will stop on each new note.
	a, // arpeggio table
	b, // arpeggio on 3 notes (the current one plus the two of the effect)
	c, // arpeggio on 4 notes (the current one plus the three of the effect)
	u, // pitch up
	d, // pitch down
	e, // fast pitch up
	f, // fast pitch down
	g, // pitch glide
	p, // pitch table
	v, // volume
	i, // volume in (louder)
	o, // volume out (softer)
	r, // reset and inverted volume
	s, // force the speed of an instrument
	w, // force the speed of an arpeggio
	x, // force the spped of a pitch
}

interface PSGInstruction {
	cellType: PSGInstructionType; // defines how the line will sound. According to it, some columns will be disabled because not taken in account.
	volume: number; // Quite simple to understand, the volume indicates how soft or loud the rectangle wave is, from 0 (inaudible) to 15 (&f, full). It is disabled as soon as the hardware part is involved (because the hardware takes control over the volume).
	noise?: number; // The noise is especially used for drums and special effects. 0 means no noise, else it varies from 1 (light noise) to 31 (low noise). It is the only parameter, along with the type, that is always available.
	period_software?: number, // This is the period of the software sound. The period is the invert of the frequency. The period can vary from 1 (very high pitch) to &fff (very low). But most of the time, you will use 0, meaning "auto" (you can type "auto" directly, but if you type "0", it will be transformed into "auto"). What "auto" means? It means that the period of your sound matches the one of your score. Most of the time that's what you want! You want your sound to "play" your music.
	pitch_software?: number; // The pitch will add a little (or a big!) bump in the frequency (from -&fff to &fff). It is effective at the beginning of a sound to add a little attack. But most of the time, you will use it to create a vibrato effect.
	arpeggio_software?: number; // This indicates how many semi-tones to add - or subtract - to the base note (from -&7f to &7f). This adds a lot of expression to the sound. For example, you can have a first line with an arpeggio of 12, that is, a whole octave, to add a nice attack to your sound. Or you can even add chords: one line at 0, the next at 4 the next at 7: you have a major chord.
	envelopeType?: PSGInstruction_EnvelopeType, // This indicates what hardware envelope is used. It is only available in modes where the hardware generator is enabled ("hard only", "hard to soft" and "soft and hard")! All the relevant envelopes available on the YM/AY can be selected (from 8 to 15, the ones from 0 to 7 are duplicate). However, you will probably use only 4 of them, which are denoted in the enum "EnvelopeType". That is because the others won't loop.
	period_hardware?: number, // This works exactly as the software period, except it has a larger range: from 1 to &ffff. Use 0 or "auto" for the hardware period to be calculated automatically.
	arpeggio_hardware?: number, // The same as for the software arpeggio. Only available for the same modes as the "hardware period", explained just above, and if the hardware period is "auto".
	pitch_hardware?: number, // The same as for the software pitch. Only available for the same modes as the "hardware period", explained just above, and if the hardware period is "auto". Also, this pitch can be used in Soft To Hard to add more desynchronization between the waves.
	ratio?: number, // This spec is neither in a "software" or "hardware" part. It is only available if both hardware and software are used: it serves as a mean to calculate the period of one part according to the other. Example: you used the "Soft to Hard" type. So first the software period is calculated, then the hardware period derives from it. But how? Easy: thanks to the ratio.
}

const keySpikeSpec: PSGInstruction[] = Array.from({ length: 15 }, (_, index) => ({
	volume: 15 - index,
	noise: 0,
	pitch: 0,
	cellType: PSGInstructionType.SoftOnly, // Use the InstrumentType enum here
}));

const bassdrumSpec: PSGInstruction[] = [
	{ cellType: PSGInstructionType.NoSoftNoHard, volume: 15, noise: 1, pitch_software: 0, },
	// { cellType: PSGInstructionType.NoSoftNoHard, volume: 14, noise: 1, pitch_software: -0x96, },
	// { cellType: PSGInstructionType.NoSoftNoHard, volume: 14, noise: 1, pitch_software: -0x96, },
	// { cellType: PSGInstructionType.NoSoftNoHard, volume: 14, noise: 1, pitch_software: -0x96, },
	// { cellType: PSGInstructionType.NoSoftNoHard, volume: 14, noise: 1, pitch_software: -0x96, },
	// { cellType: PSGInstructionType.NoSoftNoHard, volume: 14, noise: 1, pitch_software: -0x96, },
	{ cellType: PSGInstructionType.NoSoftNoHard, volume: 14, noise: 2, pitch_software: -0x96, },
	{ cellType: PSGInstructionType.SoftOnly, volume: 13, noise: 3, pitch_software: -0x12c, },
	{ cellType: PSGInstructionType.SoftOnly, volume: 12, noise: 4, pitch_software: -0x190, },
	{ cellType: PSGInstructionType.SoftOnly, volume: 11, noise: 5, pitch_software: -0x1f4, },
	{ cellType: PSGInstructionType.SoftOnly, volume: 10, noise: 6, pitch_software: -0x258, },
];

const instruments = [
	null, // Instrument 0 = No instrument
	new Instrument(keySpikeSpec),
	new Instrument(bassdrumSpec),
];

type TrackerCell = { // Each track is represented by 6 columns
	note: string; // Column 1, together with octave. HOWEVER, a note called "RST" is a rest note that stops the sound being produced for that channel!
	octave: number; // Column 1, together with note
	instrument: number; // Column 2, "01" indicates that the instrument 1 is used. The instrument 0 does not exist. It is possible that a note is present without any instrument. It means that a legato is used: the instrument does not start again when encountered: only the note changes. To create a legato, add a new note, and delete the instrument.
	effects?: string; // Columns 3 to 6: the 4 columns of effects. They are always composed of one lower-case letter indicating the type of the effect, and three digits maximum for its value. How many digits depends on the effect. For example, the Reset ("r") effect only accept one digit (0 here). The same for the volume effect ("v"). The pitch up ("u") however requires 3 digits.
	channelIndex: number; // Not a column, denotes the channel that will play the note
} | null;

type SongPattern = TrackerCell[][];

function parseTrackerCode(code: string): SongPattern {
	const lines = code.trim().split('\n');
	const patternLength = lines.length - 1; // Subtract 1 to ignore the pattern header
	const pattern: SongPattern = [];

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

const psg = new PSGEmulator();
psg.volume = .5;
const code = `
Pattern 0
  Row 0: C-4 01 --- | C-0 00 --- | --- -- ---
  Row 1: D-4 01 --- | C-1 00 --- | --- -- ---
  Row 2: E-4 01 --- | C-2 00 --- | --- -- ---
  Row 3: F-4 01 --- | C-3 00 --- | --- -- ---
  Row 4: G-4 02 --- | C-4 00 --- | --- -- ---
  Row 5: A-4 02 --- | C-5 00 --- | --- -- ---
  Row 6: B-4 02 --- | C-6 00 --- | --- -- ---
  Row 7: C-5 02 --- | C-7 00 --- | --- -- ---
`;
const tempo = 300; // Beats per minute
const pattern = parseTrackerCode(code);
console.log(pattern);
const song = new Song(psg, pattern, tempo, instruments);

window.addEventListener("DOMContentLoaded", (event) => {
	song.updateTrackerTable();
});

function start() {
	song.start();
	const pausebutton = document.getElementById('pause');
	pausebutton.removeAttribute('disabled');
}

function pause() {
	song.pause();
	const pausebutton = document.getElementById('pause');
	const contbutton = document.getElementById('continue');
	pausebutton.setAttribute('disabled', '');
	contbutton.removeAttribute('disabled');
}

function cont() {
	song.continue();
	const pausebutton = document.getElementById('pause');
	const contbutton = document.getElementById('continue');
	contbutton.setAttribute('disabled', '');
	pausebutton.removeAttribute('disabled');
}
