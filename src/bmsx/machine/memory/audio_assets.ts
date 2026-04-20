import type { RawAssetSource } from '../../rompack/source';

const BADP_HEADER_SIZE = 48;
const BADP_MAGIC_0 = 0x42; // B
const BADP_MAGIC_1 = 0x41; // A
const BADP_MAGIC_2 = 0x44; // D
const BADP_MAGIC_3 = 0x50; // P
const BADP_VERSION = 1;

export type RuntimeAudioInfo = {
	sampleRate: number;
	channels: number;
	bitsPerSample: number;
	dataOffset: number;
	dataLength: number;
	frames: number;
};

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

function isBadpBuffer(buffer: Uint8Array): boolean {
	return (
		buffer.byteLength >= BADP_HEADER_SIZE
		&& buffer[0] === BADP_MAGIC_0
		&& buffer[1] === BADP_MAGIC_1
		&& buffer[2] === BADP_MAGIC_2
		&& buffer[3] === BADP_MAGIC_3
	);
}

function parseBadpInfo(buffer: Uint8Array): RuntimeAudioInfo {
	if (!isBadpBuffer(buffer)) {
		throw new Error('[RuntimeAssets] Unsupported audio format.');
	}
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const version = view.getUint16(4, true);
	if (version !== BADP_VERSION) {
		throw new Error(`[RuntimeAssets] Unsupported BADP version ${version}.`);
	}
	const channels = view.getUint16(6, true);
	const sampleRate = view.getUint32(8, true);
	const frames = view.getUint32(12, true);
	const seekEntryCount = view.getUint32(28, true);
	const seekTableOffset = view.getUint32(32, true);
	const dataOffset = view.getUint32(36, true);
	if (channels <= 0 || channels > 2) {
		throw new Error('[RuntimeAssets] BADP channel count must be 1 or 2.');
	}
	if (sampleRate <= 0) {
		throw new Error('[RuntimeAssets] BADP sample rate must be positive.');
	}
	if (dataOffset < BADP_HEADER_SIZE || dataOffset > buffer.byteLength) {
		throw new Error('[RuntimeAssets] BADP data offset is invalid.');
	}
	if (seekEntryCount > 0 && (seekTableOffset < BADP_HEADER_SIZE || seekTableOffset >= dataOffset)) {
		throw new Error('[RuntimeAssets] BADP seek table offset is invalid.');
	}
	return {
		sampleRate,
		channels,
		bitsPerSample: 4,
		dataOffset,
		dataLength: buffer.byteLength - dataOffset,
		frames,
	};
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
			info = parseBadpInfo(buffer);
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
