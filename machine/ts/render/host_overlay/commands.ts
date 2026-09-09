import type {
	GlyphRenderSubmission,
	HostImageRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
} from '../shared/submissions';
import type { HostOverlayClipRect } from './clip';

export const enum Host2DKind {
	Img,
	Poly,
	Rect,
	Glyphs,
	Clip,
}

export type Host2DRef =
	| HostImageRenderSubmission
	| PolyRenderSubmission
	| RectRenderSubmission
	| GlyphRenderSubmission
	| HostOverlayClipRect;
