/** Bounded admission and cleanup; a running interactive world has no case deadline. */
export type FixtureBudgets = {
	readonly quantumCycles: number;
	readonly bootCycles: number;
	readonly phaseCycles: number;
	readonly cleanupCycles: number;
};

export const DEFAULT_FIXTURE_BUDGETS: FixtureBudgets = {
	quantumCycles: 65536,
	bootCycles: 67_737_600,
	phaseCycles: 33_868_800,
	cleanupCycles: 33_868_800,
};
