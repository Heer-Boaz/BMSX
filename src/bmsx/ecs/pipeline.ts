
import { $ } from '../core/game';
import type { World } from "../core/world";
import { ECSystem, ECSystemManager, TickGroup } from "./ecsystem";

export interface SystemDescriptor {
	id: string;
	group: TickGroup;
	defaultPriority?: number;
	tags?: string[];
	create: (priority: number) => ECSystem;
}

export interface NodeSpec {
	/** Registered system id to include */
	ref: string;
	/** Override group */
	group?: TickGroup;
	/** Override priority */
	priority?: number;
	/** Must run before these refs (same group only) */
	before?: string[];
	/** Must run after these refs (same group only) */
	after?: string[];
	/** Enable by predicate */
	when?: (world: World) => boolean;
}

type NodeResolved = Required<Pick<NodeSpec, "ref">> & {
	group: TickGroup;
	priority: number;
	before: string[];
	after: string[];
	index: number; // insertion order for stability
};

export interface BuildDiagnostics {
	finalOrder: string[];
	groupOrders: Record<number, string[]>; // key: TickGroup
	constraints: { ref: string; before: string[]; after: string[] }[];
	cyclesDetected: boolean;
	cycleGroups?: { group: TickGroup; refs: string[] }[];
	buildMs: number;
}

export class ECSPipelineRegistry {
	private _descs = new Map<string, SystemDescriptor>();
	private _lastDiagnostics: BuildDiagnostics | null = null;

	register(desc: SystemDescriptor): void {
		if (this._descs.has(desc.id)) throw new Error(`ECSPipelineRegistry: duplicate id '${desc.id}'`);
		this._descs.set(desc.id, desc);
	}

	registerMany(descs: SystemDescriptor[]): void { for (const d of descs) this.register(d); }

	get(id: string): SystemDescriptor | undefined { return this._descs.get(id); }

	/** Build and assign systems to the world's ECSystemManager based on nodes. */
	build(world: World, nodes: NodeSpec[]): BuildDiagnostics {
		const t0 = $.platform.clock.now();
		const filtered = nodes.filter(n => (n.when ? n.when(world) : true));
		const resolved: NodeResolved[] = [];
		for (let i = 0; i < filtered.length; i++) {
			const n = filtered[i];
			const d = this._descs.get(n.ref);
			if (!d) throw new Error(`ECSPipelineRegistry: unknown system ref '${n.ref}'`);
			resolved.push({
				ref: n.ref,
				group: n.group ?? d.group,
				priority: n.priority ?? d.defaultPriority,
				before: n.before?.slice() ?? [],
				after: n.after?.slice() ?? [],
				index: i,
			});
		}

		// Partition by group and order groups
		const groups = new Map<TickGroup, NodeResolved[]>();
		for (const r of resolved) {
			if (!groups.has(r.group)) groups.set(r.group, []);
			groups.get(r.group)!.push(r);
		}
		const orderedGroups = Array.from(groups.keys()).sort((a, b) => a - b);

		// Sort within each group honoring constraints with stable Kahn + priority
		const finalOrder: NodeResolved[] = [];
		const groupOrders: Record<number, string[]> = {};
		let anyCycle = false;
		const cycleGroups: { group: TickGroup; refs: string[] }[] = [];
		for (const g of orderedGroups) {
			const list = groups.get(g)!;
			// Build adjacency using before/after (ignore cross-group constraints)
			const id2idx = new Map<string, number>();
			list.forEach((n, idx) => id2idx.set(n.ref, idx));
			const adj: number[][] = list.map(() => [] as number[]);
			const indeg = list.map(() => 0);
			function addEdge(u: number, v: number) { adj[u].push(v); indeg[v]++; }
			for (let i = 0; i < list.length; i++) {
				const n = list[i];
				// before: n -> b
				for (const b of n.before) {
					const j = id2idx.get(b); if (j !== undefined) addEdge(i, j);
				}
				// after: a -> n
				for (const a of n.after) {
					const j = id2idx.get(a); if (j !== undefined) addEdge(j, i);
				}
			}
			// Kahn with priority + insertion order for stability
			const ready: number[] = [];
			for (let i = 0; i < indeg.length; i++) if (indeg[i] === 0) ready.push(i);
			const out: number[] = [];
			while (ready.length) {
				// pick lowest (priority, index)
				ready.sort((a, b) => (list[a].priority - list[b].priority) || (list[a].index - list[b].index));
				const u = ready.shift()!;
				out.push(u);
				for (const v of adj[u]) {
					indeg[v]--; if (indeg[v] === 0) ready.push(v);
				}
			}
			if (out.length !== list.length) {
				// Cycle detected; fall back to priority order + insertion order
				anyCycle = true;
				list.sort((a, b) => (a.priority - b.priority) || (a.index - b.index));
				finalOrder.push(...list);
				cycleGroups.push({ group: g, refs: list.map(n => n.ref) });
			} else {
				for (const idx of out) finalOrder.push(list[idx]);
			}
			groupOrders[g] = (groupOrders[g] ?? []).concat((out.length ? out.map(i => list[i].ref) : list.map(n => n.ref)));
		}

		// Materialize systems
		const SM: ECSystemManager = world.systems;
		SM.clear();
		for (const n of finalOrder) {
			const d = this._descs.get(n.ref)!;
			const sys = d.create(n.priority);
			// Attach debug id for stats reporting
			sys.__ecsId = d.id;
			SM.register(sys);
		}
		const t1 = $.platform.clock.now();
		const diag: BuildDiagnostics = {
			finalOrder: finalOrder.map(n => n.ref),
			groupOrders,
			constraints: resolved.map(n => ({ ref: n.ref, before: n.before.slice(), after: n.after.slice() })),
			cyclesDetected: anyCycle,
			cycleGroups: anyCycle ? cycleGroups : undefined,
			buildMs: (t1 - t0),
		};
		this._lastDiagnostics = diag;
		return diag;
	}

	getLastDiagnostics(): BuildDiagnostics | null { return this._lastDiagnostics; }
}

export const DefaultECSPipelineRegistry = new ECSPipelineRegistry();
