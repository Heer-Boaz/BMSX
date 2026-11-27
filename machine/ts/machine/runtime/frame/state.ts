export type FrameState = {
	updateExecuted: boolean;
	cycleBudgetRemaining: number;
	cycleBudgetGranted: number;
	cycleCarryGranted: number;
	activeCpuUsedCycles: number;
};

export const enum InstructionStepResult {
	Blocked,
	Advanced,
	Executed,
	ExecutionStopped,
}
