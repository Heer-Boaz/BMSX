import type { VdpHostOutput } from '../../machine/devices/vdp/vdp';
import type { GameView } from '../gameview';

export function commitVdpBillboardViewState(view: GameView, output: VdpHostOutput): void {
	const billboards = output.billboards;
	view.vdpBillboardCount = billboards.length;
	const positionSize = view.vdpBillboardPositionSize;
	const color = view.vdpBillboardColor;
	const uvRect = view.vdpBillboardUvRect;
	const slot = view.vdpBillboardSlot;
	for (let index = 0; index < billboards.length; index += 1) {
		const base = index * 4;
		const colorWord = billboards.colorWord[index];
		positionSize[base + 0] = billboards.positionX[index];
		positionSize[base + 1] = billboards.positionY[index];
		positionSize[base + 2] = billboards.positionZ[index];
		positionSize[base + 3] = billboards.size[index];
		color[base + 0] = ((colorWord >>> 16) & 0xff) / 255;
		color[base + 1] = ((colorWord >>> 8) & 0xff) / 255;
		color[base + 2] = (colorWord & 0xff) / 255;
		color[base + 3] = ((colorWord >>> 24) & 0xff) / 255;
		uvRect[base + 0] = billboards.sourceSrcX[index] / billboards.surfaceWidth[index];
		uvRect[base + 1] = billboards.sourceSrcY[index] / billboards.surfaceHeight[index];
		uvRect[base + 2] = (billboards.sourceSrcX[index] + billboards.sourceWidth[index]) / billboards.surfaceWidth[index];
		uvRect[base + 3] = (billboards.sourceSrcY[index] + billboards.sourceHeight[index]) / billboards.surfaceHeight[index];
		slot[index] = billboards.slot[index];
	}
}
