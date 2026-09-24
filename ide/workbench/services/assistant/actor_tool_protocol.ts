import { StudioToolInputError, toolArguments } from './tool_input';

export type ActorToolRequest =
	| { name: 'studio_list_actors'; inspection: string; start: number; count: number }
	| { name: 'studio_read_actor_tree'; actor: string; start: number; count: number }
	| { name: 'studio_read_actor_node'; node: string };
const LIST_FIELDS = ['inspection', 'start', 'count'];
const TREE_FIELDS = ['actor', 'start', 'count'];
const NODE_FIELDS = ['node'];
const START = { type: 'integer', minimum: 0 }, COUNT = { type: 'integer', minimum: 1 };

export const STUDIO_ACTOR_TOOLS = [
	{ name: 'studio_list_actors', description: 'List a page of actual World members in this authoring inspection, using Actor Lab\'s runtime reader. Reports not-loaded/uninitialized separately from an empty World. Only the active cartridge bindings own the ordinary global World; mounted ROMs are not independent Worlds. Returns stop-scoped actor handles, typed IDs and table references. No heap scan, source-definition catalog, Lua execution or mutation. References expire with the inspection. Zero-based start, positive count.',
		inputSchema: { type: 'object', properties: { inspection: { type: 'string' }, start: START, count: COUNT }, required: LIST_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_actor_tree', description: 'Read a page of one listed live actor\'s Actor Lab tree: attached components, FSM machines/states, BT instances, timelines and granted ActionEffects. Classifies components using actual class-table indices, not labels or source names. Returns node/parent handles, typed keys, object table references and each activity indicator\'s exact meaning. Stored selection is not proof of completed lifecycle callbacks or future guards. Does not treat BT execution slots as authored node IDs. No guest execution or mutation. Traversal is cached for this suspension; pages do not rescan the tree.',
		inputSchema: { type: 'object', properties: { actor: { type: 'string' }, start: START, count: COUNT }, required: TREE_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_actor_node', description: 'Inspect a node from studio_read_actor_tree using the ordinary Actor Lab runtime inspector. Returns its real object/component/receiver table references plus human-readable properties and mapped callback locations in installed source. Properties are summaries; use studio_read_runtime_values on the table references for complete typed/nested stored values. Definitions/BT blackboards come from the selected living instance, not newer source or registrations. Callback ranges refer to installed code, not dirty working copies. No source edits, Lua calls or runtime mutation.',
		inputSchema: { type: 'object', properties: { node: { type: 'string' } }, required: NODE_FIELDS, additionalProperties: false } },
];

export function decodeActorToolRequest(name: string, input: unknown): ActorToolRequest {
	if (name === 'studio_read_actor_node') {
		const value = toolArguments(input, NODE_FIELDS);
		if (typeof value.node !== 'string') throw new StudioToolInputError('Actor inspection requires a node handle from the current actor tree');
		return { name, node: value.node };
	}
	const value = toolArguments(input, name === 'studio_list_actors' ? LIST_FIELDS : TREE_FIELDS);
	if (!Number.isSafeInteger(value.start) || (value.start as number) < 0 || !Number.isSafeInteger(value.count) || (value.count as number) < 1) {
		throw new StudioToolInputError('Actor reads require a non-negative integer start and positive integer count');
	}
	if (name === 'studio_list_actors' && typeof value.inspection === 'string') return { name, inspection: value.inspection, start: value.start as number, count: value.count as number };
	if (name === 'studio_read_actor_tree' && typeof value.actor === 'string') return { name, actor: value.actor, start: value.start as number, count: value.count as number };
	throw new StudioToolInputError('Actor reads require a handle from the current suspended inspection');
}
