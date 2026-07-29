import type { LuaHoverResult } from '../../../../toolchain/ts/lua/semantic_contracts';
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
	gotoHoverHighlight: GotoHoverHighlight;
};

export const intellisenseUiState: IntellisenseUiState = {
	hoverTooltip: null,
	lastInspectorResult: null,
	gotoHoverHighlight: null,
};
