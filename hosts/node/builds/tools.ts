import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { buildArtifactId, buildRequestId, decodeBuildRequest, readBuildLog } from './api';
import type { StudioBuildJobs } from './jobs';

const id = { type: 'string', description: 'The caller-created request UUID. Reuse it to reconcile uncertain admission; do not create another build.' };
export const BUILD_TOOLS = [
	{ name: 'studio_build_targets', description: 'List saved cartridge build targets. Does not require a Studio window, agent account or toolContext.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
	{ name: 'studio_build_cart', description: 'Admit an identified build of SAVED workspace files and matching BIOS. Runs on the existing workspace server independently of this MCP request or window. Does not save drafts, install media or resume a game. Inspect with studio_read_build after a lost response; never blindly resubmit with a different ID.',
		inputSchema: { type: 'object', properties: { requestId: id, target: { type: 'string' }, debug: { type: 'boolean' }, optLevel: { type: 'integer', enum: [0, 1, 2, 3] } }, required: ['requestId', 'target', 'debug', 'optLevel'], additionalProperties: false } },
	{ name: 'studio_list_builds', description: 'Current and 50 recent workspace builds. For older or uncertain requests, use studio_read_build with the request ID. Do not busy-poll.',
		inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
	{ name: 'studio_read_build', description: 'Reconcile one build by its original request ID. Unknown means no durable admission is present. Optional log is bounded to 256 KiB, not a stream.',
		inputSchema: { type: 'object', properties: { requestId: id, log: { type: 'boolean' } }, required: ['requestId'], additionalProperties: false }, annotations: { readOnlyHint: true } },
	{ name: 'studio_cancel_build', description: 'Cancel an accepted build and await worker termination. If publication already won, returns the committed result. Never rolls back an artifact or the runtime.',
		inputSchema: { type: 'object', properties: { requestId: id }, required: ['requestId'], additionalProperties: false } },
	{ name: 'studio_read_artifact', description: 'Read exact system/cart input recipes and output digests for a published artifact ID. This is not evidence that any live runtime installed it.',
		inputSchema: { type: 'object', properties: { artifact: { type: 'string' } }, required: ['artifact'], additionalProperties: false }, annotations: { readOnlyHint: true } },
] satisfies Tool[];
export async function callBuildTool(jobs: StudioBuildJobs, name: string, input: Record<string, unknown>): Promise<unknown> {
	switch (name) {
		case 'studio_build_targets': return jobs.targets();
		case 'studio_build_cart': return jobs.admit(decodeBuildRequest(input));
		case 'studio_list_builds': return jobs.snapshot();
		case 'studio_read_build': {
			const requestId = buildRequestId(input.requestId), job = jobs.get(requestId);
			return { admitted: job !== undefined, job, log: input.log === true && job !== undefined ? await readBuildLog(jobs, requestId) : undefined };
		}
		case 'studio_cancel_build': return jobs.cancel(buildRequestId(input.requestId));
		case 'studio_read_artifact': return jobs.artifacts.read(buildArtifactId(input.artifact));
		default: throw new Error(`Unknown build tool: ${name}`);
	}
}
