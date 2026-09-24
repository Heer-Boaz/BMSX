import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { ResourceDomain } from '../../../common/resource';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { QuickPickItem } from '../../services/quick_input/provider';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows, type WorkbenchTreeNode } from '../../ui/tree_view';
import type { ActorLabInput } from './editor_input';
import { findRuntimeActor, readRuntimeActors, type ActorNode } from './runtime';

export type ActorRow = { node: ActorNode; displayLabel: string };
export type ActorChoice = QuickPickItem & { readonly domain: ResourceDomain; readonly hashId: number };

export function readActorChoices(sources: RuntimeSourceState, guest: SuspendedGuestSession, domain: ResourceDomain): ActorChoice[] {
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
	public constructor(private readonly input: ActorLabInput, private readonly sources: RuntimeSourceState, private readonly guest: SuspendedGuestSession) {}
	public update(): boolean {
		const { input, guest } = this;
		const actor = findRuntimeActor(this.sources, guest, input.domain, input.actorHashId);
		const changed = input.runtime.update(this.sources, guest, input.domain, actor);
		if (actor === undefined) {
			input.actorHashId = 0;
			input.status = 'CHOOSE A RUNNING ACTOR';
			this.statusDomain = undefined;
		} else {
			const name = input.runtime.roots[0].label, definition = guest.formatValue(guest.readStringMember(actor, 'definition_id'));
			if (this.statusDomain !== input.domain || this.statusName !== name || this.statusDefinition !== definition) {
				this.statusDomain = input.domain; this.statusName = name; this.statusDefinition = definition;
				input.status = `${name} / ${definition} / CART ${input.domain}`;
			}
		}
		if (changed) {
			this.children(null, input.runtime.roots);
			const outline = input.outline;
			rebuildWorkbenchTreeRows(outline, null);
			outline.selectionIndex = input.selectionHashId === 0 && outline.rows.length !== 0 ? 0
				: outline.rows.findIndex(row => row.element.node.hashId === input.selectionHashId);
		}
		return changed;
	}
	private children(parent: WorkbenchTreeNode<ActorRow> | null, nodes: readonly ActorNode[]): void {
		const siblings = parent === null ? this.input.outline.roots : parent.children;
		for (let i = 0; i < nodes.length; i++) {
			let row = siblings[i];
			if (row === undefined || row.element.node.hashId !== nodes[i].hashId || row.element.node.kind !== nodes[i].kind) {
				siblings.length = i;
				row = appendWorkbenchTreeNode(this.input.outline, parent, { node: nodes[i], displayLabel: '' });
			} else row.element.node = nodes[i];
			this.children(row, nodes[i].children);
			row.expandable = row.children.length !== 0;
		}
		siblings.length = nodes.length;
	}
}
