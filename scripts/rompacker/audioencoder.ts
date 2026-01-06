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
  expect(readStr(4), "RIFF"); offset += 4;
  offset += 4; // file size
  expect(readStr(4), "WAVE"); offset += 4;

  let audioFormat = 0;
  let sampleRate = 0, numChannels = 0, bitsPerSample = 0;
  let dataBuffer: Buffer | null = null;

  while (offset + 8 <= buffer.length) {
    const id = readStr(4); offset += 4;
    const size = read32(); offset += 4;

    if (id === "fmt ") {
      audioFormat = read16(); offset += 2; // 1=PCM, 3=IEEE float
      numChannels = read16(); offset += 2;
      sampleRate = read32(); offset += 4;
      offset += 6; // byteRate (4) + blockAlign (2)
      bitsPerSample = read16(); offset += 2;
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
        v = dataBuffer.readFloatLE(pos); pos += 4;
        v = clamp1(v);
      } else {
        // PCM integer
        if (bitsPerSample === 8) {
          v = (dataBuffer.readUInt8(pos++) - 128) / 128;
        } else if (bitsPerSample === 16) {
          v = dataBuffer.readInt16LE(pos) / 32768; pos += 2;
        } else if (bitsPerSample === 24) {
          const b0 = dataBuffer.readUInt8(pos++);
          const b1 = dataBuffer.readUInt8(pos++);
          const b2 = dataBuffer.readInt8(pos++);
          const s = (b2 << 16) | (b1 << 8) | b0;
          v = s / 8388608;
        } else if (bitsPerSample === 32) {
          v = dataBuffer.readInt32LE(pos) / 2147483648; pos += 4;
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
//   - Fast implementation: MDCT folding + DCT-IV via complex FFT (O(N log N))
//   - Verified equivalence: MDCT(x[0..2N-1]) == DCT4(fold(x))
// ============================================================================

const AAC_FRAME = 1024;
const PCM_SCALE = 65536.0; // bring normalized [-1,1] PCM to a typical AAC internal scale

const TWO_N = AAC_FRAME * 2;
const PI = Math.PI;

function bitReverse(i: number, bits: number): number {
  let x = i;
  let y = 0;
  for (let b = 0; b < bits; b++) {
    y = (y << 1) | (x & 1);
    x >>>= 1;
  }
  return y;
}

class FFTComplexRadix2 {
  readonly size: number;
  private readonly bits: number;
  private readonly rev: Uint16Array;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;

  constructor(size: number) {
    if ((size & (size - 1)) !== 0) throw new Error(`FFT size must be power of 2, got ${size}`);
    this.size = size;
    this.bits = Math.round(Math.log2(size));

    this.rev = new Uint16Array(size);
    for (let i = 0; i < size; i++) this.rev[i] = bitReverse(i, this.bits);

    // Twiddles for forward FFT: exp(-j*2*pi*k/size)
    this.cosTable = new Float64Array(size >>> 1);
    this.sinTable = new Float64Array(size >>> 1);
    for (let k = 0; k < (size >>> 1); k++) {
      const ang = (2 * PI * k) / size;
      this.cosTable[k] = Math.cos(ang);
      this.sinTable[k] = -Math.sin(ang);
    }
  }

  forward(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    if (re.length !== n || im.length !== n) throw new Error(`FFT buffers must have length ${n}`);

    // Bit-reversal permutation
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        let tr = re[i];
        re[i] = re[j];
        re[j] = tr;
        let ti = im[i];
        im[i] = im[j];
        im[j] = ti;
      }
    }

    // Iterative Cooley-Tukey (radix-2)
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >>> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j++) {
          const tw = (j * step) | 0;
          const wr = this.cosTable[tw];
          const wi = this.sinTable[tw];

          const i0 = i + j;
          const i1 = i0 + half;

          const r1 = re[i1];
          const i1v = im[i1];

          // v = x[i1] * W
          const vr = r1 * wr - i1v * wi;
          const vi = r1 * wi + i1v * wr;

          const ur = re[i0];
          const ui = im[i0];

          re[i0] = ur + vr;
          im[i0] = ui + vi;
          re[i1] = ur - vr;
          im[i1] = ui - vi;
        }
      }
    }
  }
}

class DCT4 {
  readonly N: number;
  readonly fftSize: number;
  private readonly fft: FFTComplexRadix2;

  private readonly preCos: Float64Array;
  private readonly preSin: Float64Array;
  private readonly postCos: Float64Array;
  private readonly postSin: Float64Array;

  private readonly re: Float64Array;
  private readonly im: Float64Array;

  constructor(N: number) {
    this.N = N;
    this.fftSize = 2 * N;
    this.fft = new FFTComplexRadix2(this.fftSize);

    // Pre-twiddle: exp(-j*pi*n/(2N)) where FFT length is 2N
    this.preCos = new Float64Array(N);
    this.preSin = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      const ang = (PI * n) / this.fftSize;
      this.preCos[n] = Math.cos(ang);
      this.preSin[n] = Math.sin(ang);
    }

