import { shallowcopy } from '../common/shallowcopy';
import {
	buildSystemRuntimeAssetLayer,
	normalizeCartridgeBlob,
	parseCartridgeIndex,
} from '../rompack/loader';
import { SYSTEM_BOOT_ENTRY_PATH, SYSTEM_MACHINE_MANIFEST } from './system';

export type RuntimeAssetLayer = Awaited<ReturnType<typeof buildSystemRuntimeAssetLayer>>;

export type RomBootPlan = {
	engineLayer: RuntimeAssetLayer;
	viewportSize: { x: number; y: number };
};

export class RomBootManager {
	public async buildBootPlan(options: { engineRom: Uint8Array; cartridge?: Uint8Array }): Promise<RomBootPlan> {
		const engineLayer = await buildSystemRuntimeAssetLayer({
			blob: options.engineRom,
			machine: SYSTEM_MACHINE_MANIFEST,
			entry_path: SYSTEM_BOOT_ENTRY_PATH,
		});

		let viewport = engineLayer.index.machine.render_size;
		if (options.cartridge) {
			const cartNormalized = normalizeCartridgeBlob(options.cartridge);
			const cartIndex = await parseCartridgeIndex(cartNormalized.payload);
			viewport = cartIndex.machine.render_size;
		}

		const viewportInput = shallowcopy(viewport) as { width?: number; height?: number;};
		return {
			engineLayer,
			viewportSize: {
				x: viewportInput.width!,
				y: viewportInput.height!,
			},
		};
	}
}
