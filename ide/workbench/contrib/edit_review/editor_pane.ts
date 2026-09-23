import type { PointerSnapshot } from '../../../common/models';
import type { EditorCommandId } from '../../../common/commands';
import * as colors from '../../../common/constants';
import { truncateMeasuredText } from '../../../common/text';
import { showEditorMessage } from '../../../common/feedback_state';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus } from '../../../input/focus';
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
import type { WorkspaceEditReviewInput } from './editor_input';
import { layoutEditReviewRows } from './projection';

/** Host source review does not borrow suspended guest state or hold execution. */
export class WorkspaceEditReviewPane extends FullWidthWorkbenchEditorPane<WorkspaceEditReviewInput> {
	private readonly actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget);
	private readonly scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget);
	public constructor(resourcePanel: ResourcePanelController) {
		super(resourcePanel);
		this.scroll.focusTarget.commandContext = this.focusTarget;
		this.scroll.focusTarget.next = this.actions.focusTarget;
		this.actions.focusTarget.previous = this.scroll.focusTarget;
		this.actions.focusTarget.next = this.scroll.focusTarget;
		this.scroll.focusTarget.previous = this.actions.focusTarget;
		for (const command of ['workspaceEditReview.apply', 'workspaceEditReview.discard'] as const) {
			this.focusTarget.registerCommand(command, { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) });
		}
	}
	public override get suspendsRuntime(): boolean { return false; }
	public override focus(): void { this.scroll.focusTarget.focus(); }
	protected override activate(): void {
		super.activate();
		this.actions.setInput(this.input.actionBar, this.focusTarget);
		this.scroll.setInput(this.input.viewport);
		this.update();
	}
	public override clearInput(): void { this.actions.clearInput(); this.scroll.clearInput(); super.clearInput(); }
	public override dispose(): void { this.actions.dispose(); this.scroll.dispose(); super.dispose(); }
	public isEnabled(command: EditorCommandId): boolean {
		return (command === 'workspaceEditReview.apply' || command === 'workspaceEditReview.discard') && this.input.proposal.state === 'pending';
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		if (command === 'workspaceEditReview.discard') this.input.proposal.dispose();
		else {
			try { this.input.proposal.apply(); }
			catch (error) { showEditorMessage(error instanceof Error ? error.message : String(error), colors.COLOR_STATUS_WARNING, 4); }
		}
	}
	public override update(): void {
		const { layout, actionBar, viewport } = this.input;
		const changed = updateFullWidthWorkbenchLayout(layout);
		const proposal = this.input.proposal;
		if (changed || this.input.renderedState !== proposal.state) {
			this.input.renderedState = proposal.state;
			this.input.status = truncateMeasuredText(`${proposal.files.length} files | ${proposal.state === 'pending' ? 'Pending - Apply does not save or install'
				: proposal.state === 'applied' ? 'Applied - Undo in either source view'
				: proposal.state === 'stale' || proposal.state === 'failed' ? `${proposal.state}: ${proposal.reason}` : 'Discarded - no source changes'}`, layout.right - 8, measureTextRange);
		}
		if (changed) {
			layoutWorkbenchActionBar(actionBar, layout.right - 4, layout.top, layout.top + layout.rowHeight + 4, measureText);
			this.input.heading = truncateMeasuredText(this.input.proposal.title, actionBar.items[0].bounds.left - 8, measureTextRange);
			if (this.input.projectedWidth !== layout.right || this.input.projectedFont !== layout.font) {
				layoutEditReviewRows(this.input, layout.right - colors.SCROLLBAR_WIDTH - 8, measureTextRange);
				this.input.projectedWidth = layout.right;
				this.input.projectedFont = layout.font;
			}
			viewport.layout(4, layout.top + layout.rowHeight * 2 + 12, layout.right, layout.bottom, this.input.rows.length * layout.rowHeight);
			this.scroll.lineStep = layout.rowHeight;
		}
		this.actions.update(); this.scroll.update();
	}
	public draw(): void {
		const { layout, actionBar, viewport, rows } = this.input;
		const font = editorViewState.font.renderFont();
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		renderWorkbenchActionBar(actionBar, this, font);
		api.blit_text_inline_with_font(this.input.heading, 4, layout.top + 2, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		api.blit_text_inline_with_font(this.input.status, 4, layout.top + layout.rowHeight + 6, 0,
			this.input.proposal.state === 'stale' || this.input.proposal.state === 'failed' ? colors.COLOR_STATUS_WARNING : colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		api.pushClipRect(viewport.bounds.left, viewport.bounds.top, viewport.bounds.right, viewport.bounds.bottom);
		let index = Math.trunc(viewport.scrollTop / layout.rowHeight);
		let top = viewport.offsetTop + index * layout.rowHeight;
		for (; index < rows.length && top < viewport.bounds.bottom; index++, top += layout.rowHeight) {
			const row = rows[index];
			api.blit_text_inline_with_font(row.text, 4, top, 0, row.kind === 'before' ? colors.COLOR_STATUS_WARNING
				: row.kind === 'after' ? colors.COLOR_STATUS_SUCCESS : colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		}
		api.popClipRect();
		viewport.scrollbar.draw(colors.COLOR_CODE_BACKGROUND, colors.COLOR_RESOURCE_VIEWER_TEXT);
	}
	public drawStatusBar(top: number, color: number): void {
		api.blit_text_inline_with_font('Tab: actions | Up/Down, Page Up/Down: scroll | Ctrl+W: close',
			4, top + 2, 0, color, editorViewState.font.renderFont());
	}
	protected override handleViewPointer(snapshot: PointerSnapshot): boolean {
		return this.actions.handlePointer(snapshot) || this.scroll.handlePointer(snapshot);
	}
	public handleKeyboard(): void {}
	public handleWheel(direction: number, steps: number, pointer: PointerSnapshot | null): void {
		if (pointer !== null) this.scroll.handleWheel(pointer, direction * steps * this.input.layout.rowHeight);
	}
}
