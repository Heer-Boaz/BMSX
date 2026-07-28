import { GX_GPU_VRAM_HEIGHT, GX_GPU_VRAM_WIDTH } from '../../machine/ts/spec/gx/vram';

export const GX_SYSTEM_TEXTURE_ASSET_ID = 'gx_system_texture';
export const GX_SYSTEM_VRAM_WIDTH = 256;
export const GX_SYSTEM_VRAM_HEIGHT = 256;
export const GX_SYSTEM_VRAM_X = GX_GPU_VRAM_WIDTH - GX_SYSTEM_VRAM_WIDTH;
export const GX_SYSTEM_VRAM_Y = GX_GPU_VRAM_HEIGHT - GX_SYSTEM_VRAM_HEIGHT;
export const GX_SYSTEM_TEXTURE_X = GX_SYSTEM_VRAM_X;
export const GX_SYSTEM_TEXTURE_Y = GX_SYSTEM_VRAM_Y;
export const GX_SYSTEM_TEXTURE_WIDTH = 256;
export const GX_SYSTEM_TEXTURE_HEIGHT = 64;
