/**
 * Handwritten AAC-LC ADTS encoder (decodable silence).
 *
 * What it does:
 *   - Reads WAV container metadata (sample rate, channels, sample count).
 *   - Emits ADTS AAC-LC frames that decode as silence (all coefficients = 0).
 *
 * What it does NOT do:
 *   - It does not encode the actual audio content (no MDCT/psychoacoustics/quantiser).
 *
 * Why this is useful:
 *   - You get a bitstream that standard decoders accept, without needing
 *     AAC Huffman tables, scalefactor VLCs, or spectral coding.
 *
 * Notes:
 *   - Supports mono (SCE) and stereo (CPE, common_window=0).
 *   - Uses ONLY_LONG_SEQUENCE and ZERO_HCB for all scalefactor bands.
 *   - Optional padding via FIL elements to approximate a target bitrate.
 */

import { Buffer } from "buffer";

// ============================================================================
// WAV header parsing (minimal, robust enough for PCM/IEEE float + extensible)
// ============================================================================

interface WavInfo {
	sampleRate: number;
	numChannels: number;
	bitsPerSample: number;
	totalSamplesPerChannel: number; // number of PCM sample-frames per channel
}

function parseWavInfo(wav: Buffer, sourcePath: string): WavInfo {
	let off = 0;

	const ensure = (n: number) => {
		if (off + n > wav.length) {
			throw new Error(`[AudioEncoder] Truncated WAV "${sourcePath}"`);
		}
	};

	// const readU16 = (): number => {
	// 	ensure(2);
	// 	const v = wav.readUInt16LE(off);
	// 	off += 2;
	// 	return v;
	// };
	const readU32 = (): number => {
		ensure(4);
		const v = wav.readUInt32LE(off);
		off += 4;
		return v;
	};
	const readStr4 = (): string => {
		ensure(4);
		const s = wav.toString("ascii", off, off + 4);
		off += 4;
		return s;
	};

	const riff = readStr4();
	if (riff !== "RIFF") {
		throw new Error(`[AudioEncoder] Invalid WAV "${sourcePath}": expected RIFF, got ${riff}`);
	}
	readU32(); // file size
	const wave = readStr4();
	if (wave !== "WAVE") {
		throw new Error(`[AudioEncoder] Invalid WAV "${sourcePath}": expected WAVE, got ${wave}`);
	}

	let sampleRate = 0;
	let numChannels = 0;
	let bitsPerSample = 0;
	let blockAlign = 0;
	let dataSize = 0;

	// fmt parsing state
	let seenFmt = false;

	while (off + 8 <= wav.length) {
		const chunkId = readStr4();
		const chunkSize = readU32();

		if (chunkSize < 0 || off + chunkSize > wav.length) {
			throw new Error(`[AudioEncoder] Invalid chunk size in WAV "${sourcePath}" (${chunkId}, size=${chunkSize})`);
		}

		const chunkStart = off;

		if (chunkId === "fmt ") {
			// WAVEFORMATEX / WAVEFORMATEXTENSIBLE
			if (chunkSize < 16) {
				throw new Error(`[AudioEncoder] Invalid fmt chunk in WAV "${sourcePath}" (size=${chunkSize})`);
			}

			const audioFormat = wav.readUInt16LE(off + 0);
			numChannels = wav.readUInt16LE(off + 2);
			sampleRate = wav.readUInt32LE(off + 4);
			// byteRate = u32 @ off+8 (unused)
			blockAlign = wav.readUInt16LE(off + 12);
			bitsPerSample = wav.readUInt16LE(off + 14);

			// Optional extensible parsing
			if (audioFormat === 0xfffe && chunkSize >= 40) {
				// cbSize @ off+16
				const cbSize = wav.readUInt16LE(off + 16);
				// validBitsPerSample @ off+18 (unused)
				// channelMask @ off+20 (unused)
				// subFormat GUID @ off+24 (16 bytes)
				// We can sanity-check the GUID's Data1 (UInt32LE).
				const subFormatData1 = wav.readUInt32LE(off + 24);
				// PCM = 1, IEEE float = 3
				if (subFormatData1 !== 1 && subFormatData1 !== 3) {
					throw new Error(
						`[AudioEncoder] Unsupported WAVE_FORMAT_EXTENSIBLE SubFormat in "${sourcePath}" (Data1=${subFormatData1})`
					);
				}
				// If cbSize is smaller, we still accept; we do not rely on it here.
				void cbSize;
			} else {
				// PCM (1) or IEEE float (3) are fine for duration purposes.
				if (audioFormat !== 1 && audioFormat !== 3) {
					throw new Error(`[AudioEncoder] Unsupported WAV format "${sourcePath}": audioFormat=${audioFormat}`);
				}
			}

			if (numChannels <= 0) {
				throw new Error(`[AudioEncoder] Invalid channel count in WAV "${sourcePath}": ${numChannels}`);
			}
			if (sampleRate <= 0) {
				throw new Error(`[AudioEncoder] Invalid sample rate in WAV "${sourcePath}": ${sampleRate}`);
			}
			if (bitsPerSample <= 0 || bitsPerSample % 8 !== 0) {
				throw new Error(`[AudioEncoder] Unsupported bitsPerSample in WAV "${sourcePath}": ${bitsPerSample}`);
			}
			if (blockAlign !== numChannels * (bitsPerSample / 8)) {
				// Some WAVs can be weird, but for basic PCM this should match.
				// We use blockAlign as the source of truth for sample frame sizing if it is sane.
				if (blockAlign <= 0) {
					blockAlign = numChannels * (bitsPerSample / 8);
				}
			}

			seenFmt = true;
		} else if (chunkId === "data") {
			dataSize = chunkSize;
		}

		// advance to next chunk
		off = chunkStart + chunkSize;

		// RIFF chunks are word-aligned (pad byte if odd)
		if ((chunkSize & 1) === 1 && off < wav.length) off += 1;
	}

	if (!seenFmt) {
		throw new Error(`[AudioEncoder] WAV "${sourcePath}" missing fmt chunk`);
	}
	if (dataSize <= 0) {
		throw new Error(`[AudioEncoder] WAV "${sourcePath}" missing/empty data chunk`);
	}
	if (blockAlign <= 0) {
		throw new Error(`[AudioEncoder] WAV "${sourcePath}" invalid blockAlign`);
	}

	const totalSamplesPerChannel = Math.floor(dataSize / blockAlign);

	return { sampleRate, numChannels, bitsPerSample, totalSamplesPerChannel };
}

