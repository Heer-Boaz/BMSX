import type { MachineManifest } from '../rompack/rompack';

export const SYSTEM_ROM_NAME = 'bmsx-bios';
export const SYSTEM_BOOT_ENTRY_PATH = 'res/bios/bootrom.lua';

export const SYSTEM_MACHINE_MANIFEST: MachineManifest = {
	render_size: {
		width: 256,
		height: 212,
	},
	canonicalization: 'lower',
	namespace: 'bmsx',
	ufps: 50_000_000,
	specs: {
		cpu: {
			cpu_freq_hz: 1_000_000,
			imgdec_bytes_per_sec: 26_214_400,
		},
		dma: {
			dma_bytes_per_sec_iso: 8_388_608,
			dma_bytes_per_sec_bulk: 26_214_400,
		},
		vdp: {
			render_budget_per_frame: 512,
		},
	},
};
