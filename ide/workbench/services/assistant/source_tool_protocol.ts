import { StudioToolInputError, toolArguments } from './tool_input';
import { STUDIO_BEHAVIOR_TOOLS } from './behavior_tool_protocol';
import type { TextFileSaveResult } from '../working_copy/text_file_save';

export type SourceToolEdit = { offset: number; deleteLength: number; text: string; expectedText: string };
export type SourceToolRequest =
	| { name: 'studio_list_sources' }
	| { name: 'studio_read_source'; resource: string }
	| { name: 'studio_read_diagnostics'; receipt: string }
	| { name: 'studio_read_source_status' | 'studio_save_source'; receipt: string }
	| { name: 'studio_propose_edits'; title: string; files: { receipt: string; edits: SourceToolEdit[] }[] };

const NO_FIELDS: string[] = [];
const READ_FIELDS = ['resource'];
const RECEIPT_FIELDS = ['receipt'];
const PROPOSAL_FIELDS = ['title', 'files'];
const FILE_FIELDS = ['receipt', 'edits'];
const EDIT_FIELDS = ['offset', 'deleteLength', 'text', 'expectedText'];

export const STUDIO_SOURCE_TOOLS = [
	...STUDIO_BEHAVIOR_TOOLS,
	{ name: 'studio_read_source_status', description: 'Read current working-copy dirty state, its relation to installed code and the latest ordinary Studio Save acknowledgement for a current source receipt. Save status is historical: workspace means that exact write reached the project provider; local-only is not project-file acknowledgement. A pending Save is not success. Runtime applied only compares source with the installed revision, not successful initialization. YAML assets require an asset rebuild; source-only Lua tests are not installed program modules. This does not save, build, execute or refresh expired source authority.',
		inputSchema: { type: 'object', properties: { receipt: { type: 'string' } }, required: RECEIPT_FIELDS, additionalProperties: false } },
	{ name: 'studio_save_source', description: 'Explicitly Save the exact working-copy revision read in this prompt, using the same service as Ctrl+S. Requires a current source receipt, not a review ID or path. Does not accept edits or approve a proposal. Lua and YAML Save persist source without building/installing it; AEM Save also performs its ordinary asset application, reported separately. Waits for the actual persistence/application outcome, not provider polling. Once admitted, the Save finishes even if Stop retires this conversation; no writes are rolled back. Later edits stay dirty. Read fresh source/status in the next prompt after retirement. A local-only outcome is not a successful project-file write.',
		inputSchema: { type: 'object', properties: { receipt: { type: 'string' } }, required: RECEIPT_FIELDS, additionalProperties: false } },
	{ name: 'studio_list_sources', description: 'List source resources in this captured Studio workspace. Handles belong only to this request context; paths are labels, not filesystem access.',
		inputSchema: { type: 'object', properties: {}, required: NO_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_source', description: 'Read the exact current working copy, including unsaved edits, without opening a tab or saving. Returns a receipt required for proposals. Offsets use UTF-16 code units, not UTF-8 bytes or visual columns.',
		inputSchema: { type: 'object', properties: { resource: { type: 'string' } }, required: READ_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_diagnostics', description: 'Read Studio Problems diagnostics for a source receipt from this prompt context. Uses the shared language service, not a build or guest execution. Rows and columns are zero-based UTF-16 source positions, not visual columns. Only ready status with an empty diagnostics array means no reported problems; unsupported, pending or failed is not a clean result. Source changes retire this context.',
		inputSchema: { type: 'object', properties: { receipt: { type: 'string' } }, required: RECEIPT_FIELDS, additionalProperties: false } },
	{ name: 'studio_propose_edits', description: 'Offer one multi-file edit for explicit Studio review. Does NOT apply, save, build or run anything. Returns a review identifier; subsequent user prompts carry Studio review observations for it. Do not wait or poll for a decision. Applied is a historical review outcome, not proof of current source or Save; read fresh source receipts in the next prompt before further edits. Every file must use a receipt read in this context. Edits use original UTF-16 offsets, strictly ascending, non-overlapping; expectedText must exactly match the deleted source. A changed context cannot be refreshed by another tool call.',
		inputSchema: { type: 'object', properties: { title: { type: 'string', minLength: 1 }, files: { type: 'array', minItems: 1,
			items: { type: 'object', properties: { receipt: { type: 'string' }, edits: { type: 'array', minItems: 1,
				items: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 }, deleteLength: { type: 'integer', minimum: 0 },
					text: { type: 'string' }, expectedText: { type: 'string' } }, required: EDIT_FIELDS, additionalProperties: false } } },
				required: FILE_FIELDS, additionalProperties: false } } }, required: PROPOSAL_FIELDS, additionalProperties: false } },
];

export function decodeSourceToolRequest(name: string, input: unknown): SourceToolRequest {
	switch (name) {
		case 'studio_list_sources':
			toolArguments(input, NO_FIELDS);
			return { name };
		case 'studio_read_source': {
			const value = toolArguments(input, READ_FIELDS);
			if (typeof value.resource !== 'string') throw new StudioToolInputError('resource must be a Studio resource handle');
			return { name, resource: value.resource };
		}
		case 'studio_read_diagnostics': case 'studio_read_source_status': case 'studio_save_source': {
			const value = toolArguments(input, RECEIPT_FIELDS);
			if (typeof value.receipt !== 'string') throw new StudioToolInputError('Source operations require a source receipt');
			return { name, receipt: value.receipt };
		}
		case 'studio_propose_edits': {
			const value = toolArguments(input, PROPOSAL_FIELDS);
			if (typeof value.title !== 'string' || value.title.length === 0) throw new StudioToolInputError('A proposal needs a title');
			if (!Array.isArray(value.files) || value.files.length === 0) throw new StudioToolInputError('A proposal needs source files');
			const files = value.files.map(file => {
				const value = toolArguments(file, FILE_FIELDS);
				if (typeof value.receipt !== 'string') throw new StudioToolInputError('Each file needs a source receipt');
				if (!Array.isArray(value.edits) || value.edits.length === 0) throw new StudioToolInputError('Each file needs edits');
				const edits = value.edits.map(edit => {
					const value = toolArguments(edit, EDIT_FIELDS);
					if (!Number.isSafeInteger(value.offset) || (value.offset as number) < 0
						|| !Number.isSafeInteger(value.deleteLength) || (value.deleteLength as number) < 0
						|| typeof value.text !== 'string' || typeof value.expectedText !== 'string') {
						throw new StudioToolInputError('Edits require non-negative integer UTF-16 offsets/lengths and exact source/replacement strings');
					}
					return { offset: value.offset as number, deleteLength: value.deleteLength as number,
						text: value.text, expectedText: value.expectedText };
				});
				return { receipt: value.receipt, edits };
			});
			return { name, title: value.title, files };
		}
		default: throw new StudioToolInputError(`Unknown Studio source tool: ${name}`);
	}
}

/** Error objects cross the tool wire as text; persistence/application remain separate owner outcomes. */
export function encodeSourceSaveResult(result: TextFileSaveResult) {
	if (result.status === 'failed') return { status: result.status, version: result.snapshot.version, error: String(result.error) };
	const { persistence, application } = result;
	return { status: result.status, version: result.snapshot.version,
		persistence: persistence.status === 'local-only' && persistence.reason === 'write-failed'
			? { status: persistence.status, reason: persistence.reason, error: String(persistence.error) } : persistence,
		application: application.status === 'failed'
			? { status: application.status, phase: application.phase, error: String(application.error) } : application };
}