// ============================================================================
// Bit writer
// ============================================================================

class BitWriter {
	private bytes: number[] = [];
	private curByte = 0;
	private curBits = 0; // number of bits currently in curByte (0..7)

	writeBits(value: number, n: number): void {
		if (n <= 0) return;

		// Note: We intentionally do not hard-range-check `value` here; callers must supply correct values.
		for (let i = n - 1; i >= 0; i--) {
			const bit = (value >> i) & 1;
			this.curByte = (this.curByte << 1) | bit;
			this.curBits++;
			if (this.curBits === 8) {
				this.bytes.push(this.curByte & 0xff);
				this.curByte = 0;
				this.curBits = 0;
			}
		}
	}

	writeByte(b: number): void {
		this.writeBits(b & 0xff, 8);
	}

	byteAlignZero(): void {
		if (this.curBits === 0) return;
		// pad with zeros
		this.curByte <<= (8 - this.curBits);
		this.bytes.push(this.curByte & 0xff);
		this.curByte = 0;
		this.curBits = 0;
	}

	getBitLength(): number {
		return this.bytes.length * 8 + this.curBits;
	}

	/**
	 * Predict final payload length (bytes) if we would:
	 *   - append ID_END (3 bits)
	 *   - then byte-align with zero padding
	 */
	predictedBytesAfterEndAndAlign(): number {
		const bitsWithEnd = this.getBitLength() + 3;
		return Math.ceil(bitsWithEnd / 8);
	}

	toBufferAligned(): Buffer {
		this.byteAlignZero();
		return Buffer.from(this.bytes);
	}
}

