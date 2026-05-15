import { readLE16, readLE32 } from '../../../common/endian';
import {
	APU_FAULT_NONE,
	APU_FAULT_OUTPUT_BLOCK,
	APU_FAULT_OUTPUT_DATA_RANGE,
	APU_FAULT_OUTPUT_METADATA,
	APU_FAULT_UNSUPPORTED_FORMAT,
	type ApuAudioSource,
} from './contracts';

const BADP_HEADER_SIZE = 48;
const BADP_VERSION = 1;
const EMPTY_BADP_SEEK_FRAMES = new Uint32Array(0);
const EMPTY_BADP_SEEK_OFFSETS = new Uint32Array(0);

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

export type ApuBadpSeekTableResult = {
	faultCode: number;
	faultDetail: number;
	frames: Uint32Array<ArrayBufferLike>;
	offsets: Uint32Array<ArrayBufferLike>;
};

export function readApuBadpSeekTable(bytes: Uint8Array, source: ApuAudioSource): ApuBadpSeekTableResult {
	if (bytes.byteLength < BADP_HEADER_SIZE || bytes[0] !== 0x42 || bytes[1] !== 0x41 || bytes[2] !== 0x44 || bytes[3] !== 0x50) {
		return { faultCode: APU_FAULT_UNSUPPORTED_FORMAT, faultDetail: bytes.byteLength, frames: EMPTY_BADP_SEEK_FRAMES, offsets: EMPTY_BADP_SEEK_OFFSETS };
	}
	const version = readLE16(bytes, 4);
	if (version !== BADP_VERSION) {
		return { faultCode: APU_FAULT_UNSUPPORTED_FORMAT, faultDetail: version, frames: EMPTY_BADP_SEEK_FRAMES, offsets: EMPTY_BADP_SEEK_OFFSETS };
	}
	const channels = readLE16(bytes, 6);
	const sampleRate = readLE32(bytes, 8);
	const frames = readLE32(bytes, 12);
	const seekEntryCount = readLE32(bytes, 28);
	const seekTableOffset = readLE32(bytes, 32);
	const dataOffset = readLE32(bytes, 36);
	if (channels !== source.channels || sampleRate !== source.sampleRateHz || frames !== source.frameCount || dataOffset !== source.dataOffset) {
		return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: dataOffset, frames: EMPTY_BADP_SEEK_FRAMES, offsets: EMPTY_BADP_SEEK_OFFSETS };
	}
	if (dataOffset < BADP_HEADER_SIZE || dataOffset > bytes.byteLength) {
		return { faultCode: APU_FAULT_OUTPUT_DATA_RANGE, faultDetail: dataOffset, frames: EMPTY_BADP_SEEK_FRAMES, offsets: EMPTY_BADP_SEEK_OFFSETS };
	}
	if (source.dataBytes === 0 || dataOffset + source.dataBytes > bytes.byteLength) {
		return { faultCode: APU_FAULT_OUTPUT_DATA_RANGE, faultDetail: source.dataBytes, frames: EMPTY_BADP_SEEK_FRAMES, offsets: EMPTY_BADP_SEEK_OFFSETS };
	}
	if (seekEntryCount > 0 && (seekTableOffset < BADP_HEADER_SIZE || seekTableOffset >= dataOffset)) {
		return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: seekTableOffset, frames: EMPTY_BADP_SEEK_FRAMES, offsets: EMPTY_BADP_SEEK_OFFSETS };
	}
	if (seekEntryCount > 0 && seekTableOffset + seekEntryCount * 8 > dataOffset) {
		return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: seekEntryCount, frames: EMPTY_BADP_SEEK_FRAMES, offsets: EMPTY_BADP_SEEK_OFFSETS };
	}
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
	if (seekFrames[0] !== 0 || seekOffsets[0] !== 0) {
		return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: seekOffsets[0]!, frames: EMPTY_BADP_SEEK_FRAMES, offsets: EMPTY_BADP_SEEK_OFFSETS };
	}
	for (let index = 0; index < seekCount; index += 1) {
		if (seekFrames[index]! > source.frameCount || seekOffsets[index]! >= source.dataBytes) {
			return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: index, frames: EMPTY_BADP_SEEK_FRAMES, offsets: EMPTY_BADP_SEEK_OFFSETS };
		}
		if (index > 0 && (seekFrames[index]! < seekFrames[index - 1]! || seekOffsets[index]! < seekOffsets[index - 1]!)) {
			return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: index, frames: EMPTY_BADP_SEEK_FRAMES, offsets: EMPTY_BADP_SEEK_OFFSETS };
		}
	}
	const blockResult = validateApuBadpBlocks(bytes, source, seekFrames, seekOffsets);
	if (blockResult.faultCode !== APU_FAULT_NONE) {
		return { faultCode: blockResult.faultCode, faultDetail: blockResult.faultDetail, frames: EMPTY_BADP_SEEK_FRAMES, offsets: EMPTY_BADP_SEEK_OFFSETS };
	}
	return { faultCode: APU_FAULT_NONE, faultDetail: 0, frames: seekFrames, offsets: seekOffsets };
}

function validateApuBadpBlocks(bytes: Uint8Array, source: ApuAudioSource, seekFrames: Uint32Array<ArrayBufferLike>, seekOffsets: Uint32Array<ArrayBufferLike>): { faultCode: number; faultDetail: number } {
	let offset = 0;
	let decodedFrames = 0;
	let seekIndex = 0;
	while (decodedFrames < source.frameCount) {
		while (seekIndex < seekOffsets.length && seekOffsets[seekIndex] === offset) {
			if (seekFrames[seekIndex] !== decodedFrames) {
				return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: seekIndex };
			}
			seekIndex += 1;
		}
		if (seekIndex < seekOffsets.length && seekOffsets[seekIndex]! < offset) {
			return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: seekIndex };
		}
		const blockOffset = source.dataOffset + offset;
		if (offset + 4 > source.dataBytes) {
			return { faultCode: APU_FAULT_OUTPUT_BLOCK, faultDetail: offset };
		}
		const blockFrames = readLE16(bytes, blockOffset);
		const blockBytes = readLE16(bytes, blockOffset + 2);
		if (blockFrames === 0) {
			return { faultCode: APU_FAULT_OUTPUT_BLOCK, faultDetail: offset };
		}
		const blockHeaderBytes = 4 + source.channels * 4;
		if (blockBytes < blockHeaderBytes) {
			return { faultCode: APU_FAULT_OUTPUT_BLOCK, faultDetail: offset };
		}
		const blockEnd = offset + blockBytes;
		if (blockEnd > source.dataBytes) {
			return { faultCode: APU_FAULT_OUTPUT_BLOCK, faultDetail: offset };
		}
		let channelCursor = blockOffset + 4;
		for (let channel = 0; channel < source.channels; channel += 1) {
			if (bytes[channelCursor + 2]! > 88) {
				return { faultCode: APU_FAULT_OUTPUT_BLOCK, faultDetail: offset };
			}
			channelCursor += 4;
		}
		if (blockFrames * source.channels > (blockBytes - blockHeaderBytes) * 2) {
			return { faultCode: APU_FAULT_OUTPUT_BLOCK, faultDetail: offset };
		}
		decodedFrames += blockFrames;
		offset = blockEnd;
	}
	while (seekIndex < seekOffsets.length) {
		if (seekFrames[seekIndex]! <= source.frameCount) {
			return { faultCode: APU_FAULT_OUTPUT_METADATA, faultDetail: seekIndex };
		}
		seekIndex += 1;
	}
	return { faultCode: APU_FAULT_NONE, faultDetail: 0 };
}
