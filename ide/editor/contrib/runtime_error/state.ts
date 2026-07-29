import type { RuntimeErrorOverlay } from './model';

type RuntimeErrorState = {
	activeOverlay: RuntimeErrorOverlay;
	executionStopRow: number;
};

export const runtimeErrorState: RuntimeErrorState = {
	activeOverlay: null,
	executionStopRow: null,
};
