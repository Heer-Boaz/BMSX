import type { GameView } from '../gameview';
import type { VdpDeviceOutput } from '../../machine/devices/vdp/device_output';

export function commitVdpViewSnapshot(view: GameView, output: VdpDeviceOutput): void {
	view.dither_type = output.ditherType;
	view.vdpRpuFrame = output.rpu;
	view.vdpDirectionalLightCount = 0;
	view.vdpPointLightCount = 0;
}
