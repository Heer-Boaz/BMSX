import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { ResourceDomain } from '../../../common/resource';
import type { RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { QuickPickItem } from '../../services/quick_input/provider';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';
import type { ActorLabInput } from './editor_input';
import { findWorldActor, runtimeWorld, readRuntimeActors, type ActorNode } from './runtime';
import { resolveActorPath } from './target';

export type ActorRow = { node: ActorNode; displayLabel: string };
export type ActorChoice = QuickPickItem & { readonly domain: ResourceDomain; readonly hashId: number };

export function readActorChoices(sources: RuntimeInstalledSourceState, guest: SuspendedGuestSession, domain: ResourceDomain): ActorChoice[] {
	const actors = readRuntimeActors(sources, guest, domain), choices: ActorChoice[] = [];
	if (actors.status !== 'available') return choices;
	for (let i = 1; i <= actors.objects.arrayLength; i++) {
		const actor = actors.objects.getInteger(i) as Table;
		choices.push({ label: guest.formatValue(guest.readStringMember(actor, 'id')),
			description: guest.formatValue(guest.readStringMember(actor, 'definition_id')),
			detail: `CART ${actors.domain}`, domain: actors.domain, hashId: actor.hashId });
	}
	return choices;
}

/** Layout/collapse/selection belong to the pane, never to the runtime tree. */
export class ActorProjection {
	private statusDomain: ResourceDomain | undefined;
	private statusName = '';
	private statusDefinition = '';
	private scrollAnchor: WorkbenchTreeNode<ActorRow> | undefined;
	private revealStart = -1;
	private revealEnd = -1;
	private readonly activeRows: WorkbenchTreeNode<ActorRow>[] = [];
	public constructor(private readonly input: ActorLabInput, private readonly sources: RuntimeInstalledSourceState, private readonly guest: SuspendedGuestSession) {}
	public update(): boolean {
		const { input, guest } = this;
		const world = runtimeWorld(this.sources, guest, input.domain);
		input.worldHashId = world?.hashId;
		const actor = findWorldActor(guest, world, input.actorHashId);
		const wasPresent = input.actorPresent;
		input.actorPresent = actor !== undefined;
		const changed = input.runtime.update(this.sources, guest, input.domain, actor);
		input.stateGraph?.refresh(input.runtime.roots, guest);
		input.follow.refresh(input.runtime, guest, input.historical);
		if (actor === undefined) {
			input.status = input.actorHashId !== 0 && input.historical ? 'ACTOR NOT PRESENT AT THIS FRAME' : 'CHOOSE A RUNNING ACTOR';
			this.statusDomain = undefined;
			this.scrollAnchor = undefined; this.revealStart = -1;
			this.activeRows.length = 0;
			if (input.historical) return changed || wasPresent;
			input.actorHashId = 0; input.selectionPath = undefined;
		} else {
			const name = input.runtime.roots[0].label, definition = guest.formatValue(guest.readStringMember(actor, 'definition_id'));
			if (this.statusDomain !== input.domain || this.statusName !== name || this.statusDefinition !== definition) {
				this.statusDomain = input.domain; this.statusName = name; this.statusDefinition = definition;
				input.status = `${name} / ${definition} / CART ${input.domain}`;
			}
		}
		if (changed || wasPresent !== input.actorPresent || !input.actorPresent && input.outline.roots.length !== 0) {
			const outline = input.outline;
			const selected = outline.rows[outline.selectionIndex];
			this.scrollAnchor = outline.rows[outline.scroll];
			this.children(null, input.runtime.roots);
			rebuildWorkbenchTreeRows(outline, selected === undefined ? null : selected);
			if (outline.selectionIndex === -1 && input.selectionPath !== undefined) {
				const restored = resolveActorPath(input.runtime.roots, input.selectionPath, guest);
				if (restored !== undefined) outline.selectionIndex = outline.rows.findIndex(row => row.element.node === restored);
			}
			if (outline.selectionIndex !== -1 || !input.historical) input.rememberSelection();
		}
		return changed || wasPresent !== input.actorPresent;
	}

	/** A new live branch cannot inherit identities from its discarded future. */
	public resumeHistory(): void {
		this.input.historical = false;
		this.update();
		if (this.input.outline.selectionIndex === -1) this.input.selectionPath = undefined;
		this.input.stateGraph?.resumeHistory();
	}

	/** Explicit navigation selects; following only changes expansion and viewport. */
	public reveal(node: ActorNode): boolean {
		const outline = this.input.outline;
		const selected = this.find(outline.roots, node);
		if (selected === undefined) return false;
		this.input.presentation = 'outline';
		this.expandParents(selected);
		rebuildWorkbenchTreeRows(outline, selected);
		this.input.rememberSelection();
		this.activeRows.length = 0;
		this.revealStart = outline.selectionIndex; this.revealEnd = this.revealStart + 1;
		return true;
	}

	public revealActive(scope: ActorNode): boolean {
		const outline = this.input.outline;
		const root = this.find(outline.roots, scope);
		if (root === undefined) return false;
		this.activeRows.length = 0;
		this.collectActive(root);
		if (this.activeRows.length === 0) return false;
		const selected = outline.rows[outline.selectionIndex] || null;
		let expanded = false;
		for (const row of this.activeRows) expanded = this.expandParents(row) || expanded;
		if (expanded) rebuildWorkbenchTreeRows(outline, selected);
		this.revealStart = outline.rows.length; this.revealEnd = 0;
		for (const row of this.activeRows) {
			const index = outline.rows.indexOf(row);
			this.revealStart = Math.min(this.revealStart, index);
			this.revealEnd = Math.max(this.revealEnd, index + 1);
		}
		return expanded;
	}

	/** Apply after the pane has published current row counts and viewport bounds. */
	public layout(): void {
		const outline = this.input.outline;
		if (this.scrollAnchor !== undefined) {
			const index = outline.rows.indexOf(this.scrollAnchor);
			if (index !== -1) outline.scroll = index;
			this.scrollAnchor = undefined;
		}
		if (this.revealStart !== -1) {
			let visibleActive = false;
			for (const row of this.activeRows) {
				const index = outline.rows.indexOf(row);
				if (index >= outline.scroll && index < outline.scroll + outline.layout.visibleRowCount) { visibleActive = true; break; }
			}
			outline.scrollbar.revealRange(this.revealStart, this.revealEnd);
			if (this.activeRows.length !== 0 && !visibleActive && this.revealEnd - this.revealStart > outline.layout.visibleRowCount)
				outline.scrollbar.reveal(this.revealStart, this.revealStart + 1);
			this.revealStart = -1;
			this.activeRows.length = 0;
		}
	}

	private collectActive(row: WorkbenchTreeNode<ActorRow>): boolean {
		let descendant = false;
		for (const child of row.children) descendant = this.collectActive(child) || descendant;
		const node = row.element.node;
		const active = node.active && node.kind !== 'actor' && node.kind !== 'component';
		if (active && !descendant) this.activeRows.push(row);
		return active || descendant;
	}

	private expandParents(row: WorkbenchTreeNode<ActorRow>): boolean {
		let changed = false;
		for (let parent = row.parent; parent !== null; parent = parent.parent) {
			if (parent.collapsed) { parent.collapsed = false; changed = true; }
		}
		return changed;
	}

	private find(nodes: readonly WorkbenchTreeNode<ActorRow>[], value: ActorNode): WorkbenchTreeNode<ActorRow> | undefined {
		for (const node of nodes) {
			if (node.element.node === value) return node;
			const child = this.find(node.children, value);
			if (child !== undefined) return child;
		}
	}

	private children(parent: WorkbenchTreeNode<ActorRow> | null, nodes: readonly ActorNode[]): void {
		const siblings = parent === null ? this.input.outline.roots : parent.children;
		for (let i = 0; i < nodes.length; i++) {
			const node = nodes[i];
			let found = i;
			for (; found < siblings.length; found++) {
				const previous = siblings[found].element.node;
				if (previous.hashId === node.hashId && previous.kind === node.kind
					&& (node.kind === 'actor' || node.kind === 'component' || node.kind === 'tree'
						|| previous.keyIdentity.tag === node.keyIdentity.tag && previous.keyIdentity.scalar === node.keyIdentity.scalar)) break;
			}
			let row: WorkbenchTreeNode<ActorRow>;
			if (found === siblings.length) {
				row = appendWorkbenchTreeNode(this.input.outline, parent, { node, displayLabel: '' });
				siblings.pop(); siblings.splice(i, 0, row);
			} else {
				row = siblings[found];
				if (found !== i) { siblings.splice(found, 1); siblings.splice(i, 0, row); }
				row.element.node = node;
			}
			this.children(row, node.children);
			row.expandable = row.children.length !== 0;
		}
		siblings.length = nodes.length;
	}
}
