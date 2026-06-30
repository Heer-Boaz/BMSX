import { type MachineManifest } from '../rompack/format';
import { getMachineVdpModeProfile, PSX_MODEL_PROFILE } from '../machine/model_registry';

export const SYSTEM_ROM_NAME = 'bmsx-bios';
export const SYSTEM_BOOT_ENTRY_PATH = 'bios/bootrom.lua';


export const SYSTEM_MACHINE_MANIFEST: MachineManifest = {
	render_size: {
		width: getMachineVdpModeProfile(PSX_MODEL_PROFILE.biosVdpMode).renderWidth,
		height: getMachineVdpModeProfile(PSX_MODEL_PROFILE.biosVdpMode).renderHeight,
	},
	namespace: 'bmsx',
	vdp_class: 'psx',
	vdp_mode: PSX_MODEL_PROFILE.biosVdpMode,
};
