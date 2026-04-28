import type { FontVariant } from '../../../../render/shared/bmsx_font';
import type { ScrollbarKind } from '../../../common/models';
import type { InlineFieldMetrics } from '../inline/text_field';
import { Scrollbar, ScrollbarController } from '../scrollbar';
import { CodeLayout } from '../code/layout';
import { EditorFont } from './font';

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
	codeAreaLeft: number;
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
	cachedMaxScrollColumn: number;
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
	codeAreaLeft: 0,
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
	cachedMaxScrollColumn: 0,
	dimCrtInEditor: true,
	wordWrapEnabled: true,
};
