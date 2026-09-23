import { StudioToolInputError, toolArguments } from './tool_input';

export type SourceToolEdit = { offset: number; deleteLength: number; text: string; expectedText: string };
export type SourceToolRequest =
	| { name: 'studio_list_sources' }
	| { name: 'studio_read_source'; resource: string }
	| { name: 'studio_read_diagnostics'; receipt: string }
	| { name: 'studio_propose_edits'; title: string; files: { receipt: string; edits: SourceToolEdit[] }[] };

const NO_FIELDS: string[] = [];
const READ_FIELDS = ['resource'];
const RECEIPT_FIELDS = ['receipt'];
const PROPOSAL_FIELDS = ['title', 'files'];
const FILE_FIELDS = ['receipt', 'edits'];
const EDIT_FIELDS = ['offset', 'deleteLength', 'text', 'expectedText'];

export const STUDIO_SOURCE_TOOLS = [
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
		case 'studio_read_diagnostics': {
			const value = toolArguments(input, RECEIPT_FIELDS);
			if (typeof value.receipt !== 'string') throw new StudioToolInputError('Diagnostics require a source receipt');
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
