import type {
	GlyphRenderSubmission,
	HostImageRenderSubmission,
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
}

export type Host2DRef =
	| HostImageRenderSubmission
	| PolyRenderSubmission
	| RectRenderSubmission
	| GlyphRenderSubmission
	| HostOverlayClipRect
	| HostOverlayTransform;
