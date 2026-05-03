import type { VdpHostOutput } from '../../machine/devices/vdp/vdp';
import { SKYBOX_FACE_COUNT } from '../../machine/devices/vdp/contracts';
import type { GameView } from '../gameview';

export function commitVdpSkyboxViewState(view: GameView, output: VdpHostOutput): void {
	if (!output.skyboxEnabled) {
		view.skyboxFaceUvRects = null;
		view.skyboxFaceTextpageBindings = null;
		view.skyboxFaceSizes = null;
		return;
	}
	const faceUvRects = view.skyboxFaceUvRects ?? (view.skyboxFaceUvRects = new Float32Array(SKYBOX_FACE_COUNT * 4));
	const faceTextpageBindings = view.skyboxFaceTextpageBindings ?? (view.skyboxFaceTextpageBindings = new Int32Array(SKYBOX_FACE_COUNT));
	const faceSizes = view.skyboxFaceSizes ?? (view.skyboxFaceSizes = new Int32Array(SKYBOX_FACE_COUNT * 2));
	for (let index = 0; index < SKYBOX_FACE_COUNT; index += 1) {
		const sample = output.skyboxSamples[index]!;
		const uvBase = index * 4;
		faceUvRects[uvBase + 0] = sample.source.srcX / sample.surfaceWidth;
		faceUvRects[uvBase + 1] = sample.source.srcY / sample.surfaceHeight;
		faceUvRects[uvBase + 2] = sample.source.width / sample.surfaceWidth;
		faceUvRects[uvBase + 3] = sample.source.height / sample.surfaceHeight;
		faceTextpageBindings[index] = sample.slot;
		const sizeBase = index * 2;
		faceSizes[sizeBase + 0] = sample.source.width;
		faceSizes[sizeBase + 1] = sample.source.height;
	}
}
