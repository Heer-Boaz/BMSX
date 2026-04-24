import type { VDP } from '../../machine/devices/vdp/vdp';
import { initializeVdpFrameBufferTextures } from './framebuffer';
import { initializeVdpSlotTextures } from './slot_textures';

export function restoreVdpContextState(vdp: VDP): void {
	initializeVdpFrameBufferTextures(vdp);
	initializeVdpSlotTextures(vdp);
}
