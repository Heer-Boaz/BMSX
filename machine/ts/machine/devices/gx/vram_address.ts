export const GX_GPU_VRAM_WIDTH = 1024;
export const GX_GPU_VRAM_HEIGHT = 512;
export const GX_GPU_VRAM_Y_ADDRESS_PERIOD = 1024;
export const GX_GPU_VRAM_Y_BANK_BIT = GX_GPU_VRAM_HEIGHT;
export const GX_GPU_VRAM_WORD_COUNT = GX_GPU_VRAM_WIDTH * GX_GPU_VRAM_HEIGHT;
export const GX_GPU_VRAM_BYTE_COUNT = GX_GPU_VRAM_WORD_COUNT * 2;
export const GX_GPU_VRAM_OPEN_BUS_WORD = 0;

export function gxGpuVramYAddressMask(vramYAddressExtensionWord: number): number {
	return vramYAddressExtensionWord !== 0 ? GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1 : GX_GPU_VRAM_HEIGHT - 1;
}

export function gxGpuVramYAddress(y: number, vramYAddressExtensionWord: number): number {
	return y & gxGpuVramYAddressMask(vramYAddressExtensionWord);
}

export function gxGpuVramYBankInstalled(y: number): boolean {
	return (y & GX_GPU_VRAM_Y_BANK_BIT) === 0;
}

export function gxGpuVramYSpanOverlapsInstalledBank(y: number, height: number, vramYAddressExtensionWord: number): boolean {
	if (height === 0) return false;
	if (vramYAddressExtensionWord === 0) return true;
	const logicalY = y & (GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1);
	return logicalY < GX_GPU_VRAM_HEIGHT || height > GX_GPU_VRAM_Y_ADDRESS_PERIOD - logicalY;
}
