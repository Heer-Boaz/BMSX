import { clamp } from '../../../common/clamp';
import { readI16LE, readLE16, readLE32 } from '../../../common/endian';
import { type ApuBadpDecoderState, type ApuBadpSeekTable } from './badp_decoder';
import type { ApuSourceRevision } from './source';

export type ApuBadpDecodeTarget = {
	sourceBytes: Uint8Array;
	dataOffset: number;
	frames: number;
	channels: number;
	badpSeekTable: ApuBadpSeekTable;
	badp: ApuBadpDecoderState;
	badpTransition: ApuBadpTransition;
	sourceRevision: ApuSourceRevision;
};

export type ApuBadpTransition = {
	from: ApuBadpDecoderState;
	to: ApuBadpDecoderState;
	target: number;
	revision: number;
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

// Signed predictor delta in the upper bits, next step index in the low byte.
const BADP_TRANSITIONS = new Int32Array(89 * 16);
for (let index = 0; index < 89; ++index) {
	const step = BADP_STEP_TABLE[index]!;
	for (let code = 0; code < 16; ++code) {
		let delta = (step >> 3) + ((code & 4) ? step : 0)
			+ ((code & 2) ? step >> 1 : 0) + ((code & 1) ? step >> 2 : 0);
		if (code & 8) delta = -delta;
		BADP_TRANSITIONS[index * 16 + code] = delta * 256 + clamp(index + BADP_INDEX_TABLE[code]!, 0, 88);
	}
}

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
		previousDecodedFrame: -1,
		previousDecodedLeft: 0,
		previousDecodedRight: 0,
	};
}

export function createApuBadpTransition(): ApuBadpTransition {
	return { from: createApuBadpDecoderState(), to: createApuBadpDecoderState(), target: -1, revision: 0 };
}

function copyDecoderState(to: ApuBadpDecoderState, from: ApuBadpDecoderState): void {
	to.predictors.set(from.predictors);
	to.stepIndices.set(from.stepIndices);
	to.nextFrame = from.nextFrame;
	to.blockEnd = from.blockEnd;
	to.blockFrames = from.blockFrames;
	to.blockFrameIndex = from.blockFrameIndex;
	to.payloadOffset = from.payloadOffset;
	to.nibbleCursor = from.nibbleCursor;
	to.decodedFrame = from.decodedFrame;
	to.decodedLeft = from.decodedLeft;
	to.decodedRight = from.decodedRight;
	to.previousDecodedFrame = from.previousDecodedFrame;
	to.previousDecodedLeft = from.previousDecodedLeft;
	to.previousDecodedRight = from.previousDecodedRight;
}

function sameDecoderState(a: ApuBadpDecoderState, b: ApuBadpDecoderState): boolean {
	return a.predictors[0] === b.predictors[0] && a.predictors[1] === b.predictors[1]
		&& a.stepIndices[0] === b.stepIndices[0] && a.stepIndices[1] === b.stepIndices[1]
		&& a.nextFrame === b.nextFrame
		&& a.blockEnd === b.blockEnd
		&& a.blockFrames === b.blockFrames
		&& a.blockFrameIndex === b.blockFrameIndex
		&& a.payloadOffset === b.payloadOffset
		&& a.nibbleCursor === b.nibbleCursor
		&& a.decodedFrame === b.decodedFrame
		&& a.decodedLeft === b.decodedLeft
		&& a.decodedRight === b.decodedRight
		&& a.previousDecodedFrame === b.previousDecodedFrame
		&& a.previousDecodedLeft === b.previousDecodedLeft
		&& a.previousDecodedRight === b.previousDecodedRight;
}

export function resetApuBadpDecoder(record: ApuBadpDecodeTarget, frame: number): void {
	const badp = record.badp;
	record.badpTransition.target = -1;
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
	badp.previousDecodedFrame = -1;
	badp.previousDecodedLeft = 0;
	badp.previousDecodedRight = 0;
	seekApuBadpDecoderToFrame(record, frame);
}

