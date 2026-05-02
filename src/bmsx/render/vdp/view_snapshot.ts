import type { GameView } from '../gameview';
import type { VDP } from '../../machine/devices/vdp/vdp';
import { copyVdpCameraSnapshot } from '../../machine/devices/vdp/camera';
import { commitVdpBillboardViewState } from './billboards';
import { commitVdpSkyboxViewState } from './skybox';

export function commitVdpViewSnapshot(view: GameView, vdp: VDP): void {
	view.dither_type = vdp.committedViewDitherType;
	copyVdpCameraSnapshot(view.vdpCamera, vdp.committedCameraBank0);
	commitVdpSkyboxViewState(view, vdp);
	commitVdpBillboardViewState(view, vdp);
}
