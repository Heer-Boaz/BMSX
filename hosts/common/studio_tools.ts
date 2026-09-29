/** The Studio tool transport is independent of agent accounts, threads and turns. */
export type StudioToolResult =
	| { success: true; data: unknown; images?: readonly string[] }
	| { success: false; error: string };
export type StudioSessionDescriptor = { title: string; url: string };
export type StudioSessionInfo = StudioSessionDescriptor & { id: string };
export type StudioToolDefinition = { name: string; description: string;
	inputSchema: { type: string; properties: Record<string, unknown>; required: readonly string[]; additionalProperties: boolean } };

export type StudioToolOperation =
	| { type: 'open'; context: string }
	| { type: 'call'; context: string; name: string; arguments: unknown }
	| { type: 'review'; context: string; review: string };
export type StudioToolEvent =
	| { type: 'connected'; session: string }
	| { type: 'request'; request: string; operation: StudioToolOperation }
	| { type: 'cancel'; request: string }
	| { type: 'release'; context: string };
export type StudioToolReply = StudioToolResult & { request: string };
