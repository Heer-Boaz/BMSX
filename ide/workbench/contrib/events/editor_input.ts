import type { RuntimeEventHistory } from '../../../runtime/event_history';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { EditorGroupView } from '../../services/editor/editor_group';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { EventProjection } from './presentation';
import { createEventViewerLayout } from './layout';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import { InputInteraction } from '../../../input/interaction';
import type { EventViewerTabId } from '../../ui/tab/id';

let nextInputId = 0;

export class EventViewerInput extends ReadonlyEditorInput<EventViewerTabId, 'event_viewer'> {
	public override canMove(): boolean { return true; }
	public get resource(): undefined { return undefined; }
	public readonly actions = createWorkbenchActionBar('events.title', true, WORKBENCH_MENUS['events.context']);
	public readonly viewport = new WorkbenchScrollViewport();
	public readonly projection = new EventProjection();
	public readonly layout = createEventViewerLayout();
	public selected = -1;
	public filter = '';
	public readonly interaction = new InputInteraction();
	private generation: number;
	public constructor(public readonly history: RuntimeEventHistory) {
		const sequence = nextInputId++;
		super(`events:${sequence}`, 'event_viewer', 'EVENTS', true);
		this.setLabel(this.title, `Event view ${sequence}`, `#${sequence}`);
		this.generation = history.generation;
	}
	public update(): boolean {
		if (this.generation !== this.history.generation) {
			this.generation = this.history.generation;
			this.selected = -1;
		}
		const changed = this.projection.update(this.history, this.filter);
		if (this.projection.removed > 0) this.selected = Math.max(-1, this.selected - this.projection.removed);
		return changed;
	}
}

export function openEventViewer(group: EditorGroupView, history: RuntimeEventHistory): void {
	const active = group.model.activeTab;
	const existing = active?.kind === 'event_viewer' && active.history === history ? active
		: group.model.tabs.find(input => input.kind === 'event_viewer' && input.history === history);
	group.openEditor(existing ?? new EventViewerInput(history));
}
