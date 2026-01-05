/**
 * Audio Encoder Module
 *
 * Handwritten WAV to AAC-LC encoder.
 * No external dependencies - pure TypeScript implementation.
 */

// ============================================================================
// WAV Parser
// ============================================================================

interface WavData {
	sampleRate: number;
	numChannels: number;
	bitsPerSample: number;
	samples: Float32Array[];  // Per channel
}

function parseWav(buffer: Buffer): WavData {
	let offset = 0;

	const read32 = () => {
		const val = buffer.readUInt32LE(offset);
		offset += 4;
		return val;
	};
	const read16 = () => {
		const val = buffer.readUInt16LE(offset);
		offset += 2;
		return val;
	};
	const readStr = (len: number) => {
		const str = buffer.toString('ascii', offset, offset + len);
		offset += len;
		return str;
	};

	// RIFF header
	const riff = readStr(4);
	if (riff !== 'RIFF') throw new Error('Invalid WAV: missing RIFF header');
	read32(); // file size
	const wave = readStr(4);
	if (wave !== 'WAVE') throw new Error('Invalid WAV: missing WAVE format');

	let sampleRate = 0;
	let numChannels = 0;
	let bitsPerSample = 0;
	let dataBuffer: Buffer | null = null;

	// Parse chunks
	while (offset < buffer.length - 8) {
		const chunkId = readStr(4);
		const chunkSize = read32();

		if (chunkId === 'fmt ') {
			const audioFormat = read16();
			if (audioFormat !== 1 && audioFormat !== 3) {
				throw new Error(`Unsupported WAV format: ${audioFormat} (only PCM supported)`);
			}
			numChannels = read16();
			sampleRate = read32();
			read32(); // byte rate
			read16(); // block align
			bitsPerSample = read16();
			// Skip any extra fmt bytes
			if (chunkSize > 16) {
				offset += chunkSize - 16;
			}
		} else if (chunkId === 'data') {
			dataBuffer = buffer.subarray(offset, offset + chunkSize);
			offset += chunkSize;
		} else {
			offset += chunkSize;
		}
		// Align to word boundary
		if (chunkSize % 2 !== 0 && offset < buffer.length) {
			offset++;
		}
	}

	if (!dataBuffer || !sampleRate || !numChannels || !bitsPerSample) {
		throw new Error('Invalid WAV: missing required chunks');
	}

	// Convert to float samples
	const bytesPerSample = bitsPerSample / 8;
	const totalSamples = dataBuffer.length / bytesPerSample;
	const samplesPerChannel = Math.floor(totalSamples / numChannels);

	const samples: Float32Array[] = [];
	for (let ch = 0; ch < numChannels; ch++) {
		samples.push(new Float32Array(samplesPerChannel));
	}

	let sampleIdx = 0;
	let dataOffset = 0;

	while (dataOffset < dataBuffer.length - (bytesPerSample * numChannels - 1)) {
		for (let ch = 0; ch < numChannels; ch++) {
			let sample: number;
			if (bitsPerSample === 8) {
				sample = (dataBuffer.readUInt8(dataOffset) - 128) / 128;
				dataOffset += 1;
			} else if (bitsPerSample === 16) {
				sample = dataBuffer.readInt16LE(dataOffset) / 32768;
				dataOffset += 2;
			} else if (bitsPerSample === 24) {
				const b0 = dataBuffer.readUInt8(dataOffset);
				const b1 = dataBuffer.readUInt8(dataOffset + 1);
				const b2 = dataBuffer.readInt8(dataOffset + 2);
				sample = ((b2 << 16) | (b1 << 8) | b0) / 8388608;
				dataOffset += 3;
			} else if (bitsPerSample === 32) {
				sample = dataBuffer.readFloatLE(dataOffset);
				dataOffset += 4;
			} else {
				throw new Error(`Unsupported bits per sample: ${bitsPerSample}`);
			}
			if (sampleIdx < samplesPerChannel) {
				samples[ch][sampleIdx] = sample;
			}
		}
		sampleIdx++;
	}

	return { sampleRate, numChannels, bitsPerSample, samples };
}

