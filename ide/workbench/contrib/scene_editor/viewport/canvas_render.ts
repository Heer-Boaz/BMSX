import { api } from '../../../../runtime/overlay_api';
import type { ViewportCanvasQuad } from './canvas_geometry';

export function drawCanvas<Owner>(items: readonly ViewportCanvasQuad<Owner>[], alpha: number): void {
	for (const item of items) {
		const color = ((item.color & 0x00ffffff) | alpha) >>> 0;
		if (item.kind === 'sprite') api.drawBitmapAffine(item.bitmap, item.x, item.y, item.xx, item.xy, item.yx, item.yy,
			item.u0, item.v0, item.u1, item.v1, color);
		else api.fillQuadColor(item.x, item.y, item.xx, item.xy, item.yx, item.yy, color);
	}
}
