import type { GeometryControllerPhase } from './contracts';
import type { GeometryJobState } from './job';
import type { GeometryOverlap2dProgress } from './overlap2d';
import type { GeometryXform2Progress } from './xform2';
import type { GeometrySat2Progress } from './sat2';

export type GeometryControllerState = {
	phase: GeometryControllerPhase;
	registerWords: number[];
	activeJob: GeometryJobState | null;
	xform: GeometryXform2Progress;
	sat: GeometrySat2Progress;
	overlap: GeometryOverlap2dProgress;
	workCarry: number;
	pendingCycles: number;
	supervisorQuiesceRequested: boolean;
};
