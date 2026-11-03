import type { ResourceDomain } from '../../../common/resource';
import type { ActorRenderFrame } from './render_geometry';

export type ActorViewportHit = {
	domain: ResourceDomain; hashId: number; label: string;
	left: number; top: number; right: number; bottom: number;
};

/** Geometric picking in the published image, not a current-heap or collider query.
 * This is planar visual selection, not an alpha/occlusion or pixel-ID buffer. */
export class ActorViewportPicker {
	public readonly hit: ActorViewportHit = { domain: 0, hashId: 0, label: '', left: 0, top: 0, right: 0, bottom: 0 };
	private sequence: number | undefined;
	private domain: ResourceDomain | undefined;
	private x = 0;
	private y = 0;
	public constructor(public readonly frame: ActorRenderFrame) {}
	public pick(domain: ResourceDomain, sequence: number | undefined, x: number, y: number): ActorViewportHit | undefined {
		if (sequence === undefined || sequence !== this.frame.sequence) { this.sequence = undefined; return; }
		if (this.sequence === sequence && this.domain === domain && this.x === x && this.y === y) return this.hit.hashId === 0 ? undefined : this.hit;
		this.sequence = sequence; this.domain = domain; this.x = x; this.y = y; this.hit.hashId = 0;
		const frame = this.frame;
		for (let index = frame.quads.length - 1; index >= 0; index--) {
			const quad = frame.quads.peek(index);
			if (quad.domain !== domain) continue;
			const determinant = quad.ax * quad.by - quad.bx * quad.ay;
			if (determinant === 0) continue;
			const x0 = quad.ox + frame.offsetX, y0 = quad.oy + frame.offsetY;
			const dx = x - x0, dy = y - y0;
			const u = (quad.by * dx - quad.bx * dy) / determinant;
			const v = (quad.ax * dy - quad.ay * dx) / determinant;
			if (!(u >= 0 && u < 1 && v >= 0 && v < 1)) continue;
			this.hit.domain = domain; this.hit.hashId = quad.hashId; this.hit.label = quad.label;
			this.hit.left = Math.min(x0, x0 + quad.ax, x0 + quad.bx, x0 + quad.ax + quad.bx);
			this.hit.right = Math.max(x0, x0 + quad.ax, x0 + quad.bx, x0 + quad.ax + quad.bx);
			this.hit.top = Math.min(y0, y0 + quad.ay, y0 + quad.by, y0 + quad.ay + quad.by);
			this.hit.bottom = Math.max(y0, y0 + quad.ay, y0 + quad.by, y0 + quad.ay + quad.by);
			return this.hit;
		}
	}
}
