import type { RectBounds } from '../../../../../machine/ts/common/rect';
import type { HostBitmap } from '../../../../../machine/ts/render/host_overlay/bitmap';
import type { SceneRuntimePreview } from '../runtime_preview';
import type { SceneViewportCamera } from './camera';

/** Project one completed runtime image and its same-observation selection.
 * Held UI frames reuse projection arrays; no guest reads occur during paint. */
export class SceneRuntimeCanvas {
	public x = 0; public y = 0; public width = 0; public height = 0;
	public readonly outlines: number[][] = [];
	private bitmap: HostBitmap | undefined;
	private geometryRevision = -1;
	private cameraRevision = -1;
	private allocationRevision = -1;
	private selected = -1;
	public project(session: SceneRuntimePreview | undefined, camera: SceneViewportCamera, bounds: RectBounds, allocation: number, selected: number): void {
		const geometry = session?.geometry;
		const bitmap = session?.frame.bitmap;
		const revision = geometry?.revision ?? -1;
		if (bitmap === this.bitmap && revision === this.geometryRevision && camera.revision === this.cameraRevision
			&& allocation === this.allocationRevision && selected === this.selected) return;
		this.bitmap = bitmap; this.geometryRevision = revision;
		this.cameraRevision = camera.revision; this.allocationRevision = allocation; this.selected = selected;
		const image = bitmap?.image;
		if (image === undefined) { this.outlines.length = 0; return; }
		const cx = (bounds.left + bounds.right) / 2, cy = (bounds.top + bounds.bottom) / 2;
		this.x = cx + camera.projectX(0, 0, 0); this.y = cy + camera.projectY(0, 0, 0);
		this.width = image.width * camera.scale; this.height = image.height * camera.scale;
		let count = 0;
		for (const visual of geometry!.visuals) {
			if (visual.memberIndex !== selected) continue;
			let points = this.outlines[count++];
			if (points === undefined) { points = new Array<number>(10); this.outlines.push(points); }
			for (let corner = 0; corner < 4; corner++) {
				const u = corner === 0 || corner === 3 ? visual.left : visual.right, v = corner < 2 ? visual.top : visual.bottom;
				const x = visual.ox + visual.xx * u + visual.yx * v, y = visual.oy + visual.xy * u + visual.yy * v;
				points[corner * 2] = cx + camera.projectX(x, y, 0); points[corner * 2 + 1] = cy + camera.projectY(x, y, 0);
			}
			points[8] = points[0]; points[9] = points[1];
		}
		this.outlines.length = count;
	}
}
