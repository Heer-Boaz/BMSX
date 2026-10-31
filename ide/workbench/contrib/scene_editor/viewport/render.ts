import * as colors from '../../../../common/constants';
import { editorViewState } from '../../../../editor/ui/view/state';
import { api } from '../../../../runtime/overlay_api';
import { SCENE_VIEWPORT_POINT_STRIDE, type SceneViewportViewState } from './view_state';

/** Helpers depict actual authored origins and affine axes, never inferred visual bounds. */
export function drawSceneViewport(view: SceneViewportViewState, focused: boolean): void {
	const bounds = view.bounds, points = view.points, segment = view.segment;
	api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
	if (view.camera.mode === '2d') for (const sprite of view.sprites.items) {
		api.drawBitmapAffine(sprite.bitmap, sprite.x, sprite.y, sprite.xx, sprite.xy, sprite.yx, sprite.yy,
			sprite.u0, sprite.v0, sprite.u1, sprite.v1, sprite.source.color);
	}
	if (view.camera.mode === '2d') for (const sprite of view.sprites.items) if (sprite.source.entry === view.selected) {
		const outline = view.outline;
		outline[0] = outline[8] = sprite.x; outline[1] = outline[9] = sprite.y;
		outline[2] = sprite.x + sprite.xx; outline[3] = sprite.y + sprite.xy;
		outline[4] = sprite.x + sprite.xx + sprite.yx; outline[5] = sprite.y + sprite.xy + sprite.yy;
		outline[6] = sprite.x + sprite.yx; outline[7] = sprite.y + sprite.yy;
		api.polyline(outline, 0, 0, 0, 1, colors.COLOR_FOCUS_BORDER);
	}
	for (let index = 0; index < view.entries.length; index++) {
		if (view.entries[index] !== view.selected && view.sprites.represented.has(view.entries[index])) continue;
		const offset = index * SCENE_VIEWPORT_POINT_STRIDE, x = points[offset], y = points[offset + 1];
		segment[0] = x; segment[1] = y; segment[2] = points[offset + 2]; segment[3] = points[offset + 3];
		api.polyline(segment, 0, 0, 0, 1, colors.COLOR_CONTENT_ERROR_TEXT);
		segment[2] = points[offset + 4]; segment[3] = points[offset + 5]; api.polyline(segment, 0, 0, 0, 1, colors.COLOR_CONTENT_SUCCESS_TEXT);
		if (view.camera.mode === '3d') { segment[2] = points[offset + 6]; segment[3] = points[offset + 7]; api.polyline(segment, 0, 0, 0, 1, colors.COLOR_CONTENT_PROGRESS_TEXT); }
		const selected = view.entries[index] === view.selected;
		api.blit_rect(x - 3, y - 3, x + 4, y + 4, 0, selected ? colors.COLOR_FOCUS_BORDER : colors.COLOR_RESOURCE_VIEWER_TEXT);
		if (selected) api.blit_rect(x - 5, y - 5, x + 6, y + 6, 0, colors.COLOR_FOCUS_BORDER);
	}
	api.blit_text_inline_with_font(view.source === undefined ? 'SCENE UNAVAILABLE' : view.camera.mode === '2d' ? '2D' : '3D',
		bounds.left + 4, bounds.top + 4, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, editorViewState.font.renderFont());
	if (focused) api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_FOCUS_BORDER);
	api.popClipRect();
}
