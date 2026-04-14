import type { LuaHoverResult } from '../../../emulator/types';
import type { CodeHoverTooltip } from '../../core/types';

type GotoHoverHighlight = {
	row: number;
	startColumn: number;
	endColumn: number;
	expression: string;
};

type IntellisenseUiState = {
	hoverTooltip: CodeHoverTooltip;
	lastInspectorResult: LuaHoverResult;
	inspectorRequestFailed: boolean;
	gotoHoverHighlight: GotoHoverHighlight;
};

export const intellisenseUiState: IntellisenseUiState = {
	hoverTooltip: null,
	lastInspectorResult: null,
	inspectorRequestFailed: false,
	gotoHoverHighlight: null,
};
