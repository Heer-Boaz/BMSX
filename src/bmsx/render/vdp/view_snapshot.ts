import type { GameView } from '../gameview';
import type { VDP } from '../../machine/devices/vdp/vdp';
import type { RuntimeAssetState } from '../../machine/memory/asset/state';
import type { Memory } from '../../machine/memory/memory';
import { commitVdpSkyboxViewState } from './skybox';

export function commitVdpViewSnapshot(view: GameView, vdp: VDP, memory: Memory, assets: RuntimeAssetState): void {
	view.dither_type = vdp.committedViewDitherType;
	commitVdpSkyboxViewState(view, vdp, memory, assets);
}
