import type { StudioBuildJob, StudioBuildRequest } from '../../../hosts/common/studio_builds';

/** Build observations are workspace state, not runtime-installed state or editable source models. */
export interface WorkspaceBuilds {
	readonly jobs: readonly StudioBuildJob[];
	readonly pending: readonly StudioBuildRequest[];
	targets(): Promise<readonly string[]>;
	submit(target: string, debug: boolean, optLevel: 0 | 1 | 2 | 3): Promise<StudioBuildJob>;
	get(requestId: string): Promise<StudioBuildJob | undefined>;
	cancel(requestId: string): Promise<StudioBuildJob>;
	forget(requestId: string): void;
	log(requestId: string): Promise<string>;
}
