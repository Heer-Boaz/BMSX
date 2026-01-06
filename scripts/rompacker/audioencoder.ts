/**
 * Minimal AAC-LC (MPEG-2/4 AAC LC) ADTS encoder in pure TypeScript.
 *
 * Produces decodable ADTS/AAC frames from PCM WAV input.
 *
 * Scope / design choices:
 *  - Long blocks only (ONLY_LONG_SEQUENCE, 1024-sample frames)
 *  - Sine window (window_shape = 0)
 *  - No TNS, no MS stereo, no LTP, no PNS, no pulse, no gain control
 *  - No psychoacoustic model; very simple rate-control via global_gain search
 *  - Spectrum coded with Huffman Codebook 11 (ESC), and ZERO_HCB for all-zero bands
 *
 * Intended use:
 *  - Prototyping / experimentation, not production.
 *
 * References:
 *  - ISO/IEC 13818-7:2004 (AAC) syntax and Huffman tables.
 */

import { Buffer } from "buffer";

// ============================================================================
// WAV Parser (PCM integer + IEEE float32)
// ============================================================================

interface WavData {
	sampleRate: number;
	numChannels: number;
	bitsPerSample: number;
	samples: Float32Array[]; // de-interleaved, normalized to [-1, 1]
}

function parseWav(buffer: Buffer): WavData {
	let offset = 0;

	const read32 = () => buffer.readUInt32LE(offset);
	const read16 = () => buffer.readUInt16LE(offset);
	const readStr = (len: number) => buffer.toString("ascii", offset, offset + len);

	const expect = (got: string, expected: string) => {
		if (got !== expected) throw new Error(`Invalid WAV: expected ${expected}, got ${got}`);
	};

	// RIFF/WAVE
	expect(readStr(4), "RIFF");
	offset += 4;
	offset += 4; // file size
	expect(readStr(4), "WAVE");
	offset += 4;

	let audioFormat = 0;
	let sampleRate = 0,
		numChannels = 0,
		bitsPerSample = 0;
	let dataBuffer: Buffer | null = null;

	while (offset + 8 <= buffer.length) {
		const id = readStr(4);
		offset += 4;
		const size = read32();
		offset += 4;

		if (id === "fmt ") {
			audioFormat = read16();
			offset += 2; // 1=PCM, 3=IEEE float
			numChannels = read16();
			offset += 2;
			sampleRate = read32();
			offset += 4;
			offset += 6; // byteRate (4) + blockAlign (2)
			bitsPerSample = read16();
			offset += 2;
			if (size > 16) offset += size - 16;
		} else if (id === "data") {
			dataBuffer = buffer.subarray(offset, offset + size);
			offset += size;
		} else {
			offset += size;
		}

		// chunk padding to even
		if (offset & 1) offset++;
	}

	if (!dataBuffer) throw new Error("WAV missing data chunk");
	if (numChannels <= 0) throw new Error("Invalid WAV: numChannels <= 0");
	if (!sampleRate) throw new Error("Invalid WAV: missing sampleRate");
	if (!bitsPerSample) throw new Error("Invalid WAV: missing bitsPerSample");

	const bytesPerSample = bitsPerSample / 8;
	const totalSamples = Math.floor(dataBuffer.length / bytesPerSample / numChannels);

	const samples: Float32Array[] = Array.from({ length: numChannels }, () => new Float32Array(totalSamples));

	let pos = 0;

	const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));

	for (let i = 0; i < totalSamples; i++) {
		for (let ch = 0; ch < numChannels; ch++) {
			let v = 0;

			if (audioFormat === 3) {
				// IEEE float
				if (bitsPerSample !== 32) throw new Error(`Unsupported float WAV bitsPerSample: ${bitsPerSample}`);
				v = dataBuffer.readFloatLE(pos);
				pos += 4;
				v = clamp1(v);
			} else {
				// PCM integer
				if (bitsPerSample === 8) {
					v = (dataBuffer.readUInt8(pos++) - 128) / 128;
				} else if (bitsPerSample === 16) {
					v = dataBuffer.readInt16LE(pos) / 32768;
					pos += 2;
				} else if (bitsPerSample === 24) {
					const b0 = dataBuffer.readUInt8(pos++);
					const b1 = dataBuffer.readUInt8(pos++);
					const b2 = dataBuffer.readInt8(pos++);
					const s = (b2 << 16) | (b1 << 8) | b0;
					v = s / 8388608;
				} else if (bitsPerSample === 32) {
					v = dataBuffer.readInt32LE(pos) / 2147483648;
					pos += 4;
				} else {
					throw new Error(`Unsupported PCM WAV bitsPerSample: ${bitsPerSample}`);
				}
			}

			samples[ch][i] = v;
		}
	}

	return { sampleRate, numChannels, bitsPerSample, samples };
}

