import { formatNumberAsHex } from '../common/byte_hex_string';

export const ROM_METADATA_MAGIC = 0x44544d42; // 'BMTD' little-endian
export const ROM_METADATA_VERSION = 1;
export const ROM_METADATA_HEADER_SIZE = 12;

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

export type RomMetadataSection = {
	version: number;
	propNames: string[];
	payloadOffset: number;
};

function readVarUint(buffer: Uint8Array, offsetRef: { offset: number }): number {
	let value = 0;
	let shift = 0;
	let byte = 0;
	let count = 0;
	do {
		if (offsetRef.offset >= buffer.length) {
			throw new Error('parseRomMetadataSection: truncated varuint');
		}
		byte = buffer[offsetRef.offset++];
		value |= (byte & 0x7F) << shift;
		shift += 7;
		if (++count > 5) {
			throw new Error('parseRomMetadataSection: varuint overflow');
		}
	} while (byte & 0x80);
	return value >>> 0;
}

export function parseRomMetadataSection(buffer: Uint8Array): RomMetadataSection {
	if (buffer.byteLength < ROM_METADATA_HEADER_SIZE) {
		throw new Error('parseRomMetadataSection: section too small');
	}
	const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
	const magic = view.getUint32(0, true);
	if (magic !== ROM_METADATA_MAGIC) {
		throw new Error(`parseRomMetadataSection: bad magic ${formatNumberAsHex(magic)}`);
	}
	const version = view.getUint32(4, true);
	if (version !== ROM_METADATA_VERSION) {
		throw new Error(`parseRomMetadataSection: unsupported version ${version}`);
	}
	const propCount = view.getUint32(8, true);
	const offsetRef = { offset: ROM_METADATA_HEADER_SIZE };
	const propNames = new Array<string>(propCount);
	for (let i = 0; i < propCount; i++) {
		const length = readVarUint(buffer, offsetRef);
		if (offsetRef.offset + length > buffer.length) {
			throw new Error('parseRomMetadataSection: truncated property string');
		}
		propNames[i] = utf8Decoder.decode(buffer.subarray(offsetRef.offset, offsetRef.offset + length));
		offsetRef.offset += length;
	}
	return {
		version,
		propNames,
		payloadOffset: offsetRef.offset,
	};
}
