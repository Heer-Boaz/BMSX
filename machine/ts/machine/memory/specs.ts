import { PSX_MODEL_PROFILE, VDP_MODE_PSX_PROFILE } from '../model_registry';
import {
	DEFAULT_GEO_SCRATCH_SIZE,
	BASE_RAM_USED_SIZE,
	IO_REGION_SIZE,
	MIN_RAM_SIZE,
	VDP_STREAM_BUFFER_SIZE,
	type MemoryMapSpecs,
} from './map';

export function resolveRuntimeMemoryMapSpecs(): MemoryMapSpecs {
	const renderSize = VDP_MODE_PSX_PROFILE;
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
		+ `texture_vram=${PSX_MODEL_PROFILE.textureBytes}).`,
	);
	return {
		ram_bytes: ramBytes,
		texture_bytes: PSX_MODEL_PROFILE.textureBytes,
		staging_bytes: PSX_MODEL_PROFILE.stagingBytes,
		framebuffer_bytes: frameBufferBytes,
	};
}
