import { GX_CHARACTER_PLANE_CONTROL_ENABLE } from '../../machine/devices/gx/character_plane';
import type { GxCharacterPlanePipelineState, RenderGraphPassContext } from '../backend/backend';
import type { GameView } from '../gameview';

export function createGxCharacterPlanePipelineState(view: GameView): GxCharacterPlanePipelineState {
	return {
		width: 0,
		height: 0,
		output: view.gxCharacterPlaneOutput,
	};
}
export function writeGxCharacterPlanePipelineState(
	context: RenderGraphPassContext,
	state: GxCharacterPlanePipelineState,
): void {
	state.width = context.view.offscreenCanvasSize.x;
	state.height = context.view.offscreenCanvasSize.y;
	state.output = context.view.gxCharacterPlaneOutput;
}

export function shouldRenderGxCharacterPlane(view: GameView): boolean {
	return (view.gxCharacterPlaneOutput.controlWord & GX_CHARACTER_PLANE_CONTROL_ENABLE) !== 0;
}
