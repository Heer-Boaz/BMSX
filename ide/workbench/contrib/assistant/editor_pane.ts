import { AssistantReferences } from './references';
import type { Clipboard } from '../../../../hosts/common/clipboard';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import { point_in_rect, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandId } from '../../../common/commands';
import * as colors from '../../../common/constants';
import type { PointerSnapshot } from '../../../common/models';
import { truncateMeasuredText } from '../../../common/text';
import { drawMarkdownRow, measureStyledText } from '../../../editor/render/markdown';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { MultilineFieldControl } from '../../../editor/ui/inline/multiline_control';
import { drawMultilineField } from '../../../editor/ui/inline/multiline_render';
import { editorViewState } from '../../../editor/ui/view/state';
import { writeClipboard } from '../../../input/clipboard';
import { inputFocus } from '../../../input/focus';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../input/pointer/buttons';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { EditorPanes } from '../../services/editor/editor_panes';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import { editorTabGroup } from '../../ui/tab/group_model';
import { openEditorTab } from '../../ui/tabs';
import { WorkspaceEditReviewInput } from '../edit_review/editor_input';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { AssistantInput } from './editor_input';
import type { QuickInputController } from '../../services/quick_input/controller';
import { AssistantChatCommands, isAssistantCommand } from './chat_commands';

const SPINNER = ['|', '/', '-', '\\'];

const COMMANDS = ['assistant.history', 'assistant.new', 'assistant.commands', 'assistant.queue', 'assistant.direct', 'assistant.signIn', 'assistant.cancelLogin', 'assistant.signOut',
	'assistant.openLogin', 'assistant.copyCode', 'assistant.send', 'assistant.stop', 'assistant.review', 'assistant.copy'] as const;

