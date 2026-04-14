import type { RuntimeErrorOverlay } from '../../../common/types';

type RuntimeErrorState = {
	activeOverlay: RuntimeErrorOverlay;
	executionStopRow: number;
};

export const runtimeErrorState: RuntimeErrorState = {
	activeOverlay: null,
	executionStopRow: null,
};
