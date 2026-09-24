import { StudioToolInputError, toolArguments } from './tool_input';

export type BehaviorToolRequest =
	| { name: 'studio_list_behaviors' }
	| { name: 'studio_read_behavior'; behavior: string }
	| { name: 'studio_propose_fsm_initial'; state: string }
	| { name: 'studio_propose_bt_child_edit'; child: string; operation: 'remove' | 'duplicate' | 'move_up' | 'move_down' }
	| { name: 'studio_propose_effect_value'; property: string; expression: string };

const EMPTY: string[] = [], BEHAVIOR = ['behavior'], STATE = ['state'], CHILD = ['child', 'operation'], PROPERTY = ['property', 'expression'];
const CHILD_OPERATIONS = ['remove', 'duplicate', 'move_up', 'move_down'];
export const STUDIO_BEHAVIOR_TOOLS = [
	{ name: 'studio_list_behaviors', description: 'Discover authored FSM, behavior-tree and ActionEffect registrations through Studio Behavior Lens. Includes unsaved working copies, duplicate occurrences and unresolved ids. This is static source evidence, NOT a list of running instances. Handles expire with this prompt/source context. Does not open views or execute Lua.',
		inputSchema: { type: 'object', properties: {}, required: EMPTY, additionalProperties: false } },
	{ name: 'studio_read_behavior', description: 'Read one registration through the shared Behavior Lens source model: occurrence tree, authored/reference ranges, partial/dynamic source, FSM entries and possible transition outcomes, and admitted source edits. Ranges are one-based UTF-16 positions. A static transition is NOT proof that a runtime guard allows it. Sources identify working-copy versions; use studio_list_sources/read_source for full text. No layout engine or guest evaluation runs.',
		inputSchema: { type: 'object', properties: { behavior: { type: 'string' } }, required: BEHAVIOR, additionalProperties: false } },
	{ name: 'studio_propose_fsm_initial', description: 'Propose making an admitted FSM state its actual source parent\'s initial state. The state handle must advertise fsm.set_initial. Uses Studio\'s syntax-preserving edit, including insertion when no initial field exists. Shared source constructors affect all their consumers. Returns a review, NOT application/save/install. Do not poll for a review decision; later user prompts carry its outcome.',
		inputSchema: { type: 'object', properties: { state: { type: 'string' } }, required: STATE, additionalProperties: false } },
	{ name: 'studio_propose_bt_child_edit', description: 'Propose removing, duplicating or moving an admitted authored BT list entry by one rank. The child handle must advertise the requested bt action. Edits the written expression, not its referenced initializer or a runtime node. Comments/other fields remain source-owned. Moving/duplicating expressions can change evaluation order/frequency; removing the final choice may leave an empty selector. No fallback node is invented. Shared lists affect all consumers. Returns an explicit source review; does NOT apply/save/install/run.',
		inputSchema: { type: 'object', properties: { child: { type: 'string' }, operation: { type: 'string', enum: CHILD_OPERATIONS } }, required: CHILD, additionalProperties: false } },
	{ name: 'studio_propose_effect_value', description: 'Propose replacing an admitted ActionEffect field or requirement expression. The property handle must advertise effect.set_value. Uses the same Lua expression parser and exact written field as Studio, never edits a referenced initializer implicitly. No expression is evaluated. Shared definitions affect all consumers. Returns an explicit source review; does NOT apply/save/install/run.',
		inputSchema: { type: 'object', properties: { property: { type: 'string' }, expression: { type: 'string' } }, required: PROPERTY, additionalProperties: false } },
];
export const STUDIO_BEHAVIOR_TOOL_NAMES = new Set(STUDIO_BEHAVIOR_TOOLS.map(tool => tool.name));

export function decodeBehaviorToolRequest(name: string, input: unknown): BehaviorToolRequest {
	switch (name) {
		case 'studio_list_behaviors': toolArguments(input, EMPTY); return { name };
		case 'studio_read_behavior': {
			const value = toolArguments(input, BEHAVIOR);
			if (typeof value.behavior !== 'string') throw new StudioToolInputError('behavior must be a registration handle from this context');
			return { name, behavior: value.behavior };
		}
		case 'studio_propose_fsm_initial': {
			const value = toolArguments(input, STATE);
			if (typeof value.state !== 'string') throw new StudioToolInputError('state must be a source node handle');
			return { name, state: value.state };
		}
		case 'studio_propose_bt_child_edit': {
			const value = toolArguments(input, CHILD);
			if (typeof value.child !== 'string' || !CHILD_OPERATIONS.includes(value.operation as string)) throw new StudioToolInputError('A BT edit requires a child handle and a listed operation');
			return { name, child: value.child, operation: value.operation as Extract<BehaviorToolRequest, { name: typeof name }>['operation'] };
		}
		case 'studio_propose_effect_value': {
			const value = toolArguments(input, PROPERTY);
			if (typeof value.property !== 'string' || typeof value.expression !== 'string') throw new StudioToolInputError('An effect edit requires a property handle and Lua expression text');
			return { name, property: value.property, expression: value.expression };
		}
		default: throw new StudioToolInputError(`Unknown Studio behavior tool: ${name}`);
	}
}
