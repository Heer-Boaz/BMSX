import type { VDP } from '../../machine/devices/vdp/vdp';
import { SKYBOX_FACE_KEYS } from '../../machine/devices/vdp/contracts';
import type { Memory } from '../../machine/memory/memory';
import type { GameView } from '../gameview';
import { ENGINE_ATLAS_INDEX } from '../../rompack/format';
import { resolveVdpBlitterSample } from './surfaces';

export function commitVdpSkyboxViewState(view: GameView, vdp: VDP, memory: Memory): void {
	const ids = vdp.committedViewSkyboxFaceIds;
	view.skyboxFaceIds = ids;
	if (!ids) {
		view.skyboxFaceUvRects = null;
		view.skyboxFaceAtlasBindings = null;
		view.skyboxFaceSizes = null;
		return;
	}
	const faceUvRects = view.skyboxFaceUvRects ?? (view.skyboxFaceUvRects = new Float32Array(SKYBOX_FACE_KEYS.length * 4));
	const faceAtlasBindings = view.skyboxFaceAtlasBindings ?? (view.skyboxFaceAtlasBindings = new Int32Array(SKYBOX_FACE_KEYS.length));
	const faceSizes = view.skyboxFaceSizes ?? (view.skyboxFaceSizes = new Int32Array(SKYBOX_FACE_KEYS.length * 2));
	for (let index = 0; index < SKYBOX_FACE_KEYS.length; index += 1) {
		const assetId = ids[SKYBOX_FACE_KEYS[index]];
		const sample = resolveVdpBlitterSample(vdp, memory.resolveAssetHandle(assetId));
		if (sample.atlasId === ENGINE_ATLAS_INDEX) {
			throw new Error(`[VDPSkybox] Skybox image '${assetId}' must live in primary/secondary atlas space, not the engine atlas.`);
		}
		const uvBase = index * 4;
		faceUvRects[uvBase + 0] = sample.source.srcX / sample.surfaceWidth;
		faceUvRects[uvBase + 1] = sample.source.srcY / sample.surfaceHeight;
		faceUvRects[uvBase + 2] = sample.source.width / sample.surfaceWidth;
		faceUvRects[uvBase + 3] = sample.source.height / sample.surfaceHeight;
		faceAtlasBindings[index] = sample.atlasId;
		const sizeBase = index * 2;
		faceSizes[sizeBase + 0] = sample.source.width;
		faceSizes[sizeBase + 1] = sample.source.height;
	}
}
