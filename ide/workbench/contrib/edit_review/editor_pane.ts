import type { RectBounds } from '../../../../machine/ts/common/rect';
import { create_rect_bounds, point_in_rect, write_rect_bounds } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { EditorCommandId } from '../../../common/commands';
import * as colors from '../../../common/constants';
import { truncateMeasuredText } from '../../../common/text';
import { showEditorMessage } from '../../../common/feedback_state';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import type { EditorTextModel } from '../../../editor/model/text_model';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import type { WorkspaceEditReviewInput } from './editor_input';
import { layoutEditReviewRows } from './projection';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import type { WorkbenchSurface } from '../../services/windows/model';
import { WorkbenchTooltip } from '../../ui/tooltip';
import { CodeEditorInput } from '../code_editor/editor_input';
import { sourceTabDescription } from '../../ui/tab/titles';
import type { PointerHoverTarget } from '../../../input/pointer/hover';
import type { DisposableStore } from '../../../common/lifecycle';

// Keep a short source line readable beside the preview, rather than wrapping a diff into fragments.
const REVIEW_READING_COLUMNS = 48;

/** Source review shares the ordinary authoring pause, without borrowing guest state. */
export class WorkspaceEditReviewPane extends WorkbenchViewEditorPane<WorkspaceEditReviewInput> implements PointerHoverTarget {
	public override get companionGameMinimumWidth(): number {
		return editorViewState.charAdvance * REVIEW_READING_COLUMNS + colors.SCROLLBAR_WIDTH + 8;
	}
	private readonly actions: WorkbenchActionBarControl;
	private readonly scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget);
	private readonly tooltip = new WorkbenchTooltip();
	private readonly headingBounds = create_rect_bounds();
	private headingHovered = false;
	private sourcePicker: DisposableStore | undefined;
	public constructor(private readonly group: EditorGroupView, private readonly quickInput: QuickInputController,
		contextMenu: ContextMenuController, surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface,
		private readonly workArea: Readonly<RectBounds>, scope: InputFocusScope) {
		super(scope);
		this.focusTarget.canFocus = this.scroll.focusTarget.canFocus = () => this.hasInput
			&& this.input.viewport.bounds.left < this.input.viewport.bounds.right && this.input.viewport.height > 0;
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget, () => this.focus(), contextMenu);
		this.actions.focusTarget.canFocus = () => this.hasInput && this.input.actionBar.bounds.left < this.input.actionBar.bounds.right
			&& this.input.actionBar.bounds.top < this.input.actionBar.bounds.bottom;
		this.actions.onDidOpenOverflow = lifetime => {
			this.tooltip.hide();
			lifetime.add({ dispose: this.input.proposal.onDidSettle(() => contextMenu.hide()) });
		};
		this.tooltip.attach(surfaces, owner, workArea);
		this.scroll.onWillScroll = edge => this.input.reading.noteUserScroll(edge);
		this.scroll.focusTarget.commandContext = this.focusTarget;
		this.scroll.focusTarget.next = this.actions.focusTarget;
		this.actions.focusTarget.previous = this.actions.focusTarget.next = () => this.focus();
		this.scroll.focusTarget.previous = this.actions.focusTarget;
		for (const command of ['workspaceEditReview.apply', 'workspaceEditReview.discard', 'workspaceEditReview.source', 'workspaceEditReview.impacts'] as const) {
			const implementation = { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) };
			this.focusTarget.registerCommand(command, implementation);
			this.scroll.focusTarget.registerCommand(command, implementation);
		}
	}
	public override get commandTarget(): InputFocusTarget { return this.scroll.focusTarget.canFocus!() ? this.scroll.focusTarget : this.actions.focusTarget; }
	protected override activate(): void {
		this.actions.setInput(this.input.actionBar, this.focusTarget);
		this.scroll.setInput(this.input.viewport);
		this.update();
	}
	public override clearInput(): void {
		if (this.hasInput) this.input.reading.capture(this.input.viewport, this.input.rows);
		if (this.sourcePicker !== undefined) this.quickInput.hide();
		this.tooltip.hide(); pointerHover.release(this); this.headingHovered = false;
		this.actions.clearInput(); this.scroll.clearInput(); super.clearInput();
	}
	public override dispose(): void {
		if (this.hasInput) this.input.reading.capture(this.input.viewport, this.input.rows);
		if (this.sourcePicker !== undefined) this.quickInput.hide();
		this.tooltip.detach(); pointerHover.release(this);
		this.actions.dispose(); this.scroll.dispose(); super.dispose();
	}
	public isEnabled(command: EditorCommandId): boolean {
		if (!this.hasInput) return false;
		if (command === 'workspaceEditReview.impacts') return this.input.evidence.items.length > 0;
		return this.input.proposal.state === 'pending' && (command === 'workspaceEditReview.apply' || command === 'workspaceEditReview.discard'
			|| command === 'workspaceEditReview.source' && this.input.evidence.items.length > 0);
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		if (command === 'workspaceEditReview.discard') { this.input.proposal.dispose(); return; }
		if (command === 'workspaceEditReview.source') { this.openImpactSource(this.input); return; }
		if (command === 'workspaceEditReview.impacts') {
			this.input.reading.goToLine(this.input.lines.find(line => line.part === 'impacts')!);
			this.input.reading.restore(this.input.viewport, this.input.rows, this.input.layout.rowHeight);
			this.focus(); return;
		}
		// Reveal the shared working copies; Apply and Save are separate user operations.
		void this.apply(this.input);
	}
	private openImpactSource(input: WorkspaceEditReviewInput): void {
		this.quickInput.pick('Impact Source', input.evidence.summary, () => {
			return new TextQuickPickProvider(input.evidence.items.map(item => ({ label: item.label, description: item.value,
				detail: `${sourceTabDescription(item.location.model.resource)} / v${item.location.version}\n${item.description}`, location: item.location })));
		}, item => {
			const { model, offset } = item.location, position = { row: 0, column: 0 };
			model.buffer.positionAt(offset, position);
			this.group.openEditor(new CodeEditorInput(model), {
				selection: { row: position.row, startColumn: position.column, endColumn: position.column },
			});
		}, lifetime => {
			this.sourcePicker = lifetime;
			lifetime.add({ dispose: () => { if (this.sourcePicker === lifetime) this.sourcePicker = undefined; } });
			lifetime.add({ dispose: input.proposal.onDidSettle(() => this.quickInput.hide()) });
		});
	}
	private reveal(models: readonly EditorTextModel[]): void {
		for (const model of models) this.group.openEditor(new CodeEditorInput(model));
	}
	private async apply(input: WorkspaceEditReviewInput): Promise<void> {
		try {
			const models = await input.proposal.apply();
			if (this.hasInput && this.input === input) this.reveal(models);
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
			layoutWorkbenchActionBar(actionBar, layout.right - 4, layout.top, Math.min(layout.bottom, layout.top + layout.rowHeight + 4), measureText, editorViewState.font.renderFont(), layout.left + 4);
			this.input.heading = truncateMeasuredText(this.input.proposal.title, actionBar.bounds.left - layout.left - 8, measureTextRange);
			write_rect_bounds(this.headingBounds, layout.left + 4, layout.top, actionBar.bounds.left - 4, Math.min(layout.bottom, layout.top + layout.rowHeight + 4));
			const textWidth = width - colors.SCROLLBAR_WIDTH - 8;
			const top = Math.min(layout.bottom, layout.top + layout.rowHeight * 2 + 12);
			if (textWidth > 0 && layout.bottom > top && (this.input.projectedWidth !== textWidth || this.input.projectedFont !== layout.font)) {
				layoutEditReviewRows(this.input, textWidth, measureTextRange);
				this.input.projectedWidth = textWidth;
				this.input.projectedFont = layout.font;
			}
			viewport.layout(layout.left + 4, top, layout.right, layout.bottom, this.input.rows.length * layout.rowHeight);
			this.input.reading.restore(viewport, this.input.rows, layout.rowHeight);
			this.scroll.lineStep = layout.rowHeight;
		}
		if (!this.scroll.focusTarget.canFocus!()) { this.scroll.cancelPointer(); this.scroll.focusTarget.release(); this.focusTarget.release(); }
		if (!this.actions.focusTarget.canFocus!()) {
			pointerCapture.cancelTarget(this.actions); pointerHover.release(this.actions); this.actions.focusTarget.release();
		}
		this.actions.update();
		const hint = this.actions.tooltipItem, font = editorViewState.font.renderFont();
		if (hint !== undefined) this.tooltip.show(hint.tooltip, hint.bounds, font, measureTextRange, measureText, this.workArea);
		else if (this.headingHovered && this.input.heading !== proposal.title)
			this.tooltip.show(proposal.title, this.headingBounds, font, measureTextRange, measureText, this.workArea);
		else this.tooltip.hide();
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
		if (this.actions.handlePointer(snapshot)) { pointerHover.release(this); return true; }
		this.headingHovered = snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.headingBounds);
		if (this.headingHovered) pointerHover.visit(this); else pointerHover.release(this);
		return this.headingHovered || this.scroll.handlePointer(snapshot);
	}
	public onPointerLeave(): void { this.headingHovered = false; this.tooltip.hide(); }
	public handleKeyboard(): void {}
	public handleWheel(event: WheelInputSnapshot): void {
		this.scroll.handleWheel(event, event.deltaY * this.input.layout.rowHeight);
	}
}
