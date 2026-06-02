import { buildBinaryPropTable, encodeBinaryWithPropTable } from '../../common/serializer/binencoder';
import {
	ROM_METADATA_HEADER_SIZE,
	ROM_METADATA_MAGIC,
	ROM_METADATA_VERSION,
} from '../metadata';

const utf8Encoder = new TextEncoder();

function pushVarUint(bytes: number[], value: number): void {
	if (value < 0 || value !== (value >>> 0)) {
		throw new Error('encodeRomMetadataSectionHeader: invalid varuint');
	}
	let current = value >>> 0;
	while (current >= 0x80) {
		bytes.push((current & 0x7F) | 0x80);
		current >>>= 7;
	}
	bytes.push(current);
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
	const out = new Uint8Array(header.length + bytes.length);
	out.set(header, 0);
	out.set(bytes, header.length);
	return out;
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
