import { create_rect_bounds } from '../../../../machine/ts/common/rect';
import { TextField } from '../../../editor/ui/inline/text_field_model';
import { MultilineFieldViewport } from '../../../editor/ui/inline/multiline_viewport';
import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { AssistantConversation } from '../../services/assistant/conversation';
import type { EditorPanes } from '../../services/editor/editor_panes';
import { createWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { editorTabGroup } from '../../ui/tab/group_model';
import { openEditorTab } from '../../ui/tabs';
import { AssistantTranscriptProjection } from './projection';

/** Ephemeral view state; the workspace owns the conversation across pane switches. */
export class AssistantInput extends ReadonlyEditorInput<'assistant', 'assistant'> {
	public get resource(): undefined { return undefined; }
	public readonly turnActions = createWorkbenchActionBar('assistant.turn');
	public readonly lifetime = new AbortController();
	public editingQueuedId: string | undefined;
	public commandPending = false;
	public readonly draft = new TextField();
	public readonly composer = new MultilineFieldViewport();
	public readonly composerBounds = create_rect_bounds();
	public readonly viewport = new WorkbenchScrollViewport();
	public readonly transcript = new AssistantTranscriptProjection();
	public readonly layout: FullWidthWorkbenchLayout = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
		viewportWidth: -1, viewportHeight: -1, codeAreaTop: -1, codeAreaBottom: -1,
	};
	public draftHasText = false;
	public selectedEntry = -1;
	public projectedRevision = -1;
	public revealOlder = false;
	public status = '';
	public constructor(public readonly conversation: AssistantConversation) {
		super('assistant', 'assistant', 'CODEX', true);
		this.disposables.add({ dispose: this.draft.onDidChangeText(() => { this.draftHasText = this.draft.text.trim().length > 0; }) });
		this.disposables.add({ dispose: conversation.onDidChange((index, kind) => {
			if (kind === 'reset' || kind === 'prepend') this.transcript.reset();
			else if (kind === 'proposal') this.transcript.invalidateHeading(index);
			else if (kind === 'text') this.transcript.invalidate(index);
			if (kind === 'prepend') { this.revealOlder = true; if (this.selectedEntry >= 0) this.selectedEntry += index; }
			if (kind === 'reset') { this.editingQueuedId = undefined; this.revealOlder = false; }
			if (conversation.accountRefreshing) this.editingQueuedId = undefined;
			if (conversation.entries.length === 0) this.selectedEntry = -1;
			if (kind === 'text' && conversation.entries[index]?.kind === 'proposal') this.selectedEntry = index;
		}) });
		this.disposables.add({ dispose: () => conversation.disconnect() });
		this.disposables.add({ dispose: () => this.lifetime.abort() });
	}
}

export function openAssistant(panes: EditorPanes, conversation: AssistantConversation): void {
	openEditorTab(panes, editorTabGroup.findById('assistant') ?? new AssistantInput(conversation));
}
