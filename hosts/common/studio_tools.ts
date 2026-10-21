import type { StudioBuildSnapshot, StudioBuildChange } from './studio_builds';

/** The Studio tool transport is independent of agent accounts, threads and turns. */
export type StudioToolResult =
	| { success: true; data: unknown; images?: readonly string[] }
	| { success: false; error: string };
export type StudioSessionDescriptor = { title: string; url: string; tools: boolean; builds: boolean };
export type StudioSourceAccess = 'review' | 'edit';
export type StudioReviewApproval = 'user' | 'agent';
export type StudioBrowserSessionInfo = StudioSessionDescriptor & { id: string; kind: 'browser'; sourceAccess: 'edit'; reviewApproval: 'user' };
export type StudioHeadlessSessionInfo = { id: string; kind: 'headless'; title: string; tools: true; builds: false;
	sourceAccess: StudioSourceAccess; reviewApproval: 'agent'; requestId: string; buildRequestId: string };
export type StudioSessionInfo = StudioBrowserSessionInfo | StudioHeadlessSessionInfo;
export type StudioHeadlessStartRequest = { requestId: string; buildRequestId: string; sourceAccess: StudioSourceAccess };
export type StudioHeadlessStartResult = { requestId: string } & (
	| { status: 'ready'; session: StudioHeadlessSessionInfo }
	| { status: 'closed'; session: string }
);
export type StudioHeadlessCloseResult = { status: 'closed' }
	| { status: 'dirty'; resources: readonly { domain: -1 | 0 | 1; path: string }[] };
export type StudioToolDefinition = { name: string; description: string;
	inputSchema: { type: string; properties: Record<string, unknown>; required: readonly string[]; additionalProperties: boolean } };

export type StudioToolOperation =
	| { type: 'open'; context: string }
	| { type: 'call'; context: string; name: string; arguments: unknown }
	| { type: 'review'; context: string; review: string }
	| { type: 'resolve-review'; context: string; review: string; decision: 'apply' | 'discard' };
export type StudioToolEvent =
	| { type: 'connected'; session: string; server: string; builds?: StudioBuildSnapshot }
	| { type: 'build-snapshot'; snapshot: StudioBuildSnapshot }
	| { type: 'build-change'; change: StudioBuildChange }
	| { type: 'heartbeat'; sequence: number }
	| { type: 'request'; request: string; operation: StudioToolOperation }
	| { type: 'cancel'; request: string }
	| { type: 'release'; context: string };
export type StudioToolReply = StudioToolResult & { request: string };

// Liveness belongs to the window protocol, not Codex account/model polling.
export const STUDIO_HEARTBEAT_MS = 5000;
export const STUDIO_LIVENESS_MS = 15000;
export const STUDIO_CONNECT_MS = 10000;