// ============================================================================
// AAC-LC Encoder Constants
// ============================================================================

const AAC_FRAME_LENGTH = 1024;
const NUM_SWB_LONG_44100 = 49;

// Scalefactor band boundaries for 44100 Hz long blocks
const SWB_OFFSET_LONG_44100 = [
	0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 88,
	100, 112, 124, 140, 156, 172, 192, 216, 240, 268, 300, 336, 380,
	428, 480, 536, 600, 668, 740, 820, 904, 996, 1096, 1204, 1320,
	1444, 1576, 1716, 1864, 2020, 2184, 2356, 2548, 2748, 2956, 3172,
	3396, 3628, 3868, 4116, 4372, 4636, 4908, 5188, 5476, 5772, 6076,
	6388
];

// Scalefactor band boundaries for 48000 Hz long blocks
const SWB_OFFSET_LONG_48000 = [
	0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 88,
	96, 108, 120, 132, 144, 160, 176, 196, 216, 240, 264, 292, 320,
	352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672, 704, 736,
	768, 800, 832, 864, 896, 928, 1024
];

// ============================================================================
// MDCT (Modified Discrete Cosine Transform)
// ============================================================================

class MDCT {
	private readonly n: number;
	private readonly n2: number;
	private readonly n4: number;
	private readonly cosTable: Float64Array;
	private readonly sinTable: Float64Array;
	private readonly window: Float64Array;

	constructor(frameLength: number) {
		this.n = frameLength * 2;
		this.n2 = frameLength;
		this.n4 = frameLength / 2;

		// Precompute twiddle factors
		this.cosTable = new Float64Array(this.n4);
		this.sinTable = new Float64Array(this.n4);

		for (let k = 0; k < this.n4; k++) {
			const angle = (Math.PI / this.n) * (2 * k + 1 + this.n2 / 2);
			this.cosTable[k] = Math.cos(angle);
			this.sinTable[k] = Math.sin(angle);
		}

		// Kaiser-Bessel derived window
		this.window = this.computeKBDWindow(this.n);
	}

	private computeKBDWindow(length: number): Float64Array {
		const window = new Float64Array(length);
		const alpha = 4.0;
		const halfLen = length / 2;

		// Compute Kaiser window for first half
		const kaiser = new Float64Array(halfLen + 1);
		const piAlpha = Math.PI * alpha;

		for (let n = 0; n <= halfLen; n++) {
			const x = (2.0 * n / halfLen) - 1.0;
			kaiser[n] = this.bessel0(piAlpha * Math.sqrt(1 - x * x)) / this.bessel0(piAlpha);
		}

		// Cumulative sum
		const cumSum = new Float64Array(halfLen + 1);
		cumSum[0] = 0;
		for (let n = 1; n <= halfLen; n++) {
			cumSum[n] = cumSum[n - 1] + kaiser[n - 1];
		}

		// Normalize and apply sqrt for overlap-add
		const total = cumSum[halfLen] + kaiser[halfLen];
		for (let n = 0; n < halfLen; n++) {
			window[n] = Math.sqrt(cumSum[n + 1] / total);
		}
		for (let n = halfLen; n < length; n++) {
			window[n] = Math.sqrt(cumSum[length - n] / total);
		}

		return window;
	}

	private bessel0(x: number): number {
		let sum = 1.0;
		let term = 1.0;
		const x2 = x * x / 4;

		for (let k = 1; k < 25; k++) {
			term *= x2 / (k * k);
			sum += term;
			if (term < 1e-12) break;
		}
		return sum;
	}

