type GotoHoverHighlight = {
	row: number;
	startColumn: number;
	endColumn: number;
	expression: string;
};

type IntellisenseUiState = {
	gotoHoverHighlight: GotoHoverHighlight;
};

export const intellisenseUiState: IntellisenseUiState = {
	gotoHoverHighlight: null,
};
