import { GX_GPU_VRAM_BYTE_COUNT } from '../../machine/ts/machine/devices/gx/gpu_command_buffer';
import { BIOS_ATLAS_ID } from '../../machine/ts/rompack/format';

export const TEXTURE_ATLAS_RGBA_BYTES_PER_PIXEL = 4;

export const GX_DIRECT16_ATLAS_RGBA_BYTE_LIMIT = GX_GPU_VRAM_BYTE_COUNT * 2;
export const GX_SYSTEM_DIRECT16_ATLAS_RGBA_BYTE_LIMIT = 0x00048000;
export const GX_CART_DIRECT16_ATLAS_RGBA_BYTE_LIMIT = GX_DIRECT16_ATLAS_RGBA_BYTE_LIMIT - GX_SYSTEM_DIRECT16_ATLAS_RGBA_BYTE_LIMIT;
export const GX_CART_ATLAS_ID_LIMIT = BIOS_ATLAS_ID;