// ============================================================================
// AAC/ADTS constants and tables
// ============================================================================

const AAC_FRAME_SAMPLES = 1024;

// ADTS sampling_frequency_index mapping (MPEG-4)
const ADTS_SAMPLE_RATES = [
	96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000
	// 7350 exists in MPEG-4 ASC, but we intentionally do not support it here
] as const;

// Number of scalefactor bands (long, 1024) per sampling_frequency_index.
// Sourced from FAAD2 tables (num_swb_1024_window).
const NUM_SWB_1024_WINDOW: ReadonlyArray<number> = [
	41, 41, 47, 49, 49, 51, 47, 47, 43, 43, 43, 40
] as const;

function getSampleRateIndex(sampleRate: number): number {
	const idx = ADTS_SAMPLE_RATES.indexOf(sampleRate as any);
	if (idx < 0) {
		throw new Error(`[AudioEncoder] Unsupported sample rate for ADTS/AAC-LC: ${sampleRate} Hz`);
	}
	return idx;
}

function getNumSwbLong1024(sampleRateIndex: number): number {
	const v = NUM_SWB_1024_WINDOW[sampleRateIndex];
	if (typeof v !== "number" || v <= 0) {
		throw new Error(`[AudioEncoder] Unsupported sampleRateIndex for num_swb: ${sampleRateIndex}`);
	}
	return v;
}

// ============================================================================
// AAC raw bitstream building blocks (silence)
// ============================================================================

/**
 * Writes a minimal Individual Channel Stream that decodes as silence:
 *   - global_gain present
 *   - ics_info: ONLY_LONG_SEQUENCE, window_shape=sine, max_sfb = num_swb
 *   - section_data: one section covering all sfb with ZERO_HCB
 *   - scale_factor_data: none (ZERO_HCB => no scalefactor bits)
 *   - pulse/tns/gain_control: not present
 *
 * The ordering matches the decoder expectation: global_gain first, then ics_info, then section_data...
 */
function writeIcsSilence(w: BitWriter, sampleRateIndex: number): void {
	const maxSfb = getNumSwbLong1024(sampleRateIndex);

	// global_gain (8 bits)
	// For ZERO_HCB everywhere it doesn't matter much; keep a conventional mid value.
	w.writeBits(128, 8);

	// ics_info (long)
	w.writeBits(0, 1); // ics_reserved_bit
	w.writeBits(0, 2); // window_sequence = ONLY_LONG_SEQUENCE
	w.writeBits(0, 1); // window_shape = 0 (sine)
	w.writeBits(maxSfb, 6); // max_sfb (long)

	// predictor_data_present (long sequences only)
	w.writeBits(0, 1); // predictor_data_present = 0

	// section_data:
	// One section that spans max_sfb scalefactor bands, all with ZERO_HCB (0).
	// For long blocks, sect_bits=5 and escape=31.
	const SECT_CB_ZERO_HCB = 0; // 4 bits
	const SECT_BITS_LONG = 5;
	const SECT_ESC = (1 << SECT_BITS_LONG) - 1; // 31

	w.writeBits(SECT_CB_ZERO_HCB, 4); // sect_cb

	let remaining = maxSfb;
	while (remaining > SECT_ESC) {
		w.writeBits(SECT_ESC, SECT_BITS_LONG);
		remaining -= SECT_ESC;
	}
	// remaining is 1..31 here for our supported sample rates
	w.writeBits(remaining, SECT_BITS_LONG);

	// scale_factor_data: none, because sfb_cb == ZERO_HCB => no bits are read.

	// pulse_data_present / tns_data_present / gain_control_data_present
	w.writeBits(0, 1); // pulse_data_present
	w.writeBits(0, 1); // tns_data_present
	w.writeBits(0, 1); // gain_control_data_present

	// spectral_data: none (ZERO_HCB => no Huffman data required).
}

