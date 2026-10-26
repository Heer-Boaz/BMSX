import type { StudioHeadlessCloseResult, StudioSourceAccess, StudioToolOperation, StudioToolResult } from '../../common/studio_tools';
import type { StudioProjectAdmission } from '../../common/studio_projects';
import type { WorkspaceDirectoryEntry, WorkspaceRecord } from '../../../ide/workspace/record_provider';

export type StudioWorkspaceOperation =
	| { readonly method: 'read'; readonly path: string }
	| { readonly method: 'readDirectory'; readonly path: string }
	| { readonly method: 'write'; readonly path: string; readonly record: WorkspaceRecord;
		readonly overwrite: boolean; readonly expectedSource?: string | null }
	| { readonly method: 'delete'; readonly path: string };
export type StudioWorkspaceValue = WorkspaceRecord | WorkspaceDirectoryEntry[] | null | undefined;
export type StudioWorkspaceRequest = { readonly type: 'workspace-request'; readonly request: number; readonly operation: StudioWorkspaceOperation };
export type StudioWorkspaceReply = { readonly type: 'workspace-result'; readonly request: number } & (
	| { readonly success: true; readonly value: StudioWorkspaceValue }
	| { readonly success: false; readonly error: Error }
);

export type HeadlessStudioOptions = {
	readonly workspaceRoot: string;
	readonly project: StudioProjectAdmission;
	readonly systemRomPath: string;
	readonly cartridgeSlots: readonly [string | null, string | null];
	readonly recoveryIdentity: string;
	readonly sourceAccess: StudioSourceAccess;
};

export type HeadlessStudioRequest =
	| StudioWorkspaceReply
	| { readonly type: 'execute'; readonly request: string; readonly operation: StudioToolOperation }
	| { readonly type: 'cancel'; readonly request: string }
	| { readonly type: 'release'; readonly context: string }
	| { readonly type: 'close'; readonly request: string; readonly discardUnsaved: boolean }
	| { readonly type: 'shutdown'; readonly request: string };

export type HeadlessStudioReply =
	| StudioWorkspaceRequest
	| { readonly type: 'ready' }
	| { readonly type: 'failed'; readonly error: Error }
	| { readonly type: 'result'; readonly request: string; readonly result: StudioToolResult }
	| { readonly type: 'closed'; readonly request: string; readonly result: StudioHeadlessCloseResult };