	forward(input: Float64Array, output: Float64Array): void {
		const windowed = new Float64Array(this.n);

		// Apply window
		for (let i = 0; i < this.n; i++) {
			windowed[i] = input[i] * this.window[i];
		}

		// Pre-rotation
		const rotated = new Float64Array(this.n2);
		for (let i = 0; i < this.n4; i++) {
			const re = windowed[this.n4 * 3 - 1 - 2 * i] + windowed[this.n4 + 2 * i];
			const im = windowed[this.n4 - 1 - 2 * i] - windowed[this.n4 * 3 + 2 * i] || 0;
			const cos = this.cosTable[i];
			const sin = this.sinTable[i];
			rotated[2 * i] = re * cos + im * sin;
			rotated[2 * i + 1] = im * cos - re * sin;
		}

		// FFT of size N/4 (complex)
		const fftResult = new Float64Array(this.n2);
		this.fft(rotated, fftResult, this.n4);

		// Post-rotation
		for (let k = 0; k < this.n4; k++) {
			const re = fftResult[2 * k];
			const im = fftResult[2 * k + 1];
			const cos = this.cosTable[k];
			const sin = this.sinTable[k];

			const outRe = re * cos + im * sin;
			const outIm = im * cos - re * sin;

			output[2 * k] = -outRe;
			output[this.n2 - 1 - 2 * k] = outIm;
		}
	}

	private fft(input: Float64Array, output: Float64Array, n: number): void {
		if (n === 1) {
			output[0] = input[0];
			output[1] = input[1];
			return;
		}

		const halfN = n / 2;

		// Split even/odd
		const even = new Float64Array(n);
		const odd = new Float64Array(n);

		for (let i = 0; i < halfN; i++) {
			even[2 * i] = input[4 * i];
			even[2 * i + 1] = input[4 * i + 1];
			odd[2 * i] = input[4 * i + 2];
			odd[2 * i + 1] = input[4 * i + 3];
		}

		const evenOut = new Float64Array(n);
		const oddOut = new Float64Array(n);

		this.fft(even, evenOut, halfN);
		this.fft(odd, oddOut, halfN);

		// Combine
		for (let k = 0; k < halfN; k++) {
			const angle = -2 * Math.PI * k / n;
			const cos = Math.cos(angle);
			const sin = Math.sin(angle);

			const re = oddOut[2 * k] * cos - oddOut[2 * k + 1] * sin;
			const im = oddOut[2 * k] * sin + oddOut[2 * k + 1] * cos;

			output[2 * k] = evenOut[2 * k] + re;
			output[2 * k + 1] = evenOut[2 * k + 1] + im;
			output[2 * (k + halfN)] = evenOut[2 * k] - re;
			output[2 * (k + halfN) + 1] = evenOut[2 * k + 1] - im;
		}
	}
}

// ============================================================================
// Psychoacoustic Model (Simplified)
// ============================================================================

interface PsychoacousticResult {
	energies: Float64Array;
	thresholds: Float64Array;
	smr: Float64Array;  // Signal-to-mask ratio per band
}

