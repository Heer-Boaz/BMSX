import { AssistantAttachments } from './attachments';
import { TextStyle, type SourceTextStyle } from '../../../common/markdown/model';
import type { ResourceIdentity } from '../../../common/resource';
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
import { MarkdownSource } from '../../../common/markdown/source';
import { AssistantFooter } from './footer';
import { AssistantTranscriptSelection } from './transcript_selection';

/** Ephemeral view state; the workspace owns the conversation across pane switches. */
export class AssistantInput extends ReadonlyEditorInput<'assistant', 'assistant'> {
	public override readonly serializable = false;
	public get resource(): undefined { return undefined; }
	public readonly turnActions = createWorkbenchActionBar('assistant.turn', true);
	public readonly lifetime = new AbortController();
	public editingQueuedId: string | undefined;
	public commandPending = false;
	public readonly attachments = new AssistantAttachments();
	public readonly draft = new TextField<ResourceIdentity>();
	public readonly composer = new MultilineFieldViewport(true);
	public readonly draftMarkdown = new MarkdownSource();
	public referenceStyles: readonly SourceTextStyle[] = [];
	public readonly composerBounds = create_rect_bounds();
	public readonly viewport = new WorkbenchScrollViewport();
	public readonly transcript = new AssistantTranscriptProjection();
	public readonly selection = new AssistantTranscriptSelection();
	public readonly layout: FullWidthWorkbenchLayout = {
		left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
	};
	public draftHasText = false;
	public projectedRevision = -1;
	public readonly footer = new AssistantFooter();
	public footerTop = 0;
	public editingQueue = false;
	public busySince: number | undefined;
	public activitySecond = -1;
	public activityText = '';
	public activityLabel = '';
	public constructor(public readonly conversation: AssistantConversation) {
		super('assistant', 'assistant', 'CODEX', true);
		this.disposables.add({ dispose: this.draft.onDidChangeText(() => { this.draftHasText = this.draft.text.trim().length > 0;
			this.referenceStyles = this.draft.annotations.map(span => ({ from: span.from, to: span.to, style: TextStyle.Link }));
			this.draftMarkdown.update(this.draft.text, this.referenceStyles); }) });
		this.disposables.add({ dispose: conversation.onDidChange((index, kind) => {
			if (kind === 'reset') { this.selection.select(undefined); this.transcript.reset(); }
			else if (kind === 'proposal' || kind === 'text') this.transcript.invalidate(conversation.entries[index]);
			if (kind === 'reset') { this.editingQueuedId = undefined; }
			if (conversation.accountRefreshing) this.editingQueuedId = undefined;
			if (kind === 'text' && conversation.entries[index]?.kind === 'proposal') this.selection.select(conversation.entries[index]);
		}) });
		this.disposables.add({ dispose: () => conversation.disconnect() });
		this.disposables.add({ dispose: () => { this.lifetime.abort(); this.attachments.clear(); } });
	}
}

export function openAssistant(panes: EditorPanes, conversation: AssistantConversation): AssistantInput {
	const input = editorTabGroup.tabs.find(input => input.kind === 'assistant') ?? new AssistantInput(conversation);
	openEditorTab(panes, input);
	return input;
}
