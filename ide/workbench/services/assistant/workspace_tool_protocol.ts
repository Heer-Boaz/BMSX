import { StudioToolInputError, toolArguments } from './tool_input';

const BUILD_FIELDS = ['requestId'];
export const STUDIO_WORKSPACE_TOOLS = [
	{ name: 'studio_open_build', description: 'Open a completed workspace build in a NEW Studio browser tab, using its exact published cartridge/BIOS artifact. Takes the build request ID, not an arbitrary URL. Keeps this window and unsaved drafts intact. Returns opened or browser-blocked with the exact URL; opened acknowledges navigation, NOT boot or a live target. Select the new window via studio_list_sessions after startup. If blocked, use Studio: Build Jobs to open it with a user gesture or open the returned URL. Never retries automatically. Not available in standalone Studio without workspace builds.',
		inputSchema: { type: 'object', properties: { requestId: { type: 'string' } }, required: BUILD_FIELDS, additionalProperties: false } },
];

export function decodeWorkspaceToolRequest(name: string, input: unknown): { name: 'studio_open_build'; requestId: string } {
	if (name !== 'studio_open_build') throw new StudioToolInputError(`Unknown Studio workspace tool: ${name}`);
	const value = toolArguments(input, BUILD_FIELDS);
	if (typeof value.requestId !== 'string') throw new StudioToolInputError('Opening a build requires its request ID.');
	return { name, requestId: value.requestId };
}
