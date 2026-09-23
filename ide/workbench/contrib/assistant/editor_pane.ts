import type { Clipboard } from '../../../../hosts/common/clipboard';
import type { PlayerInput } from '../../../../hosts/common/input/player';
import { point_in_rect, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandId } from '../../../common/commands';
import * as colors from '../../../common/constants';
import type { PointerSnapshot } from '../../../common/models';
import { truncateMeasuredText } from '../../../common/text';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { MultilineFieldControl } from '../../../editor/ui/inline/multiline_control';
import { drawMultilineField } from '../../../editor/ui/inline/multiline_render';
import { setFieldText } from '../../../editor/ui/inline/text_field';
import { editorViewState } from '../../../editor/ui/view/state';
import { writeClipboard } from '../../../input/clipboard';
import { inputFocus } from '../../../input/focus';
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
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

const COMMANDS = ['assistant.connect', 'assistant.disconnect', 'assistant.signIn', 'assistant.cancelLogin', 'assistant.signOut',
	'assistant.openLogin', 'assistant.copyCode', 'assistant.send', 'assistant.stop', 'assistant.review', 'assistant.copy'] as const;

/** Host-only conversation work continues under the ordinary workbench game pause. */
export class AssistantPane extends FullWidthWorkbenchEditorPane<AssistantInput> {
	private readonly account = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget);
	private readonly login = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget);
	private readonly actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget);
	private readonly scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget, input => this.handleTranscriptKeyboard(input));
	private readonly composer = new MultilineFieldControl();
	private unbindDraft: (() => void) | undefined;
	public constructor(resources: ResourcePanelController, private readonly clipboard: Clipboard, private readonly panes: EditorPanes) {
		super(resources);
		this.scroll.focusTarget.commandContext = this.focusTarget;
		for (const command of COMMANDS) this.focusTarget.registerCommand(command, { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) });
	}
	public override focus(): void { this.input.draft.focusTarget.focus(); }
	protected override activate(): void {
		super.activate();
		this.account.setInput(this.input.accountActions, this.focusTarget);
		this.login.setInput(this.input.loginActions, this.focusTarget);
		this.actions.setInput(this.input.turnActions, this.focusTarget);
		this.scroll.setInput(this.input.viewport);
		this.composer.setInput(this.input.draft, this.input.composer, this.input.composerBounds);
		this.unbindDraft = this.input.draft.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		const ring = [this.input.draft.focusTarget, this.actions.focusTarget, this.scroll.focusTarget, this.account.focusTarget, this.login.focusTarget];
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
		this.composer.clearInput(); this.account.clearInput(); this.login.clearInput(); this.actions.clearInput(); this.scroll.clearInput();
		super.clearInput();
	}
	public override dispose(): void { this.clearInput(); this.account.dispose(); this.login.dispose(); this.actions.dispose(); this.scroll.dispose(); super.dispose(); }
	public isEnabled(command: EditorCommandId): boolean {
		const { conversation: model, selectedEntry, draftHasText } = this.input;
		switch (command) {
			case 'assistant.connect': return model.available && model.state === 'disconnected';
			case 'assistant.disconnect': return model.state !== 'disconnected';
			case 'assistant.signIn': return model.state === 'ready' && !model.accountRefreshing && model.account!.requiresLogin;
			case 'assistant.cancelLogin': return model.state === 'signing-in';
			case 'assistant.signOut': return model.state === 'ready' && !model.accountRefreshing && model.account!.connected;
			case 'assistant.openLogin': case 'assistant.copyCode': return model.loginCode !== undefined;
			case 'assistant.send': return model.canSend && draftHasText;
			case 'assistant.stop': return model.state === 'running';
			case 'assistant.review': return model.entries[selectedEntry]?.proposal !== undefined;
			case 'assistant.copy': return selectedEntry >= 0;
			default: return false;
		}
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		const { conversation: model, draft } = this.input;
		switch (command) {
			case 'assistant.connect': void model.connect(); break;
			case 'assistant.disconnect': model.disconnect(); break;
			case 'assistant.signIn': void model.startLogin(); break;
			case 'assistant.cancelLogin': void model.cancelLogin(); break;
			case 'assistant.signOut': void model.signOut(); break;
			case 'assistant.openLogin': model.openLoginPage(); break;
			case 'assistant.copyCode': void writeClipboard(this.clipboard, model.loginCode!, 'Copied sign-in code'); break;
			case 'assistant.send': {
				const prompt = draft.text;
				void model.sendPrompt(prompt);
				setFieldText(draft, '', false); this.input.draftHasText = false; draft.focusTarget.focus(); break;
			}
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
			layoutWorkbenchActionBar(input.accountActions, layout.right - 4, layout.top, layout.top + row + 4, measureText);
			layoutWorkbenchActionBar(input.loginActions, layout.right - 4, layout.top + row * 2 + 8, layout.top + row * 3 + 12, measureText);
			layoutWorkbenchActionBar(input.turnActions, layout.right - 4, layout.bottom - row - 4, layout.bottom, measureText);
			write_rect_bounds(input.composerBounds, 4, layout.bottom - row * 5 - 10, layout.right - 4, layout.bottom - row - 6);
			this.scroll.lineStep = row;
			this.composer.rowHeight = editorViewState.lineHeight;
		}
		if (changed || model.revision !== input.projectedRevision) {
			input.projectedRevision = model.revision;
			input.loginLabel = model.loginCode === undefined ? '' : `Code: ${model.loginCode}`;
			this.account.focusTarget.next = model.loginCode === undefined ? input.draft.focusTarget : this.login.focusTarget;
			input.draft.focusTarget.previous = model.loginCode === undefined ? this.account.focusTarget : this.login.focusTarget;
			if (model.loginCode === undefined && this.login.focusTarget.hasFocus) input.draft.focusTarget.focus();
			input.status = truncateMeasuredText(!model.available ? 'Codex requires browser Studio on the development server.'
				: `${model.accountRefreshing ? 'Refreshing account' : model.state}${model.account?.email ? ` | ${model.account.email}` : ''}${model.account?.requiresLogin ? ' | Sign in to the private Studio profile' : ''}`,
				layout.right - 8, measureTextRange);
			const atEnd = viewport.scrollTop + viewport.height >= viewport.contentHeight;
			input.transcript.update(model.entries, layout.right - colors.SCROLLBAR_WIDTH - 8, measureTextRange, layout.font!);
			viewport.layout(4, layout.top + row * 4 + 16, layout.right, input.composerBounds.top - 4, input.transcript.rows.length * row);
			if (atEnd) viewport.scrollbar.setScroll(viewport.contentHeight);
		}
		input.composer.update(input.draft, input.composerBounds.right - input.composerBounds.left - 6 - editorViewState.spaceAdvance,
			Math.trunc((input.composerBounds.bottom - input.composerBounds.top - 4) / editorViewState.lineHeight), measureTextRange, layout.font!);
		this.account.update(); this.login.update(); this.actions.update(); this.scroll.update();
	}
	public draw(): void {
		const input = this.input, { layout, viewport } = input;
		const font = editorViewState.font.renderFont();
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		renderWorkbenchActionBar(input.accountActions, this, font); renderWorkbenchActionBar(input.loginActions, this, font); renderWorkbenchActionBar(input.turnActions, this, font);
		api.blit_text_inline_with_font(input.status, 4, layout.top + layout.rowHeight + 6, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		if (input.loginLabel) api.blit_text_inline_with_font(input.loginLabel, 4, layout.top + layout.rowHeight * 2 + 10, 0, colors.COLOR_STATUS_SUCCESS, font);
		api.blit_text_inline_with_font('Sends prompt + requested sources. Review required.', 4, layout.top + layout.rowHeight * 3 + 14, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		api.pushClipRect(viewport.bounds.left, viewport.bounds.top, viewport.bounds.right, viewport.bounds.bottom);
		const rows = input.transcript.rows;
		for (let index = Math.trunc(viewport.scrollTop / layout.rowHeight), top = viewport.offsetTop + index * layout.rowHeight;
			index < rows.length && top < viewport.bounds.bottom; index++, top += layout.rowHeight) {
			const row = rows[index];
			if (row.entry === input.selectedEntry) api.fill_rect(4, top, viewport.bounds.right, top + layout.rowHeight, 0, colors.SELECTION_OVERLAY);
			api.blit_text_inline_with_font(row.text, 4, top, 0, row.entry === input.selectedEntry ? colors.COLOR_SELECTION_TEXT : row.heading ? colors.COLOR_STATUS_SUCCESS : colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		}
		api.popClipRect(); viewport.scrollbar.draw(colors.COLOR_CODE_BACKGROUND, colors.COLOR_RESOURCE_VIEWER_TEXT);
		const bounds = input.composerBounds;
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_RESOURCE_VIEWER_TEXT);
		drawMultilineField(input.draft, input.composer, bounds);
	}
	public drawStatusBar(top: number, color: number): void {
		api.blit_text_inline_with_font('Ctrl+Enter: send | Enter: newline | Tab: controls', 4, top + 2, 0, color, editorViewState.font.renderFont());
	}
	protected override handleViewPointer(snapshot: PointerSnapshot): boolean {
		if (this.account.handlePointer(snapshot) || this.login.handlePointer(snapshot) || this.actions.handlePointer(snapshot) || this.composer.handlePointer(snapshot)) return true;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.viewport.bounds)) {
			const index = Math.trunc((snapshot.viewportY - this.input.viewport.offsetTop) / this.input.layout.rowHeight);
			const row = this.input.transcript.rows[index];
			if (row) this.input.selectedEntry = row.entry;
		}
		return this.scroll.handlePointer(snapshot);
	}
	private handleTranscriptKeyboard(input: PlayerInput): boolean {
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
			const row = transcript.rows.findIndex(row => row.entry === this.input.selectedEntry);
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
		if ((isCtrlDown(input) || isMetaDown(input)) && isKeyJustPressed('Enter', input)) { consumeIdeKey('Enter', input); this.execute('assistant.send'); return; }
		this.composer.handleKeyboard(input, this.clipboard);
	}
	public handleWheel(direction: number, steps: number, pointer: PointerSnapshot | null): void {
		if (pointer !== null) this.scroll.handleWheel(pointer, direction * steps * this.input.layout.rowHeight);
	}
}
