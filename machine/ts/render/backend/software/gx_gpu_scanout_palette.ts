import { gxGpuSoftwareRgb555ChannelTo8 } from './gx_gpu_vram';

export const GX_GPU_SOFTWARE_RGB555_RGBA = new Uint32Array(0x1_0000);

for (let word = 0; word < GX_GPU_SOFTWARE_RGB555_RGBA.length; word += 1) {
	GX_GPU_SOFTWARE_RGB555_RGBA[word] = (
		gxGpuSoftwareRgb555ChannelTo8(word & 0x1f)
		| (gxGpuSoftwareRgb555ChannelTo8((word >>> 5) & 0x1f) << 8)
		| (gxGpuSoftwareRgb555ChannelTo8((word >>> 10) & 0x1f) << 16)
		| ((word & 0x8000) << 16)
	) >>> 0;
}
