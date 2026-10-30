import type { WorkbenchWindowPlacementState } from '../ui/window/model';

export type MainWorkspaceRegionPlacement = 'dockedMain' | 'floatingWindow';

/** A never-floated region has no requested window placement yet. */
export type MainWorkspaceRegionState = {
	readonly placement: MainWorkspaceRegionPlacement;
	readonly window: WorkbenchWindowPlacementState | undefined;
};