// ============================================================================
// Bitstream Writer
// ============================================================================

class BitWriter {
	private bytes: number[] = [];
	private curByte = 0;
	private curBits = 0;
	private totalBits = 0;

	writeBits(v: number, n: number): void {
		if (n === 0) return;
		// write MSB-first
		for (let i = n - 1; i >= 0; i--) {
			this.curByte = (this.curByte << 1) | ((v >> i) & 1);
			this.curBits++;
			this.totalBits++;
			if (this.curBits === 8) {
				this.bytes.push(this.curByte & 0xff);
				this.curByte = 0;
				this.curBits = 0;
			}
		}
	}

	byteAlign(): void {
		while (this.curBits !== 0) this.writeBits(0, 1);
	}

	writeBuffer(buf: Buffer): void {
		// assumes byte aligned, but will still work if not (bit-by-bit)
		for (let i = 0; i < buf.length; i++) this.writeBits(buf[i], 8);
	}

	getBitCount(): number {
		return this.totalBits;
	}

	getBuffer(): Buffer {
		const out = this.bytes.slice();
		if (this.curBits > 0) out.push((this.curByte << (8 - this.curBits)) & 0xff);
		return Buffer.from(out);
	}
}

// ============================================================================
// MDCT (long blocks, N=1024) with sine window
// ============================================================================

const AAC_FRAME = 1024;
const PCM_SCALE = 65536.0; // bring normalized [-1,1] PCM to a typical AAC internal scale
const TWO_N = AAC_FRAME * 2;
const PI = Math.PI;

class Mdct1024 {
	private window: Float64Array;
	private buf: Float64Array;

	constructor() {
		this.window = new Float64Array(TWO_N);
		for (let n = 0; n < TWO_N; n++) {
			// Sine window for long blocks
			this.window[n] = Math.sin((PI / (2 * AAC_FRAME)) * (n + 0.5));
		}
		this.buf = new Float64Array(TWO_N);
	}

	forward(input: Float64Array, out: Float64Array): void {
		// window
		for (let n = 0; n < TWO_N; n++) {
			this.buf[n] = input[n] * this.window[n];
		}

		const N = AAC_FRAME;

		for (let k = 0; k < N; k++) {
			const dk = (PI / N) * (k + 0.5);
			const cosD = Math.cos(dk);
			const sinD = Math.sin(dk);

			// angle for n=0: (n + 0.5 + N/2) * dk
			let angle = (0.5 + N / 2) * dk;
			let cosA = Math.cos(angle);
			let sinA = Math.sin(angle);

			let sum = 0;
			for (let n = 0; n < TWO_N; n++) {
				sum += this.buf[n] * cosA;

				// recurrence: advance angle by dk
				const nextCos = cosA * cosD - sinA * sinD;
				const nextSin = sinA * cosD + cosA * sinD;
				cosA = nextCos;
				sinA = nextSin;
			}
			out[k] = sum;
		}
	}
}

// ============================================================================
// AAC tables (scalefactor bands, Huffman codebooks)
// ============================================================================

// Sampling frequency index (ADTS / AAC)
const AAC_SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000] as const;

function getSampleRateIndex(sampleRate: number): number {
	const idx = AAC_SAMPLE_RATES.indexOf(sampleRate as any);
	return idx >= 0 ? idx : -1;
}

// --- Scalefactor band offsets for long windows (1024), from FAAD2 tables ---

const SWB_OFFSET_1024_96 = new Uint16Array([
	0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 64, 72, 80, 88, 96, 108, 120, 132, 144,
	156, 172, 188, 204, 220, 240, 260, 284, 308, 336, 364, 396, 432, 468, 508, 552, 600, 652, 704, 768,
	832, 896, 960, 1024,
]);

const SWB_OFFSET_1024_64 = new Uint16Array([
	0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 64, 72, 80, 88, 100, 112, 124, 140, 156,
	172, 192, 216, 240, 268, 304, 344, 384, 424, 464, 504, 544, 584, 624, 664, 704, 744, 784, 824, 864,
	904, 944, 984, 1024,
]);

