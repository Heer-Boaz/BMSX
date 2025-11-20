import type { World } from "../core/world";
import { ECSystem, TickGroup } from "./ecsystem";

declare const $: any; // avoid circular dependency issues

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
	/** Enable by predicate */
	when?: (world: World) => boolean;
}

type NodeResolved = Required<Pick<NodeSpec, "ref">> & {
	group: TickGroup;
	priority: number;
	index: number; // insertion order for stability
};

export interface BuildDiagnostics {
	finalOrder: string[];
	groupOrders: Record<number, string[]>; // key: TickGroup
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
				priority: n.priority ?? d.defaultPriority ?? 0,
				index: i,
			});
		}

		// Sort by group, then priority, then index
		resolved.sort((a, b) => {
			if (a.group !== b.group) return a.group - b.group;
			if (a.priority !== b.priority) return a.priority - b.priority;
			return a.index - b.index;
		});

		const finalOrder: NodeResolved[] = resolved;
		const groupOrders: Record<number, string[]> = {};

		// Populate groupOrders for diagnostics
		for (const r of finalOrder) {
			if (!groupOrders[r.group]) groupOrders[r.group] = [];
			groupOrders[r.group].push(r.ref);
		}

		// Instantiate systems
		const systems: ECSystem[] = [];
		for (const r of finalOrder) {
			const d = this._descs.get(r.ref)!;
			const sys = d.create(r.priority);
			sys.__ecsId = r.ref;
			systems.push(sys);
		}

		// Apply to world
		world.systems.clear();
		for (const s of systems) world.systems.register(s);

		const t1 = $.platform.clock.now();
		const diag: BuildDiagnostics = {
			finalOrder: finalOrder.map(r => r.ref),
			groupOrders,
			buildMs: t1 - t0,
		};
		this._lastDiagnostics = diag;
		return diag;
	}

	getLastDiagnostics(): BuildDiagnostics | null { return this._lastDiagnostics; }
}

export const DefaultECSPipelineRegistry = new ECSPipelineRegistry();
