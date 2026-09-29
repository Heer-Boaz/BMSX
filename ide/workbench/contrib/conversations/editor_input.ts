import { ReadonlyEditorInput } from '../../common/editor_input';
import type { FullWidthWorkbenchLayout } from '../../common/layout';
import type { ObservedConversation } from '../../services/assistant/observed_conversation';
import { WorkbenchScrollViewport } from '../../ui/scroll_viewport';
import { AssistantTranscriptProjection } from '../assistant/projection';
import { ObservedConversationFooter } from './footer';

/** View of the native thread; closing it releases only this observer. */
export class ConversationObserverInput extends ReadonlyEditorInput<'codex-conversations', 'conversation_observer'> {
	public get resource(): undefined { return undefined; }
	public readonly lifetime = new AbortController();
	public readonly viewport = new WorkbenchScrollViewport();
	public readonly transcript = new AssistantTranscriptProjection();
	public readonly layout: FullWidthWorkbenchLayout = { left: 0, top: 0, right: 0, bottom: 0, rowHeight: 0, font: null,
		viewportWidth: -1, viewportHeight: -1, codeAreaTop: -1, codeAreaBottom: -1 };
	public selectedEntry = -1;
	public projectedRevision = -1;
	public readonly footer = new ObservedConversationFooter();
	public footerTop = 0;
	public constructor(public readonly conversation: ObservedConversation) {
		super('codex-conversations', 'conversation_observer', 'CODEX CLI', true);
		this.disposables.add({ dispose: conversation.onDidChange((index, kind) => {
			if (kind === 'reset') { this.transcript.reset(); this.selectedEntry = -1; }
			else if (kind === 'text') this.transcript.invalidate(index);
			else if (kind === 'prepend' && this.selectedEntry >= 0) this.selectedEntry += index;
		}) });
		this.disposables.add({ dispose: () => { this.lifetime.abort(); conversation.disconnect(); } });
	}
}
