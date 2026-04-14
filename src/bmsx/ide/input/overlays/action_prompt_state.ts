import type { ActionPromptState } from '../../core/types';

type ActionPromptUiState = {
	prompt: ActionPromptState;
};

export const actionPromptState: ActionPromptUiState = {
	prompt: null,
};
