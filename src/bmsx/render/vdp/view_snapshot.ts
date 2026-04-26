import type { GameView } from '../gameview';
import type { VDP } from '../../machine/devices/vdp/vdp';
import type { RuntimeAssetState } from '../../machine/memory/asset/state';
import { commitVdpSkyboxViewState } from './skybox';

export function commitVdpViewSnapshot(view: GameView, vdp: VDP, assets: RuntimeAssetState): void {
	view.dither_type = vdp.committedViewDitherType;
	commitVdpSkyboxViewState(view, vdp, assets);
}
