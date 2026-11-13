import type { GeometryControllerPhase } from './contracts';
import type { GeometryJobState } from './job';
import type { GeometryOverlap2dProgress } from './overlap2d';

export type GeometryControllerState = {
	phase: GeometryControllerPhase;
	registerWords: number[];
	activeJob: GeometryJobState | null;
	overlap: GeometryOverlap2dProgress;
	workCarry: number;
	availableWorkUnits: number;
	pendingCycles: number;
	supervisorQuiesceRequested: boolean;
};
