import {
	buildRuntimeRomLayer,
	buildSystemRuntimeRomLayer,
	type RuntimeRomLayer,
} from '../rompack/loader';
import { SYSTEM_BOOT_ENTRY_PATH, SYSTEM_MACHINE_MANIFEST } from './system';
import { getMachineVdpModeProfile, PSX_MODEL_PROFILE } from '../machine/model_registry';

export type RomBootPlan = {
	systemLayer: RuntimeRomLayer;
	cartLayer: RuntimeRomLayer | null;
	viewportSize: { x: number; y: number };
};

export class RomBootManager {
	public async buildBootPlan(options: { systemRom: Uint8Array; cartridge?: Uint8Array }): Promise<RomBootPlan> {
		const systemLayer = await buildSystemRuntimeRomLayer({
			blob: options.systemRom,
			machine: SYSTEM_MACHINE_MANIFEST,
			entry_path: SYSTEM_BOOT_ENTRY_PATH,
		});
		const cartLayer = options.cartridge
			? await buildRuntimeRomLayer({ blob: options.cartridge, id: 'cart' })
			: null;

		const viewport = getMachineVdpModeProfile(PSX_MODEL_PROFILE.biosVdpMode);
		return {
			systemLayer,
			cartLayer,
			viewportSize: {
				x: viewport.renderWidth,
				y: viewport.renderHeight,
			},
		};
	}
}
