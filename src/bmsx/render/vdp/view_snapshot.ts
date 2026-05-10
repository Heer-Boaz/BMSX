import type { GameView } from '../gameview';
import type { VDP } from '../../machine/devices/vdp/vdp';
import { commitVdpBillboardViewState } from './billboards';
import { commitVdpSkyboxViewState } from './skybox';
import { resolveVdpTransformSnapshot } from './transform';

export function commitVdpViewSnapshot(view: GameView, vdp: VDP): void {
	const output = vdp.readHostOutput();
	view.dither_type = output.ditherType;
	resolveVdpTransformSnapshot(view.vdpTransform, output.xfViewMatrixWords, output.xfProjectionMatrixWords);
	commitVdpSkyboxViewState(view, output);
	commitVdpBillboardViewState(view, output);
}