    // Post-twiddle: exp(-j*pi*(2k+1)/(4N))
    this.postCos = new Float64Array(N);
    this.postSin = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const ang = (PI * (2 * k + 1)) / (4 * N);
      this.postCos[k] = Math.cos(ang);
      this.postSin[k] = Math.sin(ang);
    }

    this.re = new Float64Array(this.fftSize);
    this.im = new Float64Array(this.fftSize);
  }

  transform(xN: Float64Array, outN: Float64Array): void {
    if (xN.length !== this.N) throw new Error(`DCT4 input must be length ${this.N}`);
    if (outN.length !== this.N) throw new Error(`DCT4 output must be length ${this.N}`);

    // Build complex FFT input of length 2N:
    // c[n] = x[n] * exp(-j*pi*n/(2N)) for n=0..N-1, else 0
    for (let n = 0; n < this.N; n++) {
      const x = xN[n];
      const c = this.preCos[n];
      const s = this.preSin[n];
      this.re[n] = x * c;
      this.im[n] = -x * s;
    }
    this.re.fill(0, this.N);
    this.im.fill(0, this.N);

    this.fft.forward(this.re, this.im);

    // out[k] = Re( FFT[k] * exp(-j*pi*(2k+1)/(4N)) )
    for (let k = 0; k < this.N; k++) {
      const r = this.re[k];
      const i = this.im[k];
      outN[k] = r * this.postCos[k] + i * this.postSin[k];
    }
  }
}

class Mdct1024 {
  private readonly window: Float64Array;
  private readonly dct4: DCT4;

  private readonly winBuf: Float64Array;
  private readonly foldBuf: Float64Array;

  constructor() {
    this.window = new Float64Array(TWO_N);
    for (let n = 0; n < TWO_N; n++) {
      this.window[n] = Math.sin((PI / (2 * AAC_FRAME)) * (n + 0.5));
    }

    this.dct4 = new DCT4(AAC_FRAME);
    this.winBuf = new Float64Array(TWO_N);
    this.foldBuf = new Float64Array(AAC_FRAME);
  }

  forward(input: Float64Array, out: Float64Array): void {
    if (input.length !== TWO_N) throw new Error(`MDCT input must be length ${TWO_N}`);
    if (out.length !== AAC_FRAME) throw new Error(`MDCT output must be length ${AAC_FRAME}`);

    // Window
    for (let n = 0; n < TWO_N; n++) this.winBuf[n] = input[n] * this.window[n];

    // Fold for MDCT equivalence (see MDCT <-> DCT-IV folding relation):
    //   a = x[0..N/2-1]
    //   b = x[N/2..N-1]
    //   c = x[N..3N/2-1]
    //   d = x[3N/2..2N-1]
    //   v = (-reverse(c) - d, a - reverse(b))
    const N = AAC_FRAME;
    const half = N >>> 1;
    for (let i = 0; i < half; i++) {
      this.foldBuf[i] = -this.winBuf[N + half - 1 - i] - this.winBuf[N + half + i];
      this.foldBuf[half + i] = this.winBuf[i] - this.winBuf[N - 1 - i];
    }

    this.dct4.transform(this.foldBuf, out);
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
  156, 172, 188, 212, 240, 276, 320, 384, 448, 512, 576, 640, 704, 768, 832, 896, 960, 1024
]);

const SWB_OFFSET_1024_64 = new Uint16Array([
  0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 64, 72, 80, 88, 100, 112, 124, 140, 156,
  172, 192, 216, 240, 268, 304, 344, 384, 424, 464, 504, 544, 584, 624, 664, 704, 744, 784, 824, 864, 904, 944, 984, 1024
]);

const SWB_OFFSET_1024_48 = new Uint16Array([
  0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 88, 96, 108, 120, 132, 144, 160, 176,
  196, 216, 240, 264, 292, 320, 352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672, 704, 736, 768, 800, 832, 864, 896,
  928, 1024
]);

const SWB_OFFSET_1024_32 = new Uint16Array([
  0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 80, 88, 96, 108, 120, 132, 144, 160, 176,
  196, 216, 240, 264, 292, 320, 352, 384, 416, 448, 480, 512, 544, 576, 608, 640, 672, 704, 736, 768, 800, 832, 864, 896,
  928, 960, 992, 1024
]);

const SWB_OFFSET_1024_24 = new Uint16Array([
  0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 52, 60, 68, 76, 84, 92, 100, 108, 116, 124, 136, 148,
  160, 172, 188, 204, 220, 240, 260, 284, 308, 336, 364, 396, 432, 468, 508, 552, 600, 652, 704, 768, 832, 896, 960, 1024
]);

const SWB_OFFSET_1024_16 = new Uint16Array([
  0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 100, 112, 124, 136, 148, 160, 172, 184, 196, 212, 228, 244,
  260, 280, 300, 320, 344, 368, 396, 424, 456, 492, 532, 572, 616, 664, 716, 772, 832, 896, 960, 1024
]);

