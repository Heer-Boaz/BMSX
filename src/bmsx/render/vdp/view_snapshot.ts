import type { GameView } from '../gameview';
import type { VDP } from '../../machine/devices/vdp/vdp';
import { commitVdpSkyboxViewState } from './skybox';

export function commitVdpViewSnapshot(view: GameView, vdp: VDP): void {
	view.dither_type = vdp.committedViewDitherType;
	commitVdpSkyboxViewState(view, vdp);
}
