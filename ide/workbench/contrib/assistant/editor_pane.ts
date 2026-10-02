import type { ImageDecoder } from '../../../../hosts/common/image';
import { ImagePreviewCache } from '../../ui/image_preview';
import { ImagePreviewOverlay } from '../../ui/image_preview_overlay';
import { AssistantAttachmentStrip } from './attachment_strip';
import { AssistantTranscriptControl } from './transcript_control';
import { AssistantReferences } from './references';
import type { Clipboard } from '../../../../hosts/common/clipboard';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import { write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandId } from '../../../common/commands';
import * as colors from '../../../common/constants';
import type { PointerSnapshot } from '../../../common/models';
import { truncateMeasuredText } from '../../../common/text';
import { measureStyledText } from '../../../editor/render/markdown';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { MultilineFieldControl } from '../../../editor/ui/inline/multiline_control';
import { drawMultilineField } from '../../../editor/ui/inline/multiline_render';
import { editorViewState } from '../../../editor/ui/view/state';
import { writeClipboard } from '../../../input/clipboard';
import { inputFocus } from '../../../input/focus';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../input/pointer/buttons';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { updateFullWidthWorkbenchLayout, STATUS_BAR_CONNECTION_WIDTH } from '../../common/layout';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { EditorPanes } from '../../services/editor/editor_panes';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { editorTabGroup } from '../../ui/tab/group_model';
import { openEditorTab } from '../../ui/tabs';
import { WorkspaceEditReviewInput } from '../edit_review/editor_input';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { AssistantInput } from './editor_input';
import { isAssistantCommand, type AssistantChatCommands } from './chat_commands';

const SPINNER = ['|', '/', '-', '\\'];

const COMMANDS = ['assistant.queue', 'assistant.direct', 'assistant.send', 'assistant.review', 'assistant.copy'] as const;

