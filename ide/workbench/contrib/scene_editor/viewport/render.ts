import * as colors from '../../../../common/constants';
import { editorViewState } from '../../../../editor/ui/view/state';
import { api } from '../../../../runtime/overlay_api';
import { SCENE_VIEWPORT_POINT_STRIDE, type SceneViewportViewState, type SceneViewportPlacement } from './view_state';
import { TRANSLATE_PLANE_HANDLES, TranslateHandle } from './translate_gizmo';
import type { SceneViewportQuad } from './canvas';

/** Helpers depict actual authored origins and affine axes, never inferred visual bounds. */
export function drawSceneViewport(view: SceneViewportViewState, focused: boolean, placement?: Readonly<SceneViewportPlacement>): void {
	const bounds = view.bounds, points = view.points, segment = view.segment;
	api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
	if (view.camera.mode === '3d' && view.models.scene.instances.length > 0)
		api.drawMeshScene(view.models.scene, bounds.left, bounds.top, bounds.right, bounds.bottom);
	if (view.camera.mode === '2d') drawCanvas(view.canvas.items, 0xff000000);
	if (view.camera.mode === '2d') for (const sprite of view.canvas.items) if (sprite.source.entry === view.selected) {
		const outline = view.outline;
		outline[0] = outline[8] = sprite.x; outline[1] = outline[9] = sprite.y;
		outline[2] = sprite.x + sprite.xx; outline[3] = sprite.y + sprite.xy;
		outline[4] = sprite.x + sprite.xx + sprite.yx; outline[5] = sprite.y + sprite.xy + sprite.yy;
		outline[6] = sprite.x + sprite.yx; outline[7] = sprite.y + sprite.yy;
		api.polyline(outline, 0, 0, 0, 1, colors.COLOR_FOCUS_BORDER);
	}
	for (let index = 0; index < view.entries.length; index++) {
		if (view.entries[index] === view.selected && view.gizmo.world !== undefined) continue;
		if (view.entries[index] !== view.selected && (view.camera.mode === '2d' ? view.canvas.represented : view.models.represented).has(view.entries[index])) continue;
		const offset = index * SCENE_VIEWPORT_POINT_STRIDE, x = points[offset], y = points[offset + 1];
		segment[0] = x; segment[1] = y; segment[2] = points[offset + 2]; segment[3] = points[offset + 3];
		api.polyline(segment, 0, 0, 0, 1, colors.COLOR_CONTENT_ERROR_TEXT);
		segment[2] = points[offset + 4]; segment[3] = points[offset + 5]; api.polyline(segment, 0, 0, 0, 1, colors.COLOR_CONTENT_SUCCESS_TEXT);
		if (view.camera.mode === '3d') { segment[2] = points[offset + 6]; segment[3] = points[offset + 7]; api.polyline(segment, 0, 0, 0, 1, colors.COLOR_CONTENT_PROGRESS_TEXT); }
		const selected = view.entries[index] === view.selected;
		api.blit_rect(x - 3, y - 3, x + 4, y + 4, 0, selected ? colors.COLOR_FOCUS_BORDER : colors.COLOR_RESOURCE_VIEWER_TEXT);
		if (selected) api.blit_rect(x - 5, y - 5, x + 6, y + 6, 0, colors.COLOR_FOCUS_BORDER);
	}
	const gizmo = view.gizmo;
	if (placement === undefined && gizmo.world !== undefined) {
		const handle = gizmo.active === TranslateHandle.None ? gizmo.hover : gizmo.active;
		for (let plane = 0; plane < 3; plane++) if ((gizmo.visiblePlanes & (1 << plane)) !== 0) {
			const active = handle === TRANSLATE_PLANE_HANDLES[plane];
			api.polyline(gizmo.planes[plane], 0, 0, 0, active ? 2 : 1, active ? colors.COLOR_CONTENT_WARNING_TEXT
				: plane === 0 ? colors.COLOR_CONTENT_PROGRESS_TEXT : plane === 1 ? colors.COLOR_CONTENT_SUCCESS_TEXT : colors.COLOR_CONTENT_ERROR_TEXT);
		}
		for (let axis = 0; axis < 3; axis++) if ((gizmo.visibleAxes & (1 << axis)) !== 0) {
			const active = handle !== TranslateHandle.View && (handle & (1 << axis)) !== 0;
			const color = active ? colors.COLOR_CONTENT_WARNING_TEXT : axis === 0 ? colors.COLOR_CONTENT_ERROR_TEXT
				: axis === 1 ? colors.COLOR_CONTENT_SUCCESS_TEXT : colors.COLOR_CONTENT_PROGRESS_TEXT;
			const points = gizmo.axes[axis]; api.polyline(points, 0, 0, 0, active ? 3 : 2, color);
			api.blit_text_inline_with_font('XYZ'[axis], points[2] + gizmo.radius, points[3] - gizmo.radius, 0, color, editorViewState.font.renderFont());
		}
		const half = gizmo.radius * 0.5;
		api.fill_rect(gizmo.x - half, gizmo.y - half, gizmo.x + half, gizmo.y + half, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
		api.blit_rect(gizmo.x - half, gizmo.y - half, gizmo.x + half, gizmo.y + half, 0,
			handle === TranslateHandle.View ? colors.COLOR_CONTENT_WARNING_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT);
	}
	if (placement?.located) {
		if (view.camera.mode === '2d') drawCanvas(view.placementCanvas.items, 0xa0000000);
		else if (view.placementModels.scene.instances.length > 0)
			api.drawMeshScene(view.placementModels.scene, bounds.left, bounds.top, bounds.right, bounds.bottom);
		const x = (bounds.left + bounds.right) / 2 + view.camera.projectX(placement.x, placement.y, placement.z);
		const y = (bounds.top + bounds.bottom) / 2 + view.camera.projectY(placement.x, placement.y, placement.z);
		segment[0] = x - 5; segment[1] = y; segment[2] = x + 5; segment[3] = y;
		api.polyline(segment, 0, 0, 0, 1, colors.COLOR_FOCUS_BORDER);
		segment[0] = x; segment[1] = y - 5; segment[2] = x; segment[3] = y + 5;
		api.polyline(segment, 0, 0, 0, 1, colors.COLOR_FOCUS_BORDER);
	}
	const font = editorViewState.font;
	if (placement !== undefined) {
		api.blit_text_inline_with_font(placement.definitionLabel, bounds.left + 4, bounds.top + 4, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font.renderFont());
		api.blit_text_inline_with_font(view.camera.mode === '3d' ? placement.located ? 'Click: place on XZ' : 'Point at XZ plane' : 'Click: place',
			bounds.left + 4, bounds.top + 4 + font.lineHeight, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font.renderFont());
		api.blit_text_inline_with_font('Esc: cancel', bounds.left + 4, bounds.top + 4 + font.lineHeight * 2, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font.renderFont());
		if ((view.camera.mode === '2d' ? view.placementCanvas.items.length : view.placementModels.scene.instances.length) === 0) api.blit_text_inline_with_font('No preview',
			bounds.left + 4, bounds.top + 4 + font.lineHeight * 3, 0, colors.COLOR_CONTENT_WARNING_TEXT, font.renderFont());
	} else api.blit_text_inline_with_font(view.source === undefined ? 'SCENE UNAVAILABLE' : view.camera.mode === '2d' ? '2D' : '3D',
		bounds.left + 4, bounds.top + 4, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font.renderFont());
	if (focused) api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_FOCUS_BORDER);
	api.popClipRect();
}

function drawCanvas<Owner>(items: readonly SceneViewportQuad<Owner>[], alpha: number): void {
	for (const item of items) {
		const color = ((item.source.color & 0x00ffffff) | alpha) >>> 0;
		if (item.kind === 'sprite') api.drawBitmapAffine(item.bitmap, item.x, item.y, item.xx, item.xy, item.yx, item.yy,
			item.u0, item.v0, item.u1, item.v1, color);
		else api.fillQuadColor(item.x, item.y, item.xx, item.xy, item.yx, item.yy, color);
	}
}
