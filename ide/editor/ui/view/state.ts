import type { FontVariant } from '../../../../machine/ts/render/shared/bmsx_font';
import type { InlineFieldMetrics } from '../inline/text_field';
import { EditorFont } from './font';

export type EditorViewState = {
	fontVariant: FontVariant;
	viewportWidth: number;
	viewportHeight: number;
	font: EditorFont;
	lineHeight: number;
	charAdvance: number;
	spaceAdvance: number;
	tabBarHeight: number;
	tabBarTotalHeight: number;
	baseBottomMargin: number;
	editorAreaLeft: number;
	editorAreaTop: number;
	editorAreaBottom: number;
	inlineFieldMetricsRef: InlineFieldMetrics;
	dimCrtInEditor: boolean;
};

export const editorViewState: EditorViewState = {
	fontVariant: undefined!,
	viewportWidth: 0,
	viewportHeight: 0,
	font: undefined!,
	lineHeight: 0,
	charAdvance: 0,
	spaceAdvance: 0,
	tabBarHeight: 0,
	tabBarTotalHeight: 0,
	baseBottomMargin: 0,
	editorAreaLeft: 0,
	editorAreaTop: 0,
	editorAreaBottom: 0,
	inlineFieldMetricsRef: undefined!,
	dimCrtInEditor: true,
};
