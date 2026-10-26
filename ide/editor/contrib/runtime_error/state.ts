import type { RuntimeErrorOverlay } from './model';

export type RuntimeErrorState = {
	activeOverlay: RuntimeErrorOverlay;
	executionStopRow: number;
};
