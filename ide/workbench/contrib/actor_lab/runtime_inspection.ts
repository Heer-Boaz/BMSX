import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { RuntimeInspection } from '../../../runtime/inspection';
import type { RuntimeLuaFunctionSource } from '../../../runtime/lua_inspection';
import type { BehaviorInspectionProperty } from '../behavior_lens/inspection';
import { inspectActorNode } from './inspection';
import { ActorRuntimeTree, readRuntimeActors, runtimeWorld, type ActorNode } from './runtime';
import { actorActions } from './operations';
import { readActorMethods } from './methods';
import { captureActorTarget } from './target';
import { prepareLuaArguments } from '../../../runtime/lua_literal';
import { valueTag, ValueTag } from '../../../../machine/ts/machine/cpu/value';
import type { ActorInvocation } from './execution';

type InspectedActor = { readonly value: Table; tree?: ActorRuntimeTree; rows?: ActorInspectionRow[] };
type ActorInspectionProperty = Pick<BehaviorInspectionProperty, 'label' | 'value' | 'description' | 'warning'> & {
	readonly source?: Pick<RuntimeLuaFunctionSource, 'resource' | 'range'> & { readonly origin: 'installed' };
};
type ActorInspectionRow = { readonly node: ActorNode; readonly reference: string; readonly actor: string; readonly parent?: string; properties?: ActorInspectionProperty[] };

/** On-demand cartlib interpretation of one physical suspension. No pane, heap scan, source inference or execution. */
export class ActorRuntimeInspection {
	private roots: ReturnType<typeof readRuntimeActors> | undefined;
	private readonly actors = new Map<string, InspectedActor>();
	private readonly nodes = new Map<string, ActorInspectionRow>();
	public constructor(private readonly inspection: RuntimeInspection) {}

	public list(start: number, count: number) {
		const { inspection } = this;
		inspection.requireSuspended();
		const { sources, guest, values } = inspection;
		if (this.roots === undefined) this.roots = readRuntimeActors(sources, guest, inspection.state.activeCartridge);
		const roots = this.roots;
		if (roots.status !== 'available') return { inspection: inspection.id, domain: roots.domain, status: roots.status };
		const entries = [];
		for (let i = start, end = Math.min(start + count, roots.objects.arrayLength); i < end; i++) {
			const actor = roots.objects.getInteger(i + 1) as Table;
			const reference = `${inspection.id}/actor/${actor.hashId}`;
			if (!this.actors.has(reference)) this.actors.set(reference, { value: actor });
			entries.push({ reference, object: values.describe(actor), id: values.describe(guest.readStringMember(actor, 'id')),
				definitionId: values.describe(guest.readStringMember(actor, 'definition_id')), active: guest.isTruthy(guest.readStringMember(actor, 'active')) });
		}
		return { inspection: inspection.id, domain: roots.domain, status: roots.status, start, total: roots.objects.arrayLength, actors: entries };
	}

	public tree(reference: string, start: number, count: number) {
		const { inspection } = this;
		inspection.requireSuspended();
		const actor = this.actors.get(reference);
		if (actor === undefined) throw new Error('Actor reference does not belong to this inspection. List the live actors first.');
		if (actor.rows === undefined) {
			actor.tree = new ActorRuntimeTree();
			actor.tree.update(inspection.sources, inspection.guest, this.roots!.domain, actor.value);
			actor.rows = [];
			this.addNodes(reference, actor.tree.roots, actor.rows);
		}
		const nodes = [];
		for (let i = start, end = Math.min(start + count, actor.rows.length); i < end; i++) nodes.push(this.describe(actor.rows[i]));
		return { inspection: inspection.id, actor: reference, domain: this.roots!.domain, start, total: actor.rows.length, nodes };
	}

	public read(reference: string) {
		const { inspection } = this;
		inspection.requireSuspended();
		const row = this.nodes.get(reference);
		if (row === undefined) throw new Error('Actor node reference does not belong to this inspection. Read the actor tree first.');
		const { node } = row;
		if (row.properties === undefined) {
			row.properties = inspectActorNode(inspection.sources, inspection.guest, node).map(property => ({
				label: property.label, value: property.value, description: property.description, warning: property.warning,
				source: property.source === undefined ? undefined : { resource: property.source.resource, range: property.source.range, origin: 'installed' as const },
			}));
		}
		return { inspection: inspection.id, domain: this.roots!.domain, ...this.describe(row),
			component: inspection.values.describe(node.component), receiver: inspection.values.describe(node.receiver), properties: row.properties };
	}

	public operations(reference: string) {
		this.inspection.requireSuspended();
		const row = this.nodes.get(reference);
		if (row === undefined) throw new Error('List the current actor tree before requesting operations.');
		return { node: reference, actions: actorActions(row.node).map(action => ({ name: action.method, label: action.label,
			description: action.description, arguments: action.payload ?? '' })),
			methods: readActorMethods(this.inspection.sources, this.inspection.guest, row.node.value!).map(method => ({ name: method.name,
				source: method.source === undefined ? undefined : { resource: method.source.resource, range: method.source.range, origin: 'installed' as const } })) };
	}
	public invocation(reference: string, kind: 'action' | 'method', method: string, source: string): ActorInvocation {
		const { inspection } = this;
		inspection.requireSuspended();
		const row = this.nodes.get(reference);
		if (row === undefined) throw new Error('Actor node is not part of the current inspected tree.');
		const args = prepareLuaArguments(source), guest = inspection.guest;
		const target = captureActorTarget(this.roots!.domain, runtimeWorld(inspection.sources, guest, this.roots!.domain)!.hashId,
			this.actors.get(row.actor)!.tree!.roots, row.node, guest);
		if (kind === 'action') {
			if (!actorActions(row.node).some(action => action.method === method)) throw new Error('Action is not available on this actor node.');
			return { kind, target, method, args };
		}
		const closure = guest.readStringMember(row.node.value, method);
		if (valueTag(closure) !== ValueTag.Closure) throw new Error('Selected member is not a stored Lua method.');
		return { kind, target, method, args, identity: guest.identity(closure) };
	}

	private addNodes(actor: string, nodes: readonly ActorNode[], rows: ActorInspectionRow[], parent?: string): void {
		for (const node of nodes) {
			const reference = `${this.inspection.id}/actor-node/${this.nodes.size}`;
			const row = { node, reference, actor, parent };
			this.nodes.set(reference, row);
			rows.push(row);
			this.addNodes(actor, node.children, rows, reference);
		}
	}
	private describe(row: ActorInspectionRow) {
		const { node } = row, { values } = this.inspection;
		return { reference: row.reference, actor: row.actor, parent: row.parent, kind: node.kind, label: node.label,
			key: values.describe(node.key), object: values.describe(node.value),
			activity: { value: node.active, basis: ACTIVITY_BASIS[node.kind] }, children: node.children.length };
	}
	public dispose(): void {
		for (const actor of this.actors.values()) actor.tree?.dispose();
		this.actors.clear(); this.nodes.clear(); this.roots = undefined;
	}
}

/** The Actor Lab indicator is a stored/derived fact, not proof of completed callbacks or future guards. */
const ACTIVITY_BASIS: Record<ActorNode['kind'], string> = {
	actor: 'actor.active', component: 'actor.active && component.enabled', tree: 'actor.active && component.enabled',
	machine: 'actor.active && component.enabled && component._started',
	state: 'machine indicator && ancestor selections (current_id or definition.is_concurrent)',
	timeline: 'entry.playing', effect: 'effect.active_count > 0',
};
