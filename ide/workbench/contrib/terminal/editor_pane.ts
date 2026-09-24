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
import { consumeIdeKey, isCtrlDown, isKeyJustPressed, isMetaDown, isShiftDown, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { PointerButton } from '../../../input/pointer/buttons';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { TerminalInput } from './editor_input';

const COMMANDS = ['terminal.evaluate', 'terminal.pause', 'terminal.continue', 'terminal.clear', 'terminal.copy'] as const;

export class TerminalPane extends FullWidthWorkbenchEditorPane<TerminalInput> {
	private readonly actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget);
	private readonly scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget, input => this.handleTranscriptKeyboard(input));
	private readonly composer = new MultilineFieldControl();
	private unbindDraft: (() => void) | undefined;
	private status = '';
	public constructor(resources: ResourcePanelController, private readonly clipboard: Clipboard) {
		super(resources);
		this.scroll.focusTarget.commandContext = this.focusTarget;
		for (const command of COMMANDS) this.focusTarget.registerCommand(command, { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) });
	}
	public override focus(): void { this.input.draft.focusTarget.focus(); }
	protected override activate(): void {
		super.activate();
		this.actions.setInput(this.input.actions, this.focusTarget);
		this.scroll.setInput(this.input.viewport);
		this.composer.setInput(this.input.draft, this.input.composer, this.input.composerBounds);
		this.unbindDraft = this.input.draft.focusTarget.bindKeyboard(input => this.handleKeyboard(input));
		const ring = [this.input.draft.focusTarget, this.actions.focusTarget, this.scroll.focusTarget];
		for (let index = 0; index < ring.length; index++) {
			ring[index].next = ring[(index + 1) % ring.length]; ring[index].previous = ring[(index + ring.length - 1) % ring.length];
		}
		for (const command of COMMANDS) this.input.draft.focusTarget.registerCommand(command, { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) });
		this.update();
	}
	public override clearInput(): void {
		this.unbindDraft?.(); this.unbindDraft = undefined;
		this.composer.clearInput(); this.actions.clearInput(); this.scroll.clearInput();
		super.clearInput();
	}
	public override dispose(): void { this.clearInput(); this.actions.dispose(); this.scroll.dispose(); super.dispose(); }
	public isEnabled(command: EditorCommandId): boolean {
		const { session, selectedEntry, draftHasText } = this.input;
		switch (command) {
			case 'terminal.evaluate': return session.canEvaluate && draftHasText;
			case 'terminal.pause': return session.canToggleExecution && !session.paused;
			case 'terminal.continue': return session.canToggleExecution && session.paused;
			case 'terminal.clear': return session.transcript.next > session.transcript.start;
			case 'terminal.copy': return selectedEntry >= session.transcript.start && selectedEntry < session.transcript.next;
			default: return false;
		}
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		const input = this.input, { session } = input;
		switch (command) {
			case 'terminal.evaluate':
				session.evaluate(input.draft.text); setFieldText(input.draft, '', true); input.draftHasText = false;
				input.historyIndex = -1; input.savedDraft = ''; input.draft.focusTarget.focus(); break;
			case 'terminal.pause': case 'terminal.continue': session.toggleExecution(); break;
			case 'terminal.clear': session.transcript.clear(); input.selectedEntry = -1; break;
			case 'terminal.copy': void writeClipboard(this.clipboard, session.transcript.entry(input.selectedEntry).text, 'Copied terminal entry'); break;
		}
	}
	public override update(): void {
		const input = this.input, { layout, viewport, session } = input;
		const changed = updateFullWidthWorkbenchLayout(layout), row = layout.rowHeight;
		if (changed) {
			write_rect_bounds(input.composerBounds, 4, layout.bottom - row * 5 - 10, layout.right - 4, layout.bottom - row - 6);
			this.scroll.lineStep = row; this.composer.rowHeight = editorViewState.lineHeight;
		}
		const status = session.active !== undefined ? session.paused ? 'Lua call paused. Mutations are retained.' : 'Executing Lua on the guest CPU...'
			: session.canEvaluate ? 'Lua session | own namespace, not cart globals' : 'Lua unavailable: start/resume cart or finish machine operation';
		if (changed || status !== this.status) { this.status = status; input.status = truncateMeasuredText(status, layout.right - 8, measureTextRange); }
		if (changed || session.transcript.revision !== input.projectedRevision) {
			input.projectedRevision = session.transcript.revision;
			const atEnd = viewport.scrollTop + viewport.height >= viewport.contentHeight;
			input.transcript.update(session.transcript, layout.right - colors.SCROLLBAR_WIDTH - 8, layout.font!, measureTextRange);
			viewport.layout(4, layout.top + row * 2 + 8, layout.right, input.composerBounds.top - 4, input.transcript.rows.length * row);
			if (atEnd) viewport.scrollbar.setScroll(viewport.contentHeight);
			if (input.selectedEntry < session.transcript.start) input.selectedEntry = -1;
		}
		input.composer.update(input.draft, input.composerBounds.right - input.composerBounds.left - 6 - editorViewState.spaceAdvance,
			Math.trunc((input.composerBounds.bottom - input.composerBounds.top - 4) / editorViewState.lineHeight), measureTextRange, layout.font!);
		let actionsChanged = changed;
		for (const item of input.actions.items) {
			const visible = item.command === 'terminal.evaluate' ? session.active === undefined
				: session.active !== undefined && (item.command === 'terminal.pause' ? !session.paused : session.paused);
			if (item.visible !== visible) { item.visible = visible; actionsChanged = true; }
		}
		if (actionsChanged) layoutWorkbenchActionBar(input.actions, layout.right - 4, layout.bottom - row - 4, layout.bottom, measureText);
		this.actions.update(); this.scroll.update();
	}
	public draw(): void {
		const input = this.input, { layout, viewport } = input, font = editorViewState.font.renderFont();
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		renderWorkbenchActionBar(input.actions, this, font);
		api.blit_text_inline_with_font(input.status, 4, layout.top + 2, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		api.blit_text_inline_with_font('Enter: run | Shift+Enter: newline | Up/Down: history', 4, layout.top + layout.rowHeight + 6, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		api.pushClipRect(viewport.bounds.left, viewport.bounds.top, viewport.bounds.right, viewport.bounds.bottom);
		const rows = input.transcript.rows;
		for (let index = Math.trunc(viewport.scrollTop / layout.rowHeight), top = viewport.offsetTop + index * layout.rowHeight;
			index < rows.length && top < viewport.bounds.bottom; index++, top += layout.rowHeight) {
			const row = rows[index];
			if (row.entry === input.selectedEntry) api.fill_rect(4, top, viewport.bounds.right, top + layout.rowHeight, 0, colors.SELECTION_OVERLAY);
			api.blit_text_inline_with_font(row.text, 4, top, 0, row.entry === input.selectedEntry ? colors.COLOR_SELECTION_TEXT
				: row.kind === 'error' ? colors.COLOR_STATUS_ERROR : row.kind === 'input' ? colors.COLOR_STATUS_SUCCESS : colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		}
		api.popClipRect(); viewport.scrollbar.draw(colors.COLOR_CODE_BACKGROUND, colors.COLOR_RESOURCE_VIEWER_TEXT);
		const bounds = input.composerBounds;
		api.blit_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_RESOURCE_VIEWER_TEXT);
		drawMultilineField(input.draft, input.composer, bounds);
	}
	public drawStatusBar(top: number, color: number): void {
		api.blit_text_inline_with_font('Lua load subset | locals last one input | Ctrl+L: clear output', 4, top + 2, 0, color, editorViewState.font.renderFont());
	}
	protected override handleViewPointer(snapshot: PointerSnapshot): boolean {
		if (this.actions.handlePointer(snapshot) || this.composer.handlePointer(snapshot)) return true;
		if ((snapshot.justPressedButtons & PointerButton.Primary) !== 0 && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.viewport.bounds)) {
			const row = this.input.transcript.rows[Math.trunc((snapshot.viewportY - this.input.viewport.offsetTop) / this.input.layout.rowHeight)];
			if (row) this.input.selectedEntry = row.entry;
		}
		return this.scroll.handlePointer(snapshot);
	}
	private handleTranscriptKeyboard(input: PlayerInput): boolean {
		if ((isCtrlDown(input) || isMetaDown(input)) && isKeyJustPressed('KeyL', input)) {
			consumeIdeKey('KeyL', input); this.execute('terminal.clear'); return true;
		}
		if ((isCtrlDown(input) || isMetaDown(input)) && isKeyJustPressed('KeyC', input)) {
			consumeIdeKey('KeyC', input); this.execute('terminal.copy'); return true;
		}
		for (const key of ['ArrowUp', 'ArrowDown'] as const) {
			if (!shouldRepeatKeyFromPlayer(key, input)) continue;
			consumeIdeKey(key, input);
			const view = this.input, transcript = view.session.transcript;
			if (transcript.start === transcript.next) return true;
			view.selectedEntry = Math.max(transcript.start, Math.min(transcript.next - 1,
				view.selectedEntry === -1 ? transcript.start : view.selectedEntry + (key === 'ArrowUp' ? -1 : 1)));
			const row = view.transcript.rows.findIndex(row => row.entry === view.selectedEntry), top = row * view.layout.rowHeight;
			if (top < view.viewport.scrollTop) view.viewport.scrollbar.setScroll(top);
			else if (top + view.layout.rowHeight > view.viewport.scrollTop + view.viewport.height) view.viewport.scrollbar.setScroll(top + view.layout.rowHeight - view.viewport.height);
			return true;
		}
		return false;
	}
	public handleKeyboard(input: PlayerInput): void {
		if (!this.input.draft.focusTarget.hasFocus) return;
		if ((isCtrlDown(input) || isMetaDown(input)) && isKeyJustPressed('KeyL', input)) { consumeIdeKey('KeyL', input); this.execute('terminal.clear'); return; }
		if (!isShiftDown(input) && shouldRepeatKeyFromPlayer('Enter', input)) {
			const submitted = isKeyJustPressed('Enter', input);
			consumeIdeKey('Enter', input); if (submitted) this.execute('terminal.evaluate'); return;
		}
		const view = this.input, { draft, session } = view;
		if (!isShiftDown(input) && !isCtrlDown(input) && !isMetaDown(input) && draft.selectionAnchor === null) {
			for (const key of ['ArrowUp', 'ArrowDown'] as const) {
				if (!shouldRepeatKeyFromPlayer(key, input) || session.history.length === 0
					|| (key === 'ArrowUp' ? draft.cursorRow !== 0 : draft.cursorRow !== draft.lines.length - 1)) continue;
				consumeIdeKey(key, input);
				if (view.historyIndex === -1) { view.savedDraft = draft.text; view.historyIndex = session.history.length; }
				view.historyIndex = Math.max(0, Math.min(session.history.length, view.historyIndex + (key === 'ArrowUp' ? -1 : 1)));
				setFieldText(draft, view.historyIndex === session.history.length ? view.savedDraft : session.history[view.historyIndex], true);
				view.draftHasText = draft.text.trim().length > 0;
				return;
			}
		}
		this.composer.handleKeyboard(input, this.clipboard);
	}
	public handleWheel(direction: number, steps: number, pointer: PointerSnapshot | null): void {
		if (pointer !== null) this.scroll.handleWheel(pointer, direction * steps * this.input.layout.rowHeight);
	}
}
