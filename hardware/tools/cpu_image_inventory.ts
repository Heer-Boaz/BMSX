// Inspect explicitly supplied built images with the existing BLua32 image
// decoder. The first input is the firmware; each subsequent input is a cart.
// This reports image metadata, not runtime heap usage or compatibility.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readLE32 } from '../../machine/ts/common/endian';
import {
	Blua32ConstantTag,
	BLUA32_CONSTANT_RECORD_SIZE,
	BLUA32_CONSTANT_TAG_OFFSET,
} from '../../machine/ts/spec/blua32/image_format';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { decodeBlua32RomImage } from '../../toolchain/ts/rompack/blua32_image';

const encoder = new TextEncoder();
const files = process.argv.slice(2);
if (files.length === 0) throw new Error('Supply firmware ROM first, then zero or more cartridge ROMs.');
const noExecutableImages: { path: string; sha256: string; bytes: number }[] = [];
const images = files.flatMap((path, index) => {
	const bytes = readFileSync(path);
	const image = decodeBlua32RomImage(bytes, index === 0 ? SYSTEM_ROM_BASE : CART_ROM_BASE);
	if (!image) {
		if (index === 0) throw new Error(`Firmware has no BLua32 image: ${path}`);
		noExecutableImages.push({ path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length });
		return [];
	}
	const strings = new Set([...image.globalNames, ...image.systemGlobalNames]);
	const constants = { nil: 0, false: 0, true: 0, number: 0, string: 0 };
	const tableOffset = image.header.constantTableAddress - image.address;
	for (let i = 0; i < image.constants.length; i += 1) {
		const tag = readLE32(image.bytes, tableOffset + i * BLUA32_CONSTANT_RECORD_SIZE + BLUA32_CONSTANT_TAG_OFFSET);
		switch (tag) {
			case Blua32ConstantTag.Nil: constants.nil += 1; break;
			case Blua32ConstantTag.False: constants.false += 1; break;
			case Blua32ConstantTag.True: constants.true += 1; break;
			case Blua32ConstantTag.Number: constants.number += 1; break;
			case Blua32ConstantTag.String:
				constants.string += 1;
				strings.add(image.constants[i] as string);
				break;
		}
	}
	let stringBytes = 0;
	for (const value of strings) stringBytes += encoder.encode(value).length;
	return [{
		path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
		globalRecords: image.globalNames.length, systemGlobalRecords: image.systemGlobalNames.length,
		uniqueGlobals: new Set(image.globalNames).size, uniqueSystemGlobals: new Set(image.systemGlobalNames).size,
		constantRecords: image.constants.length, constants, functions: image.functions.length,
		uniqueImageStrings: strings.size, uniqueImageStringUtf8Bytes: stringBytes,
		ordinary: new Set(image.globalNames), system: new Set(image.systemGlobalNames), strings,
	}];
});
const firmware = images[0];
const rows = images.map(({ ordinary, system, strings, ...row }, index) => {
	if (index === 0) return row;
	const combinedStrings = new Set([...firmware.strings, ...strings]);
	let combinedStringBytes = 0;
	for (const value of combinedStrings) combinedStringBytes += encoder.encode(value).length;
	return {
		...row,
		withFirmware: {
			ordinaryGlobals: new Set([...firmware.ordinary, ...ordinary]).size,
			systemGlobals: new Set([...firmware.system, ...system]).size,
			uniqueImageStrings: combinedStrings.size,
			uniqueImageStringUtf8Bytes: combinedStringBytes,
		},
	};
});
process.stdout.write(JSON.stringify({
	scope: 'Image records only; no runtime activation, live heap, peak frame depth, physical capacity, or compatibility guarantee.',
	firmware: files[0], images: rows, noExecutableImages,
}, null, 2) + '\n');
