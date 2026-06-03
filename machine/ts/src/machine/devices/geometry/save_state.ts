import type { GeometryControllerPhase } from './contracts';
import type { GeometryJobState } from './job';

export type GeometryControllerState = {
	phase: GeometryControllerPhase;
	registerWords: number[];
	activeJob: GeometryJobState | null;
	workCarry: number;
	availableWorkUnits: number;
};
