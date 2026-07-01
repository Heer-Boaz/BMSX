import { type MachineManifest } from '../rompack/format';

export const SYSTEM_ROM_NAME = 'bmsx-bios';
export const SYSTEM_BOOT_ENTRY_PATH = 'bios/bootrom.lua';


export const SYSTEM_MACHINE_MANIFEST: MachineManifest = {
	namespace: 'bmsx',
	vdp_class: 'psx',
};
