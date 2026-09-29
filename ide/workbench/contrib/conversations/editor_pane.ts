import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { ImageDecoder } from '../../../../hosts/common/image';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { PointerSnapshot } from '../../../common/models';
import * as colors from '../../../common/constants';
import { measureTextRange } from '../../../editor/common/text/layout';
import { measureStyledText } from '../../../editor/render/markdown';
import { editorViewState } from '../../../editor/ui/view/state';
import { PointerButton } from '../../../input/pointer/buttons';
import { api } from '../../../runtime/overlay_api';
import { updateFullWidthWorkbenchLayout, STATUS_BAR_CONNECTION_WIDTH } from '../../common/layout';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { ImagePreviewCache } from '../../ui/image_preview';
import { ImagePreviewOverlay } from '../../ui/image_preview_overlay';
import { AssistantTranscriptControl } from '../assistant/transcript_control';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { ConversationObserverInput } from './editor_input';

/** Deliberately no composer, account controls, stop button or agent-tool authority. */
export class ConversationObserverPane extends FullWidthWorkbenchEditorPane<ConversationObserverInput> {
	private readonly previews: ImagePreviewCache;
	private readonly preview: ImagePreviewOverlay;
	private readonly transcriptView: AssistantTranscriptControl;
	public constructor(resources: ResourcePanelController, decodeImage: ImageDecoder) {
		super(resources);
		this.previews = new ImagePreviewCache(decodeImage); this.preview = new ImagePreviewOverlay(this.previews);
		this.transcriptView = new AssistantTranscriptControl(this.focusTarget, this.previews, this.preview);
		this.focusTarget.registerCommand('conversations.older', { isEnabled: () => !this.input.conversation.pending && this.input.conversation.olderCursor !== null,
			run: () => { void this.input.conversation.older(); } });
	}
	protected override activate(): void { super.activate(); this.transcriptView.setInput(this.input); this.update(); }
	public override focus(): void { this.transcriptView.scroll.focusTarget.focus(); }
	public override clearInput(): void { this.preview.close(); this.previews.dispose(); this.transcriptView.clearInput(); super.clearInput(); }
	public override dispose(): void { this.clearInput(); this.transcriptView.dispose(); super.dispose(); }
	public override update(): void {
		const input = this.input, { layout, viewport, conversation } = input;
		const layoutChanged = updateFullWidthWorkbenchLayout(layout);
		if (layoutChanged || input.projectedRevision !== conversation.revision) {
			input.projectedRevision = conversation.revision;
			this.transcriptView.scroll.lineStep = layout.rowHeight;
			input.transcript.update(conversation.entries, layout.right - colors.SCROLLBAR_WIDTH - 16, measureStyledText, layout.font!);
			input.footer.update(conversation, layout.right - STATUS_BAR_CONNECTION_WIDTH - 8, measureTextRange, layout.font!);
		}
		const row = layout.rowHeight;
		input.footerTop = layout.bottom - (input.footer.lines.length > 1 ? (input.footer.lines.length - 1) * row + 2 : 0);
		const bottom = input.footerTop - 4 - (conversation.workStartedAt !== undefined ? row + 2 : 0);
		const follow = viewport.scrollTop + viewport.height >= viewport.contentHeight;
		const scroll = input.transcript.layout(viewport.scrollTop / row, Math.max(1, (bottom - layout.top - 4) / row), follow);
		viewport.layout(4, layout.top + 4, layout.right, bottom, input.transcript.rowCount * row);
		viewport.scrollbar.setScroll(scroll * row);
	}
	public draw(): void {
		const { layout, conversation, footer, footerTop } = this.input;
		const font = editorViewState.font.renderFont();
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		api.fill_rect(0, footerTop, layout.right, layout.bottom, 0, colors.COLOR_STATUS_BACKGROUND);
		for (let index = 0; index + 1 < footer.lines.length; index++) api.blit_text_inline_with_font(footer.lines[index], STATUS_BAR_CONNECTION_WIDTH + 4, footerTop + index * layout.rowHeight + 2, 0, colors.COLOR_STATUS_TEXT, font);
		if (conversation.workStartedAt !== undefined) {
			const elapsed = performance.now() - conversation.workStartedAt;
			api.blit_text_inline_with_font('|/-\\'[Math.trunc(elapsed / 150) & 3], 4, footerTop - layout.rowHeight - 2, 0, colors.COLOR_STATUS_SUCCESS, font);
			api.blit_text_inline_with_font(conversation.activity, 16, footerTop - layout.rowHeight - 2, 0, colors.COLOR_STATUS_SUCCESS, font);
		}
		this.previews.beginFrame(); this.transcriptView.draw(); this.preview.draw(layout, layout.rowHeight); this.previews.endFrame();
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		api.blit_text_inline_with_font(this.input.footer.lines.at(-1)!, bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont());
	}
	protected override handleViewPointer(snapshot: PointerSnapshot): boolean {
		return this.preview.handlePointer(snapshot) || this.transcriptView.handleSelection(snapshot) || this.transcriptView.scroll.handlePointer(snapshot)
			|| snapshot.insideViewport && (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
	}
	public handleKeyboard(_input: PlayerInput): void {} // The transcript focus target owns selection and scroll keys.
	public handleWheel(direction: number, steps: number, pointer: PointerSnapshot | null): void {
		if (!this.preview.visible && pointer !== null) this.transcriptView.scroll.handleWheel(pointer, direction * steps * this.input.layout.rowHeight);
	}
}