const SWB_OFFSET_1024_48 = new Uint16Array([
	0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 88, 96, 108, 120, 132, 144, 160, 176,
	196, 216, 240, 264, 292, 320, 352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672, 704, 736, 768,
	800, 832, 864, 896, 928, 1024,
]);

const SWB_OFFSET_1024_32 = new Uint16Array([
	0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 88, 96, 108, 120, 132, 144, 160, 176,
	196, 216, 240, 264, 292, 320, 352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672, 704, 736, 768,
	800, 832, 864, 896, 928, 960, 992, 1024,
]);

const SWB_OFFSET_1024_24 = new Uint16Array([
	0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 52, 60, 68, 76, 84, 92, 104, 116, 128, 140, 156, 172,
	192, 212, 240, 268, 304, 344, 384, 424, 464, 504, 544, 584, 624, 664, 704, 744, 784, 824, 864, 904,
	944, 984, 1024,
]);

const SWB_OFFSET_1024_16 = new Uint16Array([
	0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 100, 112, 124, 136, 148, 160, 172, 184, 196, 212, 228,
	244, 260, 276, 292, 308, 324, 344, 364, 384, 404, 424, 444, 464, 488, 512, 536, 560, 584, 608, 632,
	656, 680, 704, 728, 752, 776, 800, 824, 848, 872, 896, 920, 944, 968, 992, 1024,
]);

const SWB_OFFSET_1024_8 = new Uint16Array([
	0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132, 144, 156, 172, 188, 204, 220, 236, 252, 268, 288,
	308, 328, 348, 372, 396, 420, 448, 476, 508, 544, 580, 620, 664, 712, 764, 820, 880, 944, 1024,
]);

const SWB_OFFSET_1024_WINDOW: Uint16Array[] = [
	SWB_OFFSET_1024_96, // 96000
	SWB_OFFSET_1024_96, // 88200
	SWB_OFFSET_1024_64, // 64000
	SWB_OFFSET_1024_48, // 48000
	SWB_OFFSET_1024_48, // 44100
	SWB_OFFSET_1024_32, // 32000
	SWB_OFFSET_1024_24, // 24000
	SWB_OFFSET_1024_24, // 22050
	SWB_OFFSET_1024_16, // 16000
	SWB_OFFSET_1024_16, // 12000
	SWB_OFFSET_1024_16, // 11025
	SWB_OFFSET_1024_8, // 8000
];

// --- Huffman codebooks (ISO/IEC 13818-7:2004 Annex A) ---

// Scalefactor Huffman codebook (Table A.1), indices 0..120 (dpcm_sf + 60)
const HCB_SF_LENS = new Uint8Array([
	19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 17, 17,
	17, 17, 17, 17, 17, 17, 17, 17, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 15, 15, 15, 15, 15, 15,
	15, 15, 14, 14, 14, 14, 14, 14, 13, 13, 12, 12, 11, 11, 10, 9, 8, 7, 6, 6, 5, 5, 4, 4, 3, 3, 3, 3,
	3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
	2, 3, 3, 3, 3, 3, 4, 4, 5, 5, 6, 6, 7, 8, 9, 10, 11, 11, 12, 12, 13, 13, 14, 14, 14, 14, 14, 14,
	15, 15, 15, 15, 15, 15, 15, 15, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 17, 17,
	17, 17, 17, 17, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19,
	19,
]);

const HCB_SF_CODES = new Uint32Array([
	524287, 524286, 524285, 524284, 524283, 524282, 524281, 524280, 524279, 524278, 524277, 262132, 262131,
	262130, 262129, 262128, 262127, 262126, 262125, 262124, 262123, 262122, 131056, 131055, 131054, 131053,
	131052, 131051, 131050, 131049, 131048, 131047, 65512, 65511, 65510, 65509, 65508, 65507, 65506, 65505,
	65504, 65503, 32738, 32737, 32736, 32735, 32734, 32733, 32732, 32731, 16370, 16369, 16368, 16367, 16366,
	16365, 8181, 8180, 4088, 4087, 2043, 2042, 1018, 506, 250, 122, 58, 57, 26, 25, 10, 9, 2, 1, 0, 12,
	13, 14, 15, 11, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
	24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
	49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73,
	74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98,
	99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119,
	120,
]);

