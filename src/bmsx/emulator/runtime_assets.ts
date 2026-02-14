import type { RawAssetSource } from '../rompack/asset_source';
import { parseWavInfo, type WavInfo } from '../utils/wav';

export type RuntimeAudioInfo = WavInfo;

export interface RuntimeAudioRegistry {
	hasAsset(assetId: string): boolean;
	registerAudioMeta(meta: {
		id: string;
		sampleRate: number;
		channels: number;
		bitsPerSample: number;
		frames: number;
		dataOffset: number;
		dataSize: number;
	}): void;
}

function isWavBuffer(buffer: Uint8Array): boolean {
	return (
		buffer.byteLength >= 12
		&& buffer[0] === 0x52 // R
		&& buffer[1] === 0x49 // I
		&& buffer[2] === 0x46 // F
		&& buffer[3] === 0x46 // F
		&& buffer[8] === 0x57 // W
		&& buffer[9] === 0x41 // A
		&& buffer[10] === 0x56 // V
		&& buffer[11] === 0x45 // E
	);
}

function isOggBuffer(buffer: Uint8Array): boolean {
	return (
		buffer.byteLength >= 4
		&& buffer[0] === 0x4f // O
		&& buffer[1] === 0x67 // g
		&& buffer[2] === 0x67 // g
		&& buffer[3] === 0x53 // S
	);
}

function isOggBufferAt(buffer: Uint8Array, offset: number): boolean {
	return (
		offset + 4 <= buffer.byteLength
		&& buffer[offset] === 0x4f // O
		&& buffer[offset + 1] === 0x67 // g
		&& buffer[offset + 2] === 0x67 // g
		&& buffer[offset + 3] === 0x53 // S
	);
}

function readLeU32(buffer: Uint8Array, offset: number): number {
	return buffer[offset]
		| (buffer[offset + 1] << 8)
		| (buffer[offset + 2] << 16)
		| (buffer[offset + 3] << 24);
}

function isOggGranulePosInvalid(buffer: Uint8Array, offset: number): boolean {
	for (let byteIndex = 0; byteIndex < 8; byteIndex += 1) {
		if (buffer[offset + byteIndex] !== 0xff) {
			return false;
		}
	}
	return true;
}

function readLeU64(buffer: Uint8Array, offset: number): number {
	let value = 0;
	let factor = 1;
	for (let byteIndex = 0; byteIndex < 8; byteIndex += 1) {
		const current = buffer[offset + byteIndex] * factor;
		const updated = value + current;
		if (!Number.isFinite(updated)) {
			return Number.MAX_SAFE_INTEGER;
		}
		value = updated;
		factor *= 256;
	}
	return value;
}

function parseOggVorbisInfo(buffer: Uint8Array): RuntimeAudioInfo {
	let sampleRate = 0;
	let channels = 0;
	const searchLimit = Math.min(buffer.byteLength - 7, 8192);
	for (let index = 0; index <= searchLimit; index += 1) {
		if (buffer[index] !== 0x01) {
			continue;
		}
		if (
			buffer[index + 1] === 0x76 // v
			&& buffer[index + 2] === 0x6f // o
			&& buffer[index + 3] === 0x72 // r
			&& buffer[index + 4] === 0x62 // b
			&& buffer[index + 5] === 0x69 // i
			&& buffer[index + 6] === 0x73 // s
			&& index + 20 < buffer.byteLength
		) {
			channels = buffer[index + 11];
			sampleRate = readLeU32(buffer, index + 12);
			if (channels > 0 && sampleRate > 0) {
				break;
			}
			channels = 0;
		}
	}
	if (sampleRate <= 0 || channels <= 0) {
		throw new Error('[RuntimeAssets] Failed to read OGG/Vorbis metadata.');
	}

	let frameCount = 0;
	let cursor = 0;
	const segmentHeaderSize = 27;
	while (cursor + segmentHeaderSize <= buffer.byteLength) {
		if (!isOggBufferAt(buffer, cursor)) {
			cursor += 1;
			continue;
		}
		const segmentCount = buffer[cursor + 26];
		const pageStart = cursor + segmentHeaderSize;
		if (pageStart > buffer.byteLength) {
			break;
		}
		const segmentTableEnd = pageStart + segmentCount;
		if (segmentTableEnd > buffer.byteLength) {
			break;
		}
		let payloadEnd = segmentTableEnd;
		for (let index = pageStart; index < segmentTableEnd; index += 1) {
			payloadEnd += buffer[index];
		}
		if (payloadEnd > buffer.byteLength) {
			break;
		}

		const granulePos = readLeU64(buffer, cursor + 6);
		if (
			!isOggGranulePosInvalid(buffer, cursor + 6)
			&& granulePos > frameCount
			&& granulePos <= Number.MAX_SAFE_INTEGER
		) {
			frameCount = granulePos;
		}
		cursor = payloadEnd;
	}

	const frames = frameCount > 0 ? frameCount : 0;

	return {
		sampleRate,
		channels,
		bitsPerSample: 16,
		dataOffset: 0,
		dataLength: buffer.byteLength,
		frames,
	};
}

export function parseAudioInfo(buffer: Uint8Array): RuntimeAudioInfo {
	if (isWavBuffer(buffer)) {
		return parseWavInfo(buffer);
	}
	if (isOggBuffer(buffer)) {
		return parseOggVorbisInfo(buffer);
	}
	throw new Error('[RuntimeAssets] Unsupported audio format.');
}

export function registerAudioAssets(source: RawAssetSource, registry: RuntimeAudioRegistry): void {
	const entries = source.list('audio');
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index]!;
		if (registry.hasAsset(entry.resid)) {
			continue;
		}
		if (typeof entry.start !== 'number' || typeof entry.end !== 'number') {
			throw new Error(`[RuntimeAssets] Audio asset '${entry.resid}' missing ROM buffer offsets.`);
		}
		const buffer = source.getBytesView(entry);
		let info: RuntimeAudioInfo;
		try {
			info = parseAudioInfo(buffer);
		} catch (error) {
			throw new Error(`[RuntimeAssets] Unsupported audio format for '${entry.resid}'.`, { cause: error as Error });
		}
		registry.registerAudioMeta({
			id: entry.resid,
			sampleRate: info.sampleRate,
			channels: info.channels,
			bitsPerSample: info.bitsPerSample,
			frames: info.frames,
			dataOffset: info.dataOffset,
			dataSize: info.dataLength,
		});
	}
}
