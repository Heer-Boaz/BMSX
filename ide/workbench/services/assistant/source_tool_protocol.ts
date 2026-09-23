/** External tool arguments are admitted here, not in the text model/history owners. */
export class SourceToolInputError extends Error {}

export type SourceToolEdit = { offset: number; deleteLength: number; text: string; expectedText: string };
export type SourceToolRequest =
	| { name: 'studio_list_sources' }
	| { name: 'studio_read_source'; resource: string }
	| { name: 'studio_propose_edits'; title: string; files: { receipt: string; edits: SourceToolEdit[] }[] };

const NO_FIELDS: string[] = [];
const READ_FIELDS = ['resource'];
const PROPOSAL_FIELDS = ['title', 'files'];
const FILE_FIELDS = ['receipt', 'edits'];
const EDIT_FIELDS = ['offset', 'deleteLength', 'text', 'expectedText'];

export const STUDIO_SOURCE_TOOLS = [
	{ name: 'studio_list_sources', description: 'List source resources in this captured Studio workspace. Handles belong only to this request context; paths are labels, not filesystem access.',
		inputSchema: { type: 'object', properties: {}, required: NO_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_source', description: 'Read the exact current working copy, including unsaved edits, without opening a tab or saving. Returns a receipt required for proposals. Offsets use UTF-16 code units, not UTF-8 bytes or visual columns.',
		inputSchema: { type: 'object', properties: { resource: { type: 'string' } }, required: READ_FIELDS, additionalProperties: false } },
	{ name: 'studio_propose_edits', description: 'Offer one multi-file edit for explicit Studio review. Does NOT apply, save, build or run anything. Every file must use a receipt read in this context. Edits use original UTF-16 offsets, strictly ascending, non-overlapping; expectedText must exactly match the deleted source. A changed context cannot be refreshed by another tool call.',
		inputSchema: { type: 'object', properties: { title: { type: 'string', minLength: 1 }, files: { type: 'array', minItems: 1,
			items: { type: 'object', properties: { receipt: { type: 'string' }, edits: { type: 'array', minItems: 1,
				items: { type: 'object', properties: { offset: { type: 'integer', minimum: 0 }, deleteLength: { type: 'integer', minimum: 0 },
					text: { type: 'string' }, expectedText: { type: 'string' } }, required: EDIT_FIELDS, additionalProperties: false } } },
				required: FILE_FIELDS, additionalProperties: false } } }, required: PROPOSAL_FIELDS, additionalProperties: false } },
];

export function decodeSourceToolRequest(name: string, input: unknown): SourceToolRequest {
	switch (name) {
		case 'studio_list_sources':
			object(input, NO_FIELDS);
			return { name };
		case 'studio_read_source': {
			const value = object(input, READ_FIELDS);
			if (typeof value.resource !== 'string') throw new SourceToolInputError('resource must be a Studio resource handle');
			return { name, resource: value.resource };
		}
		case 'studio_propose_edits': {
			const value = object(input, PROPOSAL_FIELDS);
			if (typeof value.title !== 'string' || value.title.length === 0) throw new SourceToolInputError('A proposal needs a title');
			if (!Array.isArray(value.files) || value.files.length === 0) throw new SourceToolInputError('A proposal needs source files');
			const files = value.files.map(file => {
				const value = object(file, FILE_FIELDS);
				if (typeof value.receipt !== 'string') throw new SourceToolInputError('Each file needs a source receipt');
				if (!Array.isArray(value.edits) || value.edits.length === 0) throw new SourceToolInputError('Each file needs edits');
				const edits = value.edits.map(edit => {
					const value = object(edit, EDIT_FIELDS);
					if (!Number.isSafeInteger(value.offset) || (value.offset as number) < 0
						|| !Number.isSafeInteger(value.deleteLength) || (value.deleteLength as number) < 0
						|| typeof value.text !== 'string' || typeof value.expectedText !== 'string') {
						throw new SourceToolInputError('Edits require non-negative integer UTF-16 offsets/lengths and exact source/replacement strings');
					}
					return { offset: value.offset as number, deleteLength: value.deleteLength as number,
						text: value.text, expectedText: value.expectedText };
				});
				return { receipt: value.receipt, edits };
			});
			return { name, title: value.title, files };
		}
		default: throw new SourceToolInputError(`Unknown Studio source tool: ${name}`);
	}
}

function object(input: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SourceToolInputError('Tool arguments must be an object');
	const keys = Object.keys(input);
	if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) throw new SourceToolInputError('Tool arguments do not match the declared fields');
	return input as Record<string, unknown>;
}
