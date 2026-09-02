import {
	decodeBinary,
	requireObject,
	requireObjectKey,
} from '../common/serializer/binencoder';
import { CART_RAM_SIZE } from '../spec/bmsx/memory_map';
import type { CartRomHeader } from './format';

export type CartridgeRamDeviceConfig = {
	type: 'ram';
	bytes: number;
};

export type CartridgeRomDeviceConfig = {
	type: 'rom';
};

export type CartridgeMailboxDeviceConfig = {
	type: 'mailbox';
};

export type CartridgeDeviceConfig =
	| CartridgeRomDeviceConfig
	| CartridgeRamDeviceConfig
	| CartridgeMailboxDeviceConfig;

export type CartManifest = {
	title?: string;
	hardware: CartridgeDeviceConfig[];
};

function assertObjectKeys(
	object: Record<string, unknown>,
	allowed: readonly string[],
	label: string,
): void {
	const keys = Object.keys(object);
	for (let index = 0; index < keys.length; index += 1) {
		if (!allowed.includes(keys[index]!)) {
			throw new Error(`${label}.${keys[index]} is not part of the cartridge manifest schema.`);
		}
	}
}

export function parseCartManifest(value: unknown, label: string): CartManifest {
	const root = requireObject(value, label);
	assertObjectKeys(root, ['title', 'hardware'], label);
	const title = root.title;
	let manifestTitle: string | undefined;
	if (title !== undefined) {
		if (typeof title !== 'string') {
			throw new Error(`${label}.title must be a string.`);
		}
		manifestTitle = title;
	}
	const hardwareValue = requireObjectKey(root, 'hardware', label, `${label}.hardware`);
	if (!Array.isArray(hardwareValue)) {
		throw new Error(`${label}.hardware must be an array.`);
	}
	const hardware: CartridgeDeviceConfig[] = [];
	let romPresent = false;
	let ramPresent = false;
	let mailboxPresent = false;
	for (let index = 0; index < hardwareValue.length; index += 1) {
		const deviceLabel = `${label}.hardware[${index}]`;
		const object = requireObject(hardwareValue[index], deviceLabel);
		const type = requireObjectKey(object, 'type', deviceLabel, `${deviceLabel}.type`);
		switch (type) {
			case 'rom':
				assertObjectKeys(object, ['type'], deviceLabel);
				if (romPresent) {
					throw new Error(`${label}.hardware contains more than one ROM device.`);
				}
				romPresent = true;
				hardware.push({ type: 'rom' });
				break;
			case 'ram': {
				assertObjectKeys(object, ['type', 'bytes'], deviceLabel);
				if (ramPresent) {
					throw new Error(`${label}.hardware contains more than one RAM device.`);
				}
				const bytes = requireObjectKey(object, 'bytes', deviceLabel, `${deviceLabel}.bytes`) as number;
				if (!Number.isInteger(bytes) || bytes < 1 || bytes > CART_RAM_SIZE) {
					throw new Error(`${deviceLabel}.bytes must be an integer from 1 through ${CART_RAM_SIZE}.`);
				}
				ramPresent = true;
				hardware.push({ type: 'ram', bytes });
				break;
			}
			case 'mailbox':
				assertObjectKeys(object, ['type'], deviceLabel);
				if (mailboxPresent) {
					throw new Error(`${label}.hardware contains more than one mailbox device.`);
				}
				mailboxPresent = true;
				hardware.push({ type: 'mailbox' });
				break;
			default:
				throw new Error(`${deviceLabel}.type is not a supported cartridge device.`);
		}
	}
	return manifestTitle === undefined
		? { hardware }
		: { title: manifestTitle, hardware };
}

export function decodeCartManifest(
	packageBytes: Uint8Array,
	header: CartRomHeader,
): CartManifest {
	if (header.manifestLength === 0) {
		throw new Error('Cartridge package header is missing its manifest payload.');
	}
	return parseCartManifest(
		decodeBinary(packageBytes.subarray(
			header.manifestOffset,
			header.manifestOffset + header.manifestLength,
		), { rejectFloatingPointValues: true }),
		'Cartridge package manifest',
	);
}
