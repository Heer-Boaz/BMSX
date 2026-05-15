import { clamp } from '../../../common/clamp';
import { readI16LE, readLE16 } from '../../../common/endian';
import { type ApuBadpDecoderState } from './badp_decoder';

export type ApuBadpDecodeTarget = {
	sourceBytes: Uint8Array;
	dataOffset: number;
	frames: number;
	channels: number;
	badpSeekFrames: Uint32Array<ArrayBufferLike>;
	badpSeekOffsets: Uint32Array<ArrayBufferLike>;
	badp: ApuBadpDecoderState;
};

const BADP_STEP_TABLE = new Int32Array([
	7, 8, 9, 10, 11, 12, 13, 14, 16, 17,
	19, 21, 23, 25, 28, 31, 34, 37, 41, 45,
	50, 55, 60, 66, 73, 80, 88, 97, 107, 118,
	130, 143, 157, 173, 190, 209, 230, 253, 279, 307,
	337, 371, 408, 449, 494, 544, 598, 658, 724, 796,
	876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
	2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358,
	5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
	15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
]);

const BADP_INDEX_TABLE = new Int32Array([
	-1, -1, -1, -1, 2, 4, 6, 8,
	-1, -1, -1, -1, 2, 4, 6, 8,
]);

export function createApuBadpDecoderState(): ApuBadpDecoderState {
	return {
		predictors: new Int32Array(2),
		stepIndices: new Int32Array(2),
		nextFrame: 0,
		blockEnd: 0,
		blockFrames: 0,
		blockFrameIndex: 0,
		payloadOffset: 0,
		nibbleCursor: 0,
		decodedFrame: -1,
		decodedLeft: 0,
		decodedRight: 0,
	};
}

export function resetApuBadpDecoder(record: ApuBadpDecodeTarget, frame: number): void {
	const badp = record.badp;
	badp.predictors.fill(0);
	badp.stepIndices.fill(0);
	badp.nextFrame = 0;
	badp.blockEnd = 0;
	badp.blockFrames = 0;
	badp.blockFrameIndex = 0;
	badp.payloadOffset = 0;
	badp.nibbleCursor = 0;
	badp.decodedFrame = -1;
	badp.decodedLeft = 0;
	badp.decodedRight = 0;
	seekApuBadpDecoderToFrame(record, frame);
}

export function readApuBadpFrameAt(record: ApuBadpDecodeTarget, frame: number): boolean {
	if (frame < 0 || frame >= record.frames) {
		return false;
	}
	const badp = record.badp;
	if (badp.decodedFrame === frame) {
		return true;
	}
	if (frame < badp.nextFrame) {
		seekApuBadpDecoderToFrame(record, frame);
	}
	while (badp.nextFrame <= frame) {
		decodeNextApuBadpFrame(record);
	}
	return true;
}

function loadApuBadpBlock(record: ApuBadpDecodeTarget, offset: number): void {
	const bytes = record.sourceBytes;
	const badp = record.badp;
	const blockOffset = record.dataOffset + offset;
	const blockFrames = readLE16(bytes, blockOffset);
	const blockBytes = readLE16(bytes, blockOffset + 2);
	const blockHeaderBytes = 4 + record.channels * 4;
	const blockEnd = offset + blockBytes;
	let cursor = blockOffset + 4;
	for (let channel = 0; channel < record.channels; channel += 1) {
		badp.predictors[channel] = readI16LE(bytes, cursor);
		badp.stepIndices[channel] = bytes[cursor + 2]!;
		cursor += 4;
	}
	badp.blockEnd = blockEnd;
	badp.blockFrames = blockFrames;
	badp.blockFrameIndex = 0;
	badp.payloadOffset = offset + blockHeaderBytes;
	badp.nibbleCursor = 0;
}

function seekApuBadpDecoderToFrame(record: ApuBadpDecodeTarget, frame: number): void {
	const badp = record.badp;
	if (frame === record.frames) {
		badp.nextFrame = frame;
		badp.decodedFrame = frame - 1;
		badp.decodedLeft = 0;
		badp.decodedRight = 0;
		return;
	}
	let seekIndex = 0;
	let lo = 0;
	let hi = record.badpSeekFrames.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (record.badpSeekFrames[mid]! <= frame) {
			seekIndex = mid;
			lo = mid + 1;
		} else {
			if (mid === 0) {
				break;
			}
			hi = mid - 1;
		}
	}
	let currentFrame = record.badpSeekFrames[seekIndex]!;
	let cursor = record.badpSeekOffsets[seekIndex]!;
	loadApuBadpBlock(record, cursor);
	while (currentFrame + badp.blockFrames <= frame) {
		currentFrame += badp.blockFrames;
		cursor = badp.blockEnd;
		loadApuBadpBlock(record, cursor);
	}
	badp.nextFrame = currentFrame;
	badp.decodedFrame = currentFrame - 1;
	while (badp.nextFrame <= frame) {
		decodeNextApuBadpFrame(record);
	}
}

function decodeNextApuBadpFrame(record: ApuBadpDecodeTarget): void {
	const badp = record.badp;
	if (badp.blockFrameIndex >= badp.blockFrames) {
		loadApuBadpBlock(record, badp.blockEnd);
	}
	let left = 0;
	let right = 0;
	const bytes = record.sourceBytes;
	for (let channel = 0; channel < record.channels; channel += 1) {
		const payloadIndex = record.dataOffset + badp.payloadOffset + (badp.nibbleCursor >> 1);
		const packed = bytes[payloadIndex]!;
		const code = (badp.nibbleCursor & 1) === 0 ? ((packed >> 4) & 0x0f) : (packed & 0x0f);
		badp.nibbleCursor += 1;
		let predictor = badp.predictors[channel]!;
		let stepIndex = badp.stepIndices[channel]!;
		const step = BADP_STEP_TABLE[stepIndex]!;
		let diff = step >> 3;
		if ((code & 4) !== 0) diff += step;
		if ((code & 2) !== 0) diff += step >> 1;
		if ((code & 1) !== 0) diff += step >> 2;
		if ((code & 8) !== 0) {
			predictor -= diff;
		} else {
			predictor += diff;
		}
		predictor = clamp(predictor, -32768, 32767);
		stepIndex += BADP_INDEX_TABLE[code]!;
		stepIndex = clamp(stepIndex, 0, 88);
		badp.predictors[channel] = predictor;
		badp.stepIndices[channel] = stepIndex;
		if (channel === 0) {
			left = predictor;
		} else {
			right = predictor;
		}
	}
	if (record.channels === 1) {
		right = left;
	}
	badp.blockFrameIndex += 1;
	badp.nextFrame += 1;
	badp.decodedFrame = badp.nextFrame - 1;
	badp.decodedLeft = left;
	badp.decodedRight = right;
}
