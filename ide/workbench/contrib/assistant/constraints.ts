import type { EditorPaneConstraints } from '../../services/editor/editor_pane';
import type { EditorFont } from '../../../editor/ui/view/font';
import type { AssistantInput } from './editor_input';
import type { ConversationObserverInput } from '../conversations/editor_input';
import { SCROLLBAR_WIDTH } from '../../../common/constants';

const TRANSCRIPT_READING_COLUMNS = 40;

/** Shared transcripts retain a prose reading column rather than arbitrary word fragments. */
export function measureTranscriptEditor(_input: AssistantInput | ConversationObserverInput, font: EditorFont, companionRequested: boolean, target: EditorPaneConstraints): void {
	target.minimumWidth = 0; target.minimumHeight = 0; target.companionWidth = companionRequested ? font.charAdvance * TRANSCRIPT_READING_COLUMNS + SCROLLBAR_WIDTH + 16 : undefined;
}
