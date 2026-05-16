import { readLE32 } from '../../../common/endian';

export type ApuBadpSeekTableResult = {
	frames: Uint32Array<ArrayBufferLike>;
	offsets: Uint32Array<ArrayBufferLike>;
};

export type ApuBadpDecoderState = {
	predictors: Int32Array;
	stepIndices: Int32Array;
	nextFrame: number;
	blockEnd: number;
	blockFrames: number;
	blockFrameIndex: number;
	payloadOffset: number;
	nibbleCursor: number;
	decodedFrame: number;
	decodedLeft: number;
	decodedRight: number;
};

export function readApuBadpSeekTable(bytes: Uint8Array): ApuBadpSeekTableResult {
	const seekEntryCount = readLE32(bytes, 28);
	const seekTableOffset = readLE32(bytes, 32);
	const seekCount = seekEntryCount > 0 ? seekEntryCount : 1;
	const seekFrames = new Uint32Array(seekCount);
	const seekOffsets = new Uint32Array(seekCount);
	if (seekEntryCount > 0) {
		let cursor = seekTableOffset;
		for (let index = 0; index < seekCount; index += 1) {
			seekFrames[index] = readLE32(bytes, cursor);
			seekOffsets[index] = readLE32(bytes, cursor + 4);
			cursor += 8;
		}
	} else {
		seekFrames[0] = 0;
		seekOffsets[0] = 0;
	}
	return { frames: seekFrames, offsets: seekOffsets };
}
