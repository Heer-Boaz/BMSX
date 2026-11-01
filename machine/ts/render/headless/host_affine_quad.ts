import type { HostOverlayClipState } from '../host_overlay/clip';

/** Retained pixel-centre/top-left edge setup shared by host affine fills and
 * bitmap sampling. Consumers keep their own specialized fragment loops. */
export class HostAffineQuadCoverage {
	public startX = 0;
	public startY = 0;
	public right = 0;
	public bottom = 0;
	public sign = 1;
	public area = 0;
	public includeS0 = false;
	public includeT0 = false;
	public stepSX = 0;
	public stepTX = 0;

	public set(originX: number, originY: number, xx: number, xy: number, yx: number, yy: number,
		determinant: number, clip: HostOverlayClipState): void {
		const endXX = originX + xx, endXY = originY + xy;
		const endYX = originX + yx, endYY = originY + yy;
		const endX = endXX + yx, endY = endXY + yy;
		this.startX = Math.max(clip.left, Math.trunc(Math.min(originX, endXX, endYX, endX)));
		this.startY = Math.max(clip.top, Math.trunc(Math.min(originY, endXY, endYY, endY)));
		this.right = Math.min(clip.right, Math.trunc(Math.max(originX, endXX, endYX, endX)) + 1);
		this.bottom = Math.min(clip.bottom, Math.trunc(Math.max(originY, endXY, endYY, endY)) + 1);
		const sign = determinant < 0 ? -1 : 1;
		this.sign = sign; this.area = determinant * sign;
		// At exact edges, include screen-space top/left, not local s/t zero.
		this.includeS0 = yy * sign > 0 || (yy === 0 && yx * sign < 0);
		this.includeT0 = xy * sign < 0 || (xy === 0 && xx * sign > 0);
		this.stepSX = yy * sign; this.stepTX = -xy * sign;
	}
}
