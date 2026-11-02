import type { WorkbenchMainWorkspaceState } from './main_workspace_layout';
import type { WorkbenchWindowPlacementState } from '../ui/window/model';
import type { MainWorkspaceActivityPlacement } from './main_workspace_activity';
import type { MainWorkspaceRegionId, MainWorkspacePrimaryPartId } from './main_workspace_client';
import type { MainWorkspaceRegionState } from './main_workspace_region';

/** Main persists presentation placement; documents own their authored subjects. */
export type SerializedMainWorkspace = WorkbenchMainWorkspaceState & {
	readonly regions: Readonly<Record<MainWorkspaceRegionId, MainWorkspaceRegionState>>;
	readonly activityId: string | undefined;
	readonly activityPlacement: MainWorkspaceActivityPlacement;
	readonly activityWindow: WorkbenchWindowPlacementState;
	readonly scrollX: number;
	readonly scrollY: number;
	readonly activeClient: 'primary' | 'documents' | 'activity';
	readonly activePrimaryPart: MainWorkspacePrimaryPartId;
};
