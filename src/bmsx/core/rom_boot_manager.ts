import { shallowcopy } from '../common/shallowcopy';
import {
	buildSystemRuntimeRomLayer,
	normalizeCartridgeBlob,
	parseCartridgeIndex,
} from '../rompack/loader';
import { SYSTEM_BOOT_ENTRY_PATH, SYSTEM_MACHINE_MANIFEST } from './system';

export type RuntimeRomLayer = Awaited<ReturnType<typeof buildSystemRuntimeRomLayer>>;

export type RomBootPlan = {
	systemLayer: RuntimeRomLayer;
	viewportSize: { x: number; y: number };
};

export class RomBootManager {
	public async buildBootPlan(options: { systemRom: Uint8Array; cartridge?: Uint8Array }): Promise<RomBootPlan> {
		const systemLayer = await buildSystemRuntimeRomLayer({
			blob: options.systemRom,
			machine: SYSTEM_MACHINE_MANIFEST,
			entry_path: SYSTEM_BOOT_ENTRY_PATH,
		});

		let viewport = systemLayer.index.machine.render_size;
		if (options.cartridge) {
			const cartNormalized = normalizeCartridgeBlob(options.cartridge);
			const cartIndex = await parseCartridgeIndex(cartNormalized.payload);
			viewport = cartIndex.machine.render_size;
		}

		const viewportInput = shallowcopy(viewport) as { width?: number; height?: number;};
		return {
			systemLayer,
			viewportSize: {
				x: viewportInput.width!,
				y: viewportInput.height!,
			},
		};
	}
}
