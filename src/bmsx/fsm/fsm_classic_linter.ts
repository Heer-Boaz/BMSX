import { StateDefinition } from './statedefinition';
import type { StateMachineBlueprint, StateEventDefinition } from './fsmtypes';

const FORBIDDEN_DSL_KEYS = new Set([
	'emit',
	'dispatch_event',
	'set_property',
	'adjust_property',
	'set',
	'adjust',
	'tags',
	'add_tag',
	'remove_tag',
	'activate_ability',
	'invoke',
	'consume_action',
	'command',
	'set_ticks_to_last_frame',
]);

export function assertClassicAuthoring(root: StateMachineBlueprint): void {
	walk(root as unknown as StateDefinition, root.id ?? '<root>');
}

function walk(node: StateDefinition, path: string): void {
	scanSlot(node.entering_state, `${path}.entering_state`);
	scanSlot(node.exiting_state, `${path}.exiting_state`);
	scanSlot(node.tick, `${path}.tick`);
	scanSlot(node.process_input, `${path}.process_input`);

	scanEventBag(node.on, `${path}.on`);
	scanEventBag(node.input_event_handlers, `${path}.input_event_handlers`);

	if (node.run_checks) {
		for (let i = 0; i < node.run_checks.length; i++) {
			const check = node.run_checks[i] as StateEventDefinition;
			scanEventDef(check, `${path}.run_checks[${i}]`);
		}
	}

	if (node.states) {
		for (const childId of Object.keys(node.states)) {
			const child = node.states[childId] as StateDefinition | undefined;
			if (child) {
				walk(child, `${path}.${childId}`);
			}
		}
	}
}

function scanSlot(slot: unknown, where: string): void {
	if (!slot) return;
	if (typeof slot === 'function' || typeof slot === 'string') return;
	if (typeof slot === 'object') {
		const keys = Object.keys(slot as Record<string, unknown>);
		for (const key of keys) {
			if (FORBIDDEN_DSL_KEYS.has(key)) {
				throw new Error(`[Classic FSM] Forbidden DSL in ${where}: ${keys.join(', ')}`);
			}
		}
	}
}

function scanEventBag(bag: unknown, where: string): void {
	if (!bag) return;
	const entries = Object.entries(bag as Record<string, unknown>);
	for (const entry of entries) {
		const definition = entry[1];
		if (typeof definition === 'string') continue;
		scanEventDef(definition as StateEventDefinition, `${where}.${entry[0]}`);
	}
}

function scanEventDef(definition: StateEventDefinition, where: string): void {
	if (!definition) return;
	scanSlot(definition.do as unknown, `${where}.do`);
}
