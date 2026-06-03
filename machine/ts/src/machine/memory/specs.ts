import type { MachineManifest } from '../../rompack/format';
import {
	getMachineMemorySpecs,
} from '../../rompack/format';
import {
	DEFAULT_GEO_SCRATCH_SIZE,
	BASE_RAM_USED_SIZE,
	DEFAULT_RAM_SIZE,
	DEFAULT_VRAM_IMAGE_SLOT_SIZE,
	DEFAULT_VRAM_STAGING_SIZE,
	IO_REGION_SIZE,
	MAX_RAM_SIZE,
	MIN_RAM_SIZE,
	VDP_STREAM_BUFFER_SIZE,
	type MemoryMapSpecs,
} from './map';
import { resolvePositiveSafeInteger, resolveRuntimeRenderSize } from '../specs';

function runtimeMemorySpecFault(message: string): Error {
	return new Error(`Runtime fault: ${message}`);
}

export function resolveRuntimeMemoryMapSpecs(params: {
	machine: MachineManifest;
	systemMachine: MachineManifest;
	systemSlotBytes: number;
}): MemoryMapSpecs {
	const machineConfig = params.machine;
	const systemMachine = params.systemMachine;
	const memorySpecs = getMachineMemorySpecs(machineConfig);
	const engineMemorySpecs = getMachineMemorySpecs(systemMachine);
	const slotBytes = memorySpecs.slot_bytes ?? DEFAULT_VRAM_IMAGE_SLOT_SIZE;
	const systemSlotBytes = engineMemorySpecs.system_slot_bytes ?? params.systemSlotBytes;
	const renderSize = resolveRuntimeRenderSize(machineConfig);
	const frameBufferWidth = renderSize.width;
	const frameBufferHeight = renderSize.height;
	const frameBufferBytes = frameBufferWidth * frameBufferHeight * 4;
	if (!Number.isSafeInteger(systemSlotBytes) || systemSlotBytes <= 0) {
		throw runtimeMemorySpecFault('system slot slot bytes must be a positive integer.');
	}
	const stagingBytes = memorySpecs.staging_bytes ?? DEFAULT_VRAM_STAGING_SIZE;
	const ramBytes = memorySpecs.ram_bytes === undefined
		? DEFAULT_RAM_SIZE
		: resolvePositiveSafeInteger(memorySpecs.ram_bytes, 'machine.specs.ram.ram_bytes');
	if (ramBytes < MIN_RAM_SIZE) {
		throw runtimeMemorySpecFault(`machine.specs.ram.ram_bytes (${ramBytes}) must be at least required size ${MIN_RAM_SIZE}.`);
	}
	if (ramBytes > MAX_RAM_SIZE) {
		throw runtimeMemorySpecFault(`machine.specs.ram.ram_bytes (${ramBytes}) exceeds RAM address window ${MAX_RAM_SIZE}.`);
	}
	const footprintMiB = (ramBytes / (1024 * 1024)).toFixed(2);
	const dynamicRamBytes = ramBytes - MIN_RAM_SIZE;
	console.info(
		`memory footprint: ram=${ramBytes} bytes (${footprintMiB} MiB) `
		+ `(io=${IO_REGION_SIZE}, base_ram_used=${BASE_RAM_USED_SIZE}, dynamic_ram=${dynamicRamBytes}, `
		+ `geo_scratch=${DEFAULT_GEO_SCRATCH_SIZE}, vdp_stream=${VDP_STREAM_BUFFER_SIZE}, vram_staging=${stagingBytes}, framebuffer=${frameBufferBytes} (${frameBufferWidth}x${frameBufferHeight}), `
		+ `system_slot=${systemSlotBytes}, slot=${slotBytes}x2=${slotBytes * 2}).`,
	);
	return {
		ram_bytes: ramBytes,
		slot_bytes: slotBytes,
		system_slot_bytes: systemSlotBytes,
		staging_bytes: stagingBytes,
		framebuffer_bytes: frameBufferBytes,
	};
}