export function readApuBadpFrameAt(record: ApuBadpDecodeTarget, frame: number): number {
	const badp = record.badp;
	let left: number;
	let right: number;
	if (badp.decodedFrame === frame) {
		left = badp.decodedLeft;
		right = badp.decodedRight;
	} else if (badp.previousDecodedFrame === frame) {
		left = badp.previousDecodedLeft;
		right = badp.previousDecodedRight;
	} else {
		if (frame < badp.nextFrame) {
			seekApuBadpDecoderToFrame(record, frame);
		} else if (frame > badp.nextFrame + 1) {
			const transition = record.badpTransition;
			const revision = record.sourceRevision.value;
			if (transition.target === frame && transition.revision === revision && sameDecoderState(transition.from, badp)) {
				copyDecoderState(badp, transition.to);
				return (badp.decodedLeft & 0xffff) | ((badp.decodedRight & 0xffff) << 16);
			}
			copyDecoderState(transition.from, badp);
			// Each successor header replaces the predictor and step index.
			// Keep the block containing frame - 1 for the interpolation latch.
			while (badp.nextFrame < frame) {
				if (badp.blockFrameIndex < badp.blockFrames) {
					const nextBlockFrame = badp.nextFrame + (badp.blockFrames - badp.blockFrameIndex);
					if (nextBlockFrame >= frame) break;
					badp.nextFrame = nextBlockFrame;
					badp.blockFrameIndex = badp.blockFrames;
				}
				decodeNextApuBadpFrame(record);
			}
			while (badp.nextFrame <= frame) {
				decodeNextApuBadpFrame(record);
			}
			copyDecoderState(transition.to, badp);
			transition.target = frame;
			transition.revision = revision;
			return (badp.decodedLeft & 0xffff) | ((badp.decodedRight & 0xffff) << 16);
		}
		while (badp.nextFrame <= frame) {
			decodeNextApuBadpFrame(record);
		}
		left = badp.decodedLeft;
		right = badp.decodedRight;
	}
	return (left & 0xffff) | ((right & 0xffff) << 16);
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
		badp.stepIndices[channel] = Math.min(bytes[cursor + 2]!, 88);
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
	badp.decodedFrame = -1;
	badp.decodedLeft = 0;
	badp.decodedRight = 0;
	badp.previousDecodedFrame = -1;
	badp.previousDecodedLeft = 0;
	badp.previousDecodedRight = 0;
	if (frame >= record.frames) {
		badp.nextFrame = record.frames;
		return;
	}
	let seekIndex = 0;
	let lo = 0;
	const seekTable = record.badpSeekTable;
	let hi = seekTable.entryCount - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		if (readLE32(seekTable.bytes, seekTable.byteOffset + mid * 8) <= frame) {
			seekIndex = mid;
			lo = mid + 1;
		} else {
			if (mid === 0) {
				break;
			}
			hi = mid - 1;
		}
	}
	let currentFrame = seekTable.entryCount === 0 ? 0 : readLE32(seekTable.bytes, seekTable.byteOffset + seekIndex * 8);
	let cursor = seekTable.entryCount === 0 ? 0 : readLE32(seekTable.bytes, seekTable.byteOffset + seekIndex * 8 + 4);
	loadApuBadpBlock(record, cursor);
	while (currentFrame + badp.blockFrames <= frame) {
		currentFrame += badp.blockFrames;
		cursor = badp.blockEnd;
		loadApuBadpBlock(record, cursor);
	}
	badp.nextFrame = currentFrame;
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
		const transition = BADP_TRANSITIONS[badp.stepIndices[channel]! * 16 + code]!;
		const predictor = clamp(badp.predictors[channel]! + (transition >> 8), -32768, 32767);
		badp.predictors[channel] = predictor;
		badp.stepIndices[channel] = transition & 0xff;
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
	badp.previousDecodedFrame = badp.decodedFrame;
	badp.previousDecodedLeft = badp.decodedLeft;
	badp.previousDecodedRight = badp.decodedRight;
	badp.decodedFrame = badp.nextFrame - 1;
	badp.decodedLeft = left;
	badp.decodedRight = right;
}
