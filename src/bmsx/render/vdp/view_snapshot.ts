import type { GameView } from '../gameview';
import type { VDP } from '../../machine/devices/vdp/vdp';
import type { Memory } from '../../machine/memory/memory';
import { commitVdpSkyboxViewState } from './skybox';

export function commitVdpViewSnapshot(view: GameView, vdp: VDP, memory: Memory): void {
	view.dither_type = vdp.committedViewDitherType;
	view.primaryAtlasIdInSlot = vdp.committedViewPrimaryAtlasIdInSlot;
	view.secondaryAtlasIdInSlot = vdp.committedViewSecondaryAtlasIdInSlot;
	commitVdpSkyboxViewState(view, vdp, memory);
}
