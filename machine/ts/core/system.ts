import { type MachineManifest } from '../rompack/format';
import { PSX_MODEL_PROFILE } from '../machine/model_registry';

export const SYSTEM_ROM_NAME = 'bmsx-bios';
export const SYSTEM_BOOT_ENTRY_PATH = 'bios/bootrom.lua';


export const SYSTEM_MACHINE_MANIFEST: MachineManifest = {
	render_size: {
		width: PSX_MODEL_PROFILE.biosRenderWidth,
		height: PSX_MODEL_PROFILE.biosRenderHeight,
	},
	namespace: 'bmsx',
	vdp_class: 'psx',
};
