import type { RuntimeEventHistory } from '../../../runtime/event_history';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { EditorPanes } from '../../services/editor/editor_panes';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { editorTabGroup } from '../../ui/tab/group_model';
import { openEditorTab } from '../../ui/tabs';
import { EventProjection } from './presentation';

export class EventViewerInput extends ReadonlyEditorInput<'events', 'event_viewer'> {
	public get resource(): undefined { return undefined; }
	public readonly actions = createWorkbenchActionBar('events.title');
	public readonly viewport = new WorkbenchScrollViewport();
	public readonly projection = new EventProjection();
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public selected = -1;
	public filter = '';
	public constructor(public readonly history: RuntimeEventHistory) {
		super('events', 'event_viewer', 'EVENTS', true);
	}
}

export function openEventViewer(panes: EditorPanes, history: RuntimeEventHistory): void {
	openEditorTab(panes, editorTabGroup.findById('events') ?? new EventViewerInput(history));
}
