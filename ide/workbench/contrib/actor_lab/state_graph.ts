import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { createWorkbenchGraphModel, createWorkbenchGraphNode, createWorkbenchTreeEdge, type WorkbenchGraphEdge, type WorkbenchGraphModel } from '../../ui/graph/model';
import { layoutWorkbenchTree } from '../../ui/graph/tree_layout';
import { WorkbenchGraphViewport } from '../../ui/graph/viewport';
import type { ActorNode } from './runtime';
import { actorTargetsEqual, resolveActorTarget, type ActorTarget } from './target';

class StateNode {
	public readonly kind = 'node';
	public readonly appearance = 'card';
	public readonly children: StateNode[] = [];
	public readonly bounds;
	public lines: readonly string[];
	public headerHeight: number;
	public active = false;
	public constructor(public readonly hashId: number, public readonly name: string, public readonly target: ActorTarget, font: BFont) {
		const card = createWorkbenchGraphNode(font, name, 0, 0);
		this.bounds = card.bounds; this.lines = card.lines; this.headerHeight = card.headerHeight;
	}
	public measure(font: BFont): void {
		const card = createWorkbenchGraphNode(font, this.name, 0, 0);
		Object.assign(this.bounds, card.bounds);
		this.lines = card.lines; this.headerHeight = card.headerHeight;
	}
}

type StateEdge = WorkbenchGraphEdge & { readonly child: StateNode };
type StateModel = WorkbenchGraphModel<StateNode, StateEdge>;

/** A projection of the chosen physical FSM, not a match to an authored registration. */
export class ActorStateGraph {
	public readonly viewport: WorkbenchGraphViewport<StateModel>;
	public status: 'available' | 'missing' | 'heap-replaced' = 'available';
	public title = '';
	public titleLabel = '';
	private root: StateNode | undefined;
	private dirty = true;
	private target: ActorTarget | undefined;
	public constructor(target: ActorTarget, font: BFont) {
		this.target = target;
		this.viewport = new WorkbenchGraphViewport(createWorkbenchGraphModel<StateNode, StateEdge>(font, [], []));
	}

	/** Called only after Actor Lab reacquires its tree; no borrowed object enters this view. */
	public refresh(roots: readonly ActorNode[], guest: SuspendedGuestSession): void {
		if (this.target === undefined) return;
		const machine = resolveActorTarget(roots, this.target, guest);
		if (machine === undefined) { this.retire('missing'); return; }
		if (this.root === undefined || this.root.name !== machine.name) this.title = `LIVE FSM / ${machine.name}`;
		this.root = this.reconcile(machine, this.root, undefined, guest);
	}

	public retire(status: 'missing' | 'heap-replaced'): void {
		this.target = undefined; this.status = status; this.root = undefined;
		this.viewport.selection = null;
		this.dirty = true;
	}

	private reconcile(source: ActorNode, previous: StateNode | undefined, parent: StateNode | undefined, guest: SuspendedGuestSession): StateNode {
		let node = previous;
		if (node === undefined || node.hashId !== source.hashId || node.name !== source.name
			|| !guest.matchesIdentity(source.key, node.target.path[node.target.path.length - 1].key)) {
			const target = parent === undefined ? this.target! : { ...parent.target,
				path: [...parent.target.path, { hashId: source.hashId, kind: source.kind, key: guest.identity(source.key) }] };
			node = new StateNode(source.hashId, source.name, target, this.viewport.model.font);
			this.dirty = true;
		}
		node.active = source.active;
		for (let index = 0; index < source.children.length; index++) {
			node.children[index] = this.reconcile(source.children[index], node.children[index], node, guest);
		}
		if (node.children.length !== source.children.length) { node.children.length = source.children.length; this.dirty = true; }
		return node;
	}

	/** Topology/font boundaries only. Ordinary activity changes keep geometry and the viewport. */
	public layout(font: BFont): void {
		const viewport = this.viewport;
		const fontChanged = viewport.model.font !== font;
		if (!this.dirty && !fontChanged) return;
		const selected = this.selectedTarget;
		const selectedKind = viewport.selection?.kind;
		const nodes: StateNode[] = [], edges: StateEdge[] = [];
		const visit = (node: StateNode): void => {
			if (fontChanged) node.measure(font);
			nodes.push(node);
			for (const child of node.children) visit(child);
		};
		if (this.root !== undefined) {
			visit(this.root);
			layoutWorkbenchTree(this.root, 16, 24);
			for (const parent of nodes) for (const child of parent.children) {
				edges.push({ ...createWorkbenchTreeEdge(parent, child), child });
			}
		}
		viewport.setModel(createWorkbenchGraphModel(font, nodes, edges), selected === undefined ? null : selectedKind === 'edge'
			? edges.find(edge => actorTargetsEqual(edge.child.target, selected)) || null
			: nodes.find(node => actorTargetsEqual(node.target, selected)) || null);
		this.dirty = false;
	}

	public get selectedTarget(): ActorTarget | undefined {
		const selected = this.viewport.selection;
		return selected?.kind === 'node' ? selected.target : selected?.child.target;
	}
}
