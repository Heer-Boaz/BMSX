import type { Affine2 } from '../../../../common/affine2';
import { clamp } from '../../../../../machine/ts/common/clamp';
import type { RectBounds } from '../../../../../machine/ts/common/rect';
import type { HostBitmap } from '../../../../../machine/ts/render/host_overlay/bitmap';
import type { WorkbenchViewportCamera } from '../../../ui/viewport_camera';

type QuadGeometry = {
	affine: Affine2;
	offsetX: number; offsetY: number; color: number;
	width: number; height: number;
	x: number; y: number; xx: number; xy: number; yx: number; yy: number;
};
export type ViewportCanvasQuad<Owner> = QuadGeometry & (
	{ readonly kind: 'sprite'; source: { readonly entry: Owner }; bitmap: HostBitmap; u0: number; v0: number; u1: number; v1: number }
	| { readonly kind: 'rectangle'; source: { readonly entry: Owner } }
);

/** Project prepared visual packets without revisiting source or guest state. */
export function projectViewportCanvas<Owner>(items: readonly ViewportCanvasQuad<Owner>[], camera: WorkbenchViewportCamera, bounds: Readonly<RectBounds>): void {
	const centerX = (bounds.left + bounds.right) / 2, centerY = (bounds.top + bounds.bottom) / 2, scale = camera.scale;
	for (const item of items) {
		const affine = item.affine;
		const x = affine.xx * item.offsetX + affine.yx * item.offsetY, y = affine.xy * item.offsetX + affine.yy * item.offsetY;
		item.x = centerX + camera.projectX(x, y, 0, affine.ox, affine.oy);
		item.y = centerY + camera.projectY(x, y, 0, affine.ox, affine.oy);
		item.xx = item.width * affine.xx * scale; item.xy = item.width * affine.xy * scale;
		item.yx = item.height * affine.yx * scale; item.yy = item.height * affine.yy * scale;
	}
}
/** Hit actual solid coverage or nontransparent texels, from front to back. */
export function pickViewportCanvas<Owner>(items: readonly ViewportCanvasQuad<Owner>[], x: number, y: number): Owner | undefined {
	for (let index = items.length - 1; index >= 0; index--) {
		const item = items[index];
		const determinant = item.xx * item.yy - item.yx * item.xy; if (determinant === 0) continue;
		const dx = x - item.x, dy = y - item.y;
		const u = (dx * item.yy - dy * item.yx) / determinant, v = (dy * item.xx - dx * item.xy) / determinant;
		if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) continue;
		if (item.kind === 'rectangle') return item.source.entry;
		const image = item.bitmap.image;
		const sourceX = clamp(Math.trunc((item.u0 + (item.u1 - item.u0) * u) * image.width), 0, image.width - 1);
		const sourceY = clamp(Math.trunc((item.v0 + (item.v1 - item.v0) * v) * image.height), 0, image.height - 1);
		if (image.pixels[(sourceY * image.width + sourceX) * 4 + 3] > 0) return item.source.entry;
	}
}
/** Actual world-space quad corners, before the editor camera; no inferred object boxes. */
export function measureViewportCanvas<Owner>(items: readonly ViewportCanvasQuad<Owner>[], selected: ReadonlySet<Owner> | undefined, target: RectBounds): boolean {
	let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity, count = 0;
	for (const item of items) {
		if (selected !== undefined && !selected.has(item.source.entry)) continue;
		const affine = item.affine, x = affine.ox + affine.xx * item.offsetX + affine.yx * item.offsetY;
		const y = affine.oy + affine.xy * item.offsetX + affine.yy * item.offsetY;
		const xx = item.width * affine.xx, xy = item.width * affine.xy, yx = item.height * affine.yx, yy = item.height * affine.yy;
		left = Math.min(left, x, x + xx, x + yx, x + xx + yx); right = Math.max(right, x, x + xx, x + yx, x + xx + yx);
		top = Math.min(top, y, y + xy, y + yy, y + xy + yy); bottom = Math.max(bottom, y, y + xy, y + yy, y + xy + yy); count++;
	}
	if (count === 0) return false;
	target.left = left; target.top = top; target.right = right; target.bottom = bottom; return true;
}
