export type FrameState = {
	updateExecuted: boolean;
	luaFaulted: boolean;
	cycleBudgetRemaining: number;
	cycleBudgetGranted: number;
	cycleCarryGranted: number;
	activeCpuUsedCycles: number;
};

export const enum InstructionStepResult {
	Blocked,
	Advanced,
	Executed,
}
