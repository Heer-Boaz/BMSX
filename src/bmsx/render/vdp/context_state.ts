import type { VDP } from '../../machine/devices/vdp/vdp';
import { restoreVdpFrameBufferContext } from './framebuffer';
import { syncVdpSlotTextures } from './slot_textures';

const EMPTY_TEXTURE_SEED = new Uint8Array(4);

export function restoreVdpContextState(vdp: VDP): void {
	restoreVdpFrameBufferContext(vdp, EMPTY_TEXTURE_SEED);
	syncVdpSlotTextures(vdp);
}
