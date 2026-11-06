import { create_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import type { ResourceDomain } from '../../../common/resource';
import { api } from '../../../runtime/overlay_api';
import type { ActorRenderFrame } from './render_geometry';

/** Selected visual outlines in the published game image. Selection is a retained
 * actor identity, not pointer hover or input focus; no live guest queries occur. */
export class ActorViewportSelection {
	private readonly bounds = create_rect_bounds();
	private revision = -1;
	private domain: ResourceDomain = -1;
	private hashId = 0;
	private readonly outlines = new ScratchBuffer<number[]>(() => new Array<number>(10));

	public update(frame: ActorRenderFrame, revision: number, domain: ResourceDomain, hashId: number, bounds: Readonly<RectBounds>): void {
		if (frame.sequence === undefined) { this.clear(); return; }
		if (this.revision === revision && this.domain === domain && this.hashId === hashId
			&& this.bounds.left === bounds.left && this.bounds.top === bounds.top
			&& this.bounds.right === bounds.right && this.bounds.bottom === bounds.bottom) return;
		this.revision = revision; this.domain = domain; this.hashId = hashId;
		Object.assign(this.bounds, bounds); this.outlines.clear();
		if (hashId === 0) return;
		const sx = (bounds.right - bounds.left) / frame.width, sy = (bounds.bottom - bounds.top) / frame.height;
		for (let index = 0; index < frame.quads.length; index++) {
			const quad = frame.quads.peek(index);
			if (quad.domain !== domain || quad.hashId !== hashId) continue;
			const points = this.outlines.get(this.outlines.length);
			const x = bounds.left + (quad.ox + frame.offsetX) * sx, y = bounds.top + (quad.oy + frame.offsetY) * sy;
			points[0] = x; points[1] = y;
			points[2] = x + quad.ax * sx; points[3] = y + quad.ay * sy;
			points[4] = x + (quad.ax + quad.bx) * sx; points[5] = y + (quad.ay + quad.by) * sy;
			points[6] = x + quad.bx * sx; points[7] = y + quad.by * sy;
			points[8] = x; points[9] = y;
		}
	}

	public draw(bounds: Readonly<RectBounds>): void {
		if (this.outlines.length === 0) return;
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		for (let index = 0; index < this.outlines.length; index++) api.outlinedPolyline(this.outlines.peek(index), 0, 0, 0);
		api.popClipRect();
	}

	public clear(): void { this.revision = -1; this.outlines.clear(); }
}
