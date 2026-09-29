/** Accepted workspace builds outlive their observers. Request IDs reconcile lost acknowledgements. */
export type StudioBuildRequest = { requestId: string; target: string; debug: boolean; optLevel: 0 | 1 | 2 | 3 };
export type StudioBuildState = 'queued' | 'running' | 'publishing' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type StudioBuildJob = {
	request: StudioBuildRequest; state: StudioBuildState; phase: string; acceptedAt: number; updatedAt: number;
	artifact?: string; error?: string;
};
export type StudioBuildSnapshot = { revision: number; jobs: readonly StudioBuildJob[] };
export type StudioBuildChange = { revision: number; job: StudioBuildJob };
export function isBuildTerminal(state: StudioBuildState): boolean {
	return state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'interrupted';
}
