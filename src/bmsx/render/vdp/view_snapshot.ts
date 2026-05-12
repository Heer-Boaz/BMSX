import type { GameView } from '../gameview';
import type { VdpDeviceOutput } from '../../machine/devices/vdp/device_output';
import { resolveVdpTransformSnapshot } from './transform';

export function commitVdpViewSnapshot(view: GameView, output: VdpDeviceOutput): void {
	view.dither_type = output.ditherType;
	resolveVdpTransformSnapshot(view.vdpTransform, output.xfMatrixWords, output.xfViewMatrixIndex, output.xfProjectionMatrixIndex);
	if (!output.skyboxEnabled) {
		view.skyboxRenderReady = false;
	} else {
		const faceUvRects = view.skyboxFaceUvRects;
		const faceTextpageBindings = view.skyboxFaceTextpageBindings;
		const faceSurfaceIds = view.skyboxFaceSurfaceIds;
		const faceSizes = view.skyboxFaceSizes;
		for (let index = 0; index < output.skyboxSamples.length; index += 1) {
			const sample = output.skyboxSamples[index]!;
			const uvBase = index * 4;
			faceUvRects[uvBase + 0] = sample.source.srcX / sample.surfaceWidth;
			faceUvRects[uvBase + 1] = sample.source.srcY / sample.surfaceHeight;
			faceUvRects[uvBase + 2] = sample.source.width / sample.surfaceWidth;
			faceUvRects[uvBase + 3] = sample.source.height / sample.surfaceHeight;
			faceTextpageBindings[index] = sample.slot;
			faceSurfaceIds[index] = sample.source.surfaceId;
			const sizeBase = index * 2;
			faceSizes[sizeBase + 0] = sample.source.width;
			faceSizes[sizeBase + 1] = sample.source.height;
		}
		view.skyboxRenderReady = true;
	}
	const billboards = output.billboards;
	view.vdpBillboardCount = billboards.length;
	const positionSize = view.vdpBillboardPositionSize;
	const colors = view.vdpBillboardColor;
	const uvRect = view.vdpBillboardUvRect;
	const slot = view.vdpBillboardSlot;
	const surfaceId = view.vdpBillboardSurfaceId;
	for (let index = 0; index < billboards.length; index += 1) {
		const base = index * 4;
		const color = billboards.color[index];
		positionSize[base + 0] = billboards.positionX[index];
		positionSize[base + 1] = billboards.positionY[index];
		positionSize[base + 2] = billboards.positionZ[index];
		positionSize[base + 3] = billboards.size[index];
		colors[index] = color;
		uvRect[base + 0] = billboards.sourceSrcX[index] / billboards.surfaceWidth[index];
		uvRect[base + 1] = billboards.sourceSrcY[index] / billboards.surfaceHeight[index];
		uvRect[base + 2] = (billboards.sourceSrcX[index] + billboards.sourceWidth[index]) / billboards.surfaceWidth[index];
		uvRect[base + 3] = (billboards.sourceSrcY[index] + billboards.sourceHeight[index]) / billboards.surfaceHeight[index];
		slot[index] = billboards.slot[index];
		surfaceId[index] = billboards.sourceSurfaceId[index];
	}
}
