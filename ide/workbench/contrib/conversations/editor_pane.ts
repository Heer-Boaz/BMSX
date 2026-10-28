import type { InputFocusScope } from '../../../input/focus';
import type { EditorCommandRunner } from '../../../common/commands';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { ImageDecoder } from '../../../../hosts/common/image';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import * as colors from '../../../common/constants';
import { measureTextRange } from '../../../editor/common/text/layout';
import { measureStyledText } from '../../../editor/render/markdown';
import { editorViewState } from '../../../editor/ui/view/state';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { api } from '../../../runtime/overlay_api';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { ImagePreviewCache } from '../../ui/image_preview';
import { ImagePreviewOverlay } from '../../ui/image_preview_overlay';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { AssistantTranscriptControl } from '../assistant/transcript_control';
import type { ConversationObserverInput } from './editor_input';

/** Deliberately no composer, account controls, stop button or agent-tool authority. */
export class ConversationObserverPane extends WorkbenchViewEditorPane<ConversationObserverInput> {
	private readonly previews: ImagePreviewCache;
	private readonly preview: ImagePreviewOverlay;
	private readonly transcriptView: AssistantTranscriptControl;
	public constructor(decodeImage: ImageDecoder, surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, commands: EditorCommandRunner, scope: InputFocusScope) {
		super(scope);
		this.previews = new ImagePreviewCache(decodeImage); this.preview = new ImagePreviewOverlay(this.previews, surfaces, owner, commands);
		this.transcriptView = new AssistantTranscriptControl(this.focusTarget, this.previews, this.preview);
		this.focusTarget.registerCommand('conversations.older', { isEnabled: () => this.hasInput && !this.input.conversation.pending && this.input.conversation.olderCursor !== null,
			run: () => { void this.input.conversation.older(); } });
		this.transcriptView.scroll.focusTarget.registerCommand('conversations.older', this.focusTarget.getCommand('conversations.older')!);
	}
	protected override activate(): void { this.transcriptView.setInput(this.input); this.update(); }
	public override get commandTarget() { return this.transcriptView.scroll.focusTarget; }
	public override clearInput(): void { this.preview.close(); this.previews.dispose(); this.transcriptView.clearInput(); super.clearInput(); }
	public override dispose(): void { this.clearInput(); this.preview.dispose(); this.transcriptView.dispose(); super.dispose(); }
	public override update(): void {
		const input = this.input, { layout, viewport, conversation } = input;
		const layoutChanged = updateFullWidthWorkbenchLayout(layout, this.contentBounds);
		if (layoutChanged || input.projectedRevision !== conversation.revision) {
			input.projectedRevision = conversation.revision;
			const width = layout.right - layout.left;
			input.transcript.update(conversation.entries, width - colors.SCROLLBAR_WIDTH - 16, measureStyledText, layout.font!);
			input.footer.update(conversation, width - 8, measureTextRange, layout.font!);
		}
		const row = layout.rowHeight;
		this.preview.layout(layout, row);
		input.footerTop = layout.bottom - (input.footer.lines.length > 1 ? (input.footer.lines.length - 1) * row + 2 : 0);
		const bottom = input.footerTop - 4 - (conversation.workStartedAt !== undefined ? row + 2 : 0);
		const follow = viewport.scrollTop + viewport.height >= viewport.contentHeight;
		this.transcriptView.layout(layout.top + 4, bottom, follow, layoutChanged);
	}
	public draw(): void {
		const { layout, conversation, footer, footerTop } = this.input;
		const font = editorViewState.font.renderFont();
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
		api.fill_rect(layout.left, footerTop, layout.right, layout.bottom, 0, colors.COLOR_STATUS_BACKGROUND);
		for (let index = 0; index + 1 < footer.lines.length; index++) api.blit_text_inline_with_font(footer.lines[index], layout.left + 4, footerTop + index * layout.rowHeight + 2, 0, colors.COLOR_STATUS_TEXT, font);
		if (conversation.workStartedAt !== undefined) {
			const elapsed = performance.now() - conversation.workStartedAt;
			api.blit_text_inline_with_font('|/-\\'[Math.trunc(elapsed / 150) & 3], layout.left + 4, footerTop - layout.rowHeight - 2, 0, colors.COLOR_CONTENT_PROGRESS_TEXT, font);
			api.blit_text_inline_with_font(conversation.activity, layout.left + 16, footerTop - layout.rowHeight - 2, 0, colors.COLOR_CONTENT_PROGRESS_TEXT, font);
		}
		this.previews.beginFrame(); this.transcriptView.draw(); this.previews.endFrame();
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		api.blit_text_inline_with_font(this.input.footer.lines.at(-1)!, bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont());
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot): boolean {
		return this.transcriptView.handleSelection(snapshot) || this.transcriptView.scroll.handlePointer(snapshot)
			|| snapshot.insideViewport && (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
	}
	public handleKeyboard(_input: KeyInputEvent): void {} // The transcript focus target owns selection and scroll keys.
	public handleWheel(event: WheelInputSnapshot): void {
		this.transcriptView.scroll.handleWheel(event, event.deltaY * this.input.layout.rowHeight);
	}
}
