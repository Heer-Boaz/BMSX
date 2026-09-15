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
}

export type Host2DRef =
	| HostImageRenderSubmission
	| HostFrameRenderSubmission
	| PolyRenderSubmission
	| RectRenderSubmission
	| GlyphRenderSubmission
	| HostOverlayClipRect
	| HostOverlayTransform;
