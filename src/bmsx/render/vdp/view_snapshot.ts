import type { GameView } from '../gameview';
import type { VDP } from '../../machine/devices/vdp/vdp';

export function commitVdpViewSnapshot(view: GameView, vdp: VDP): void {
	const skyboxRenderReady = vdp.committedViewSkyboxRenderReady;
	view.dither_type = vdp.committedViewDitherType;
	view.primaryAtlasIdInSlot = vdp.committedViewPrimaryAtlasIdInSlot;
	view.secondaryAtlasIdInSlot = vdp.committedViewSecondaryAtlasIdInSlot;
	view.skyboxFaceIds = vdp.committedViewSkyboxFaceIds;
	if (skyboxRenderReady) {
		view.skyboxFaceUvRects = vdp.committedViewSkyboxFaceUvRects;
		view.skyboxFaceAtlasBindings = vdp.committedViewSkyboxFaceAtlasBindings;
		view.skyboxFaceSizes = vdp.committedViewSkyboxFaceSizes;
	} else {
		view.skyboxFaceUvRects = null;
		view.skyboxFaceAtlasBindings = null;
		view.skyboxFaceSizes = null;
	}
}
