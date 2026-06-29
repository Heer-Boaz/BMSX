import { type MachineManifest } from '../rompack/format';
import { getMachineRegionTiming, PSX_MODEL_PROFILE, PSX_VDP_CLASS_PROFILE } from '../machine/model_registry';

export const SYSTEM_ROM_NAME = 'bmsx-bios';
export const SYSTEM_BOOT_ENTRY_PATH = 'bios/bootrom.lua';

const systemRegion = getMachineRegionTiming('pal');

export const SYSTEM_MACHINE_MANIFEST: MachineManifest = {
	render_size: {
		width: PSX_MODEL_PROFILE.biosRenderWidth,
		height: PSX_MODEL_PROFILE.biosRenderHeight,
	},
	namespace: 'bmsx',
	ufps: systemRegion.refreshUfpsScaled,
	specs: {
		cpu: {
			cpu_freq_hz: PSX_MODEL_PROFILE.cpuFreqHz,
			imgdec_bytes_per_sec: PSX_MODEL_PROFILE.imgDecBytesPerSec,
		},
		dma: {
			dma_bytes_per_sec_iso: PSX_MODEL_PROFILE.dmaBytesPerSecIso,
			dma_bytes_per_sec_bulk: PSX_MODEL_PROFILE.dmaBytesPerSecBulk,
		},
		vdp: {
			work_units_per_sec: PSX_VDP_CLASS_PROFILE.vdpWorkUnitsPerSec,
		},
		geo: {
			work_units_per_sec: PSX_VDP_CLASS_PROFILE.geoWorkUnitsPerSec,
		},
		ram: {
			ram_bytes: PSX_MODEL_PROFILE.ramBytes,
		},
		vram: {
			slot_bytes: PSX_MODEL_PROFILE.slotBytes,
			system_slot_bytes: PSX_MODEL_PROFILE.slotBytes,
			staging_bytes: PSX_MODEL_PROFILE.stagingBytes,
		},
	},
};
