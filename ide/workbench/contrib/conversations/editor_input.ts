import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { ObservedConversation } from '../../services/assistant/observed_conversation';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { AssistantTranscriptProjection } from '../assistant/projection';
import { ObservedConversationFooter } from './footer';
import { AssistantTranscriptSelection } from '../assistant/transcript_selection';

/** View of the native thread; closing it releases only this observer. */
export class ConversationObserverInput extends ReadonlyEditorInput<'codex-conversations', 'conversation_observer'> {
	public override readonly serializable = false;
	public get resource(): undefined { return undefined; }
	public readonly lifetime = new AbortController();
	public readonly viewport = new WorkbenchScrollViewport();
	public readonly transcript = new AssistantTranscriptProjection();
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null, };
	public readonly selection = new AssistantTranscriptSelection();
	public projectedRevision = -1;
	public readonly footer = new ObservedConversationFooter();
	public footerTop = 0;
	public constructor(public readonly conversation: ObservedConversation) {
		super('codex-conversations', 'conversation_observer', 'CODEX CLI', true);
		this.disposables.add({ dispose: conversation.onDidChange((index, kind) => {
			if (kind === 'reset') { this.selection.select(undefined); this.transcript.reset(); }
			else if (kind === 'text') this.transcript.invalidate(conversation.entries[index]);
		}) });
		this.disposables.add({ dispose: () => this.lifetime.abort() });
	}
}
