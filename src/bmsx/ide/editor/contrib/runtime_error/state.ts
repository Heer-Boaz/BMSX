import type { RuntimeErrorOverlay } from '../../../common/models';

type RuntimeErrorState = {
	activeOverlay: RuntimeErrorOverlay;
	executionStopRow: number;
};

export const runtimeErrorState: RuntimeErrorState = {
	activeOverlay: null,
	executionStopRow: null,
};
