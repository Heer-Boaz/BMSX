import type { LuaHoverResult } from '../../../../machine/runtime/contracts';
import type { CodeHoverTooltip } from '../../../common/models';

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
