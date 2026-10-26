import type { TimerHandle } from '../../../hosts/common/clock';
import type { StudioSourceContext } from '../../../hosts/common/studio_projects';
import type { WorkspaceRecord } from '../../workspace/records';
import {
	WorkspaceAutosaveChange,
	type WorkspaceAutosavePayload,
	type WorkspaceSessionGeneration,
} from './models';

type WorkspaceState = {
	context: StudioSourceContext | null;
	recoveryIdentity: string | null;
	autosaveHandle: TimerHandle | null;
	autosaveTask: Promise<void> | null;
	requestedRevision: number;
	localRevision: number;
	remoteRevision: number;
	localGeneration: WorkspaceSessionGeneration | null;
	remotePayload: WorkspaceAutosavePayload | null;
	remoteDirtyRecords: ReadonlyMap<string, WorkspaceRecord> | null;
	pendingChanges: WorkspaceAutosaveChange;
};

export const workspaceDirtyRecords = new Map<string, WorkspaceRecord>();

export const workspaceState: WorkspaceState = {
	context: null,
	recoveryIdentity: null,
	autosaveHandle: null,
	autosaveTask: null,
	requestedRevision: 0,
	localRevision: 0,
	remoteRevision: -1,
	localGeneration: null,
	remotePayload: null,
	remoteDirtyRecords: null,
	pendingChanges: WorkspaceAutosaveChange.None,
};