// Spectrum Huffman Codebook 11 (ESC) (Table A.12), indices 0..288 for (y,z) with 0..16 (unsigned)
const HCB11_LENS = new Uint8Array([
	4, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 10, 10, 10, 11, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 10, 10,
	10, 11, 5, 6, 6, 7, 7, 7, 8, 8, 9, 9, 9, 10, 10, 11, 11, 12, 6, 6, 7, 7, 7, 8, 8, 9, 9, 9, 10, 10,
	11, 11, 12, 7, 7, 7, 8, 8, 9, 9, 9, 10, 10, 11, 11, 12, 12, 8, 7, 8, 8, 9, 9, 9, 10, 10, 11, 11,
	12, 12, 12, 8, 8, 8, 9, 9, 9, 10, 10, 11, 11, 12, 12, 12, 9, 9, 9, 9, 10, 10, 11, 11, 12, 12, 12,
	12, 9, 9, 9, 10, 10, 11, 11, 12, 12, 12, 12, 12, 10, 10, 9, 10, 11, 11, 12, 12, 12, 12, 12, 12, 11,
	10, 10, 11, 11, 12, 12, 12, 12, 12, 12, 12, 11, 11, 11, 11, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
	12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 4, 5, 5, 6, 6, 7, 7, 7, 8,
	8, 8, 9, 9, 10, 10, 10, 11, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 10, 10, 10, 11, 5, 6, 6, 7, 7, 7,
	8, 8, 9, 9, 9, 10, 10, 11, 11, 12, 6, 6, 7, 7, 7, 8, 8, 9, 9, 9, 10, 10, 11, 11, 12, 7, 7, 7, 8,
	8, 9, 9, 9, 10, 10, 11, 11, 12, 12, 8, 7, 8, 8, 9, 9, 9, 10, 10, 11, 11, 12, 12, 12, 8, 8, 8, 9,
	9, 9, 10, 10, 11, 11, 12, 12, 12, 9, 9, 9, 9, 10, 10, 11, 11, 12, 12, 12, 12, 9, 9, 9, 10, 10, 11,
	11, 12, 12, 12, 12, 12, 10, 10, 9, 10, 11, 11, 12, 12, 12, 12, 12, 12, 11, 10, 10, 11, 11, 12, 12,
	12, 12, 12, 12, 12, 11, 11, 11, 11, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
	12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
]);

const HCB11_CODES = new Uint16Array([
	0, 6, 5, 28, 24, 126, 120, 96, 510, 486, 450, 2046, 1638, 8188, 8185, 8180, 16371, 4, 3, 20, 16, 112,
	92, 64, 418, 390, 346, 1758, 1374, 7989, 7981, 7968, 15929, 14, 12, 18, 66, 62, 60, 314, 302, 478,
	414, 350, 1310, 7990, 16370, 15928, 31950, 26, 22, 56, 54, 58, 254, 230, 398, 362, 306, 1759, 16369,
	31951, 31948, 63982, 124, 88, 68, 116, 100, 466, 364, 304, 1632, 1600, 31949, 31946, 63983, 63980, 488,
	90, 94, 104, 374, 380, 356, 1548, 7991, 31947, 63981, 63978, 63976, 63971, 506, 394, 348, 340, 420,
	308, 1601, 31945, 63979, 63975, 63973, 63970, 2047, 1637, 1311, 414, 1760, 31944, 63977, 63974, 63972,
	63969, 63966, 8186, 7988, 7992, 1636, 31943, 63968, 63965, 63967, 63964, 63961, 63959, 1635, 8191,
	8184, 7980, 63963, 63962, 63960, 63957, 63958, 63956, 63953, 16373, 16372, 15927, 7986, 63955, 63954,
	63952, 63950, 63951, 63949, 63946, 31953, 31952, 31941, 15922, 63948, 63947, 63945, 63943, 63944, 63942,
	63939, 63999, 63998, 63997, 31937, 63941, 63940, 63938, 63936, 63937, 63935, 63932, 0, 6, 5, 28, 24,
	126, 120, 96, 510, 486, 450, 2046, 1638, 8188, 8185, 8180, 16371, 4, 3, 20, 16, 112, 92, 64, 418, 390,
	346, 1758, 1374, 7989, 7981, 7968, 15929, 14, 12, 18, 66, 62, 60, 314, 302, 478, 414, 350, 1310, 7990,
	16370, 15928, 31950, 26, 22, 56, 54, 58, 254, 230, 398, 362, 306, 1759, 16369, 31951, 31948, 63982, 124,
	88, 68, 116, 100, 466, 364, 304, 1632, 1600, 31949, 31946, 63983, 63980, 488, 90, 94, 104, 374, 380,
	356, 1548, 7991, 31947, 63981, 63978, 63976, 63971, 506, 394, 348, 340, 420, 308, 1601, 31945, 63979,
	63975, 63973, 63970, 2047, 1637, 1311, 414, 1760, 31944, 63977, 63974, 63972, 63969, 63966, 8186, 7988,
	7992, 1636, 31943, 63968, 63965, 63967, 63964, 63961, 63959, 1635, 8191, 8184, 7980, 63963, 63962, 63960,
	63957, 63958, 63956, 63953, 16373, 16372, 15927, 7986, 63955, 63954, 63952, 63950, 63951, 63949, 63946,
	31953, 31952, 31941, 15922, 63948, 63947, 63945, 63943, 63944, 63942, 63939, 63999, 63998, 63997, 31937,
	63941, 63940, 63938, 63936, 63937, 63935, 63932,
]);

