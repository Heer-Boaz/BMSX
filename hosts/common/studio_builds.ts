/** Accepted workspace builds outlive their observers. Request IDs reconcile lost acknowledgements. */
export type StudioBuildRequest = { requestId: string; target: string; debug: boolean; optLevel: 0 | 1 | 2 | 3 };
export type StudioBuildState = 'queued' | 'running' | 'publishing' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
/** Ledger generation orders server lifetimes; sequence orders observations within one lifetime. */
export type StudioBuildVersion = { generation: number; sequence: number };
export type StudioBuildJob = {
	request: StudioBuildRequest; state: StudioBuildState; phase: string; acceptedAt: number; updatedAt: number;
	version: StudioBuildVersion;
	artifact?: string; error?: string;
};
export type StudioBuildSnapshot = { generation: number; revision: number; jobs: readonly StudioBuildJob[] };
export type StudioBuildChange = { revision: number; job: StudioBuildJob };
export function compareBuildVersions(left: StudioBuildVersion, right: StudioBuildVersion): number {
	return left.generation - right.generation || left.sequence - right.sequence;
}
export function isBuildTerminal(state: StudioBuildState): boolean {
	return state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'interrupted';
}
