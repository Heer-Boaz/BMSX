import { PSX_MACHINE_SPEC, PSX_VDP_MODE_SPEC } from '../model_registry';
import {
	DEFAULT_GEO_SCRATCH_SIZE,
	BASE_RAM_USED_SIZE,
	IO_REGION_SIZE,
	MIN_RAM_SIZE,
	VDP_STREAM_BUFFER_SIZE,
	type MemoryMapSpecs,
} from './map';

export function resolveRuntimeMemoryMapSpecs(): MemoryMapSpecs {
	const renderSize = PSX_VDP_MODE_SPEC;
	const frameBufferWidth = renderSize.renderWidth;
	const frameBufferHeight = renderSize.renderHeight;
	const frameBufferBytes = frameBufferWidth * frameBufferHeight * 4;
	const ramBytes = PSX_MACHINE_SPEC.ramBytes;
	const footprintMiB = (ramBytes / (1024 * 1024)).toFixed(2);
	const dynamicRamBytes = ramBytes - MIN_RAM_SIZE;
	console.info(
		`memory footprint: ram=${ramBytes} bytes (${footprintMiB} MiB) `
		+ `(io=${IO_REGION_SIZE}, base_ram_used=${BASE_RAM_USED_SIZE}, dynamic_ram=${dynamicRamBytes}, `
		+ `geo_scratch=${DEFAULT_GEO_SCRATCH_SIZE}, vdp_stream=${VDP_STREAM_BUFFER_SIZE}, vram_staging=${PSX_MACHINE_SPEC.stagingBytes}, framebuffer=${frameBufferBytes} (${frameBufferWidth}x${frameBufferHeight}), `
		+ `texture_vram=${PSX_MACHINE_SPEC.textureBytes}).`,
	);
	return {
		ram_bytes: ramBytes,
		texture_bytes: PSX_MACHINE_SPEC.textureBytes,
		staging_bytes: PSX_MACHINE_SPEC.stagingBytes,
		framebuffer_bytes: frameBufferBytes,
	};
}