/** Host-only conversation work continues under the ordinary workbench game pause. */
export class AssistantPane extends FullWidthWorkbenchEditorPane<AssistantInput> {
	private readonly previews: ImagePreviewCache;
	private readonly preview: ImagePreviewOverlay;
	private readonly attachments: AssistantAttachmentStrip;
	private imagesVisible = false;
	private contentTop = 0;
	private readonly references = new AssistantReferences();
	private readonly actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget);
	private readonly transcriptView: AssistantTranscriptControl;
	private readonly composer = new MultilineFieldControl();
	private unbindDraft: (() => void) | undefined;
	private unbindAttachmentClipboard: (() => void) | undefined;
	public constructor(resources: ResourcePanelController, private readonly clipboard: Clipboard, private readonly panes: EditorPanes, private readonly chat: AssistantChatCommands, decodeImage: ImageDecoder) {
		super(resources);
		this.previews = new ImagePreviewCache(decodeImage);
		this.preview = new ImagePreviewOverlay(this.previews);
		this.transcriptView = new AssistantTranscriptControl(this.focusTarget, this.previews, this.preview, () => this.execute('assistant.review'));
		this.attachments = new AssistantAttachmentStrip(this.previews, url => this.preview.open(url));
		for (const command of COMMANDS) this.focusTarget.registerCommand(command, { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) });
	}
	public override focus(): void { this.input.draft.focusTarget.focus(); }
	protected override activate(): void {
		super.activate();
		this.actions.setInput(this.input.turnActions, this.focusTarget);
		this.transcriptView.setInput(this.input);
		this.attachments.setInput(this.input.attachments);
		const draftInput = this.input;
		this.composer.setInput(draftInput.draft, draftInput.composer, draftInput.composerBounds, images => draftInput.attachments.add(images));
		this.unbindAttachmentClipboard = this.attachments.focusTarget.bindClipboard({ paste: contents => draftInput.draft.paste(contents) });
		this.unbindDraft = this.input.draft.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.input.draft.focusTarget.registerCommand('suggest.accept', {
			isEnabled: () => this.input.draft.focusTarget.hasFocus && this.references.suggestions.visible && this.references.suggestions.model.list.selectionIndex >= 0,
			run: () => this.references.suggestions.acceptSelection(),
		});
		const ring = [this.input.draft.focusTarget, this.actions.focusTarget, this.transcriptView.scroll.focusTarget];
		for (let index = 0; index < ring.length; index++) {
			ring[index].next = ring[(index + 1) % ring.length];
			ring[index].previous = ring[(index + ring.length - 1) % ring.length];
		}
		this.imagesVisible = false;
		this.attachments.focusTarget.commandContext = this.input.draft.focusTarget;
		this.attachments.focusTarget.next = this.input.draft.focusTarget;
		this.attachments.focusTarget.previous = this.transcriptView.scroll.focusTarget;
		// Keep Undo/Redo in the draft's own history, not the pane's command context.
		for (const command of COMMANDS) this.input.draft.focusTarget.registerCommand(command, { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) });
		this.update();
	}
	public override clearInput(): void {
		this.unbindDraft?.(); this.unbindDraft = undefined;
		this.unbindAttachmentClipboard?.(); this.unbindAttachmentClipboard = undefined;
		this.preview.close(); this.attachments.clearInput(); this.previews.dispose();
		this.references.clear(); this.composer.clearInput(); this.actions.clearInput(); this.transcriptView.clearInput();
		super.clearInput();
	}
	public override dispose(): void { this.clearInput(); this.actions.dispose(); this.transcriptView.dispose(); super.dispose(); }
	public isEnabled(command: EditorCommandId): boolean {
		const { conversation: model, selectedEntry } = this.input;
		const hasContent = this.input.draftHasText || this.input.attachments.images.length > 0;
		const ready = this.input.attachments.ready;
		switch (command) {
			case 'assistant.send': case 'assistant.queue': return hasContent && !this.input.commandPending && (this.input.draft.text.startsWith('/') || ready && model.canSubmit);
			case 'assistant.direct': return model.canDirect && ready && hasContent;
			case 'assistant.stop': return this.chat.isEnabled(command);
			case 'assistant.review': return model.entries[selectedEntry]?.proposal !== undefined;
			case 'assistant.copy': return selectedEntry >= 0;
			default: return false;
		}
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		const { conversation: model, draft } = this.input;
		switch (command) {
			case 'assistant.send': case 'assistant.queue': case 'assistant.direct':
				draft.focusTarget.focus(); void this.chat.submit(this.input, command === 'assistant.direct'); break;
			case 'assistant.stop': this.chat.execute(command); break;
			case 'assistant.copy': void writeClipboard(this.clipboard, model.entries[this.input.selectedEntry].text.getText(), 'Copied message'); break;
			case 'assistant.review': {
				const proposal = model.entries[this.input.selectedEntry].proposal!;
				const existing = editorTabGroup.tabs.find(input => input.kind === 'workspace_edit_review' && input.proposal === proposal);
				openEditorTab(this.panes, existing ?? new WorkspaceEditReviewInput(proposal)); break;
			}
		}
	}
	public override update(): void {
		const input = this.input, { layout, viewport, conversation: model } = input;
		const changed = updateFullWidthWorkbenchLayout(layout);
		const row = layout.rowHeight;
		if (changed) {
			this.transcriptView.scroll.lineStep = row;
			this.composer.rowHeight = editorViewState.lineHeight;
		}
		input.busySince = model.workStartedAt;
		const busy = input.busySince !== undefined;
		const second = busy ? Math.trunc((performance.now() - input.busySince!) / 1000) : -1;
		const editingQueue = input.editingQueuedId !== undefined;
		let footerChanged = false;
		if (changed || model.revision !== input.projectedRevision) {
			const count = input.footer.lines.length;
			input.footer.update(model, layout.right - STATUS_BAR_CONNECTION_WIDTH - 8, measureTextRange, layout.font!);
			footerChanged = count !== input.footer.lines.length;
		}
		const footerTop = input.footerTop = layout.bottom - (input.footer.lines.length > 1 ? (input.footer.lines.length - 1) * row + 2 : 0);
		// The shared field owns wrapping/caret geometry. Give it the maximum visible
		// rows, then fit the composer to its content without measuring the draft twice.
		// disable-next-line redundant_numeric_sanitization_pattern -- Layout constraint: reserve one editable row and at most a third of the pane, capped at six rows. This is the owning viewport boundary, not value sanitization.
		const maxRows = Math.max(1, Math.min(6, Math.trunc((footerTop - layout.top) / (3 * editorViewState.lineHeight))));
		input.draftMarkdown.update(input.draft.text, input.referenceStyles);
		input.composer.update(input.draft, layout.right - 14 - editorViewState.spaceAdvance, maxRows, measureStyledText, layout.font!, input.draftMarkdown.styles);
		const composerBottom = footerTop - row - 6;
		const composerTop = composerBottom - Math.min(maxRows, input.composer.rows.length) * editorViewState.lineHeight - 4;
		const composerChanged = changed || input.composerBounds.top !== composerTop || input.composerBounds.bottom !== composerBottom;
		if (composerChanged) write_rect_bounds(input.composerBounds, 4, composerTop, layout.right - 4, composerBottom);
		const activityLabel = busy ? model.state === 'stopping' ? 'Stopping' : model.state === 'starting' ? 'Starting' : model.activity : '';
		if (changed || activityLabel !== input.activityLabel || second !== input.activitySecond) {
			input.activitySecond = second; input.activityLabel = activityLabel;
			input.activityText = busy ? truncateMeasuredText(`${activityLabel}  ${second}s`, layout.right - 28, measureTextRange) : '';
		}
		const atEnd = viewport.scrollTop + viewport.height >= viewport.contentHeight;
		if (changed || composerChanged || model.revision !== input.projectedRevision || editingQueue !== input.editingQueue) {
			input.editingQueue = editingQueue;
			input.projectedRevision = model.revision;
			input.transcript.update(model.entries, layout.right - colors.SCROLLBAR_WIDTH - 16, measureStyledText, layout.font!);
		}
		const hasImages = input.attachments.images.length > 0;
		this.contentTop = input.composerBounds.top - (hasImages ? row * 5 + 8 : 0);
		if (hasImages) this.attachments.layout(4, this.contentTop, layout.right - 4, row);
		if (hasImages !== this.imagesVisible) {
			this.imagesVisible = hasImages;
			const stripFocus = this.attachments.focusTarget;
			input.draft.focusTarget.previous = hasImages ? stripFocus : this.transcriptView.scroll.focusTarget;
			this.transcriptView.scroll.focusTarget.next = hasImages ? stripFocus : input.draft.focusTarget;
			if (!hasImages) {
				// Retire the preview before its return control leaves the focus ring.
				this.preview.close();
				if (stripFocus.hasFocus) input.draft.focusTarget.focus();
			}
		}
		const transcriptBottom = this.contentTop - 4 - (busy || input.editingQueuedId !== undefined ? row + 2 : 0);
		const visibleRows = Math.max(1, (transcriptBottom - layout.top - 4) / row);
		const scrollRow = input.transcript.layout(viewport.scrollTop / row, visibleRows, atEnd);
		viewport.layout(4, layout.top + 4, layout.right, transcriptBottom, input.transcript.rowCount * row);
		viewport.scrollbar.setScroll(scrollRow * row);

		let actionsChanged = changed || footerChanged;
		const queuedSend = (model.state === 'running' || model.queued.length > 0) && !input.draft.text.startsWith('/') && input.editingQueuedId === undefined;
		for (const item of input.turnActions.items) {
			const visible = item.command === 'assistant.send' ? !queuedSend : item.command === 'assistant.queue' ? queuedSend
				: item.command === 'assistant.direct' ? queuedSend && model.state === 'running' : item.command === 'assistant.stop' ? model.state === 'running' || model.state === 'starting' || model.state === 'stopping'
				: model.entries[input.selectedEntry]?.proposal !== undefined;
			if (item.visible !== visible) { item.visible = visible; actionsChanged = true; }
		}
		if (actionsChanged) layoutWorkbenchActionBar(input.turnActions, layout.right - 4, footerTop - row - 4, footerTop, measureText, editorViewState.font.renderFont());
		this.actions.update(); this.references.update(input);
	}
	public draw(): void {
		const input = this.input, { layout } = input;
		this.previews.beginFrame();
		const font = editorViewState.font.renderFont();
		const textColor = colors.COLOR_RESOURCE_VIEWER_TEXT;
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		const footerTop = input.footerTop;
		api.fill_rect(0, footerTop, layout.right, layout.bottom, 0, colors.COLOR_STATUS_BACKGROUND);
		for (let index = 0; index + 1 < input.footer.lines.length; index++) {
			api.blit_text_inline_with_font(input.footer.lines[index], STATUS_BAR_CONNECTION_WIDTH + 4, footerTop + index * layout.rowHeight + 2, 0, colors.COLOR_STATUS_TEXT, font);
		}
		renderWorkbenchActionBar(input.turnActions, this, font);
		if (input.busySince !== undefined) {
			const y = this.contentTop - layout.rowHeight - 4;
			api.blit_text_inline_with_font(SPINNER[Math.trunc((performance.now() - input.busySince) / 150) & 3], 4, y, 0, colors.COLOR_STATUS_SUCCESS, font);
			api.blit_text_inline_with_font(input.activityText, 16, y, 0, textColor, font);
		} else if (input.editingQueuedId !== undefined) {
			api.blit_text_inline_with_font('Editing queued message', 4, this.contentTop - layout.rowHeight - 4, 0, textColor, font);
		}
		this.transcriptView.draw();
		const bounds = input.composerBounds;
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_QUICK_OPEN_OUTLINE);
		if (input.draft.text.length === 0) {
			const placeholder = input.conversation.state === 'running' ? 'Queue a message...' : 'Message your assistant...';
			api.pushClipRect(bounds.left + 3, bounds.top + 1, bounds.right - 3, bounds.bottom - 1);
			api.blit_text_inline_with_font(placeholder, bounds.left + 3, bounds.top + 2, 0, colors.COLOR_QUICK_OPEN_PLACEHOLDER, font);
			api.popClipRect();
		}
		drawMultilineField(input.draft, input.composer, bounds);
		if (input.attachments.images.length > 0) this.attachments.draw();
		this.references.suggestions.draw();
		this.preview.draw(layout, layout.rowHeight);
		this.previews.endFrame();
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		api.blit_text_inline_with_font(this.input.footer.lines.at(-1)!, bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont());
	}
	protected override handleViewPointer(snapshot: PointerSnapshot): boolean {
		if (this.preview.handlePointer(snapshot)) return true;
		if (this.input.attachments.images.length > 0 && this.attachments.handlePointer(snapshot)) return true;
		if (this.references.suggestions.handlePointer(snapshot)) return true;
		// Actions act on the selected message; scrollbar capture preserves selection/focus.
		if (this.actions.handlePointer(snapshot)) return true;
		if (this.transcriptView.handleSelection(snapshot)) return true;
		// Controls own focus: a transcript click still routes Ctrl+C to the message.
		return this.composer.handlePointer(snapshot) || this.transcriptView.scroll.handlePointer(snapshot) || snapshot.insideViewport && (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
	}
	public handleKeyboard(input: PlayerInput): void {
		if (!this.input.draft.focusTarget.hasFocus) return;
		if (!(isCtrlDown(input) || isMetaDown(input)) && this.references.suggestions.handleKeyboard(input)) return;
		if ((isCtrlDown(input) || isMetaDown(input)) && isKeyJustPressed('Enter', input)) { consumeIdeKey('Enter', input); this.execute(isShiftDown(input) ? 'assistant.direct' : 'assistant.send'); return; }
		// A command is a single line, so plain Enter runs it. Shift+Enter still opens a new line.
		if (!isShiftDown(input) && isKeyJustPressed('Enter', input) && isAssistantCommand(this.input)) {
			consumeIdeKey('Enter', input); this.execute('assistant.send'); return;
		}
		this.composer.handleKeyboard(input);
	}
	public handleWheel(direction: number, steps: number, pointer: PointerSnapshot | null): void {
		if (this.preview.visible) return;
		if (pointer !== null && this.input.attachments.images.length > 0 && this.attachments.handleWheel(pointer, direction * steps)) return;
		if (pointer !== null && !this.references.suggestions.handleWheel(pointer, direction * steps)) this.transcriptView.scroll.handleWheel(pointer, direction * steps * this.input.layout.rowHeight);
	}
}
