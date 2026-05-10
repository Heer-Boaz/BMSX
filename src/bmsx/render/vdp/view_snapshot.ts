import type { GameView } from '../gameview';
import type { VDP } from '../../machine/devices/vdp/vdp';
import { commitVdpBillboardViewState } from './billboards';
import { commitVdpSkyboxViewState } from './skybox';

export function commitVdpViewSnapshot(view: GameView, vdp: VDP): void {
	const output = vdp.readHostOutput();
	view.dither_type = output.ditherType;
	view.vdpCamera = output.camera;
	commitVdpSkyboxViewState(view, output);
	commitVdpBillboardViewState(view, output);
}