/** Host-only conversation work continues under the ordinary workbench game pause. */
export class AssistantPane extends FullWidthWorkbenchEditorPane<AssistantInput> {
	private readonly chat: AssistantChatCommands;
	private readonly references = new AssistantReferences();
	private readonly actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget);
	private readonly scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget, input => this.handleTranscriptKeyboard(input));
	private readonly composer = new MultilineFieldControl();
	private unbindDraft: (() => void) | undefined;
	public constructor(resources: ResourcePanelController, private readonly clipboard: Clipboard, private readonly panes: EditorPanes, quickInput: QuickInputController) {
		super(resources);
		this.chat = new AssistantChatCommands(quickInput, clipboard);
		this.scroll.focusTarget.commandContext = this.focusTarget;
		for (const command of COMMANDS) this.focusTarget.registerCommand(command, { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) });
	}
	public override focus(): void { this.input.draft.focusTarget.focus(); }
	protected override activate(): void {
		super.activate();
		this.actions.setInput(this.input.turnActions, this.focusTarget);
		this.scroll.setInput(this.input.viewport);
		this.composer.setInput(this.input.draft, this.input.composer, this.input.composerBounds);
		this.unbindDraft = this.input.draft.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		this.input.draft.focusTarget.registerCommand('suggest.accept', {
			isEnabled: () => this.input.draft.focusTarget.hasFocus && this.references.suggestions.visible && this.references.suggestions.model.list.selectionIndex >= 0,
			run: () => this.references.suggestions.acceptSelection(),
		});
		const ring = [this.input.draft.focusTarget, this.actions.focusTarget, this.scroll.focusTarget];
		for (let index = 0; index < ring.length; index++) {
			ring[index].next = ring[(index + 1) % ring.length];
			ring[index].previous = ring[(index + ring.length - 1) % ring.length];
		}
		// Keep Undo/Redo in the draft's own history, not the pane's command context.
		for (const command of COMMANDS) this.input.draft.focusTarget.registerCommand(command, { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) });
		this.update();
	}
	public override clearInput(): void {
		this.unbindDraft?.(); this.unbindDraft = undefined;
		this.references.clear(); this.composer.clearInput(); this.actions.clearInput(); this.scroll.clearInput();
		super.clearInput();
	}
	public override dispose(): void { this.clearInput(); this.actions.dispose(); this.scroll.dispose(); super.dispose(); }
	public isEnabled(command: EditorCommandId): boolean {
		const { conversation: model, selectedEntry, draftHasText } = this.input;
		switch (command) {
			case 'assistant.history': case 'assistant.new': return model.canBrowse && !this.input.commandPending;
			case 'assistant.commands': return !this.input.commandPending;
			case 'assistant.signIn': return model.available && (model.state === 'disconnected' || model.state === 'ready' && !model.accountRefreshing && model.account!.requiresLogin);
			case 'assistant.cancelLogin': return model.state === 'signing-in';
			case 'assistant.signOut': return model.state === 'ready' && !model.accountRefreshing && model.account!.connected;
			case 'assistant.openLogin': case 'assistant.copyCode': return model.loginCode !== undefined;
			case 'assistant.send': case 'assistant.queue': return draftHasText && !this.input.commandPending && (this.input.draft.text.startsWith('/') || model.canSubmit);
			case 'assistant.direct': return model.canDirect && draftHasText;
			case 'assistant.stop': return model.state === 'running' || model.state === 'starting';
			case 'assistant.review': return model.entries[selectedEntry]?.proposal !== undefined;
			case 'assistant.copy': return selectedEntry >= 0;
			default: return false;
		}
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		const { conversation: model, draft } = this.input;
		switch (command) {
			case 'assistant.history': void this.chat.history(this.input); break;
			case 'assistant.new': void model.newConversation(); break;
			case 'assistant.commands': this.chat.commands(this.input); break;
			case 'assistant.signIn': void model.connect().then(() => model.startLogin()); break;
			case 'assistant.cancelLogin': void model.cancelLogin(); break;
			case 'assistant.signOut': void model.signOut(); break;
			case 'assistant.openLogin': model.openLoginPage(); break;
			case 'assistant.copyCode': void writeClipboard(this.clipboard, model.loginCode!, 'Copied sign-in code'); break;
			case 'assistant.send': case 'assistant.queue': case 'assistant.direct':
				draft.focusTarget.focus(); void this.chat.submit(this.input, command === 'assistant.direct'); break;
			case 'assistant.stop': void model.interrupt(); break;
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
			this.scroll.lineStep = row;
			this.composer.rowHeight = editorViewState.lineHeight;
		}
		input.busySince = model.workStartedAt;
		const busy = input.busySince !== undefined;
		const second = busy ? Math.trunc((performance.now() - input.busySince!) / 1000) : -1;
		const editingQueue = input.editingQueuedId !== undefined;
		let footerChanged = false;
		if (changed || model.revision !== input.projectedRevision) {
			const count = input.footer.lines.length;
			input.footer.update(model, layout.right - 8, measureTextRange, layout.font!);
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
		const transcriptBottom = input.composerBounds.top - 4 - (busy || input.editingQueuedId !== undefined ? row + 2 : 0);
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
		if (actionsChanged) layoutWorkbenchActionBar(input.turnActions, layout.right - 4, footerTop - row - 4, footerTop, measureText);
		this.actions.update(); this.scroll.update(); this.references.update(input);
	}
	public draw(): void {
		const input = this.input, { layout, viewport } = input;
		const font = editorViewState.font.renderFont();
		const textColor = colors.COLOR_RESOURCE_VIEWER_TEXT;
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		const footerTop = input.footerTop;
		api.fill_rect(0, footerTop, layout.right, layout.bottom, 0, colors.COLOR_STATUS_BACKGROUND);
		for (let index = 0; index + 1 < input.footer.lines.length; index++) {
			api.blit_text_inline_with_font(input.footer.lines[index], 4, footerTop + index * layout.rowHeight + 2, 0, colors.COLOR_STATUS_TEXT, font);
		}
		renderWorkbenchActionBar(input.turnActions, this, font);
		if (input.busySince !== undefined) {
			const y = input.composerBounds.top - layout.rowHeight - 4;
			api.blit_text_inline_with_font(SPINNER[Math.trunc((performance.now() - input.busySince) / 150) & 3], 4, y, 0, colors.COLOR_STATUS_SUCCESS, font);
			api.blit_text_inline_with_font(input.activityText, 16, y, 0, textColor, font);
		} else if (input.editingQueuedId !== undefined) {
			api.blit_text_inline_with_font('Editing queued message', 4, input.composerBounds.top - layout.rowHeight - 4, 0, textColor, font);
		}
		api.pushClipRect(viewport.bounds.left, viewport.bounds.top, viewport.bounds.right, viewport.bounds.bottom);
		for (let index = Math.trunc(viewport.scrollTop / layout.rowHeight), top = viewport.offsetTop + index * layout.rowHeight;
			index < input.transcript.rowCount && top < viewport.bounds.bottom; index++, top += layout.rowHeight) {
			const row = input.transcript.rowAt(index)!;
			const entry = input.conversation.entries[row.entry];
			const selected = row.entry === input.selectedEntry;
			if (entry.kind === 'user' && !row.heading) {
				api.fill_rect(4, top, viewport.bounds.right, top + layout.rowHeight, 0, colors.HIGHLIGHT_OVERLAY);
				api.fill_rect(4, top, 5, top + layout.rowHeight, 0, colors.COLOR_STATUS_SUCCESS);
			}
			if (selected) api.fill_rect(4, top, viewport.bounds.right, top + layout.rowHeight, 0, colors.SELECTION_OVERLAY);
			drawMarkdownRow(row, viewport.bounds.left + 4, top, viewport.bounds.right - 12, selected ? colors.COLOR_SELECTION_TEXT
				: entry.kind === 'status' ? colors.COLOR_MARKDOWN_MUTED_TEXT : textColor, selected);
		}
		api.popClipRect(); viewport.scrollbar.draw(colors.COLOR_CODE_BACKGROUND, textColor);
		const bounds = input.composerBounds;
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_QUICK_OPEN_OUTLINE);
		if (input.draft.text.length === 0) {
			const placeholder = input.conversation.state === 'running' ? 'Queue a message...' : 'Message your assistant...';
			api.pushClipRect(bounds.left + 3, bounds.top + 1, bounds.right - 3, bounds.bottom - 1);
			api.blit_text_inline_with_font(placeholder, bounds.left + 3, bounds.top + 2, 0, colors.COLOR_QUICK_OPEN_PLACEHOLDER, font);
			api.popClipRect();
		}
		drawMultilineField(input.draft, input.composer, bounds);
		this.references.suggestions.draw();
	}
	public drawStatusBar(top: number, color: number): void {
		api.blit_text_inline_with_font(this.input.footer.lines.at(-1)!, 4, top + 2, 0, color, editorViewState.font.renderFont());
	}
	protected override handleViewPointer(snapshot: PointerSnapshot): boolean {
		if (this.references.suggestions.handlePointer(snapshot)) return true;
		// Actions act on the selected message; scrollbar capture preserves selection/focus.
		if (this.actions.handlePointer(snapshot)) return true;
		const { viewport, transcript, layout } = this.input;
		const pressed = snapshot.insideViewport && (snapshot.justPressedButtons & PointerButton.Primary) !== 0;
		if (pressed && !(viewport.scrollbar.isVisible() && point_in_rect(snapshot.viewportX, snapshot.viewportY, viewport.scrollbar.getTrack()))) {
			this.input.selectedEntry = -1;
			if (point_in_rect(snapshot.viewportX, snapshot.viewportY, viewport.bounds)) {
				const row = transcript.rowAt(Math.trunc((snapshot.viewportY - viewport.offsetTop) / layout.rowHeight));
				const x = snapshot.viewportX - viewport.bounds.left - 4;
				if (row !== undefined) for (const run of row.runs) {
					if (x >= run.x && x < run.x + run.width) { this.input.selectedEntry = row.entry; break; }
				}
			}
		}
		// Controls own focus: a transcript click still routes Ctrl+C to the message.
		return this.composer.handlePointer(snapshot) || this.scroll.handlePointer(snapshot) || pressed;
	}
	private handleTranscriptKeyboard(input: PlayerInput): boolean {
		if (this.input.selectedEntry >= 0 && isKeyJustPressed('Escape', input)) {
			consumeIdeKey('Escape', input); this.input.selectedEntry = -1; return true;
		}
		if ((isCtrlDown(input) || isMetaDown(input)) && isKeyJustPressed('KeyC', input)) {
			consumeIdeKey('KeyC', input); this.execute('assistant.copy'); return true;
		}
		if (isKeyJustPressed('Enter', input)) { consumeIdeKey('Enter', input); this.execute('assistant.review'); return true; }
		for (const key of ['ArrowUp', 'ArrowDown'] as const) {
			if (!shouldRepeatKeyFromPlayer(key, input)) continue;
			consumeIdeKey(key, input);
			const { conversation, transcript, viewport, layout } = this.input;
			this.input.selectedEntry = Math.max(-1, Math.min(conversation.entries.length - 1,
				Math.max(0, this.input.selectedEntry + (key === 'ArrowUp' ? -1 : 1))));
			const row = this.input.selectedEntry < 0 ? -1 : transcript.entryTop(this.input.selectedEntry);
			if (row >= 0) {
				const top = row * layout.rowHeight;
				if (top < viewport.scrollTop) viewport.scrollbar.setScroll(top);
				else if (top + layout.rowHeight > viewport.scrollTop + viewport.height) viewport.scrollbar.setScroll(top + layout.rowHeight - viewport.height);
			}
			return true;
		}
		return false;
	}
	public handleKeyboard(input: PlayerInput): void {
		if (!this.input.draft.focusTarget.hasFocus) return;
		if (!(isCtrlDown(input) || isMetaDown(input)) && this.references.suggestions.handleKeyboard(input)) return;
		if ((isCtrlDown(input) || isMetaDown(input)) && isKeyJustPressed('Enter', input)) { consumeIdeKey('Enter', input); this.execute(isShiftDown(input) ? 'assistant.direct' : 'assistant.send'); return; }
		// A command is a single line, so plain Enter runs it. Shift+Enter still opens a new line.
		if (!isShiftDown(input) && isKeyJustPressed('Enter', input) && isAssistantCommand(this.input)) {
			consumeIdeKey('Enter', input); this.execute('assistant.send'); return;
		}
		this.composer.handleKeyboard(input, this.clipboard);
	}
	public handleWheel(direction: number, steps: number, pointer: PointerSnapshot | null): void {
		if (pointer !== null && !this.references.suggestions.handleWheel(pointer, direction * steps)) this.scroll.handleWheel(pointer, direction * steps * this.input.layout.rowHeight);
	}
}
