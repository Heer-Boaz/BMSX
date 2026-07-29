export const GX_GPU_VRAM_X_ADDRESS_PERIOD = 1024;
export const GX_GPU_VRAM_Y_ADDRESS_PERIOD = 1024;
export const GX_GPU_VRAM_Y_ADDRESS_EXTENSION_BIT = 0x200;
export const GX_GPU_VRAM_ADDRESS_ROW_BYTE_COUNT = GX_GPU_VRAM_X_ADDRESS_PERIOD * 2;
export const GX_GPU_VRAM_ADDRESS_WORD_COUNT = GX_GPU_VRAM_X_ADDRESS_PERIOD * GX_GPU_VRAM_Y_ADDRESS_PERIOD;

export function gxGpuVramYAddressMask(vramYAddressExtensionWord: number): number {
	return vramYAddressExtensionWord !== 0 ? GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1 : GX_GPU_VRAM_Y_ADDRESS_EXTENSION_BIT - 1;
}

export function gxGpuVramYAddress(y: number, vramYAddressExtensionWord: number): number {
	return y & gxGpuVramYAddressMask(vramYAddressExtensionWord);
}
