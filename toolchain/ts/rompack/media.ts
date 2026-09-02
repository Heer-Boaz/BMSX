import {
	buildCartridgeToolingLayer,
	buildSystemToolingLayer,
	type RomToolingLayer,
} from './loader';
import {
	parseCartridgePackage,
	parseSystemRomImage,
} from '../../../machine/ts/rompack/image';

export type RomToolingMedia = {
	system: RomToolingLayer<'system'>;
	cartridgeSlots: readonly [
		RomToolingLayer<'cart'> | null,
		RomToolingLayer<'cart'> | null,
	];
};

export async function loadRomToolingMedia(
	systemRom: Uint8Array,
	cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null],
): Promise<RomToolingMedia> {
	const systemImage = parseSystemRomImage(systemRom);
	const cartridgeImages = [
		cartridgeSlots[0] ? parseCartridgePackage(cartridgeSlots[0]) : null,
		cartridgeSlots[1] ? parseCartridgePackage(cartridgeSlots[1]) : null,
	] as const;
	const [system, slot0, slot1] = await Promise.all([
		buildSystemToolingLayer(systemImage),
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
