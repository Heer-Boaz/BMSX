import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { EditorGroupView } from '../../services/editor/editor_group';

export class TerminalInput extends ReadonlyEditorInput<'terminal', 'terminal'> {
	public get resource(): undefined { return undefined; }
	public readonly frameBounds = create_rect_bounds();
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null };
	public constructor() { super('terminal', 'terminal', 'TERMINAL', true); }
}

export function openTerminal(group: EditorGroupView): void {
	group.openEditor(group.model.findById('terminal') ?? new TerminalInput());
}
