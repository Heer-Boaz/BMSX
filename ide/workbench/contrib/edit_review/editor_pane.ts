import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
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
import type { EditorTextModel } from '../../../editor/model/text_model';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { WorkspaceEditReviewInput } from './editor_input';
import { layoutEditReviewRows } from './projection';

// Keep a short source line readable beside the preview, rather than wrapping a diff into fragments.
const REVIEW_READING_COLUMNS = 48;

/** Source review shares the ordinary authoring pause, without borrowing guest state. */
export class WorkspaceEditReviewPane extends FullWidthWorkbenchEditorPane<WorkspaceEditReviewInput> {
	public override get companionGameMinimumWidth(): number {
		return editorViewState.charAdvance * REVIEW_READING_COLUMNS + colors.SCROLLBAR_WIDTH + 8;
	}
	private readonly actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget, () => this.focus());
	private readonly scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget);
	public constructor(resourcePanel: ResourcePanelController, private readonly reveal: (models: readonly EditorTextModel[]) => void) {
		super(resourcePanel);
		this.scroll.onWillScroll = edge => this.input.reading.noteUserScroll(edge);
		this.scroll.focusTarget.commandContext = this.focusTarget;
		this.scroll.focusTarget.next = this.actions.focusTarget;
		this.actions.focusTarget.previous = this.scroll.focusTarget;
		this.actions.focusTarget.next = this.scroll.focusTarget;
		this.scroll.focusTarget.previous = this.actions.focusTarget;
		for (const command of ['workspaceEditReview.apply', 'workspaceEditReview.discard'] as const) {
			const implementation = { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) };
			this.focusTarget.registerCommand(command, implementation);
			this.scroll.focusTarget.registerCommand(command, implementation);
		}
	}
	public override focus(): void { this.scroll.focusTarget.focus(); }
	protected override activate(): void {
		super.activate();
		this.actions.setInput(this.input.actionBar, this.focusTarget);
		this.scroll.setInput(this.input.viewport);
		this.update();
	}
	public override clearInput(): void {
		if (this.hasInput) this.input.reading.capture(this.input.viewport, this.input.rows);
		this.actions.clearInput(); this.scroll.clearInput(); super.clearInput();
	}
	public override dispose(): void {
		if (this.hasInput) this.input.reading.capture(this.input.viewport, this.input.rows);
		this.actions.dispose(); this.scroll.dispose(); super.dispose();
	}
	public isEnabled(command: EditorCommandId): boolean {
		return this.hasInput && (command === 'workspaceEditReview.apply' || command === 'workspaceEditReview.discard') && this.input.proposal.state === 'pending';
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		if (command === 'workspaceEditReview.discard') { this.input.proposal.dispose(); return; }
		// Reveal the shared working copies; Apply and Save are separate user operations.
		void this.apply(this.input);
	}
	private async apply(input: WorkspaceEditReviewInput): Promise<void> {
		if (input.proposal.kind === 'edit') this.reveal(input.proposal.files.flatMap(file => file.kind === 'edit' ? [file.model] : []));
		try {
			const models = await input.proposal.apply();
			// Creating a file is an explicit filesystem edit; editing an existing file is not.
			if (input.proposal.kind === 'create') this.reveal(models);
		} catch (error) {
			showEditorMessage(error instanceof Error ? error.message : String(error), 'warning', 4);
		}
	}
	public override update(): void {
		const { layout, actionBar, viewport } = this.input;
		const changed = updateFullWidthWorkbenchLayout(layout, this.contentBounds);
		const width = layout.right - layout.left;
		const proposal = this.input.proposal;
		if (changed || this.input.renderedState !== proposal.state) {
			this.input.renderedState = proposal.state;
			this.input.status = truncateMeasuredText(`${proposal.files.length} ${proposal.files.length === 1 ? 'file' : 'files'} | ${proposal.state === 'pending' ? proposal.kind === 'create' ? 'Pending - Apply creates the source file' : 'Pending - Apply edits working copies; Save is separate'
				: proposal.state === 'applied' ? proposal.kind === 'create' ? 'New source created and saved - not installed'
					: 'Applied to working copies - Undo in either source view'
					: proposal.state === 'stale' || proposal.state === 'failed' ? `${proposal.state}: ${proposal.reason}` : 'Discarded - no source changes'}`, width - 8, measureTextRange);
		}
		if (changed) {
			this.input.reading.capture(viewport, this.input.rows);
			layoutWorkbenchActionBar(actionBar, layout.right - 4, layout.top, layout.top + layout.rowHeight + 4, measureText, editorViewState.font.renderFont(), layout.left + 4);
			this.input.heading = truncateMeasuredText(this.input.proposal.title, actionBar.items[0].bounds.left - layout.left - 8, measureTextRange);
			const textWidth = width - colors.SCROLLBAR_WIDTH - 8;
			if (this.input.projectedWidth !== textWidth || this.input.projectedFont !== layout.font) {
				layoutEditReviewRows(this.input, textWidth, measureTextRange);
				this.input.projectedWidth = textWidth;
				this.input.projectedFont = layout.font;
			}
			viewport.layout(layout.left + 4, Math.min(layout.bottom, layout.top + layout.rowHeight * 2 + 12), layout.right, layout.bottom, this.input.rows.length * layout.rowHeight);
			this.input.reading.restore(viewport, this.input.rows, layout.rowHeight);
			this.scroll.lineStep = layout.rowHeight;
		}
		this.actions.update();
	}
	public draw(): void {
		const { layout, actionBar, viewport, rows } = this.input;
		const font = editorViewState.font.renderFont();
		const textLeft = layout.left + 4;
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		renderWorkbenchActionBar(actionBar, font, colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
		api.blit_text_inline_with_font(this.input.heading, textLeft, layout.top + 2, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		api.blit_text_inline_with_font(this.input.status, textLeft, layout.top + layout.rowHeight + 6, 0,
			this.input.proposal.state === 'stale' || this.input.proposal.state === 'failed' ? colors.COLOR_INSPECTOR_WARNING_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		api.pushClipRect(viewport.bounds.left, viewport.bounds.top, viewport.bounds.right, viewport.bounds.bottom);
		let index = Math.trunc(viewport.scrollTop / layout.rowHeight);
		let top = viewport.offsetTop + index * layout.rowHeight;
		for (; index < rows.length && top < viewport.bounds.bottom; index++, top += layout.rowHeight) {
			const row = rows[index];
			if (row.kind !== 'header') api.fill_rect(viewport.bounds.left, top, viewport.bounds.right, top + layout.rowHeight, 0,
				row.kind === 'before' ? colors.COLOR_DIFF_REMOVED_BACKGROUND : colors.COLOR_DIFF_INSERTED_BACKGROUND);
			api.blit_text_inline_with_font(row.text, textLeft, top, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		}
		api.popClipRect();
		viewport.scrollbar.draw(colors.COLOR_CODE_BACKGROUND, colors.COLOR_RESOURCE_VIEWER_TEXT);
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		api.blit_text_inline_with_font('Tab: actions | Up/Down, Page Up/Down: scroll | Ctrl+W: close',
			bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont());
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot): boolean {
		return this.actions.handlePointer(snapshot) || this.scroll.handlePointer(snapshot);
	}
	public handleKeyboard(): void {}
	public handleWheel(event: WheelInputSnapshot): void {
		this.scroll.handleWheel(event, event.deltaY * this.input.layout.rowHeight);
	}
}
