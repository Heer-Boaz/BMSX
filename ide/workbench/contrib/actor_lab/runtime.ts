import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { Value } from '../../../../machine/ts/machine/cpu/value';
import { createFsmStatePath } from '../../../../toolchain/ts/cartlib/fsm/state_path';
import type { ResourceDomain } from '../../../common/resource';
import { readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { QuickPickItem } from '../../services/quick_input/provider';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';
import type { ActorLabInput } from './editor_input';

export type ActorChoice = QuickPickItem & { readonly domain: ResourceDomain; readonly hashId: number };
export type ActorNode = {
	readonly kind: 'actor' | 'component' | 'machine' | 'state' | 'tree' | 'timeline' | 'effect';
	readonly hashId: number;
	readonly label: string;
	displayLabel: string;
	/** Borrowed only between CPU slices. Display identity survives, guest handles do not. */
	value: Table | null;
	receiver: Table | null;
	component: Table | null;
	key: Value;
	active: boolean;
	readonly stateKeys: readonly string[];
	readonly path?: string;
};

export function runtimeWorld(sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain): Table | undefined {
	const world = readRuntimeLuaModuleExport(sources, guest, domain, 'cartlib/world/world');
	return world.kind === 'value' && world.value !== null ? world.value as Table : undefined;
}

/** The ordinary global registerfile is shared: mounted ROMs are not separate worlds. */
export function readActorChoices(sources: RuntimeSourceState, guest: SuspendedGuestSession): ActorChoice[] {
	const choices: ActorChoice[] = [];
	const domain = sources.activeCartridgeSlot;
	const world = runtimeWorld(sources, guest, domain);
	if (world === undefined) return choices;
	const objects = guest.readStringMember(world, '_objects') as Table;
	for (let i = 1; i <= objects.arrayLength; i += 1) {
		const actor = objects.getInteger(i) as Table;
		choices.push({ label: guest.formatValue(guest.readStringMember(actor, 'id')),
			description: guest.formatValue(guest.readStringMember(actor, 'definition_id')),
			detail: `CART ${domain}`, domain, hashId: actor.hashId });
	}
	return choices;
}

export function findRuntimeActor(sources: RuntimeSourceState, guest: SuspendedGuestSession, input: ActorLabInput): Table | undefined {
	const world = runtimeWorld(sources, guest, input.domain);
	if (world === undefined) return;
	const objects = guest.readStringMember(world, '_objects') as Table;
	for (let i = 1; i <= objects.arrayLength; i += 1) {
		const actor = objects.getInteger(i) as Table;
		if (actor.hashId === input.actorHashId) return actor;
	}
}

const COMPONENT_TYPES = [
	['cartlib/fsm/fsm_component', 'FSM'], ['cartlib/behaviour_tree/bt_component', 'BT'],
	['cartlib/timeline/timeline_component', 'TIMELINES'], ['cartlib/actioneffects/actioneffect_component', 'ACTIONEFFECTS'],
] as const;
const NO_KEYS: readonly string[] = [];
type ActorTreeNode = WorkbenchTreeNode<ActorNode>;

/** Reconcile one actor by guest identity. Ordinary state changes retain nodes, labels and rows. */
export class ActorProjection {
	private changed = false;
	private readonly kinds: number[] = [];
	public constructor(private readonly input: ActorLabInput, private readonly sources: RuntimeSourceState, private readonly guest: SuspendedGuestSession) {}

	public update(): boolean {
		const { input, guest } = this;
		this.changed = false;
		const actor = findRuntimeActor(this.sources, guest, input);
		if (actor === undefined) {
			input.actorHashId = 0;
			input.status = 'CHOOSE A RUNNING ACTOR';
			this.finishChildren(null, 0);
		} else {
			const id = guest.readStringMember(actor, 'id');
			const root = this.node(null, 0, 'actor', actor, actor, null, id, guest.readStringMember(actor, 'active') === true);
			if (this.changed) input.status = `${root.element.label} / ${guest.formatValue(guest.readStringMember(actor, 'definition_id'))} / CART ${input.domain}`;
			const components = guest.readStringMember(actor, '_components') as Table;
			this.kinds.length = components.arrayLength + 1;
			this.kinds.fill(-1);
			const classes = guest.readStringMember(actor, '_components_by_class') as Table;
			for (let i = 0; i < COMPONENT_TYPES.length; i += 1) {
				const type = readRuntimeLuaModuleExport(this.sources, guest, input.domain, COMPONENT_TYPES[i][0]);
				if (type.kind !== 'value' || type.value === null) continue;
				const bucket = classes.get(type.value) as Table | null;
				if (bucket !== null) for (let j = 1; j <= bucket.arrayLength; j += 1) {
					const index = guest.readStringMember(bucket.getInteger(j), '_parent_component_index') as number;
					this.kinds[index] = i;
				}
			}
			for (let i = 1; i <= components.arrayLength; i += 1) {
				const component = components.getInteger(i) as Table;
				const type = this.kinds[i];
				const id = guest.readStringMember(component, type === 1 ? 'tree_id' : 'id');
				const branch = this.node(root, i - 1, type === 1 ? 'tree' : 'component', component, component, component, id,
					guest.readStringMember(component, 'enabled') === true && root.element.active,
					type === -1 ? 'COMPONENT' : COMPONENT_TYPES[type][1]);
				let count = 0;
				if (type === 0) {
					guest.visitTableEntries(guest.readStringMember(component, '_machines_by_id'), (key, machine) => {
						const node = this.node(branch, count++, 'machine', machine as Table, machine as Table, component, key,
							branch.element.active && guest.readStringMember(component, '_started') === true);
						this.states(node, machine as Table, component);
					});
				} else if (type === 2 || type === 3) {
					guest.visitTableEntries(guest.readStringMember(component, type === 2 ? '_entries_by_id' : 'effects'), (key, value) => {
						this.node(branch, count++, type === 2 ? 'timeline' : 'effect', value as Table, component, component, key,
							type === 2 ? guest.readStringMember(value, 'playing') === true : (guest.readStringMember(value, 'active_count') as number) > 0);
					});
				}
				this.finishChildren(branch, count);
			}
			this.finishChildren(root, components.arrayLength);
			this.finishChildren(null, 1);
		}
		if (this.changed) {
			const outline = input.outline;
			rebuildWorkbenchTreeRows(outline, null);
			outline.selectionIndex = input.selectionHashId === 0 && outline.rows.length !== 0 ? 0
				: outline.rows.findIndex(row => row.element.hashId === input.selectionHashId);
		}
		return this.changed;
	}

	private node(parent: ActorTreeNode | null, index: number, kind: ActorNode['kind'], value: Table, receiver: Table,
		component: Table | null, key: Value, active: boolean, prefix = ''): ActorTreeNode {
		const siblings = parent === null ? this.input.outline.roots : parent.children;
		let node = siblings[index];
		if (node === undefined || node.element.hashId !== value.hashId) {
			// Membership/order changed, not just the current state. Release detached borrows.
			siblings.length = index;
			const name = this.guest.formatValue(key);
			const label = prefix === '' ? name : `${prefix} ${name}`;
			const stateKeys = kind === 'state' ? [...parent!.element.stateKeys, name] : NO_KEYS;
			node = appendWorkbenchTreeNode(this.input.outline, parent, { kind, hashId: value.hashId, label, displayLabel: '',
				value, receiver, component, key, active, stateKeys,
				path: kind === 'state' ? createFsmStatePath(true, 0, stateKeys)?.text : undefined });
			this.changed = true;
		} else {
			const element = node.element;
			element.value = value; element.receiver = receiver; element.component = component; element.key = key; element.active = active;
		}
		return node;
	}

	private finishChildren(parent: ActorTreeNode | null, count: number): void {
		const children = parent === null ? this.input.outline.roots : parent.children;
		if (children.length === count) return;
		children.length = count;
		this.changed = true;
	}

	private states(parent: ActorTreeNode, machine: Table, component: Table): void {
		const { guest } = this;
		const state = parent.element.value!;
		const children = guest.readStringMember(state, 'states') as Table;
		const ids = guest.readStringMember(state, 'state_ids') as Table;
		const current = guest.readStringMember(state, 'current_id');
		for (let i = 1; i <= ids.arrayLength; i += 1) {
			const id = ids.getInteger(i);
			const child = children.get(id) as Table;
			const active = parent.element.active && (current === id || guest.readStringMember(guest.readStringMember(child, 'definition'), 'is_concurrent') === true);
			const node = this.node(parent, i - 1, 'state', child, machine, component, id, active);
			this.states(node, machine, component);
		}
		this.finishChildren(parent, ids.arrayLength);
	}
}
