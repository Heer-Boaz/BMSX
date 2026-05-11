import type { Runtime } from '../runtime';

export type RuntimeFrameStepResult = {
	previousTickSequence: number;
	tickSequence: number;
	tickAdvanced: boolean;
};

export function createRuntimeFrameStepResult(): RuntimeFrameStepResult {
	return {
		previousTickSequence: 0,
		tickSequence: 0,
		tickAdvanced: false,
	};
}

export function runRuntimeFrameStepInto(out: RuntimeFrameStepResult, runtime: Runtime, hostDeltaMs: number): void {
	const previousTickSequence = runtime.frameScheduler.lastTickSequence;
	runtime.frameScheduler.run(hostDeltaMs);
	const tickSequence = runtime.frameScheduler.lastTickSequence;
	out.previousTickSequence = previousTickSequence;
	out.tickSequence = tickSequence;
	out.tickAdvanced = tickSequence !== previousTickSequence;
}
