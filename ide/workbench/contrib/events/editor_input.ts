import type { RuntimeEventHistory } from '../../../runtime/event_history';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { EditorPanes } from '../../services/editor/editor_panes';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { editorTabGroup } from '../../ui/tab/group_model';
import { openEditorTab } from '../../ui/tabs';
import { EventProjection } from './presentation';
import { createEventViewerLayout } from './layout';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';

export class EventViewerInput extends ReadonlyEditorInput<'events', 'event_viewer'> {
	public get resource(): undefined { return undefined; }
	public readonly actions = createWorkbenchActionBar('events.title', true, WORKBENCH_MENUS['events.context']);
	public readonly viewport = new WorkbenchScrollViewport();
	public readonly projection = new EventProjection();
	public readonly layout = createEventViewerLayout();
	public selected = -1;
	public filter = '';
	public constructor(public readonly history: RuntimeEventHistory) {
		super('events', 'event_viewer', 'EVENTS', true);
	}
}

export function openEventViewer(panes: EditorPanes, history: RuntimeEventHistory): void {
	openEditorTab(panes, editorTabGroup.findById('events') ?? new EventViewerInput(history));
}
