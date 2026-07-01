import { getMachineVdpModeProfile, PSX_MODEL_PROFILE } from '../model_registry';
import {
	DEFAULT_GEO_SCRATCH_SIZE,
	BASE_RAM_USED_SIZE,
	IO_REGION_SIZE,
	MIN_RAM_SIZE,
	VDP_STREAM_BUFFER_SIZE,
	type MemoryMapSpecs,
} from './map';

export function resolveRuntimeMemoryMapSpecs(): MemoryMapSpecs {
	const renderSize = getMachineVdpModeProfile(PSX_MODEL_PROFILE.biosVdpMode);
	const frameBufferWidth = renderSize.renderWidth;
	const frameBufferHeight = renderSize.renderHeight;
	const frameBufferBytes = frameBufferWidth * frameBufferHeight * 4;
	const ramBytes = PSX_MODEL_PROFILE.ramBytes;
	const footprintMiB = (ramBytes / (1024 * 1024)).toFixed(2);
	const dynamicRamBytes = ramBytes - MIN_RAM_SIZE;
	console.info(
		`memory footprint: ram=${ramBytes} bytes (${footprintMiB} MiB) `
		+ `(io=${IO_REGION_SIZE}, base_ram_used=${BASE_RAM_USED_SIZE}, dynamic_ram=${dynamicRamBytes}, `
		+ `geo_scratch=${DEFAULT_GEO_SCRATCH_SIZE}, vdp_stream=${VDP_STREAM_BUFFER_SIZE}, vram_staging=${PSX_MODEL_PROFILE.stagingBytes}, framebuffer=${frameBufferBytes} (${frameBufferWidth}x${frameBufferHeight}), `
		+ `system_slot=${PSX_MODEL_PROFILE.slotBytes}, slot=${PSX_MODEL_PROFILE.slotBytes}x2=${PSX_MODEL_PROFILE.slotBytes * 2}).`,
	);
	return {
		ram_bytes: ramBytes,
		slot_bytes: PSX_MODEL_PROFILE.slotBytes,
		system_slot_bytes: PSX_MODEL_PROFILE.slotBytes,
		staging_bytes: PSX_MODEL_PROFILE.stagingBytes,
		framebuffer_bytes: frameBufferBytes,
	};
}