// ============================================================================
// Huffman helpers (Codebook 11 + scalefactors)
// ============================================================================

const HCB_ZERO = 0;
const HCB_ESC = 11; // Codebook 11

function writeScalefactorDiff(writer: BitWriter, diff: number): void {
	// dpcm_sf range -60..+60, coded as index 0..120 where index = diff + 60
	const idx = Math.max(0, Math.min(120, diff + 60));
	writer.writeBits(HCB_SF_CODES[idx], HCB_SF_LENS[idx]);
}

function escapeSequenceBitLen(absVal: number): number {
	// Table 60 encoding length: unary prefix (i-4 ones + 0) + i bits, where absVal = 2^i + n, i>=4
	let i = 4;
	while (i < 31 && absVal >= (1 << (i + 1))) i++;
	return (i - 3) + i; // (i-4)+1 + i = 2i-3
}

function writeEscapeSequence(writer: BitWriter, absVal: number): void {
	// absVal >= 16
	let i = 4;
	while (i < 31 && absVal >= (1 << (i + 1))) i++;

	// unary prefix: (i-4) times '1', then '0'
	for (let j = 4; j < i; j++) writer.writeBits(1, 1);
	writer.writeBits(0, 1);

	const n = absVal - (1 << i);
	writer.writeBits(n, i);
}

function pair11BitLen(a: number, b: number): number {
	const absA = Math.abs(a);
	const absB = Math.abs(b);
	const baseA = absA > 16 ? 16 : absA;
	const baseB = absB > 16 ? 16 : absB;
	const idx = baseA * 17 + baseB;

	let bits = HCB11_LENS[idx];
	if (baseA !== 0) bits += 1;
	if (baseB !== 0) bits += 1;
	if (baseA === 16) bits += escapeSequenceBitLen(absA);
	if (baseB === 16) bits += escapeSequenceBitLen(absB);
	return bits;
}

function writePair11(writer: BitWriter, a: number, b: number): void {
	const absA = Math.abs(a);
	const absB = Math.abs(b);
	const baseA = absA > 16 ? 16 : absA;
	const baseB = absB > 16 ? 16 : absB;
	const idx = baseA * 17 + baseB;

	writer.writeBits(HCB11_CODES[idx], HCB11_LENS[idx]);

	// unsigned_cb = 1 => sign bits for each non-zero value, then escape sequences
	if (baseA !== 0) writer.writeBits(a < 0 ? 1 : 0, 1);
	if (baseB !== 0) writer.writeBits(b < 0 ? 1 : 0, 1);

	if (baseA === 16) writeEscapeSequence(writer, absA);
	if (baseB === 16) writeEscapeSequence(writer, absB);
}

// ============================================================================
// Quantisation (simple, constant scalefactor per coded band)
// ============================================================================

const SF_OFFSET = 100; // ISO/IEC 13818-7:2004 get_scale_factor_gain()

function sfGain(sf: number): number {
	// 2^(0.25*(sf - 100))
	return Math.pow(2, 0.25 * (sf - SF_OFFSET));
}

function quantizeCoefficient(x: number, gain: number): number {
	const ax = Math.abs(x);
	if (ax === 0) return 0;
	const v = ax / gain;
	// encoder-side approximation; decoders perform invquant = |q|^(4/3) then multiply by gain
	const qMag = Math.floor(Math.pow(v, 0.75) + 0.4054);
	const q = qMag > 8191 ? 8191 : qMag;
	return x < 0 ? -q : q;
}

function quantizeSpectrum(spec: Float64Array, outQuant: Int16Array, maxLines: number, gain: number): void {
	for (let i = 0; i < maxLines; i++) {
		outQuant[i] = quantizeCoefficient(spec[i], gain);
	}
	for (let i = maxLines; i < outQuant.length; i++) outQuant[i] = 0;
}

