import { readLE32 } from '../../../common/endian';

export type ApuBadpSeekTable = {
	bytes: Uint8Array;
	byteOffset: number;
	entryCount: number;
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
	previousDecodedFrame: number;
	previousDecodedLeft: number;
	previousDecodedRight: number;
};

export function loadApuBadpSeekTable(out: ApuBadpSeekTable, bytes: Uint8Array, byteOffset: number): void {
	out.bytes = bytes;
	out.byteOffset = byteOffset + readLE32(bytes, byteOffset + 32);
	out.entryCount = readLE32(bytes, byteOffset + 28);
}
