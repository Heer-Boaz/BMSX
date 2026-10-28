import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import { create_rect_bounds, write_rect_bounds } from '../../../../machine/ts/common/rect';
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
	private readonly selectionListeners = new Set<() => void>();
	public readonly viewport: WorkbenchGraphViewport<StateModel>;
	public status: 'available' | 'missing' | 'heap-replaced' = 'available';
	public title = '';
	public titleLabel = '';
	private root: StateNode | undefined;
	private dirty = true;
	private target: ActorTarget | undefined;
	private selectionTarget: ActorTarget | undefined;
	private selectionKind: 'node' | 'edge' = 'node';
	private readonly activeBounds = create_rect_bounds();
	public constructor(target: ActorTarget, font: BFont) {
		this.target = target;
		this.viewport = new WorkbenchGraphViewport(createWorkbenchGraphModel<StateNode, StateEdge>(font, [], []));
	}
	public onDidChangeSelection(listener: () => void): () => void {
		this.selectionListeners.add(listener);
		return () => this.selectionListeners.delete(listener);
	}

	/** Called only after Actor Lab reacquires its tree; no borrowed object enters this view. */
	public refresh(roots: readonly ActorNode[], guest: SuspendedGuestSession): void {
		if (this.target === undefined) return;
		const machine = resolveActorTarget(roots, this.target, guest);
		if (machine === undefined) {
			if (this.status !== 'missing') for (const node of this.viewport.model.nodes) node.active = false;
			this.status = 'missing';
			return;
		}
		this.status = 'available';
		if (this.root === undefined || this.root.name !== machine.name) this.title = `LIVE FSM / ${machine.name}`;
		this.root = this.reconcile(machine, this.root, undefined, guest);
	}

	public retire(status: 'missing' | 'heap-replaced'): void {
		this.target = undefined; this.status = status; this.root = undefined;
		this.viewport.selection = null;
		this.selectionTarget = undefined;
		this.dirty = true;
	}

	/** A new live branch keeps current membership, not selections from discarded future frames. */
	public resumeHistory(): void {
		if (this.status === 'missing') this.retire('missing');
		else if (this.viewport.selection === null) this.selectionTarget = undefined;
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
		if (viewport.selection !== null) this.rememberSelection();
		const selected = this.selectionTarget;
		const selectedKind = this.selectionKind;
		const nodes: StateNode[] = [], edges: StateEdge[] = [];
		const visit = (node: StateNode): void => {
			if (fontChanged) node.measure(font);
			if (this.status !== 'available') node.active = false;
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
		if (this.status !== 'available') return;
		const selected = this.viewport.selection;
		return selected?.kind === 'node' ? selected.target : selected?.child.target;
	}

	public matchesTarget(target: ActorTarget): boolean {
		return this.target !== undefined && actorTargetsEqual(this.target, target);
	}

	public get machineTarget(): ActorTarget | undefined { return this.target; }
	public get selectionBookmark(): ActorTarget | undefined { return this.selectionTarget; }
	public get selectionType(): 'node' | 'edge' { return this.selectionKind; }

	/** Navigation may retain an absent membership, but it never becomes an actionable selection. */
	public restoreSelection(target: ActorTarget | undefined, kind: 'node' | 'edge'): void {
		this.selectionTarget = target;
		this.selectionKind = kind;
		this.viewport.selection = null;
		if (target !== undefined) this.selectTarget(target, kind);
	}

	/** Explicit input replaces any temporarily unavailable selection bookmark. */
	public rememberSelection(): void {
		const selected = this.viewport.selection;
		const target = selected?.kind === 'node' ? selected.target : selected?.child.target;
		const kind = selected === null ? this.selectionKind : selected.kind;
		const changed = kind !== this.selectionKind || (target === undefined ? this.selectionTarget !== undefined
			: this.selectionTarget === undefined || !actorTargetsEqual(target, this.selectionTarget));
		this.selectionTarget = target; this.selectionKind = kind;
		if (changed) for (const listener of this.selectionListeners) listener();
	}

	public selectTarget(target: ActorTarget, kind: 'node' | 'edge' = 'node'): boolean {
		if (this.status !== 'available') return false;
		if (kind === 'edge') {
			for (const edge of this.viewport.model.edges) {
				if (!actorTargetsEqual(edge.child.target, target)) continue;
				this.viewport.selection = edge;
				this.rememberSelection();
				return true;
			}
			return false;
		}
		for (const node of this.viewport.model.nodes) {
			if (!actorTargetsEqual(node.target, target)) continue;
			this.viewport.selection = node;
			this.rememberSelection();
			return true;
		}
		return false;
	}

	/** Follow active path endpoints, not wide ancestors; concurrent endpoints share one reveal region. */
	public revealActive(scope: ActorTarget): void {
		if (this.status !== 'available') return;
		const nodes = this.viewport.model.nodes;
		let first = 0;
		while (first < nodes.length && !actorTargetsEqual(nodes[first].target, scope)) first++;
		if (first === nodes.length) return;
		let firstActive: StateNode | undefined;
		let visibleActive = false;
		const visible = this.viewport.visibleBounds;
		const bounds = this.activeBounds;
		for (let index = first; index < nodes.length; index++) {
			const node = nodes[index];
			if (index !== first && node.target.path.length <= scope.path.length) break;
			if (!node.active) continue;
			let hasActiveChild = false;
			for (const child of node.children) if (child.active) { hasActiveChild = true; break; }
			if (hasActiveChild) continue;
			const nodeBounds = node.bounds;
			if (nodeBounds.right > visible.left && nodeBounds.left < visible.right
				&& nodeBounds.top + node.headerHeight > visible.top && nodeBounds.top < visible.bottom) visibleActive = true;
			if (firstActive === undefined) {
				write_rect_bounds(bounds, nodeBounds.left, nodeBounds.top, nodeBounds.right, nodeBounds.top + node.headerHeight);
				firstActive = node;
			} else {
				bounds.left = Math.min(bounds.left, nodeBounds.left);
				bounds.top = Math.min(bounds.top, nodeBounds.top);
				bounds.right = Math.max(bounds.right, nodeBounds.right);
				bounds.bottom = Math.max(bounds.bottom, nodeBounds.top + node.headerHeight);
			}
		}
		if (firstActive === undefined) return;
		this.viewport.revealBounds(bounds);
		// A large union can overlap only the empty space between concurrent branches.
		// Keep a visible active branch; otherwise reveal the first endpoint in stable tree order.
		if (!visibleActive && (bounds.right - bounds.left > visible.right - visible.left
			|| bounds.bottom - bounds.top > visible.bottom - visible.top)) this.viewport.reveal(firstActive);
	}
}
