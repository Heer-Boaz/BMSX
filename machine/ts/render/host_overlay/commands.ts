import type { HostBitmapRenderSubmission } from './bitmap';
import type { HostMeshSceneRenderSubmission } from './mesh';
import type {
	GlyphRenderSubmission,
	HostImageRenderSubmission,
	HostFrameRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
	color,
} from '../shared/submissions';
import type { HostOverlayClipRect } from './clip';
import type { HostOverlayTransform } from './transform';

/** A colored unit quad in host logical coordinates, without an image resource. */
export type HostSolidQuadRenderSubmission = {
	originX: number;
	originY: number;
	axisXX: number;
	axisXY: number;
	axisYX: number;
	axisYY: number;
	color: color;
};

export const enum Host2DKind {
	Img,
	Poly,
	Rect,
	Glyphs,
	Clip,
	Transform,
	Frame,
	Bitmap,
	MeshScene,
	SolidQuad,
}

export type Host2DRef =
	| HostSolidQuadRenderSubmission
	| HostBitmapRenderSubmission
	| HostMeshSceneRenderSubmission
	| HostImageRenderSubmission
	| HostFrameRenderSubmission
	| PolyRenderSubmission
	| RectRenderSubmission
	| GlyphRenderSubmission
	| HostOverlayClipRect
	| HostOverlayTransform;