function bitsForFillElement(fillBytes: number): number {
	if (fillBytes < 0) return 0;
	if (fillBytes < 15) {
		// ID_FIL (3) + count (4) + fillBytes*8
		return 3 + 4 + fillBytes * 8;
	}
	if (fillBytes <= 270) {
		// ID_FIL (3) + count=15 (4) + esc_count (8) + fillBytes*8
		return 3 + 4 + 8 + fillBytes * 8;
	}
	throw new Error(`[AudioEncoder] fillBytes too large for single FIL element: ${fillBytes}`);
}

function writeFillElement(w: BitWriter, fillBytes: number): void {
	if (fillBytes <= 0) return;
	if (fillBytes > 270) {
		throw new Error(`[AudioEncoder] fillBytes too large for FIL element: ${fillBytes}`);
	}

	const ID_FIL = 6;
	w.writeBits(ID_FIL, 3);

	if (fillBytes < 15) {
		w.writeBits(fillBytes, 4);
	} else {
		w.writeBits(15, 4);
		w.writeBits(fillBytes - 15, 8);
	}

	for (let i = 0; i < fillBytes; i++) {
		w.writeBits(0, 8); // fill_byte
	}
}

function buildRawPayload(sampleRateIndex: number, numChannels: number, targetFrameBytes?: number): Buffer {
	// targetFrameBytes includes ADTS header; payload target is minus 7 bytes.
	const targetPayloadBytes = typeof targetFrameBytes === "number" ? Math.max(0, targetFrameBytes - 7) : undefined;

	const w = new BitWriter();

	if (numChannels === 1) {
		const ID_SCE = 0;
		w.writeBits(ID_SCE, 3);
		w.writeBits(0, 4); // element_instance_tag
		writeIcsSilence(w, sampleRateIndex);
	} else if (numChannels === 2) {
		const ID_CPE = 1;
		w.writeBits(ID_CPE, 3);
		w.writeBits(0, 4); // element_instance_tag
		w.writeBits(0, 1); // common_window = 0 (each channel has its own ics_info)
		writeIcsSilence(w, sampleRateIndex);
		writeIcsSilence(w, sampleRateIndex);
	} else {
		throw new Error(`[AudioEncoder] Only mono/stereo supported (got ${numChannels}ch)`);
	}

	// Optional padding using FIL elements to approximate target bitrate.
	// We choose fill sizes so that (payload + END + align) lands <= targetPayloadBytes.
	if (typeof targetPayloadBytes === "number" && targetPayloadBytes > 0) {
		while (true) {
			const curPred = w.predictedBytesAfterEndAndAlign();
			const remaining = targetPayloadBytes - curPred;
			if (remaining <= 0) break;

			// Greedy: try the largest possible FIL chunk that still fits.
			let chunk = Math.min(270, remaining);

			// Decrease until it fits without exceeding targetPayloadBytes.
			while (chunk > 0) {
				const bitsAfter = w.getBitLength() + bitsForFillElement(chunk);
				const predAfter = Math.ceil((bitsAfter + 3) / 8); // + ID_END, then byte aligned
				if (predAfter <= targetPayloadBytes) break;
				chunk--;
			}

			if (chunk <= 0) break; // cannot add any FIL without overshooting; accept slight underfill.
			writeFillElement(w, chunk);
		}
	}

	// End element
	const ID_END = 7;
	w.writeBits(ID_END, 3);

	// Align payload to a whole number of bytes for ADTS frame_length accounting.
	return w.toBufferAligned();
}

// ============================================================================
// ADTS header
// ============================================================================

