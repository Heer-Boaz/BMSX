import * as colors from '../../../../common/constants';
import { editorViewState } from '../../../../editor/ui/view/state';
import { api } from '../../../../runtime/overlay_api';
import { ARTWORK_COLORS } from '../../../../theme/artwork_colors';
import { SCENE_VIEWPORT_POINT_STRIDE, type SceneViewportViewState, type SceneViewportPlacement } from './view_state';
import { TRANSLATE_AXIS_LABELS, TRANSLATE_PLANE_HANDLES, TranslateHandle } from './translate_gizmo';
import { drawCanvas } from './canvas_render';
import { renderWorkbenchActionBar } from '../../../render/action_bar';

/** Helpers depict actual authored origins and affine axes, never inferred visual bounds. */
export function drawSceneViewport(view: SceneViewportViewState, focused: boolean, placement?: Readonly<SceneViewportPlacement>): void {
	const bounds = view.bounds, points = view.points, segment = view.segment;
	api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, ARTWORK_COLORS.background);
	if (view.camera.mode === '3d' && view.geometry.scene.instances.length > 0)
		api.drawMeshScene(view.geometry.scene, bounds.left, bounds.top, bounds.right, bounds.bottom);
	if (view.camera.mode === '2d') drawCanvas(view.canvas.items, 0xff000000);
	for (const outline of view.canvas.outlines) if (outline.visible) api.outlinedPolyline(outline.points, 0, 0, 0);
	for (let index = 0; index < view.entries.length; index++) {
		if (view.entries[index] === view.selected && view.gizmo.world !== undefined) continue;
		if (view.entries[index] !== view.selected && (view.camera.mode === '2d' ? view.canvas.represented : view.geometry.represented).has(view.entries[index])) continue;
		const offset = index * SCENE_VIEWPORT_POINT_STRIDE, x = points[offset], y = points[offset + 1];
		segment[0] = x; segment[1] = y; segment[2] = points[offset + 2]; segment[3] = points[offset + 3];
		api.outlinedPolyline(segment, 0, 0, 0, 1, ARTWORK_COLORS.axes[0]);
		segment[2] = points[offset + 4]; segment[3] = points[offset + 5]; api.outlinedPolyline(segment, 0, 0, 0, 1, ARTWORK_COLORS.axes[1]);
		if (view.camera.mode === '3d') { segment[2] = points[offset + 6]; segment[3] = points[offset + 7]; api.outlinedPolyline(segment, 0, 0, 0, 1, ARTWORK_COLORS.axes[2]); }
		const selected = view.entries[index] === view.selected;
		api.outlinedRect(x - 3, y - 3, x + 4, y + 4, 0);
		if (selected) api.outlinedRect(x - 5, y - 5, x + 6, y + 6, 0);
	}
	const gizmo = view.gizmo;
	if (placement === undefined && gizmo.world !== undefined) {
		const handle = gizmo.active === TranslateHandle.None ? gizmo.hover : gizmo.active;
		for (let plane = 0; plane < 3; plane++) if ((gizmo.visiblePlanes & (1 << plane)) !== 0) {
			const active = handle === TRANSLATE_PLANE_HANDLES[plane];
			api.outlinedPolyline(gizmo.planes[plane], 0, 0, 0, active ? 2 : 1, active ? ARTWORK_COLORS.active
				: plane === 0 ? ARTWORK_COLORS.axes[2] : plane === 1 ? ARTWORK_COLORS.axes[1] : ARTWORK_COLORS.axes[0]);
		}
		for (let axis = 0; axis < 3; axis++) if ((gizmo.visibleAxes & (1 << axis)) !== 0) {
			const active = handle !== TranslateHandle.View && (handle & (1 << axis)) !== 0;
			const color = active ? ARTWORK_COLORS.active : ARTWORK_COLORS.axes[axis];
			const points = gizmo.axes[axis]; api.outlinedPolyline(points, 0, 0, 0, active ? 3 : 2, color);
			const x = points[2] + gizmo.radius, y = points[3] - gizmo.radius, font = editorViewState.font.renderFont();
			api.fill_rect(x - 2, y - 2, x + view.axisLabelWidths[axis] + 2, y + font.lineHeight + 2, 0, ARTWORK_COLORS.annotation.background);
			api.blit_text_inline_with_font(TRANSLATE_AXIS_LABELS[axis], x, y, 0, ARTWORK_COLORS.annotation.foreground, font);
		}
		const half = gizmo.radius * 0.5;
		api.fill_rect(gizmo.x - half, gizmo.y - half, gizmo.x + half, gizmo.y + half, 0,
			handle === TranslateHandle.View ? ARTWORK_COLORS.active : ARTWORK_COLORS.annotation.background);
		api.outlinedRect(gizmo.x - half, gizmo.y - half, gizmo.x + half, gizmo.y + half, 0);
	}
	if (placement?.located) {
		if (view.camera.mode === '2d') drawCanvas(view.placementCanvas.items, 0xa0000000);
		else if (view.placementGeometry.scene.instances.length > 0)
			api.drawMeshScene(view.placementGeometry.scene, bounds.left, bounds.top, bounds.right, bounds.bottom);
		const x = (bounds.left + bounds.right) / 2 + view.camera.projectX(placement.x, placement.y, placement.z);
		const y = (bounds.top + bounds.bottom) / 2 + view.camera.projectY(placement.x, placement.y, placement.z);
		segment[0] = x - 5; segment[1] = y; segment[2] = x + 5; segment[3] = y;
		api.outlinedPolyline(segment, 0, 0, 0);
		segment[0] = x; segment[1] = y - 5; segment[2] = x; segment[3] = y + 5;
		api.outlinedPolyline(segment, 0, 0, 0);
	}
	renderWorkbenchActionBar(view.navigationActions, editorViewState.font.renderFont(),
		ARTWORK_COLORS.annotation.foreground, ARTWORK_COLORS.annotation.warning);
	if (placement !== undefined || view.source === undefined) view.caption.draw(bounds.left + 4, view.navigationActions.bounds.bottom + 4);
	if (focused) api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_FOCUS_BORDER);
	api.popClipRect();
}