function computeSfbCodebooks(quant: Int16Array, swbOffsets: Uint16Array, maxSfb: number, outSfbCb: Uint8Array): number {
	// Returns number of non-zero (coded) bands
	let codedBands = 0;
	for (let sfb = 0; sfb < maxSfb; sfb++) {
		const start = swbOffsets[sfb];
		const end = swbOffsets[sfb + 1];

		let allZero = true;
		for (let i = start; i < end; i++) {
			if (quant[i] !== 0) {
				allZero = false;
				break;
			}
		}

		if (allZero) {
			outSfbCb[sfb] = HCB_ZERO;
		} else {
			outSfbCb[sfb] = HCB_ESC;
			codedBands++;
		}
	}
	return codedBands;
}

// ============================================================================
// Side info writing (ICS, section_data, scalefactors, spectral_data)
// ============================================================================

function writeIcsInfoLong(writer: BitWriter, maxSfb: number): void {
	// Table 15 (ics_info) for long blocks, predictor_data_present = 0
	writer.writeBits(0, 1); // ics_reserved_bit
	writer.writeBits(0, 2); // window_sequence = ONLY_LONG_SEQUENCE
	writer.writeBits(0, 1); // window_shape = SINE_WINDOW
	writer.writeBits(maxSfb, 6);
	writer.writeBits(0, 1); // predictor_data_present = 0
}

function writeSectionDataLong(writer: BitWriter, sfbCb: Uint8Array): void {
	// Table 17 (section_data), long blocks => sect_bits = 5, sect_esc_val = 31
	const maxSfb = sfbCb.length;
	const sectBits = 5;
	const escVal = (1 << sectBits) - 1; // 31

	let sfb = 0;
	while (sfb < maxSfb) {
		const cb = sfbCb[sfb] & 0x0f;
		let run = 1;
		while (sfb + run < maxSfb && sfbCb[sfb + run] === cb) run++;

		writer.writeBits(cb, 4);

		let rem = run;
		while (rem >= escVal) {
			writer.writeBits(escVal, sectBits);
			rem -= escVal;
		}
		writer.writeBits(rem, sectBits); // may be 0

		sfb += run;
	}
}

function estimateSectionDataBitsLong(sfbCb: Uint8Array): number {
	const maxSfb = sfbCb.length;
	const sectBits = 5;
	const escVal = (1 << sectBits) - 1;

	let bits = 0;
	let sfb = 0;
	while (sfb < maxSfb) {
		const cb = sfbCb[sfb];
		let run = 1;
		while (sfb + run < maxSfb && sfbCb[sfb + run] === cb) run++;

		bits += 4; // sect_cb
		// sect_len_incr chunks
		const chunks = Math.floor(run / escVal) + 1;
		bits += chunks * sectBits;

		sfb += run;
	}
	return bits;
}

function writeScaleFactorDataConstant(writer: BitWriter, sfbCb: Uint8Array): void {
	// With constant scalefactor across coded bands => diff = 0 for each coded sfb
	// diff=0 => idx=60, which is 1-bit codeword "0" in Table A.1
	for (let sfb = 0; sfb < sfbCb.length; sfb++) {
		if (sfbCb[sfb] !== HCB_ZERO) {
			writeScalefactorDiff(writer, 0);
		}
	}
}

function writeSpectralDataLong(writer: BitWriter, quant: Int16Array, swbOffsets: Uint16Array, sfbCb: Uint8Array): void {
	const maxSfb = sfbCb.length;
	for (let sfb = 0; sfb < maxSfb; sfb++) {
		if (sfbCb[sfb] === HCB_ZERO) continue;

		const start = swbOffsets[sfb];
		const end = swbOffsets[sfb + 1];

		for (let i = start; i < end; i += 2) {
			const a = quant[i] | 0;
			const b = i + 1 < end ? (quant[i + 1] | 0) : 0;
			writePair11(writer, a, b);
		}
	}
}

