import type { VDP } from '../../machine/devices/vdp/vdp';
import { restoreVdpFrameBufferContext } from './framebuffer';
import { initializeVdpSlotTextures } from './slot_textures';

export function restoreVdpContextState(vdp: VDP): void {
	restoreVdpFrameBufferContext(vdp);
	initializeVdpSlotTextures(vdp);
}