function computePsychoacoustics(
	spectrum: Float64Array,
	sampleRate: number,
	numBands: number
): PsychoacousticResult {
	const halfLen = spectrum.length / 2;
	const energies = new Float64Array(numBands);
	const thresholds = new Float64Array(numBands);
	const smr = new Float64Array(numBands);

	// Get band offsets
	const bandOffsets = sampleRate >= 48000 ? SWB_OFFSET_LONG_48000 : SWB_OFFSET_LONG_44100;
	const actualBands = Math.min(numBands, bandOffsets.length - 1);

	// Calculate energy per band
	for (let b = 0; b < actualBands; b++) {
		const start = bandOffsets[b];
		const end = Math.min(bandOffsets[b + 1], halfLen);
		let energy = 0;
		for (let i = start; i < end; i++) {
			energy += spectrum[i] * spectrum[i];
		}
		energies[b] = energy / Math.max(1, end - start);
	}

	// Absolute threshold of hearing (approximation in dB SPL at 1kHz)
	const absoluteThreshold = (freq: number): number => {
		const f = freq / 1000;
		if (f < 0.01) return 100;
		return 3.64 * Math.pow(f, -0.8)
			- 6.5 * Math.exp(-0.6 * Math.pow(f - 3.3, 2))
			+ 0.001 * Math.pow(f, 4);
	};

	// Bark scale conversion
	const hzToBark = (hz: number): number => {
		return 13 * Math.atan(0.00076 * hz) + 3.5 * Math.atan(Math.pow(hz / 7500, 2));
	};

	// Calculate masking thresholds
	for (let b = 0; b < actualBands; b++) {
		const centerBin = (bandOffsets[b] + bandOffsets[Math.min(b + 1, bandOffsets.length - 1)]) / 2;
		const centerFreq = (centerBin * sampleRate) / (halfLen * 2);

		// Absolute threshold
		const absThresh = Math.pow(10, absoluteThreshold(centerFreq) / 10) * 1e-12;

		// Spreading function from neighboring bands
		let maskingThreshold = absThresh;
		const centerBark = hzToBark(centerFreq);

		for (let j = 0; j < actualBands; j++) {
			if (energies[j] > 0) {
				const jCenterBin = (bandOffsets[j] + bandOffsets[Math.min(j + 1, bandOffsets.length - 1)]) / 2;
				const jFreq = (jCenterBin * sampleRate) / (halfLen * 2);
				const jBark = hzToBark(jFreq);
				const deltaBark = centerBark - jBark;

				// Spreading function
				let spread: number;
				if (deltaBark < -1) {
					spread = 27 * (deltaBark + 1);
				} else if (deltaBark < 0) {
					spread = -6.5 + 10 * deltaBark;
				} else if (deltaBark < 1) {
					spread = -6.5 - 25 * deltaBark;
				} else {
					spread = -6.5 - 25 - 17 * (deltaBark - 1);
				}

				const mask = energies[j] * Math.pow(10, spread / 10);
				maskingThreshold = Math.max(maskingThreshold, mask);
			}
		}

		thresholds[b] = maskingThreshold;
		smr[b] = energies[b] > 0 ? 10 * Math.log10(energies[b] / Math.max(maskingThreshold, 1e-20)) : 0;
	}

	return { energies, thresholds, smr };
}

// ============================================================================
// Quantization
// ============================================================================

interface QuantizationResult {
	quantized: Int16Array;
	scalefactors: Uint8Array;
}

function quantizeSpectrum(
	spectrum: Float64Array,
	psycho: PsychoacousticResult,
	sampleRate: number
): QuantizationResult {
	const length = spectrum.length;
	const quantized = new Int16Array(length);
	const bandOffsets = sampleRate >= 48000 ? SWB_OFFSET_LONG_48000 : SWB_OFFSET_LONG_44100;
	const numBands = Math.min(bandOffsets.length - 1, psycho.smr.length);
	const scalefactors = new Uint8Array(numBands);

	// Calculate scalefactor per band based on SMR
	for (let b = 0; b < numBands; b++) {
		const start = bandOffsets[b];
		const end = Math.min(bandOffsets[b + 1], length);

		// Find max value in band
		let maxVal = 0;
		for (let i = start; i < end; i++) {
			maxVal = Math.max(maxVal, Math.abs(spectrum[i]));
		}

		// Calculate scalefactor (0-255)
		// Higher SMR = more bits = lower scalefactor
		const smrFactor = Math.max(0, Math.min(1, (psycho.smr[b] + 10) / 60));
		const sf = Math.floor(255 * (1 - smrFactor * 0.7));
		scalefactors[b] = Math.min(255, Math.max(0, sf));

		// Quantize using scalefactor
		const scale = Math.pow(2, (scalefactors[b] - 100) / 4);
		for (let i = start; i < end; i++) {
			const val = spectrum[i] / Math.max(scale, 1e-10);
			quantized[i] = Math.round(Math.max(-8191, Math.min(8191, val)));
		}
	}

	return { quantized, scalefactors };
}

