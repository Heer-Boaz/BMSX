import type { MachineManifest } from '../../rompack/format';
import {
	getMachineMemorySpecs,
} from '../../rompack/format';
import {
	DEFAULT_GEO_SCRATCH_SIZE,
	DEFAULT_STRING_HANDLE_COUNT,
	DEFAULT_STRING_HEAP_SIZE,
	DEFAULT_VRAM_IMAGE_SLOT_SIZE,
	DEFAULT_VRAM_STAGING_SIZE,
	IO_REGION_SIZE,
	IO_WORD_SIZE,
	STRING_HANDLE_ENTRY_SIZE,
	VDP_STREAM_BUFFER_SIZE,
	alignUp,
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
	const stringHandleCount = DEFAULT_STRING_HANDLE_COUNT;
	const stringHeapBytes = DEFAULT_STRING_HEAP_SIZE;
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
	const runtimeRamBaseOffset = IO_REGION_SIZE
		+ (stringHandleCount * STRING_HANDLE_ENTRY_SIZE)
		+ stringHeapBytes;
	const runtimeRamBasePadding = alignUp(runtimeRamBaseOffset, IO_WORD_SIZE) - runtimeRamBaseOffset;
	const fixedRamBytes = runtimeRamBaseOffset
		+ runtimeRamBasePadding
		+ DEFAULT_GEO_SCRATCH_SIZE
		+ VDP_STREAM_BUFFER_SIZE;
	const requiredRamBytes = fixedRamBytes;
	const ramBytes = memorySpecs.ram_bytes === undefined
		? requiredRamBytes
		: resolvePositiveSafeInteger(memorySpecs.ram_bytes, 'machine.specs.ram.ram_bytes');
	if (ramBytes < requiredRamBytes) {
		throw runtimeMemorySpecFault(`machine.specs.ram.ram_bytes (${ramBytes}) must be at least required size ${requiredRamBytes}.`);
	}
	const footprintMiB = (ramBytes / (1024 * 1024)).toFixed(2);
	console.info(
		`memory footprint: ram=${ramBytes} bytes (${footprintMiB} MiB) `
		+ `(io=${IO_REGION_SIZE}, string_handles=${stringHandleCount}, string_heap=${stringHeapBytes}, `
		+ `geo_scratch=${DEFAULT_GEO_SCRATCH_SIZE}, vdp_stream=${VDP_STREAM_BUFFER_SIZE}, vram_staging=${stagingBytes}, framebuffer=${frameBufferBytes} (${frameBufferWidth}x${frameBufferHeight}), `
		+ `system_slot=${systemSlotBytes}, slot=${slotBytes}x2=${slotBytes * 2}).`,
	);
	return {
		ram_bytes: ramBytes,
		string_handle_count: stringHandleCount,
		string_heap_bytes: stringHeapBytes,
		slot_bytes: slotBytes,
		system_slot_bytes: systemSlotBytes,
		staging_bytes: stagingBytes,
		framebuffer_bytes: frameBufferBytes,
	};
}