function estimateSpectralBitsLong(
	spec: Float64Array,
	swbOffsets: Uint16Array,
	maxSfb: number,
	gain: number,
	tmpSfbCb: Uint8Array,
): { spectralBits: number; codedBands: number } {
	let spectralBits = 0;
	let codedBands = 0;

	// Evaluate per sfb whether everything quantizes to zero; if so, use ZERO_HCB and skip.
	for (let sfb = 0; sfb < maxSfb; sfb++) {
		const start = swbOffsets[sfb];
		const end = swbOffsets[sfb + 1];

		let allZero = true;
		let bitsHere = 0;

		for (let i = start; i < end; i += 2) {
			const a = quantizeCoefficient(spec[i], gain);
			const b = i + 1 < end ? quantizeCoefficient(spec[i + 1], gain) : 0;

			if (a !== 0 || b !== 0) allZero = false;
			bitsHere += pair11BitLen(a, b);
		}

		if (allZero) {
			tmpSfbCb[sfb] = HCB_ZERO;
		} else {
			tmpSfbCb[sfb] = HCB_ESC;
			codedBands++;
			spectralBits += bitsHere;
		}
	}

	return { spectralBits, codedBands };
}

// ============================================================================
// Simple per-channel global_gain search to meet bitrate
// ============================================================================

function chooseGlobalGainForTargetBits(
	spec: Float64Array,
	swbOffsets: Uint16Array,
	maxSfb: number,
	targetBits: number,
	includeIcsInfo: boolean,
): number {
	if (!Number.isFinite(targetBits) || targetBits <= 0) {
		return 100; // neutral default
	}

	const tmpSfbCb = new Uint8Array(maxSfb);

	// Fixed bits (excluding section/scalefac/spectral)
	const icsInfoBits = includeIcsInfo ? 1 + 2 + 1 + 6 + 1 : 0; // long ics_info bits
	const fixedBits = 8 + icsInfoBits + 3; // global_gain + (maybe) ics_info + (pulse/tns/gain_control)

	// Binary search: larger global_gain => larger gain => smaller quant => fewer bits (monotonic enough)
	let lo = 0;
	let hi = 255;
	let best = 255;

	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const gain = sfGain(mid);

		const { spectralBits, codedBands } = estimateSpectralBitsLong(spec, swbOffsets, maxSfb, gain, tmpSfbCb);
		const sectionBits = estimateSectionDataBitsLong(tmpSfbCb);
		const scalefacBits = codedBands * HCB_SF_LENS[60]; // diff=0, idx=60 => 1 bit

		const totalBits = fixedBits + sectionBits + scalefacBits + spectralBits;

		if (totalBits <= targetBits) {
			best = mid;
			hi = mid - 1;
		} else {
			lo = mid + 1;
		}
	}

	return best;
}

// ============================================================================
// Encode one Individual Channel Stream (long blocks only)
// ============================================================================

function encodeIcsLong(writer: BitWriter, spec: Float64Array, fsIndex: number, targetBits: number, commonWindow: boolean): void {
	const swbOffsets = SWB_OFFSET_1024_WINDOW[fsIndex];
	const maxSfb = swbOffsets.length - 1;
	const maxLines = swbOffsets[maxSfb];

	const includeIcsInfo = !commonWindow;

	// Choose global_gain (base scalefactor) per frame / channel for crude bitrate control
	const globalGain = chooseGlobalGainForTargetBits(spec, swbOffsets, maxSfb, targetBits, includeIcsInfo);

	// Quantize using constant gain for all coded bands (sf == global_gain)
	const gain = sfGain(globalGain);

	const quant = new Int16Array(AAC_FRAME);
	quantizeSpectrum(spec, quant, maxLines, gain);

	// Determine per-band codebooks (ZERO_HCB if the entire band is zero)
	const sfbCb = new Uint8Array(maxSfb);
	computeSfbCodebooks(quant, swbOffsets, maxSfb, sfbCb);

	// --- Bitstream (Table 16: individual_channel_stream) ---
	writer.writeBits(globalGain, 8); // global_gain

	if (!commonWindow) {
		writeIcsInfoLong(writer, maxSfb);
	}

	writeSectionDataLong(writer, sfbCb);
	writeScaleFactorDataConstant(writer, sfbCb);

	writer.writeBits(0, 1); // pulse_data_present
	writer.writeBits(0, 1); // tns_data_present
	writer.writeBits(0, 1); // gain_control_data_present

	writeSpectralDataLong(writer, quant, swbOffsets, sfbCb);
}

// ============================================================================
// ADTS Header Writer
// ============================================================================

