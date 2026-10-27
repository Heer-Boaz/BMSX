import type { FontVariant } from '../../../../machine/ts/render/shared/bmsx_font';
import type { Viewport } from '../../../common/viewport';
import { TAB_SPACES } from '../../../common/constants';
import type { InlineFieldMetrics } from '../inline/text_field';
import { EditorFont } from './font';
import { editorViewState } from './state';

const fontChangeListeners = new Set<(font: EditorFont) => void>();
const fieldMetrics: InlineFieldMetrics = {
	advanceChar: char => editorViewState.font.advance(char),
	spaceAdvance: 0,
	tabSpaces: TAB_SPACES,
};

/** Shared typography changes publish the actual immutable font generation. */
export function onDidChangeEditorFont(listener: (font: EditorFont) => void): () => void {
	fontChangeListeners.add(listener);
	return () => fontChangeListeners.delete(listener);
}

export function configureFontVariant(variant: FontVariant): void {
	const font = new EditorFont(variant);
	editorViewState.fontVariant = variant;
	editorViewState.font = font;
	editorViewState.lineHeight = font.lineHeight;
	editorViewState.charAdvance = font.advance('M');
	editorViewState.spaceAdvance = font.advance(' ');
	fieldMetrics.spaceAdvance = editorViewState.spaceAdvance;
	editorViewState.inlineFieldMetricsRef = fieldMetrics;
	editorViewState.tabBarHeight = editorViewState.lineHeight + 3;
	editorViewState.baseBottomMargin = editorViewState.lineHeight + 6;
	for (const listener of fontChangeListeners) listener(font);
}

/** Canvas dimensions belong to the frontend, not an attached Source control. */
export function applyViewportSize(viewport: Viewport): void {
	editorViewState.viewportWidth = viewport.width;
	editorViewState.viewportHeight = viewport.height;
}
