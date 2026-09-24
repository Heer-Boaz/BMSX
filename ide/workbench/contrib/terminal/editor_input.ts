import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import { TextField } from '../../../editor/ui/inline/text_field_model';
import { MultilineFieldViewport } from '../../../editor/ui/inline/multiline_viewport';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { LuaTerminalSession } from '../../services/terminal/session';
import type { EditorPanes } from '../../services/editor/editor_panes';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { editorTabGroup } from '../../ui/tab/group_model';
import { openEditorTab } from '../../ui/tabs';
import { TerminalProjection } from './projection';

export class TerminalInput extends ReadonlyEditorInput<'terminal', 'terminal'> {
	public get resource(): undefined { return undefined; }
	public readonly actions = createWorkbenchActionBar('terminal.input');
	public readonly draft = new TextField();
	public readonly composer = new MultilineFieldViewport();
	public readonly composerBounds = create_rect_bounds();
	public readonly viewport = new WorkbenchScrollViewport();
	public readonly transcript = new TerminalProjection();
	public readonly layout: FullWidthWorkbenchLayout = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
		viewportWidth: -1, viewportHeight: -1, codeAreaTop: -1, codeAreaBottom: -1,
	};
	public draftHasText = false;
	public historyIndex = -1;
	public savedDraft = '';
	public selectedEntry = -1;
	public projectedRevision = -1;
	public status = '';
	public constructor(public readonly session: LuaTerminalSession) {
		super('terminal', 'terminal', 'TERMINAL', true);
		this.disposables.add({ dispose: this.draft.onDidChangeText(() => { this.draftHasText = this.draft.text.trim().length > 0; }) });
	}
}

export function openTerminal(panes: EditorPanes, session: LuaTerminalSession): void {
	openEditorTab(panes, editorTabGroup.findById('terminal') ?? new TerminalInput(session));
}
