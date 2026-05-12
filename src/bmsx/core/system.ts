import { DEFAULT_GEO_WORK_UNITS_PER_SEC, type MachineManifest } from '../rompack/format';
import { DEFAULT_UFPS_SCALED } from '../machine/runtime/timing/constants';

export const SYSTEM_ROM_NAME = 'bmsx-bios';
export const SYSTEM_BOOT_ENTRY_PATH = 'bios/bootrom.lua';

export const SYSTEM_MACHINE_MANIFEST: MachineManifest = {
	render_size: {
		width: 256,
		height: 212,
	},
	namespace: 'bmsx',
	ufps: DEFAULT_UFPS_SCALED,
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
			work_units_per_sec: 25_600,
		},
		geo: {
			work_units_per_sec: DEFAULT_GEO_WORK_UNITS_PER_SEC,
		},
	},
};
