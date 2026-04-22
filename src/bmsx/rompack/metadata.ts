import { buildBinaryPropTable, encodeBinaryWithPropTable } from '../common/serializer/binencoder';
import { formatNumberAsHex } from '../common/byte_hex_string';

export const ROM_METADATA_MAGIC = 0x44544d42; // 'BMTD' little-endian
export const ROM_METADATA_VERSION = 1;
export const ROM_METADATA_HEADER_SIZE = 12;

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const utf8Encoder = new TextEncoder();

function pushVarUint(bytes: number[], value: number): void {
	if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value) || value > 0xFFFFFFFF) {
		throw new Error('encodeRomMetadataSectionHeader: invalid varuint');
	}
	let current = value >>> 0;
	while (current >= 0x80) {
		bytes.push((current & 0x7F) | 0x80);
		current >>>= 7;
	}
	bytes.push(current);
}

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

export function encodeRomMetadataSectionHeader(propNames: readonly string[]): Uint8Array {
	const header = new Uint8Array(ROM_METADATA_HEADER_SIZE);
	const view = new DataView(header.buffer);
	view.setUint32(0, ROM_METADATA_MAGIC, true);
	view.setUint32(4, ROM_METADATA_VERSION, true);
	view.setUint32(8, propNames.length >>> 0, true);

	const bytes: number[] = [];
	for (let i = 0; i < propNames.length; i++) {
		const encoded = utf8Encoder.encode(propNames[i]);
		pushVarUint(bytes, encoded.length);
		for (let j = 0; j < encoded.length; j++) bytes.push(encoded[j]);
	}
	return Uint8Array.from([...header, ...bytes]);
}

export function buildRomMetadataSection(values: readonly any[]): { header: Uint8Array; propNames: string[]; payloads: Uint8Array[] } {
	const propNames = buildBinaryPropTable(values, true);
	const payloads = new Array<Uint8Array>(values.length);
	for (let i = 0; i < values.length; i++) {
		payloads[i] = encodeBinaryWithPropTable(values[i], propNames);
	}
	return {
		header: encodeRomMetadataSectionHeader(propNames),
		propNames,
		payloads,
	};
}

export function parseRomMetadataSection(buffer: Uint8Array): { version: number; propNames: string[]; payloadOffset: number } {
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
