import type {
	GlyphRenderSubmission,
	HostImageRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
} from '../shared/submissions';

export const enum Host2DKind {
	Img,
	Poly,
	Rect,
	Glyphs,
}

export type Host2DRef =
	| HostImageRenderSubmission
	| PolyRenderSubmission
	| RectRenderSubmission
	| GlyphRenderSubmission;
