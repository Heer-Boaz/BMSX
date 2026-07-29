import {
	buildCartridgeToolingLayer,
	buildSystemToolingLayer,
	type RomToolingLayer,
} from './loader';
import { parseRomImage } from '../image';
import { SYSTEM_BOOT_ENTRY_PATH } from './system';

export type RomToolingMedia = {
	system: RomToolingLayer;
	cartridgeSlots: readonly [
		RomToolingLayer | null,
		RomToolingLayer | null,
	];
};

export async function loadRomToolingMedia(
	systemRom: Uint8Array,
	cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null],
): Promise<RomToolingMedia> {
	const systemImage = parseRomImage(systemRom, 'system');
	const cartridgeImages = [
		cartridgeSlots[0] ? parseRomImage(cartridgeSlots[0], 'cart') : null,
		cartridgeSlots[1] ? parseRomImage(cartridgeSlots[1], 'cart') : null,
	] as const;
	const [system, slot0, slot1] = await Promise.all([
		buildSystemToolingLayer({
			image: systemImage,
			entry_path: SYSTEM_BOOT_ENTRY_PATH,
		}),
		cartridgeImages[0]
			? buildCartridgeToolingLayer(cartridgeImages[0])
			: null,
		cartridgeImages[1]
			? buildCartridgeToolingLayer(cartridgeImages[1])
			: null,
	]);
	return {
		system,
		cartridgeSlots: [slot0, slot1],
	};
}
