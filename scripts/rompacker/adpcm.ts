import type { AudioMeta } from '../../src/bmsx/rompack/format';
import { decodeWavToPcm } from '../../src/bmsx/common/wav';
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis';

const ADPCM_MAGIC = 'BADP';
const ADPCM_VERSION = 1;
const ADPCM_HEADER_SIZE = 48;
const ADPCM_NO_LOOP = 0xffffffff;
const ADPCM_SEEK_INTERVAL_SEC = 5;
const DEFAULT_BLOCK_FRAMES = 512;
const MIN_BLOCK_FRAMES = 128;
const MAX_BLOCK_FRAMES = 768;

const ADPCM_STEP_TABLE = [
	7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
	19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
	50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
	130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
	337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
	876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
	2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
	5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
	15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

const ADPCM_INDEX_TABLE = [
	-1, -1, -1, -1, 2, 4, 6, 8,
	-1, -1, -1, -1, 2, 4, 6, 8,
];

type PcmData = {
	samples: Int16Array;
	sampleRate: number;
	channels: number;
	frames: number;
};

export type AdpcmHeader = {
	version: number;
	channels: number;
	sampleRate: number;
	frames: number;
	loopStartFrame: number;
	loopEndFrame: number;
	seekStrideFrames: number;
	seekEntryCount: number;
	seekTableOffset: number;
	dataOffset: number;
};

export type EncodedAdpcmAudio = {
	buffer: Buffer;
	sampleRate: number;
	channels: number;
	frames: number;
	loopStartFrame: number;
	loopEndFrame: number;
};

let oggDecoderPromise: Promise<OggVorbisDecoder> | null = null;

function clampToInt16(value: number): number {
	if (value < -32768) return -32768;
	if (value > 32767) return 32767;
	return value | 0;
}

function isWavBuffer(bytes: Uint8Array): boolean {
	return (
		bytes.byteLength >= 12
		&& bytes[0] === 0x52
		&& bytes[1] === 0x49
		&& bytes[2] === 0x46
		&& bytes[3] === 0x46
		&& bytes[8] === 0x57
		&& bytes[9] === 0x41
		&& bytes[10] === 0x56
		&& bytes[11] === 0x45
	);
}

function isOggBuffer(bytes: Uint8Array): boolean {
	return (
		bytes.byteLength >= 4
		&& bytes[0] === 0x4f
		&& bytes[1] === 0x67
		&& bytes[2] === 0x67
		&& bytes[3] === 0x53
	);
}

export function isBadpBuffer(bytes: Uint8Array): boolean {
	return (
		bytes.byteLength >= ADPCM_HEADER_SIZE
		&& bytes[0] === 0x42
		&& bytes[1] === 0x41
		&& bytes[2] === 0x44
		&& bytes[3] === 0x50
	);
}

export function parseBadpHeader(bytes: Uint8Array): AdpcmHeader {
	if (!isBadpBuffer(bytes)) {
		throw new Error('[ADPCM] Invalid BADP header.');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const version = view.getUint16(4, true);
	if (version !== ADPCM_VERSION) {
		throw new Error(`[ADPCM] Unsupported BADP version ${version}.`);
	}
	const channels = view.getUint16(6, true);
	const sampleRate = view.getUint32(8, true);
	const frames = view.getUint32(12, true);
	const loopStartFrame = view.getUint32(16, true);
	const loopEndFrame = view.getUint32(20, true);
	const seekStrideFrames = view.getUint32(24, true);
	const seekEntryCount = view.getUint32(28, true);
	const seekTableOffset = view.getUint32(32, true);
	const dataOffset = view.getUint32(36, true);
	if (channels <= 0 || channels > 2) {
		throw new Error('[ADPCM] BADP channels must be 1 or 2.');
	}
	if (sampleRate <= 0) {
		throw new Error('[ADPCM] BADP sample rate must be positive.');
	}
	if (dataOffset < ADPCM_HEADER_SIZE || dataOffset > bytes.byteLength) {
		throw new Error('[ADPCM] BADP data offset is invalid.');
	}
	if (seekEntryCount > 0 && (seekTableOffset < ADPCM_HEADER_SIZE || seekTableOffset >= dataOffset)) {
		throw new Error('[ADPCM] BADP seek table offset is invalid.');
	}
	return {
		version,
		channels,
		sampleRate,
		frames,
		loopStartFrame,
		loopEndFrame,
		seekStrideFrames,
		seekEntryCount,
		seekTableOffset,
		dataOffset,
	};
}

async function getOggDecoder(): Promise<OggVorbisDecoder> {
	if (oggDecoderPromise === null) {
		oggDecoderPromise = (async () => {
			const decoder = new OggVorbisDecoder();
			await decoder.ready;
			return decoder;
		})();
	}
	return oggDecoderPromise;
}

async function decodeOggToPcm(bytes: Uint8Array): Promise<PcmData> {
	const decoder = await getOggDecoder();
	const decoded = await decoder.decodeFile(bytes);
	const channels = decoded.channelData.length;
	const sampleRate = decoded.sampleRate | 0;
	const frames = decoded.samplesDecoded | 0;
	if (channels <= 0 || channels > 2) {
		throw new Error('[ADPCM] OGG source must decode to mono or stereo.');
	}
	if (sampleRate <= 0 || frames <= 0) {
		throw new Error('[ADPCM] OGG decode produced invalid metadata.');
	}
	const samples = new Int16Array(frames * channels);
	let cursor = 0;
	for (let frame = 0; frame < frames; frame += 1) {
		for (let channel = 0; channel < channels; channel += 1) {
			const channelData = decoded.channelData[channel];
			const value = channelData[frame];
			const clamped = value < -1 ? -1 : (value > 1 ? 1 : value);
			const scaled = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
			samples[cursor] = clampToInt16(scaled);
			cursor += 1;
		}
	}
	await decoder.reset();
	return {
		samples,
		sampleRate,
		channels,
		frames,
	};
}

async function decodeSourceToPcm(input: Buffer): Promise<PcmData> {
	const bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	if (isWavBuffer(bytes)) {
		const buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer;
		const decoded = decodeWavToPcm(buffer);
		return {
			samples: decoded.samples,
			sampleRate: decoded.sampleRate,
			channels: decoded.channels,
			frames: decoded.frames,
		};
	}
	if (isOggBuffer(bytes)) {
		return decodeOggToPcm(bytes);
	}
	throw new Error('[ADPCM] Unsupported source audio format. Expected WAV or OGG.');
}

function trimTrailingSilenceFrames(samples: Int16Array, channels: number): number {
	const silenceThreshold = 40;
	const minSilenceFrames = 200;
	const totalFrames = Math.floor(samples.length / channels);
	let firstNonSilentFromEnd = totalFrames;
	for (let frame = totalFrames - 1; frame >= 0; frame -= 1) {
		const base = frame * channels;
		let silent = true;
		for (let channel = 0; channel < channels; channel += 1) {
			if (Math.abs(samples[base + channel]) >= silenceThreshold) {
				silent = false;
				break;
			}
		}
		if (!silent) {
			firstNonSilentFromEnd = frame + 1;
			break;
		}
	}
	const trimmedFrames = totalFrames - firstNonSilentFromEnd;
	if (trimmedFrames >= minSilenceFrames) {
		return firstNonSilentFromEnd > 0 ? firstNonSilentFromEnd : 1;
	}
	return totalFrames;
}

function detectLoopFrames(samples: Int16Array, channels: number, sampleRate: number, totalFrames: number): { start: number; end: number } | null {
	const windowFrames = Math.min(sampleRate * 2, Math.floor(totalFrames / 2));
	if (windowFrames < Math.floor(sampleRate / 2)) {
		return null;
	}
	const tailStart = totalFrames - windowFrames;
	const strideFrames = Math.max(1, Math.floor(windowFrames / 2048));
	const searchStep = Math.max(64, Math.floor(sampleRate / 8));
	let bestStart = -1;
	let bestError = Number.POSITIVE_INFINITY;
	for (let candidate = Math.floor(sampleRate / 2); candidate < tailStart; candidate += searchStep) {
		const available = tailStart - candidate;
		if (available < windowFrames) {
			break;
		}
		let error = 0;
		let count = 0;
		for (let frame = 0; frame < windowFrames; frame += strideFrames) {
			const leftBase = (candidate + frame) * channels;
			const rightBase = (tailStart + frame) * channels;
			for (let channel = 0; channel < channels; channel += 1) {
				const diff = samples[leftBase + channel] - samples[rightBase + channel];
				error += diff * diff;
				count += 1;
			}
		}
		const normalized = error / (count * 32768 * 32768);
		if (normalized < bestError) {
			bestError = normalized;
			bestStart = candidate;
		}
	}
	if (bestStart < 0 || bestError > 0.0008) {
		return null;
	}
	return {
		start: bestStart,
		end: tailStart,
	};
}

function chooseBlockFrames(samples: Int16Array, channels: number, startFrame: number, totalFrames: number): number {
	const remaining = totalFrames - startFrame;
	if (remaining <= MIN_BLOCK_FRAMES) {
		return remaining;
	}
	const inspectFrames = remaining < 256 ? remaining : 256;
	let diffAccumulator = 0;
	let prev = 0;
	for (let frame = 0; frame < inspectFrames; frame += 1) {
		const base = (startFrame + frame) * channels;
		const mixed = channels === 1 ? samples[base] : ((samples[base] + samples[base + 1]) >> 1);
		if (frame > 0) {
			diffAccumulator += Math.abs(mixed - prev);
		}
		prev = mixed;
	}
	const avgDiff = diffAccumulator / (inspectFrames - 1);
	if (avgDiff > 2000) {
		return remaining < 256 ? remaining : 256;
	}
	if (avgDiff < 400) {
		const frames = remaining < MAX_BLOCK_FRAMES ? remaining : MAX_BLOCK_FRAMES;
		return frames;
	}
	const frames = remaining < DEFAULT_BLOCK_FRAMES ? remaining : DEFAULT_BLOCK_FRAMES;
	return frames;
}

function encodeImaNibble(sample: number, predictor: number, stepIndex: number): { code: number; predictor: number; stepIndex: number } {
	let delta = sample - predictor;
	let code = 0;
	if (delta < 0) {
		code = 8;
		delta = -delta;
	}
	const step = ADPCM_STEP_TABLE[stepIndex];
	let diff = step >> 3;
	if (delta >= step) {
		code |= 4;
		delta -= step;
		diff += step;
	}
	if (delta >= (step >> 1)) {
		code |= 2;
		delta -= step >> 1;
		diff += step >> 1;
	}
	if (delta >= (step >> 2)) {
		code |= 1;
		diff += step >> 2;
	}
	predictor += (code & 8) !== 0 ? -diff : diff;
	if (predictor < -32768) predictor = -32768;
	if (predictor > 32767) predictor = 32767;
	stepIndex += ADPCM_INDEX_TABLE[code];
	if (stepIndex < 0) stepIndex = 0;
	if (stepIndex > 88) stepIndex = 88;
	return {
		code,
		predictor,
		stepIndex,
	};
}

function normalizeLoopFrames(meta: AudioMeta, sampleRate: number, totalFrames: number): { start: number; end: number } | null {
	if (meta.loop === undefined || meta.loop === null) {
		return null;
	}
	let start = Math.floor(meta.loop * sampleRate);
	let end = meta.loopEnd !== undefined && meta.loopEnd !== null ? Math.floor(meta.loopEnd * sampleRate) : totalFrames;
	if (start < 0) start = 0;
	if (start > totalFrames) start = totalFrames;
	if (end < 0) end = 0;
	if (end > totalFrames) end = totalFrames;
	if (end <= start) {
		return null;
	}
	return { start, end };
}

export async function encodeAudioAssetToAdpcm(input: Buffer, meta: AudioMeta): Promise<EncodedAdpcmAudio> {
	const inputBytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
	if (isBadpBuffer(inputBytes)) {
		const header = parseBadpHeader(inputBytes);
		return {
			buffer: Buffer.from(input),
			sampleRate: header.sampleRate,
			channels: header.channels,
			frames: header.frames,
			loopStartFrame: header.loopStartFrame,
			loopEndFrame: header.loopEndFrame,
		};
	}

	const decoded = await decodeSourceToPcm(input);
	if (decoded.channels <= 0 || decoded.channels > 2) {
		throw new Error('[ADPCM] Source audio must be mono or stereo.');
	}
	const totalFrames = trimTrailingSilenceFrames(decoded.samples, decoded.channels);
	const trimmedSamples = decoded.samples.subarray(0, totalFrames * decoded.channels);
	let loopFrames = normalizeLoopFrames(meta, decoded.sampleRate, totalFrames);
	if (loopFrames === null && meta.audiotype === 'music') {
		loopFrames = detectLoopFrames(trimmedSamples, decoded.channels, decoded.sampleRate, totalFrames);
	}

	const channels = decoded.channels;
	const sampleRate = decoded.sampleRate;
	const seekStrideFrames = sampleRate * ADPCM_SEEK_INTERVAL_SEC;
	const seekFrames: number[] = [];
	const seekOffsets: number[] = [];
	const statesPredictor = new Int32Array(channels);
	const statesStepIndex = new Int32Array(channels);
	const dataParts: Buffer[] = [];
	let dataSize = 0;
	let frameStart = 0;
	let nextSeekAt = 0;

	while (frameStart < totalFrames) {
		const blockFrames = chooseBlockFrames(trimmedSamples, channels, frameStart, totalFrames);
		const blockHeaderBytes = 4 + channels * 4;
		const payloadBytes = ((blockFrames * channels) + 1) >> 1;
		const blockBytes = blockHeaderBytes + payloadBytes;
		const block = Buffer.alloc(blockBytes);
		block.writeUInt16LE(blockFrames, 0);
		block.writeUInt16LE(blockBytes, 2);
		for (let channel = 0; channel < channels; channel += 1) {
			const predictor = statesPredictor[channel];
			const stepIndex = statesStepIndex[channel];
			const base = 4 + channel * 4;
			block.writeInt16LE(predictor, base);
			block.writeUInt8(stepIndex, base + 2);
			block.writeUInt8(0, base + 3);
		}

		let nibbleCursor = 0;
		const payloadOffset = blockHeaderBytes;
		for (let frame = 0; frame < blockFrames; frame += 1) {
			const srcBase = (frameStart + frame) * channels;
			for (let channel = 0; channel < channels; channel += 1) {
				const sample = trimmedSamples[srcBase + channel];
				const encoded = encodeImaNibble(sample, statesPredictor[channel], statesStepIndex[channel]);
				statesPredictor[channel] = encoded.predictor;
				statesStepIndex[channel] = encoded.stepIndex;
				const payloadIndex = payloadOffset + (nibbleCursor >> 1);
				if ((nibbleCursor & 1) === 0) {
					block[payloadIndex] = encoded.code << 4;
				} else {
					block[payloadIndex] |= encoded.code & 0x0f;
				}
				nibbleCursor += 1;
			}
		}

		if (seekFrames.length === 0 || frameStart >= nextSeekAt) {
			seekFrames.push(frameStart);
			seekOffsets.push(dataSize);
			nextSeekAt = frameStart + seekStrideFrames;
		}

		dataParts.push(block);
		dataSize += blockBytes;
		frameStart += blockFrames;
	}

	const seekEntryCount = seekFrames.length;
	const seekTableSize = seekEntryCount * 8;
	const dataOffset = ADPCM_HEADER_SIZE + seekTableSize;
	const result = Buffer.alloc(dataOffset + dataSize);
	result.write(ADPCM_MAGIC, 0, 'ascii');
	result.writeUInt16LE(ADPCM_VERSION, 4);
	result.writeUInt16LE(channels, 6);
	result.writeUInt32LE(sampleRate, 8);
	result.writeUInt32LE(totalFrames, 12);
	const loopStartFrame = loopFrames ? loopFrames.start : ADPCM_NO_LOOP;
	const loopEndFrame = loopFrames ? loopFrames.end : ADPCM_NO_LOOP;
	result.writeUInt32LE(loopStartFrame, 16);
	result.writeUInt32LE(loopEndFrame, 20);
	result.writeUInt32LE(seekStrideFrames, 24);
	result.writeUInt32LE(seekEntryCount, 28);
	result.writeUInt32LE(ADPCM_HEADER_SIZE, 32);
	result.writeUInt32LE(dataOffset, 36);
	result.writeUInt32LE(0, 40);
	result.writeUInt32LE(0, 44);

	let cursor = ADPCM_HEADER_SIZE;
	for (let index = 0; index < seekEntryCount; index += 1) {
		result.writeUInt32LE(seekFrames[index], cursor + 0);
		result.writeUInt32LE(seekOffsets[index], cursor + 4);
		cursor += 8;
	}
	cursor = dataOffset;
	for (let index = 0; index < dataParts.length; index += 1) {
		const part = dataParts[index];
		part.copy(result, cursor);
		cursor += part.length;
	}

	return {
		buffer: result,
		sampleRate,
		channels,
		frames: totalFrames,
		loopStartFrame,
		loopEndFrame,
	};
}
