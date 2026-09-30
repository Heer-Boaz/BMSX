import type { StudioBuildJob, StudioBuildRequest } from '../../../hosts/common/studio_builds';

/** Opening a tab is not successful boot or a registered live target. */
export type PublishedBuildOpenResult = { readonly status: 'opened' | 'blocked'; readonly url: string };

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
