import type { VDP } from '../../machine/devices/vdp/vdp';
import type { GameView } from '../gameview';

export function restoreVdpContextState(vdp: VDP, view: GameView): void {
	view.vdpFrameBufferTextures.initialize(vdp);
	view.vdpSlotTextures.initialize(vdp);
}
