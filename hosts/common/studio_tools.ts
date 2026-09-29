import type { StudioBuildSnapshot, StudioBuildChange } from './studio_builds';

/** The Studio tool transport is independent of agent accounts, threads and turns. */
export type StudioToolResult =
	| { success: true; data: unknown; images?: readonly string[] }
	| { success: false; error: string };
export type StudioSessionDescriptor = { title: string; url: string; tools: boolean; builds: boolean };
export type StudioSessionInfo = StudioSessionDescriptor & { id: string };
export type StudioToolDefinition = { name: string; description: string;
	inputSchema: { type: string; properties: Record<string, unknown>; required: readonly string[]; additionalProperties: boolean } };

export type StudioToolOperation =
	| { type: 'open'; context: string }
	| { type: 'call'; context: string; name: string; arguments: unknown }
	| { type: 'review'; context: string; review: string };
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
