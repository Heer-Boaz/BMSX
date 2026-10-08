import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { EditorPanes } from '../../services/editor/editor_panes';
import { editorTabGroup } from '../../ui/tab/group_model';
import { openEditorTab } from '../../ui/tabs';

export class TerminalInput extends ReadonlyEditorInput<'terminal', 'terminal'> {
	public get resource(): undefined { return undefined; }
	public readonly frameBounds = create_rect_bounds();
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public constructor() { super('terminal', 'terminal', 'TERMINAL', true); }
}

export function openTerminal(panes: EditorPanes): void {
	openEditorTab(panes, editorTabGroup.findById('terminal') ?? new TerminalInput());
}