function buildAdtsHeader(frameLengthBytes: number, sampleRateIndex: number, numChannels: number): Buffer {
	if (frameLengthBytes <= 0 || frameLengthBytes > 0x1fff) {
		throw new Error(`[AudioEncoder] ADTS frame length out of range: ${frameLengthBytes}`);
	}
	if (numChannels < 1 || numChannels > 7) {
		throw new Error(`[AudioEncoder] ADTS channel_configuration out of range: ${numChannels}`);
	}

	const w = new BitWriter();

	// syncword 12
	w.writeBits(0xfff, 12);
	// ID 1 (0=MPEG-4)
	w.writeBits(0, 1);
	// layer 2
	w.writeBits(0, 2);
	// protection_absent 1 (1=no CRC)
	w.writeBits(1, 1);
	// profile 2 (AAC-LC => profile_ObjectType=2 => write 1)
	w.writeBits(1, 2);
	// sampling_frequency_index 4
	w.writeBits(sampleRateIndex, 4);
	// private_bit 1
	w.writeBits(0, 1);
	// channel_configuration 3
	w.writeBits(numChannels, 3);
	// original/copy 1
	w.writeBits(0, 1);
	// home 1
	w.writeBits(0, 1);

	// copyright id bit 1
	w.writeBits(0, 1);
	// copyright id start 1
	w.writeBits(0, 1);

	// aac_frame_length 13
	w.writeBits(frameLengthBytes, 13);

	// adts_buffer_fullness 11 (0x7FF = VBR)
	w.writeBits(0x7ff, 11);

	// num_raw_data_blocks_in_frame 2 (0 => 1 raw_data_block)
	w.writeBits(0, 2);

	const hdr = w.toBufferAligned();
	if (hdr.length !== 7) {
		throw new Error(`[AudioEncoder] Internal error: ADTS header is ${hdr.length} bytes (expected 7)`);
	}
	return hdr;
}

// ============================================================================
// Public API
// ============================================================================

export interface AudioEncoderOptions {
	/**
	 * Target bitrate in kbps.
	 * If provided, frames are padded using FIL elements to approximate this bitrate.
	 * This does NOT encode the original audio; it only changes output size.
	 */
	bitrate?: number;
}

export async function encodeWavToAacLc(
	wavBuffer: Buffer,
	sourcePath: string,
	options: AudioEncoderOptions = {}
): Promise<Buffer> {
	const wav = parseWavInfo(wavBuffer, sourcePath);
	const { sampleRate, numChannels, totalSamplesPerChannel } = wav;

	if (numChannels !== 1 && numChannels !== 2) {
		throw new Error(`[AudioEncoder] Only mono/stereo supported: got ${numChannels}ch in "${sourcePath}"`);
	}

	const srIndex = getSampleRateIndex(sampleRate);

	// Number of AAC frames needed to cover the WAV duration.
	const numFrames = Math.ceil(totalSamplesPerChannel / AAC_FRAME_SAMPLES);
	if (numFrames <= 0) return Buffer.alloc(0);

	// Precompute base payload and base frame size (without fill).
	const basePayload = buildRawPayload(srIndex, numChannels);
	const baseFrameBytes = 7 + basePayload.length;

	// Optional target size from bitrate
	let targetFrameBytes: number | undefined;
	if (typeof options.bitrate === "number") {
		const bitrateKbps = options.bitrate;
		if (!Number.isFinite(bitrateKbps) || bitrateKbps <= 0) {
			throw new Error(`[AudioEncoder] Invalid bitrate: ${options.bitrate}`);
		}
		// bytes/frame = (bitrate * 1000 / 8) / (sampleRate / 1024)
		const bytesPerFrame = (bitrateKbps * 1000 * AAC_FRAME_SAMPLES) / (8 * sampleRate);
		targetFrameBytes = Math.max(baseFrameBytes, Math.round(bytesPerFrame));

		if (targetFrameBytes > 0x1fff) {
			throw new Error(
				`[AudioEncoder] Target frame size too large for ADTS (>${0x1fff}): ${targetFrameBytes} bytes`
			);
		}
	}

	const outFrames: Buffer[] = [];
	outFrames.length = numFrames;

	for (let i = 0; i < numFrames; i++) {
		const payload = targetFrameBytes
			? buildRawPayload(srIndex, numChannels, targetFrameBytes)
			: basePayload;

		const frameLen = 7 + payload.length;
		const adts = buildAdtsHeader(frameLen, srIndex, numChannels);
		outFrames[i] = Buffer.concat([adts, payload]);
	}

	return Buffer.concat(outFrames);
}

export function isEncoderAvailable(): boolean {
	return true;
}