function writeADTS(writer: BitWriter, frameLenBytes: number, sampleRate: number, numChannels: number): void {
	writer.writeBits(0xfff, 12); // syncword
	writer.writeBits(0, 1); // ID=0 (MPEG-4)
	writer.writeBits(0, 2); // layer
	writer.writeBits(1, 1); // protection_absent

	writer.writeBits(1, 2); // profile: AAC-LC = 1
	const idx = getSampleRateIndex(sampleRate);
	writer.writeBits(idx >= 0 ? idx : 4, 4); // sampling_frequency_index (fallback 44100)
	writer.writeBits(0, 1); // private_bit
	writer.writeBits(numChannels, 3); // channel_configuration

	writer.writeBits(0, 1); // original_copy
	writer.writeBits(0, 1); // home
	writer.writeBits(0, 1); // copyright_id_bit
	writer.writeBits(0, 1); // copyright_id_start

	writer.writeBits(frameLenBytes, 13); // aac_frame_length
	writer.writeBits(0x7ff, 11); // adts_buffer_fullness (VBR)
	writer.writeBits(0, 2); // number_of_raw_data_blocks_in_frame (0 => 1 raw block)
}

// ============================================================================
// Public API
// ============================================================================

export async function encodeWavToAacLc(
	wavBuffer: Buffer,
	sourcePath: string,
	options: { bitrate?: number } = {},
): Promise<Buffer> {
	const wav = parseWav(wavBuffer);
	const { sampleRate, numChannels, samples } = wav;

	const fsIndex = getSampleRateIndex(sampleRate);
	if (fsIndex < 0) {
		throw new Error(`Unsupported AAC sample rate ${sampleRate} Hz in ${sourcePath}`);
	}
	if (numChannels !== 1 && numChannels !== 2) {
		throw new Error(`Only mono/stereo supported. Got ${numChannels} channels in ${sourcePath}`);
	}

	const bitrateKbps = options.bitrate ?? 128;
	const targetBitsPerFrame = Math.max(200, Math.floor((bitrateKbps * 1000 * AAC_FRAME) / sampleRate));
	const targetBitsPerChannel = Math.floor(targetBitsPerFrame / numChannels);

	const totalSamples = samples[0].length;
	const numFrames = Math.ceil(totalSamples / AAC_FRAME);

	const mdct = new Mdct1024();

	const prev: Float64Array[] = Array.from({ length: numChannels }, () => new Float64Array(AAC_FRAME));
	const inBuf: Float64Array[] = Array.from({ length: numChannels }, () => new Float64Array(TWO_N));
	const specBuf: Float64Array[] = Array.from({ length: numChannels }, () => new Float64Array(AAC_FRAME));

	const frames: Buffer[] = [];

	for (let f = 0; f < numFrames; f++) {
		// Build 2048-sample analysis buffer per channel (overlap)
		for (let ch = 0; ch < numChannels; ch++) {
			inBuf[ch].set(prev[ch], 0);
			const base = f * AAC_FRAME;
			for (let i = 0; i < AAC_FRAME; i++) {
				const idx = base + i;
				inBuf[ch][AAC_FRAME + i] = idx < totalSamples ? samples[ch][idx] * PCM_SCALE : 0;
			}
			prev[ch].set(inBuf[ch].subarray(AAC_FRAME));
			mdct.forward(inBuf[ch], specBuf[ch]);
		}

		// Raw data block payload
		const payloadWriter = new BitWriter();

		if (numChannels === 1) {
			payloadWriter.writeBits(0, 3); // ID_SCE
			payloadWriter.writeBits(0, 4); // element_instance_tag
			encodeIcsLong(payloadWriter, specBuf[0], fsIndex, targetBitsPerChannel, /*commonWindow*/ false);
		} else {
			payloadWriter.writeBits(1, 3); // ID_CPE
			payloadWriter.writeBits(0, 4); // element_instance_tag
			payloadWriter.writeBits(0, 1); // common_window = 0
			// channel 0
			encodeIcsLong(payloadWriter, specBuf[0], fsIndex, targetBitsPerChannel, /*commonWindow*/ false);
			// channel 1
			encodeIcsLong(payloadWriter, specBuf[1], fsIndex, targetBitsPerChannel, /*commonWindow*/ false);
		}

		payloadWriter.writeBits(7, 3); // ID_END
		payloadWriter.byteAlign();
		const payload = payloadWriter.getBuffer();

		// ADTS header + payload
		const adtsWriter = new BitWriter();
		writeADTS(adtsWriter, 7 + payload.length, sampleRate, numChannels);
		adtsWriter.writeBuffer(payload);
		frames.push(adtsWriter.getBuffer());
	}

	return Buffer.concat(frames);
}

export function isEncoderAvailable(): boolean {
	return true;
}