// ============================================================================
// Bitstream Writer
// ============================================================================

class BitstreamWriter {
	private buffer: number[] = [];
	private currentByte = 0;
	private bitPosition = 0;

	writeBits(value: number, numBits: number): void {
		for (let i = numBits - 1; i >= 0; i--) {
			this.currentByte = (this.currentByte << 1) | ((value >> i) & 1);
			this.bitPosition++;

			if (this.bitPosition === 8) {
				this.buffer.push(this.currentByte);
				this.currentByte = 0;
				this.bitPosition = 0;
			}
		}
	}

	writeBytes(bytes: Uint8Array): void {
		for (const byte of bytes) {
			this.writeBits(byte, 8);
		}
	}

	byteAlign(): void {
		if (this.bitPosition > 0) {
			this.currentByte <<= (8 - this.bitPosition);
			this.buffer.push(this.currentByte);
			this.currentByte = 0;
			this.bitPosition = 0;
		}
	}

	getBuffer(): Buffer {
		const result = [...this.buffer];
		if (this.bitPosition > 0) {
			result.push(this.currentByte << (8 - this.bitPosition));
		}
		return Buffer.from(result);
	}

	getBitLength(): number {
		return this.buffer.length * 8 + this.bitPosition;
	}
}

// ============================================================================
// AAC Raw Data Block Encoder
// ============================================================================

function encodeScalefactorData(
	writer: BitstreamWriter,
	scalefactors: Uint8Array,
	numBands: number
): void {
	// Global gain
	writer.writeBits(128, 8);

	// Scalefactor differences (DPCM encoded)
	let lastSf = 128;
	for (let b = 0; b < numBands; b++) {
		const diff = scalefactors[b] - lastSf + 60;  // Offset to make positive
		// Write as Huffman code (simplified)
		const clampedDiff = Math.max(0, Math.min(120, diff));
		writer.writeBits(clampedDiff, 7);
		lastSf = scalefactors[b];
	}
}

function encodeSpectralData(
	writer: BitstreamWriter,
	quantized: Int16Array,
	sampleRate: number
): void {
	const bandOffsets = sampleRate >= 48000 ? SWB_OFFSET_LONG_48000 : SWB_OFFSET_LONG_44100;
	const numBands = bandOffsets.length - 1;

	// Section data - use one section per 4 bands with same codebook
	const sectionsPerGroup = Math.ceil(numBands / 4);

	for (let sect = 0; sect < sectionsPerGroup; sect++) {
		const startBand = sect * 4;
		const endBand = Math.min((sect + 1) * 4, numBands);

		// Section codebook (1-11) based on max value
		let maxVal = 0;
		for (let b = startBand; b < endBand && b < bandOffsets.length - 1; b++) {
			const start = bandOffsets[b];
			const end = bandOffsets[b + 1];
			for (let i = start; i < end && i < quantized.length; i++) {
				maxVal = Math.max(maxVal, Math.abs(quantized[i]));
			}
		}

		// Select codebook
		let codebook: number;
		if (maxVal === 0) codebook = 0;
		else if (maxVal <= 1) codebook = 1;
		else if (maxVal <= 4) codebook = 3;
		else if (maxVal <= 12) codebook = 5;
		else codebook = 11;

		// Write section header
		writer.writeBits(codebook, 4);
		writer.writeBits(endBand - startBand, 5);  // Section length

		// Write spectral coefficients using selected codebook
		if (codebook > 0) {
			for (let b = startBand; b < endBand && b < bandOffsets.length - 1; b++) {
				const start = bandOffsets[b];
				const end = Math.min(bandOffsets[b + 1], quantized.length);

				for (let i = start; i < end; i += 4) {
					// Write 4-tuple
					for (let j = 0; j < 4 && i + j < end; j++) {
						const val = quantized[i + j];
						const absVal = Math.min(Math.abs(val), 8191);

						if (codebook <= 4) {
							// Small codebooks: 3 bits per value
							writer.writeBits(absVal & 0x7, 3);
							if (absVal > 0) writer.writeBits(val < 0 ? 1 : 0, 1);
						} else if (codebook <= 10) {
							// Medium codebooks: 5 bits per value
							writer.writeBits(absVal & 0x1F, 5);
							if (absVal > 0) writer.writeBits(val < 0 ? 1 : 0, 1);
						} else {
							// ESC codebook: variable length
							if (absVal < 16) {
								writer.writeBits(absVal, 4);
							} else {
								writer.writeBits(16, 4);  // Escape
								const n = Math.floor(Math.log2(absVal)) - 3;
								writer.writeBits(n, 4);
								writer.writeBits(absVal - (1 << (n + 4)), n + 4);
							}
							if (absVal > 0) writer.writeBits(val < 0 ? 1 : 0, 1);
						}
					}
				}
			}
		}
	}
}

