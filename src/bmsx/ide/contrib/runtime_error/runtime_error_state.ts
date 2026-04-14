import type { RuntimeErrorOverlay } from '../../core/types';

type RuntimeErrorState = {
	activeOverlay: RuntimeErrorOverlay;
	executionStopRow: number;
};

export const runtimeErrorState: RuntimeErrorState = {
	activeOverlay: null,
	executionStopRow: null,
};
