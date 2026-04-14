import type { FontVariant } from '../../render/shared/bmsx_font';
import type { ScrollbarKind } from '../core/types';
import type { InlineFieldMetrics } from './inline_text_field';
import { Scrollbar, ScrollbarController } from './scrollbar';
import { CodeLayout } from './code_layout';
import { EditorFont } from './view/editor_font';

export type EditorViewState = {
	scrollRow: number;
	scrollColumn: number;
	fontVariant: FontVariant;
	viewportWidth: number;
	viewportHeight: number;
	font: EditorFont;
	lineHeight: number;
	charAdvance: number;
	spaceAdvance: number;
	gutterWidth: number;
	headerHeight: number;
	tabBarHeight: number;
	tabBarRowCount: number;
	baseBottomMargin: number;
	inlineFieldMetricsRef: InlineFieldMetrics;
	scrollbars: Record<ScrollbarKind, Scrollbar>;
	scrollbarController: ScrollbarController;
	layout: CodeLayout;
	codeVerticalScrollbarVisible: boolean;
	codeHorizontalScrollbarVisible: boolean;
	maxLineLength: number;
	maxLineLengthRow: number;
	maxLineLengthDirty: boolean;
	cachedVisibleRowCount: number;
	cachedVisibleColumnCount: number;
	dimCrtInEditor: boolean;
	wordWrapEnabled: boolean;
};

export const editorViewState: EditorViewState = {
	scrollRow: 0,
	scrollColumn: 0,
	fontVariant: undefined!,
	viewportWidth: 0,
	viewportHeight: 0,
	font: undefined!,
	lineHeight: 0,
	charAdvance: 0,
	spaceAdvance: 0,
	gutterWidth: 0,
	headerHeight: 0,
	tabBarHeight: 0,
	tabBarRowCount: 1,
	baseBottomMargin: 0,
	inlineFieldMetricsRef: undefined!,
	scrollbars: undefined!,
	scrollbarController: undefined!,
	layout: undefined!,
	codeVerticalScrollbarVisible: false,
	codeHorizontalScrollbarVisible: false,
	maxLineLength: 0,
	maxLineLengthRow: 0,
	maxLineLengthDirty: true,
	cachedVisibleRowCount: 1,
	cachedVisibleColumnCount: 1,
	dimCrtInEditor: true,
	wordWrapEnabled: true,
};