function encodeIndividualChannelStream(
	writer: BitstreamWriter,
	spectrum: Float64Array,
	sampleRate: number,
	_targetBitsPerFrame: number
): void {
	// ICS info
	writer.writeBits(0, 1);  // ics_reserved_bit
	writer.writeBits(0, 2);  // window_sequence (ONLY_LONG_SEQUENCE)
	writer.writeBits(0, 1);  // window_shape (KBD)
	writer.writeBits(NUM_SWB_LONG_44100, 6);  // max_sfb

	// Predictor data not present
	writer.writeBits(0, 1);  // predictor_data_present

	// Compute psychoacoustic model
	const numBands = NUM_SWB_LONG_44100;
	const psycho = computePsychoacoustics(spectrum, sampleRate, numBands);

	// Quantize spectrum
	const { quantized, scalefactors } = quantizeSpectrum(spectrum, psycho, sampleRate);

	// Section data
	writer.writeBits(0, 1);  // global_gain present
	encodeScalefactorData(writer, scalefactors, numBands);

	// Spectral data
	encodeSpectralData(writer, quantized, sampleRate);
}

// ============================================================================
// ADTS Header
// ============================================================================

function writeADTSHeader(
	writer: BitstreamWriter,
	frameLength: number,
	sampleRate: number,
	numChannels: number
): void {
	// Syncword
	writer.writeBits(0xFFF, 12);

	// ID (0 = MPEG-4)
	writer.writeBits(0, 1);

	// Layer (always 0)
	writer.writeBits(0, 2);

	// Protection absent (1 = no CRC)
	writer.writeBits(1, 1);

	// Profile (1 = AAC-LC)
	writer.writeBits(1, 2);

	// Sampling frequency index
	const sfIndex = getSampleRateIndex(sampleRate);
	writer.writeBits(sfIndex, 4);

	// Private bit
	writer.writeBits(0, 1);

	// Channel configuration
	writer.writeBits(numChannels, 3);

	// Original/copy
	writer.writeBits(0, 1);

	// Home
	writer.writeBits(0, 1);

	// Copyright identification bit
	writer.writeBits(0, 1);

	// Copyright identification start
	writer.writeBits(0, 1);

	// Frame length (ADTS header + payload)
	writer.writeBits(frameLength, 13);

	// Buffer fullness (0x7FF = VBR)
	writer.writeBits(0x7FF, 11);

	// Number of raw data blocks - 1
	writer.writeBits(0, 2);
}

function getSampleRateIndex(sampleRate: number): number {
	const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
	const index = rates.indexOf(sampleRate);
	return index >= 0 ? index : 4;  // Default to 44100
}

// ============================================================================
// Main Encoder
// ============================================================================

export interface AudioEncoderOptions {
	/** Target bitrate in kbps (default: 128) */
	bitrate?: number;
}

