import type { HostBitmapRenderSubmission } from './bitmap';
import type {
	GlyphRenderSubmission,
	HostImageRenderSubmission,
	HostFrameRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
} from '../shared/submissions';
import type { HostOverlayClipRect } from './clip';
import type { HostOverlayTransform } from './transform';

export const enum Host2DKind {
	Img,
	Poly,
	Rect,
	Glyphs,
	Clip,
	Transform,
	Frame,
	Bitmap,
}

export type Host2DRef =
	| HostBitmapRenderSubmission
	| HostImageRenderSubmission
	| HostFrameRenderSubmission
	| PolyRenderSubmission
	| RectRenderSubmission
	| GlyphRenderSubmission
	| HostOverlayClipRect
	| HostOverlayTransform;
