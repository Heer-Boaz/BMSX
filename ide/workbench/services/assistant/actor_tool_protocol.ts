import { StudioToolInputError, toolArguments } from './tool_input';
import { ValueTag } from '../../../../machine/ts/machine/cpu/value';

export type ActorToolRequest =
	| { name: 'studio_list_actors'; inspection: string; start: number; count: number }
	| { name: 'studio_read_actor_tree'; actor: string; start: number; count: number }
	| { name: 'studio_read_actor_node'; node: string }
	| { name: 'studio_list_actor_operations'; node: string }
	| { name: 'studio_actor_action' | 'studio_call_actor_method'; node: string; method: string; arguments: string }
	| { name: 'studio_actor_execution_status'; target: string }
	| { name: 'studio_control_actor'; target: string; operation: number; action: 'pause' | 'continue' };
const LIST_FIELDS = ['inspection', 'start', 'count'];
const TREE_FIELDS = ['actor', 'start', 'count'];
const NODE_FIELDS = ['node'];
const CALL_FIELDS = ['node', 'method', 'arguments'];
const CONTROL_FIELDS = ['target', 'operation', 'action'];
const START = { type: 'integer', minimum: 0 }, COUNT = { type: 'integer', minimum: 1 };
const RESULT_DESCRIPTION = ` Results pair bounded display strings (values) with raw ValueTags (tags): ${ValueTag.Nil}=nil, ${ValueTag.False}=false, ${ValueTag.True}=true, ${ValueTag.Number}=number, ${ValueTag.String}=string, ${ValueTag.Table}=table, ${ValueTag.Closure}=closure, ${ValueTag.BuiltinFunction}=builtin, ${ValueTag.Thread}=thread. Reinspect for expandable values; a completed call is not proof of domain success or a refreshed image.`;

export const STUDIO_ACTOR_TOOLS = [
	{ name: 'studio_list_actor_operations', description: 'Discover the same live-instance actions and stored Lua methods as Actor Lab. Node must come from the current suspended actor tree. Defaults are Lua literal arguments, not code. Discovery executes nothing. Action/call completion is distinct from event gates, later disposal, or later rendering.',
		inputSchema: { type: 'object', properties: { node: { type: 'string' } }, required: NODE_FIELDS, additionalProperties: false } },
	...['studio_actor_action', 'studio_call_actor_method'].map(name => ({ name, description: (name === 'studio_actor_action'
		? 'Execute a discovered Actor Lab action on this actual node. method is the advertised action name; arguments is a Lua literal argument list (without self, state path or keyed entry ID). Uses the World mutation rendezvous and reacquires the exact membership, then waits for call completion or pause. Can advance gameplay to reach the boundary. Returns values and tags, NOT an assertion of domain success. Prior inspection handles expire. Stop before invocation revokes it; during the call it pauses without undoing writes. Does not edit source.'
		: 'Call one discovered stored Lua method on the node object, passing it as self. arguments is a Lua literal argument list, not executable expressions. Reacquires the same World/object/membership/method after the World boundary. Waits for completion or pause. May advance to reach the boundary; references expire. Stop revokes an uninvoked call or pauses an entered call, never rolls back writes.') + RESULT_DESCRIPTION,
		inputSchema: { type: 'object', properties: { node: { type: 'string' }, method: { type: 'string' }, arguments: { type: 'string' } }, required: CALL_FIELDS, additionalProperties: false } })),
	{ name: 'studio_actor_execution_status', description: 'Read shared Actor Lab execution status once, including the active operation ID, invoked flag, pause and last result. Does not poll the provider or execute the machine. Use call/control tools to wait for actual completion or pause.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'], additionalProperties: false } },
	{ name: 'studio_control_actor', description: 'Pause or continue the identified shared Actor operation, without continuing ordinary gameplay after its return. Continue waits for completion or another stop. A revoked pre-invocation request cannot be revived: continuing merely lets its retained physical admission call return. No unwinding or rollback.',
		inputSchema: { type: 'object', properties: { target: { type: 'string' }, operation: { type: 'integer', minimum: 1 }, action: { enum: ['pause', 'continue'] } }, required: CONTROL_FIELDS, additionalProperties: false } },
	{ name: 'studio_list_actors', description: 'List a page of actual World members in this authoring inspection, using Actor Lab\'s runtime reader. Reports not-loaded/uninitialized separately from an empty World. Only the active cartridge bindings own the ordinary global World; mounted ROMs are not independent Worlds. Returns stop-scoped actor handles, typed IDs and table references. No heap scan, source-definition catalog, Lua execution or mutation. References expire with the inspection. Zero-based start, positive count.',
		inputSchema: { type: 'object', properties: { inspection: { type: 'string' }, start: START, count: COUNT }, required: LIST_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_actor_tree', description: 'Read a page of one listed live actor\'s Actor Lab tree: attached components, FSM machines/states, BT instances, timelines and granted ActionEffects. Classifies components using actual class-table indices, not labels or source names. Returns node/parent handles, typed keys, object table references and each activity indicator\'s exact meaning. Stored selection is not proof of completed lifecycle callbacks or future guards. Does not treat BT execution slots as authored node IDs. No guest execution or mutation. Traversal is cached for this suspension; pages do not rescan the tree.',
		inputSchema: { type: 'object', properties: { actor: { type: 'string' }, start: START, count: COUNT }, required: TREE_FIELDS, additionalProperties: false } },
	{ name: 'studio_read_actor_node', description: 'Inspect a node from studio_read_actor_tree using the ordinary Actor Lab runtime inspector. Returns its real object/component/receiver table references plus human-readable properties and mapped callback locations in installed source. Properties are summaries; use studio_read_runtime_values on the table references for complete typed/nested stored values. Definitions/BT blackboards come from the selected living instance, not newer source or registrations. Callback ranges refer to installed code, not dirty working copies. No source edits, Lua calls or runtime mutation.',
		inputSchema: { type: 'object', properties: { node: { type: 'string' } }, required: NODE_FIELDS, additionalProperties: false } },
];

export function decodeActorToolRequest(name: string, input: unknown): ActorToolRequest {
	if (name === 'studio_actor_execution_status') {
		const value = toolArguments(input, ['target']);
		if (typeof value.target !== 'string') throw new StudioToolInputError('Actor execution status requires an authoring target.');
		return { name, target: value.target };
	}
	if (name === 'studio_control_actor') {
		const value = toolArguments(input, CONTROL_FIELDS);
		if (typeof value.target !== 'string' || !Number.isSafeInteger(value.operation) || (value.operation as number) < 1 || value.action !== 'pause' && value.action !== 'continue') throw new StudioToolInputError('Actor control requires the current operation ID and pause/continue action.');
		return { name, target: value.target, operation: value.operation as number, action: value.action };
	}
	if (name === 'studio_actor_action' || name === 'studio_call_actor_method') {
		const value = toolArguments(input, CALL_FIELDS);
		if (typeof value.node !== 'string' || typeof value.method !== 'string' || typeof value.arguments !== 'string') throw new StudioToolInputError('Actor calls require a current node, method and Lua literal arguments.');
		return { name, node: value.node, method: value.method, arguments: value.arguments };
	}
	if (name === 'studio_read_actor_node' || name === 'studio_list_actor_operations') {
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