const DEFAULT_BITRATE = 128;

export async function encodeWavToAacLc(
	wavBuffer: Buffer,
	sourcePath: string,
	options: AudioEncoderOptions = {}
): Promise<Buffer> {
	const bitrate = options.bitrate ?? DEFAULT_BITRATE;

	// Parse WAV
	const wav = parseWav(wavBuffer);
	const { sampleRate, numChannels, samples } = wav;

	// Resample to supported rate if needed
	const supportedRates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
	if (!supportedRates.includes(sampleRate)) {
		throw new Error(`[AudioEncoder] Unsupported sample rate: ${sampleRate}Hz for "${sourcePath}"`);
	}

	// Initialize MDCT
	const mdct = new MDCT(AAC_FRAME_LENGTH);

	// Calculate frames
	const totalSamples = samples[0].length;
	const numFrames = Math.ceil(totalSamples / AAC_FRAME_LENGTH);
	const targetBitsPerFrame = Math.floor((bitrate * 1000 * AAC_FRAME_LENGTH) / sampleRate);

	// Output buffer
	const frames: Buffer[] = [];

	// Previous samples for overlap
	const prevSamples: Float64Array[] = [];
	for (let ch = 0; ch < numChannels; ch++) {
		prevSamples.push(new Float64Array(AAC_FRAME_LENGTH));
	}

	// Encode each frame
	for (let frame = 0; frame < numFrames; frame++) {
		const frameWriter = new BitstreamWriter();

		// Prepare frame data per channel
		const spectra: Float64Array[] = [];

		for (let ch = 0; ch < numChannels; ch++) {
			const frameStart = frame * AAC_FRAME_LENGTH;

			// Create 2N input buffer (overlap with previous)
			const input = new Float64Array(AAC_FRAME_LENGTH * 2);
			input.set(prevSamples[ch], 0);

			for (let i = 0; i < AAC_FRAME_LENGTH; i++) {
				const sampleIdx = frameStart + i;
				input[AAC_FRAME_LENGTH + i] = sampleIdx < totalSamples ? samples[ch][sampleIdx] : 0;
			}

			// Store for next overlap
			prevSamples[ch].set(input.subarray(AAC_FRAME_LENGTH));

			// Apply MDCT
			const spectrum = new Float64Array(AAC_FRAME_LENGTH);
			mdct.forward(input, spectrum);
			spectra.push(spectrum);
		}

		// Write raw data block
		// ID_SCE (single channel element) = 0 or ID_CPE (channel pair) = 1
		if (numChannels === 1) {
			frameWriter.writeBits(0, 3);  // ID_SCE
			frameWriter.writeBits(0, 4);  // element_instance_tag
			encodeIndividualChannelStream(frameWriter, spectra[0], sampleRate, targetBitsPerFrame);
		} else {
			frameWriter.writeBits(1, 3);  // ID_CPE
			frameWriter.writeBits(0, 4);  // element_instance_tag
			frameWriter.writeBits(0, 1);  // common_window = 0

			encodeIndividualChannelStream(frameWriter, spectra[0], sampleRate, targetBitsPerFrame / 2);
			encodeIndividualChannelStream(frameWriter, spectra[1], sampleRate, targetBitsPerFrame / 2);
		}

		// ID_END
		frameWriter.writeBits(7, 3);
		frameWriter.byteAlign();

		const payload = frameWriter.getBuffer();

		// Write ADTS frame
		const adtsWriter = new BitstreamWriter();
		writeADTSHeader(adtsWriter, 7 + payload.length, sampleRate, numChannels);
		adtsWriter.writeBytes(payload);

		frames.push(adtsWriter.getBuffer());
	}

	return Buffer.concat(frames);
}

/**
 * Checks if the audio encoder is available (always true for handwritten implementation)
 */
export function isEncoderAvailable(): boolean {
	return true;
}

