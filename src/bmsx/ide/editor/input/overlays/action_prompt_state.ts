import type { ActionPromptState } from '../../../common/types';

type ActionPromptUiState = {
	prompt: ActionPromptState;
};

export const actionPromptState: ActionPromptUiState = {
	prompt: null,
};
