import type { WorkbenchMainWorkspaceState } from './main_workspace_layout';
import type { WorkbenchWindowPlacementState } from '../ui/window/model';
import type { MainWorkspaceActivityPlacement } from './main_workspace_activity';
import type { MainWorkspaceRegionId } from './main_workspace_client';
import type { MainWorkspaceRegionState } from './main_workspace_region';

/** Contributions persist their authored subject and reading state, never live control authority. */
export type SerializedPrimaryClient = { readonly kind: 'scene'; readonly value: string };

/** Main's primary work is separate from the document-part topology and source recovery. */
export type SerializedMainWorkspace = WorkbenchMainWorkspaceState & {
	readonly regions: Readonly<Record<MainWorkspaceRegionId, MainWorkspaceRegionState>>;
	readonly primary: SerializedPrimaryClient | null;
	readonly activityId: string | undefined;
	readonly activityPlacement: MainWorkspaceActivityPlacement;
	readonly activityWindow: WorkbenchWindowPlacementState;
	readonly scrollX: number;
	readonly scrollY: number;
	readonly activeClient: 'primary' | 'documents' | 'activity';
	readonly activeRegion: 'hierarchy' | 'details';
};
