import { GX_GPU_GP0_CPU_TO_VRAM_FIRST } from '../../spec/gx/gp0';
import type { Direct16GxTexture } from './gx_texture_codec';

export const GX_GPU_CPU_TO_VRAM_HEADER_BYTES = 12;

export function encodeDirect16GxUpload(texture: Direct16GxTexture, x: number, y: number): Buffer {
	const stream = Buffer.alloc(GX_GPU_CPU_TO_VRAM_HEADER_BYTES + texture.words.length);
	stream.writeUInt32LE((GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24) >>> 0, 0);
	stream.writeUInt32LE((x | (y << 16)) >>> 0, 4);
	stream.writeUInt32LE((texture.wordWidth | (texture.height << 16)) >>> 0, 8);
	texture.words.copy(stream, GX_GPU_CPU_TO_VRAM_HEADER_BYTES);
	return stream;
}