const SWB_OFFSET_1024_8 = new Uint16Array([
  0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120, 132, 144, 156, 172, 188, 204, 220, 236, 252, 268, 288, 308, 328,
  348, 372, 396, 420, 448, 476, 508, 544, 580, 620, 664, 712, 764, 820, 880, 944, 1024
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
  SWB_OFFSET_1024_8,  // 8000
];

// --- Huffman codebooks (ISO/IEC 13818-7:2004 Annex A) ---

// Scalefactor Huffman codebook (Table A.1), indices 0..120 (dpcm_sf + 60)
const HCB_SF_LENS = new Uint8Array([
  18, 18, 18, 18, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 18, 19, 18, 17, 17,
  16, 17, 16, 16, 16, 16, 15, 15, 14, 14, 14, 14, 14, 14, 13, 13, 12, 12, 12, 11, 12, 11, 10, 10,
  10, 9, 9, 8, 8, 8, 7, 6, 6, 5, 4, 3, 1, 4, 4, 5, 6, 6, 7, 7, 8, 8, 9, 9,
  10, 10, 10, 11, 11, 11, 11, 12, 12, 13, 13, 13, 14, 14, 16, 15, 16, 15, 18, 19, 19, 19, 19, 19,
  19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19, 19,
  19
]);

const HCB_SF_CODES = new Uint32Array([
  262120, 262118, 262119, 262117, 524277, 524273, 524269, 524278, 524270, 524271, 524272, 524284, 524285, 524287, 524286, 524279, 524280, 524283, 524281, 262116,
  524282, 262115, 131055, 131056, 65525, 131054, 65522, 65523, 65524, 65521, 32758, 32759, 16377, 16373, 16375, 16371, 16374, 16370, 8183, 8181,
  4089, 4087, 4086, 2041, 4084, 2040, 1017, 1015, 1013, 504, 503, 250, 248, 246, 121, 58, 56, 26, 11, 4,
  0, 10, 12, 27, 57, 59, 120, 122, 247, 249, 502, 505, 1012, 1014, 1016, 2037, 2036, 2038, 2039, 4085,
  4088, 8180, 8182, 8184, 16376, 16372, 65520, 32756, 65526, 32757, 262114, 524249, 524250, 524251, 524252, 524253, 524254, 524248, 524242, 524243,
  524244, 524245, 524246, 524274, 524255, 524263, 524264, 524265, 524266, 524267, 524262, 524256, 524257, 524258, 524259, 524260, 524261, 524247, 524268, 524276,
  524275
]);

// Spectrum Huffman Codebook 11 (ESC) (Table A.12), indices 0..288 for (y,z) with 0..16 (unsigned)
const HCB11_LENS = new Uint8Array([
  4, 5, 6, 7, 8, 8, 9, 10, 10, 10, 11, 11, 12, 11, 12, 12, 10, 5, 4, 5, 6, 7, 7, 8,
  8, 9, 9, 9, 10, 10, 10, 10, 11, 8, 6, 5, 5, 6, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10,
  10, 10, 8, 7, 6, 6, 6, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10, 10, 8, 8, 7, 7, 7,
  7, 8, 8, 8, 8, 9, 9, 9, 10, 10, 10, 10, 8, 8, 7, 7, 7, 7, 8, 8, 8, 9, 9, 9,
  9, 10, 10, 10, 10, 8, 9, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 10, 10, 10, 10, 10, 8, 9,
  8, 8, 8, 8, 8, 8, 9, 9, 9, 10, 10, 10, 10, 10, 10, 8, 10, 9, 8, 8, 9, 9, 9, 9,
  9, 10, 10, 10, 10, 10, 10, 11, 8, 10, 9, 9, 9, 9, 9, 9, 9, 10, 10, 10, 10, 10, 10, 11,
  11, 8, 11, 9, 9, 9, 9, 9, 9, 10, 10, 10, 10, 10, 11, 10, 11, 11, 8, 11, 10, 9, 9, 10,
  9, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 8, 11, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 11,
  11, 11, 11, 11, 9, 11, 10, 9, 9, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 9, 11, 10,
  10, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 9, 12, 10, 10, 10, 10, 10, 10, 10, 11,
  11, 11, 11, 11, 11, 12, 12, 9, 9, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 9,
  5
]);

const HCB11_CODES = new Uint16Array([
  0, 6, 25, 61, 156, 198, 423, 912, 962, 991, 2022, 2035, 4091, 2028, 4090, 4094, 910, 5, 1, 8, 20, 55, 66, 146,
  175, 401, 421, 437, 926, 960, 930, 973, 2006, 174, 23, 7, 9, 24, 57, 64, 142, 163, 184, 409, 428, 449, 945, 918,
  958, 970, 157, 60, 21, 22, 26, 59, 68, 145, 165, 190, 406, 430, 441, 929, 913, 933, 981, 148, 154, 54, 56, 58,
  65, 140, 155, 176, 195, 414, 427, 444, 927, 911, 937, 975, 147, 191, 62, 63, 67, 69, 158, 167, 185, 404, 418, 442,
  451, 934, 935, 955, 980, 159, 416, 143, 141, 144, 152, 166, 182, 196, 415, 431, 447, 921, 959, 948, 969, 999, 168, 438,
  171, 164, 170, 178, 194, 197, 408, 420, 440, 908, 932, 964, 966, 989, 1000, 173, 943, 402, 189, 188, 398, 407, 410, 419,
  433, 909, 920, 951, 979, 977, 987, 2013, 180, 990, 425, 411, 412, 417, 426, 429, 435, 907, 946, 952, 974, 993, 992, 2002,
  2021, 183, 2019, 443, 424, 422, 432, 434, 439, 923, 922, 954, 949, 982, 2007, 996, 2008, 2026, 186, 2024, 928, 445, 436, 906,
  452, 914, 938, 944, 956, 983, 2004, 2012, 2011, 2005, 2032, 193, 2043, 968, 931, 917, 925, 940, 942, 965, 984, 994, 998, 2020,
  2023, 2016, 2025, 2039, 400, 2034, 915, 446, 448, 916, 919, 941, 963, 961, 978, 2010, 2009, 2015, 2027, 2036, 2042, 405, 2040, 957,
  924, 939, 936, 947, 953, 976, 995, 997, 2018, 2014, 2029, 2033, 2041, 2044, 403, 4093, 988, 950, 967, 972, 971, 985, 986, 2003,
  2017, 2030, 2031, 2037, 2038, 4092, 4095, 413, 450, 181, 161, 150, 151, 149, 153, 160, 162, 172, 169, 177, 179, 187, 192, 399,
  4
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
      if (quant[i] !== 0) { allZero = false; break; }
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
      const b = (i + 1 < end) ? (quant[i + 1] | 0) : 0;
      writePair11(writer, a, b);
    }
  }
}

