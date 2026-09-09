import type { TimerHandle } from '../../../hosts/common/clock';
import type { WorkspaceRecord } from '../../workspace/records';
import {
	WorkspaceAutosaveChange,
	type WorkspaceAutosavePayload,
	type WorkspaceSessionGeneration,
} from './models';
import type { EditorTextModel } from '../../editor/model/text_model';
import type { CodeEditorViewState } from '../../editor/ui/code_editor_state';

type WorkspaceState = {
	projectRootPath: string | null;
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
export const workspacePendingCodeEditorViews = new Map<EditorTextModel, CodeEditorViewState>();

export const workspaceState: WorkspaceState = {
	projectRootPath: null,
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
