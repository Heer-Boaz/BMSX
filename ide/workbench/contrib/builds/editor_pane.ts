import { STATUS_PRIORITY_CONTENT, type WorkbenchStatusItem } from '../../common/status_bar';
import type { Clipboard } from '../../../../hosts/common/clipboard';
import { create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandId } from '../../../common/commands';
import * as colors from '../../../common/constants';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusScope } from '../../../input/focus';
import { writeClipboard } from '../../../input/clipboard';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WorkbenchTextViewControl } from '../../ui/text_view/control';
import type { WorkbenchTextViewModel } from '../../ui/text_view/model';
import { WorkbenchTooltip } from '../../ui/tooltip';
import type { BuildLogInput } from './editor_input';
import type { BuildLogViewModel } from './view_model';

const ACTIONS = ['buildLog.error', 'buildLog.output', 'buildLog.refresh', 'buildLog.copyAll'] as const;

/** Captured stdout/stderr and a failure diagnostic are separate documents of the same request. */
export class BuildLogPane extends WorkbenchViewEditorPane<BuildLogInput> {
	public readonly statusItems: readonly WorkbenchStatusItem[] = [
		{ text: '', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' },
	];
	private readonly reading = new WorkbenchTextViewControl(this.focusTarget);
	private readonly actions: WorkbenchActionBarControl;
	private readonly tooltip = new WorkbenchTooltip();
	private readonly bodyBounds = create_rect_bounds();
	private attachedDocument: WorkbenchTextViewModel | undefined;
	private attachedView: BuildLogViewModel | undefined;
	private renderedRevision = -1;
	private heading = '';
	private statusView: BuildLogViewModel | undefined;
	private statusRevision = -1;
	private unbindDocument: (() => void) | undefined;

	public constructor(private readonly clipboard: Clipboard, contextMenu: ContextMenuController,
		surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>, scope: InputFocusScope) {
		super(scope);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget, () => this.focus(), contextMenu);
		this.actions.onDidOpenOverflow = () => this.tooltip.hide();
		this.tooltip.attach(surfaces, owner, workArea);
		for (const target of [this.focusTarget, this.reading.focusTarget, this.reading.findField.focusTarget]) {
			for (const command of ACTIONS) target.registerCommand(command, { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) });
		}
		for (const target of [this.focusTarget, this.actions.focusTarget]) for (const command of ['text.find', 'text.findNext', 'text.findPrevious'] as const)
			target.registerCommand(command, this.reading.focusTarget.getCommand(command)!);
		this.reading.focusTarget.next = this.actions.focusTarget;
		this.reading.focusTarget.previous = this.actions.focusTarget;
		this.actions.focusTarget.previous = this.reading.focusTarget;
		this.actions.focusTarget.next = this.reading.focusTarget;
	}

	public override get commandTarget() { return this.reading.focusTarget; }
	protected override activate(): void {
		const view = this.input.view;
		this.actions.setInput(view.actions, this.focusTarget);
		this.unbindDocument = view.onDidChangeDocument(document => {
			this.attachedDocument = document;
			this.reading.setInput(document);
			if (this.hasInput && this.input.view === view) this.reading.update(this.bodyBounds, editorViewState.font, view.layout.rowHeight);
		});
		this.update();
	}
	public override clearInput(): void {
		this.unbindDocument?.(); this.unbindDocument = undefined;
		this.tooltip.hide(); this.actions.clearInput(); this.reading.clearInput();
		this.attachedDocument = undefined; this.attachedView = undefined; this.renderedRevision = -1;
		super.clearInput();
	}
	public override dispose(): void {
		this.unbindDocument?.(); this.unbindDocument = undefined;
		this.tooltip.detach(); this.actions.dispose(); this.reading.dispose(); super.dispose();
	}

	public isEnabled(command: EditorCommandId): boolean {
		if (!this.hasInput) return false;
		const view = this.input.view;
		switch (command) {
			case 'buildLog.refresh': return !view.result.isDisposed && !view.result.loading;
			case 'buildLog.error': return view.error !== undefined;
			case 'buildLog.output': return true;
			case 'buildLog.copyAll': return view.document.buffer.length !== 0;
			default: return false;
		}
	}
	public isActive(command: EditorCommandId): boolean {
		return this.hasInput && (command === 'buildLog.error' && this.input.view.channel === 'error'
			|| command === 'buildLog.output' && this.input.view.channel === 'output');
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		const view = this.input.view;
		if (command === 'buildLog.refresh') { void view.result.refresh(); return; }
		if (command === 'buildLog.copyAll') {
			void writeClipboard(this.clipboard, view.document.buffer.getText(), 'Copied build document.');
			return;
		}
		const channel = command === 'buildLog.error' ? 'error' : 'output';
		view.channel = channel;
		this.update(); this.focus();
	}

	public override update(): void {
		const view = this.input.view, layout = view.layout;
		const changed = updateFullWidthWorkbenchLayout(layout, this.contentBounds);
		const attached = this.attachedView !== view;
		if (this.attachedDocument !== view.document) {
			this.attachedDocument = view.document; this.reading.setInput(view.document);
		}
		if (changed || attached || this.renderedRevision !== view.revision) {
			this.attachedView = view; this.renderedRevision = view.revision;
			for (const item of view.actions.items) item.checked = this.isActive(item.command);
			layoutWorkbenchActionBar(view.actions, layout.right - 4, layout.top + 2, layout.top + layout.rowHeight + 8,
				measureText, editorViewState.font.renderFont(), layout.left + 4);
			const recipe = `${view.result.job.request.debug ? 'Debug' : 'Release'} -O${view.result.job.request.optLevel}`;
			this.heading = measureText(recipe) <= view.actions.bounds.left - layout.left - 12 ? recipe : '';
			write_rect_bounds(this.bodyBounds, layout.left, Math.min(layout.bottom, layout.top + layout.rowHeight + 12), layout.right, layout.bottom);
		}
		this.reading.update(this.bodyBounds, editorViewState.font, layout.rowHeight);
		this.actions.update();
		const item = this.actions.tooltipItem;
		if (item !== undefined) this.tooltip.show(item.tooltip, item.bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.tooltip.hide();
	}
	public draw(): void {
		const view = this.input.view, { layout, actions, result } = view;
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		api.blit_text_inline_with_font(this.heading, layout.left + 4, layout.top + 4, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, editorViewState.font.renderFont());
		renderWorkbenchActionBar(actions, editorViewState.font.renderFont(), colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
		this.reading.draw();
		if (view.channel === 'output' && view.document.buffer.length === 0) {
			const bounds = view.document.viewport.bounds;
			const text = result.outputText === undefined
				? result.loading ? 'Loading…' : 'Unavailable' : 'No output';
			api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
			api.blit_text_inline_with_font(text, bounds.left + 4, bounds.top + 4, 0, colors.COLOR_DESCRIPTION_TEXT, editorViewState.font.renderFont());
			api.popClipRect();
		}
	}
	public updateStatus(): void {
		const view = this.input.view, result = view.result;
		if (this.statusView === view && this.statusRevision === view.revision) return;
		this.statusView = view; this.statusRevision = view.revision;
		this.statusItems[0].text = result.readError === undefined
			? `${view.channel === 'error' ? 'Failure diagnostic' : 'Captured output'} | ${result.loading ? 'Reading snapshot…' : result.job.state}`
			: `Read failed: ${result.readError}`;
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot): boolean {
		return this.actions.handlePointer(snapshot) || this.reading.handlePointer(snapshot);
	}
	public handleKeyboard(): void {}
	public handleWheel(event: WheelInputSnapshot): void { this.reading.handleWheel(event, event.deltaY * this.input.view.layout.rowHeight); }
}