function estimateSpectralBitsLong(spec: Float64Array, swbOffsets: Uint16Array, maxSfb: number, gain: number, tmpSfbCb: Uint8Array): { spectralBits: number; codedBands: number } {
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
      const b = (i + 1 < end) ? quantizeCoefficient(spec[i + 1], gain) : 0;

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
  includeIcsInfo: boolean
): number {
  if (!Number.isFinite(targetBits) || targetBits <= 0) {
    return 100; // neutral default
  }

  const tmpSfbCb = new Uint8Array(maxSfb);

  // Fixed bits (excluding section/scalefac/spectral)
  const icsInfoBits = includeIcsInfo ? (1 + 2 + 1 + 6 + 1) : 0; // long ics_info bits
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

function estimateTotalBitsLongForGlobalGain(
  spec: Float64Array,
  swbOffsets: Uint16Array,
  maxSfb: number,
  globalGain: number,
  includeIcsInfo: boolean,
  tmpSfbCb: Uint8Array
): number {
  const icsInfoBits = includeIcsInfo ? (1 + 2 + 1 + 6 + 1) : 0; // long ics_info bits
  const fixedBits = 8 + icsInfoBits + 3; // global_gain + (maybe) ics_info + (pulse/tns/gain_control)

  const gain = sfGain(globalGain);
  const { spectralBits, codedBands } = estimateSpectralBitsLong(spec, swbOffsets, maxSfb, gain, tmpSfbCb);
  const sectionBits = estimateSectionDataBitsLong(tmpSfbCb);
  const scalefacBits = codedBands * HCB_SF_LENS[60]; // diff=0, idx=60 => 1 bit
  return fixedBits + sectionBits + scalefacBits + spectralBits;
}

function chooseGlobalGainForTargetBitsHistory(
  spec: Float64Array,
  swbOffsets: Uint16Array,
  maxSfb: number,
  targetBits: number,
  includeIcsInfo: boolean,
  prevGlobalGain: number | null,
  maxDownStep: number
): number {
  if (prevGlobalGain == null || !Number.isFinite(prevGlobalGain)) {
    return chooseGlobalGainForTargetBits(spec, swbOffsets, maxSfb, targetBits, includeIcsInfo);
  }
  if (!Number.isFinite(targetBits) || targetBits <= 0) {
    return clampInt(prevGlobalGain | 0, 0, 255);
  }

  const tmpSfbCb = new Uint8Array(maxSfb);
  let gg = clampInt(prevGlobalGain | 0, 0, 255);

  // Step up until we fit the budget (always allowed).
  let bits = estimateTotalBitsLongForGlobalGain(spec, swbOffsets, maxSfb, gg, includeIcsInfo, tmpSfbCb);
  while (bits > targetBits && gg < 255) {
    gg++;
    bits = estimateTotalBitsLongForGlobalGain(spec, swbOffsets, maxSfb, gg, includeIcsInfo, tmpSfbCb);
  }

  // Step down to improve quality, but limit how fast we "improve" to keep the noise floor stable.
  const downLimit = Math.max(0, maxDownStep | 0);
  let down = 0;
  while (down < downLimit && gg > 0) {
    const bits2 = estimateTotalBitsLongForGlobalGain(spec, swbOffsets, maxSfb, gg - 1, includeIcsInfo, tmpSfbCb);
    if (bits2 <= targetBits) {
      gg--;
      bits = bits2;
      down++;
    } else {
      break;
    }
  }

  return gg;
}

// ============================================================================
// Encode one Individual Channel Stream (long blocks only)
// ============================================================================

function encodeIcsLong(
  writer: BitWriter,
  spec: Float64Array,
  fsIndex: number,
  targetBits: number,
  commonWindow: boolean,
  gainBias: number,
  prevGlobalGain: number | null,
  globalGainMaxDownStep: number
): number {
  const swbOffsets = SWB_OFFSET_1024_WINDOW[fsIndex];
  const maxSfb = swbOffsets.length - 1;
  const maxLines = swbOffsets[maxSfb];

  const includeIcsInfo = !commonWindow;

  // Choose global_gain (base scalefactor) per frame / channel for crude bitrate control
  const baseGlobalGain = chooseGlobalGainForTargetBitsHistory(spec, swbOffsets, maxSfb, targetBits, includeIcsInfo, prevGlobalGain, globalGainMaxDownStep);
  const globalGain = clampInt(baseGlobalGain + (gainBias | 0), 0, 255);

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

  return baseGlobalGain;
}

// ============================================================================
// ADTS Header Writer
// ============================================================================

function writeADTS(writer: BitWriter, frameLenBytes: number, sampleRate: number, numChannels: number): void {
  writer.writeBits(0xfff, 12);  // syncword
  writer.writeBits(0, 1);       // ID=0 (MPEG-4)
  writer.writeBits(0, 2);       // layer
  writer.writeBits(1, 1);       // protection_absent

  writer.writeBits(1, 2);       // profile: AAC-LC = 1
  const idx = getSampleRateIndex(sampleRate);
  writer.writeBits(idx >= 0 ? idx : 4, 4); // sampling_frequency_index (fallback 44100)
  writer.writeBits(0, 1);       // private_bit
  writer.writeBits(numChannels, 3); // channel_configuration

  writer.writeBits(0, 1);       // original_copy
  writer.writeBits(0, 1);       // home
  writer.writeBits(0, 1);       // copyright_id_bit
  writer.writeBits(0, 1);       // copyright_id_start

  writer.writeBits(frameLenBytes, 13); // aac_frame_length
  writer.writeBits(0x7ff, 11);  // adts_buffer_fullness (VBR)
  writer.writeBits(0, 2);       // number_of_raw_data_blocks_in_frame (0 => 1 raw block)
}


export interface AudioEncoderOptions {
  /** Target bitrate in kbps (default: 128). */
  bitrate?: number;

/**
 * Auto-tune for low bitrates: may downmix stereo->mono and resample to a lower AAC-supported
 * sampling rate to improve quality and speed.
 *
 * Default: true
 */
autoTune?: boolean;

/**
 * Force encoder sample rate (Hz). Must be one of the AAC ADTS supported rates:
 * 96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000.
 *
 * If set, overrides autoTune sample-rate selection.
 */
targetSampleRate?: number;

/**
 * Force output channel count (1 or 2).
 * If set to 1 and input is stereo, encoder will downmix.
 * (Upmix is not supported.)
 *
 * If set, overrides autoTune channel selection.
 */
targetChannels?: 1 | 2;

/**
 * Resampler quality (number of FIR taps). Higher = better, slower.
 *
 * Default: 32
 */
resampleTaps?: number;

  /**
   * Optional bandwidth limit (Hz). Frequencies above this are zeroed in the MDCT domain
   * (a pragmatic low-bitrate quality improvement).
   *
   * If omitted, a heuristic based on bitrate/sample-rate is used.
   */
  bandwidthHz?: number;

  /**
   * Optional silence gate (dBFS, negative). If provided, frames whose RMS falls below this
   * threshold are encoded as true "all-zero" spectra (no warble in silence).
   *
   * Example: -55 or -60.
   */
  silenceGateDb?: number;

  /**
   * Optional extra bias added to the chosen global_gain (in AAC scalefactor steps).
   * Each step is ~1.5 dB. Increasing this can reduce low-level warble at very low bitrates,
   * at the cost of more quantization (lower quality).
   *
   * Typical values: 0..2.
   */
  gainBiasSteps?: number;


  /**
   * Limits how quickly the encoder is allowed to *improve* quality from one frame to the next
   * by decreasing global_gain. This stabilizes quantization noise at very low bitrates and can
   * reduce metallic "warble/siren" artifacts.
   *
   * Larger = faster adaptation (potentially more warble), smaller = more stability.
   *
   * If omitted, a bitrate-based heuristic is used.
   */
  globalGainMaxDownStep?: number;
  /**
   * Extra zero frames appended to let the overlap-add tail decay cleanly.
   * For file encoding, 1 can help if you hear a tail artifact. For live streaming, set 0.
   *
   * Default: 0
   */
  flushFrames?: number;
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : (v > hi ? hi : v);
}

function defaultBandwidthHz(sampleRate: number, bitrateKbps: number, numChannels: number): number {
  // Heuristic tuned for AAC-LC without SBR (no HE-AAC tools):
  // very low bitrates need aggressive bandwidth limiting to avoid "swirl/warble".
  const perCh = bitrateKbps / Math.max(1, numChannels);
  let bw: number;

  if (perCh <= 16) bw = 3400;
  else if (perCh <= 24) bw = 5000;
  else if (perCh <= 32) bw = 7000;
  else if (perCh <= 48) bw = 10000;
  else if (perCh <= 64) bw = 14000;
  else if (perCh <= 96) bw = 18000;
  else bw = sampleRate / 2;

  // Never exceed Nyquist.
  const nyq = sampleRate / 2;
  return Math.max(0, Math.min(bw, nyq));
}

function mdctMaxLineForBandwidth(sampleRate: number, bandwidthHz: number): number {
  // MDCT has AAC_FRAME coefficients spanning ~0..Nyquist (fs/2).
  // Approx mapping: f ~= (k + 0.5) * fs / (2*N) => k ~= 2*N*f/fs - 0.5.
  const k = Math.floor((2 * AAC_FRAME * bandwidthHz) / sampleRate - 0.5);
  return clampInt(k + 1, 0, AAC_FRAME); // +1 because k is zero-based index; line count is k+1
}

function globalGainBiasSteps(bitrateKbps: number, numChannels: number): number {
  // Each step is ~1.5 dB (20*log10(2^(0.25))).
  // A small positive bias can reduce low-level warble at very low bitrates.
  const perCh = bitrateKbps / Math.max(1, numChannels);
  if (perCh <= 16) return 2;  // ~3 dB
  if (perCh <= 24) return 1;  // ~1.5 dB
  return 0;
}

function defaultGlobalGainMaxDownStep(bitrateKbps: number, numChannels: number): number {
  const perCh = bitrateKbps / Math.max(1, numChannels);
  if (perCh <= 16) return 1;
  if (perCh <= 24) return 2;
  if (perCh <= 32) return 3;
  return 4;
}

function autoTargetChannels(inputChannels: number, bitrateKbps: number): 1 | 2 {
  // Pragmatic default: at low bitrates, mono usually beats "bad stereo".
  // You can override via options.targetChannels.
  if (inputChannels <= 1) return 1;
  if (!Number.isFinite(bitrateKbps) || bitrateKbps <= 0) return 2;
  if (bitrateKbps <= 48) return 1; // <=48 kb/s total: downmix
  return 2;
}

function autoTargetSampleRate(inputSampleRate: number, bitrateKbps: number, numChannels: number): number {
  // Heuristic for AAC-LC without SBR:
  // Keep the time resolution reasonable (bits per 1024-sample frame) at very low bitrates.
  // Note: this picks a "desired" rate; we later snap to a supported AAC ADTS rate and avoid upsampling.
  const perCh = bitrateKbps / Math.max(1, numChannels);

  if (perCh <= 16) return 8000;
  if (perCh <= 24) return 16000;
  if (perCh <= 32) return 22050;
  if (perCh <= 48) return 32000;

  // Higher bitrates: keep input rate (but will be snapped to nearest supported).
  return inputSampleRate;
}

function pickAacSampleRate(desired: number, inputSampleRate: number): number {
  // Choose the closest ADTS-supported rate to `desired`, preferring not to upsample above inputSampleRate.
  const want = (Number.isFinite(desired) && desired > 0) ? desired : inputSampleRate;

  const rates = AAC_SAMPLE_RATES as unknown as number[]; // descending order in this file
  const candidates = rates.filter(r => r <= inputSampleRate);
  const pool = candidates.length > 0 ? candidates : rates;

  let best = pool[pool.length - 1];
  let bestDist = Number.POSITIVE_INFINITY;

  for (const r of pool) {
    const d = Math.abs(r - want);
    if (d < bestDist) {
      bestDist = d;
      best = r;
    }
  }
  return best;
}

function downmixStereoToMono(left: Float32Array, right: Float32Array): Float32Array {
  const n = Math.min(left.length, right.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // -6 dB sum to reduce clipping risk
    out[i] = 0.5 * (left[i] + right[i]);
  }
  return out;
}

function sinc(x: number): number {
  if (x === 0) return 1;
  const pix = Math.PI * x;
  return Math.sin(pix) / pix;
}

function blackmanWindow(k: number, m: number): number {
  // Blackman window (a0=0.42, a1=0.5, a2=0.08)
  if (m <= 1) return 1;
  const a0 = 0.42;
  const a1 = 0.5;
  const a2 = 0.08;
  const w = (2 * Math.PI * k) / (m - 1);
  return a0 - a1 * Math.cos(w) + a2 * Math.cos(2 * w);
}

/**
 * Band-limited (windowed-sinc) resampler.
 * Designed for downsampling (e.g. 44.1k -> 16k / 8k). Works for upsampling too, but is slower than linear.
 */
function resampleSincF32(input: Float32Array, inRate: number, outRate: number, taps: number): Float32Array {
  if (inRate === outRate) return input;
  if (!Number.isFinite(inRate) || !Number.isFinite(outRate) || inRate <= 0 || outRate <= 0) {
    throw new Error(`Invalid resample rates: inRate=${inRate}, outRate=${outRate}`);
  }

  // Keep taps even and within a sane range.
  const TAPS = clampInt((taps | 0) || 32, 16, 128);
  const tapsEven = (TAPS & 1) === 0 ? TAPS : (TAPS + 1);
  const half = tapsEven / 2;

  const ratio = outRate / inRate;
  const outLen = Math.max(1, Math.floor(input.length * ratio + 0.5));
  const out = new Float32Array(outLen);

  // Cutoff in cycles/sample (relative to input rate), with small rolloff to reduce aliasing at the edge.
  const fc = 0.5 * Math.min(1, ratio) * 0.98;
  const twoFc = 2 * fc;

  // Precompute window
  const win = new Float64Array(tapsEven);
  for (let k = 0; k < tapsEven; k++) win[k] = blackmanWindow(k, tapsEven);

  for (let m = 0; m < outLen; m++) {
    const t = m / ratio;              // position in input sample units
    const center = Math.floor(t);
    const frac = t - center;

    let sum = 0;
    let sumW = 0;

    // i range produces tapsEven coefficients
    for (let i = -half + 1; i <= half; i++) {
      const n = center + i;
      const x = i - frac; // distance from the fractional position

      // window index in [0, tapsEven-1]
      const k = i + half - 1;
      const w = win[k] * twoFc * sinc(twoFc * x);

      if (n >= 0 && n < input.length) sum += input[n] * w;
      sumW += w;
    }

    out[m] = sumW !== 0 ? (sum / sumW) : 0;
  }

  return out;
}

function encodeIcsLongSilence(writer: BitWriter, fsIndex: number, commonWindow: boolean): void {
  const swbOffsets = SWB_OFFSET_1024_WINDOW[fsIndex];
  const maxSfb = swbOffsets.length - 1;

  // Any reasonable value. With ZERO_HCB everywhere, it won't matter much.
  const globalGain = 180;

  writer.writeBits(globalGain, 8);

  if (!commonWindow) {
    writeIcsInfoLong(writer, maxSfb);
  }

  // All sfb are ZERO_HCB => one long "all zero" section.
  const sfbCb = new Uint8Array(maxSfb);
  writeSectionDataLong(writer, sfbCb);

  // No scalefactors (because no non-zero bands)
  // Presence bits:
  writer.writeBits(0, 1); // pulse_data_present
  writer.writeBits(0, 1); // tns_data_present
  writer.writeBits(0, 1); // gain_control_data_present

  // No spectral data.
}
// ============================================================================
// Public API
// ============================================================================

export async function encodeWavToAacLc(
  wavBuffer: Buffer,
  sourcePath: string,
  options: AudioEncoderOptions = {}
): Promise<Buffer> {
  const wav = parseWav(wavBuffer);
  let { sampleRate, numChannels, samples } = wav;

const bitrateKbps = options.bitrate ?? 128;

// --------------------------------------------------------------------------
// Auto-tune (optional): downmix + resample for low-bitrate speech-friendly output
// --------------------------------------------------------------------------
const autoTune = options.autoTune ?? true;

// Channel selection
const desiredCh = options.targetChannels ?? (autoTune ? autoTargetChannels(numChannels, bitrateKbps) : numChannels);
if (desiredCh === 1 && numChannels === 2) {
  samples = [downmixStereoToMono(samples[0], samples[1])];
  numChannels = 1;
}
// We do not support upmixing; if desiredCh is 2 but input is mono, keep mono.
if (numChannels !== 1 && numChannels !== 2) {
  throw new Error(`Only mono/stereo supported. Got ${numChannels} channels in ${sourcePath}`);
}

// Sample-rate selection
const desiredRate = options.targetSampleRate ?? (autoTune ? autoTargetSampleRate(sampleRate, bitrateKbps, numChannels) : sampleRate);
const outRate = pickAacSampleRate(desiredRate, sampleRate);

if (outRate !== sampleRate) {
  const taps = options.resampleTaps ?? 32;
  samples = samples.map(ch => resampleSincF32(ch, sampleRate, outRate, taps));
  sampleRate = outRate;
}

const fsIndex = getSampleRateIndex(sampleRate);
if (fsIndex < 0) {
  throw new Error(`Unsupported AAC sample rate ${sampleRate} Hz in ${sourcePath}`);
}

// Bandwidth / rate-control knobs
const bwHz = options.bandwidthHz ?? defaultBandwidthHz(sampleRate, bitrateKbps, numChannels);
const bwMaxLine = mdctMaxLineForBandwidth(sampleRate, bwHz);

// If gainBiasSteps isn't explicitly set, enable a small auto-bias at very low bitrates.
const ggBias = options.gainBiasSteps ?? globalGainBiasSteps(bitrateKbps, numChannels);

  const ggMaxDownStep = options.globalGainMaxDownStep ?? defaultGlobalGainMaxDownStep(bitrateKbps, numChannels);

    // Per-channel global_gain history for stability (reduces frame-to-frame "warble").
    const prevGlobalGain: Array<number | null> = new Array(numChannels).fill(null);

const flushFrames = options.flushFrames ?? 0;
const gateDb = options.silenceGateDb;
  const gateRms = (gateDb === undefined || gateDb === null) ? null : Math.pow(10, gateDb / 20);
  const targetBitsPerFrame = Math.max(200, Math.floor((bitrateKbps * 1000 * AAC_FRAME) / sampleRate));
  const targetBitsPerChannel = Math.floor(targetBitsPerFrame / numChannels);

  const totalSamples = samples[0].length;
  const numFrames = Math.ceil(totalSamples / AAC_FRAME) + Math.max(0, flushFrames | 0);

  const mdct = new Mdct1024();

  const prev: Float64Array[] = Array.from({ length: numChannels }, () => new Float64Array(AAC_FRAME));
  const inBuf: Float64Array[] = Array.from({ length: numChannels }, () => new Float64Array(TWO_N));
  const specBuf: Float64Array[] = Array.from({ length: numChannels }, () => new Float64Array(AAC_FRAME));

  const frames: Buffer[] = [];

  for (let f = 0; f < numFrames; f++) {
    // Build 2048-sample analysis buffer per channel (overlap)
    const frameRms: number[] = new Array(numChannels).fill(0);

    for (let ch = 0; ch < numChannels; ch++) {
      inBuf[ch].set(prev[ch], 0);
      const base = f * AAC_FRAME;

      let sumSq = 0;
      for (let i = 0; i < AAC_FRAME; i++) {
        const idx = base + i;
        const s = idx < totalSamples ? samples[ch][idx] : 0;
        sumSq += s * s;
        inBuf[ch][AAC_FRAME + i] = s * PCM_SCALE;
      }
      frameRms[ch] = Math.sqrt(sumSq / AAC_FRAME);

      prev[ch].set(inBuf[ch].subarray(AAC_FRAME));
      mdct.forward(inBuf[ch], specBuf[ch]);

      // Pragmatic bandwidth limiting at low bitrate: zero out lines above bwMaxLine
      if (bwMaxLine < AAC_FRAME) {
        specBuf[ch].fill(0, bwMaxLine);
      }
    }

    // Raw data block payload
    const payloadWriter = new BitWriter();

    if (numChannels === 1) {
      payloadWriter.writeBits(0, 3); // ID_SCE
      payloadWriter.writeBits(0, 4); // element_instance_tag
      const silent0 = (gateRms !== null) && (frameRms[0] < gateRms);
      if (silent0) {
        encodeIcsLongSilence(payloadWriter, fsIndex, /*commonWindow*/ false);
      } else {
        prevGlobalGain[0] = encodeIcsLong(payloadWriter, specBuf[0], fsIndex, targetBitsPerChannel, /*commonWindow*/ false, ggBias, prevGlobalGain[0], ggMaxDownStep);
      }
    } else {
      payloadWriter.writeBits(1, 3); // ID_CPE
      payloadWriter.writeBits(0, 4); // element_instance_tag
      payloadWriter.writeBits(0, 1); // common_window = 0
      // channel 0
      const silent0 = (gateRms !== null) && (frameRms[0] < gateRms);
      if (silent0) {
        encodeIcsLongSilence(payloadWriter, fsIndex, /*commonWindow*/ false);
      } else {
        prevGlobalGain[0] = encodeIcsLong(payloadWriter, specBuf[0], fsIndex, targetBitsPerChannel, /*commonWindow*/ false, ggBias, prevGlobalGain[0], ggMaxDownStep);
      }
      // channel 1
      const silentR = (gateRms !== null) && (frameRms[1] < gateRms);
      if (silentR) {
        encodeIcsLongSilence(payloadWriter, fsIndex, /*commonWindow*/ false);
      } else {
        prevGlobalGain[1] = encodeIcsLong(payloadWriter, specBuf[1], fsIndex, targetBitsPerChannel, /*commonWindow*/ false, ggBias, prevGlobalGain[1], ggMaxDownStep);
      }
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
