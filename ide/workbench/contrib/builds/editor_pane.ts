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
	private attachedInput: BuildLogInput | undefined;
	private renderedRevision = -1;
	private heading = '';
	private statusInput: BuildLogInput | undefined;
	private statusRevision = -1;

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
		this.actions.setInput(this.input.actions, this.focusTarget);
		this.update();
	}
	public override clearInput(): void {
		this.tooltip.hide(); this.actions.clearInput(); this.reading.clearInput();
		this.attachedDocument = undefined; this.attachedInput = undefined; this.renderedRevision = -1;
		super.clearInput();
	}
	public override dispose(): void { this.tooltip.detach(); this.actions.dispose(); this.reading.dispose(); super.dispose(); }

	public isEnabled(command: EditorCommandId): boolean {
		if (!this.hasInput) return false;
		switch (command) {
			case 'buildLog.refresh': return !this.input.loading;
			case 'buildLog.error': return this.input.error !== undefined;
			case 'buildLog.output': return true;
			case 'buildLog.copyAll': return this.input.document.buffer.length !== 0;
			default: return false;
		}
	}
	public isActive(command: EditorCommandId): boolean {
		return this.hasInput && (command === 'buildLog.error' && this.input.channel === 'error'
			|| command === 'buildLog.output' && this.input.channel === 'output');
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		if (command === 'buildLog.refresh') { void this.input.refresh(); return; }
		if (command === 'buildLog.copyAll') {
			void writeClipboard(this.clipboard, this.input.document.buffer.getText(), 'Copied build document.');
			return;
		}
		const channel = command === 'buildLog.error' ? 'error' : 'output';
		if (this.input.channel !== channel) { this.input.channel = channel; this.input.revision++; }
		this.update(); this.focus();
	}

	public override update(): void {
		const input = this.input, layout = input.layout;
		const changed = updateFullWidthWorkbenchLayout(layout, this.contentBounds);
		const attached = this.attachedInput !== input;
		if (this.attachedDocument !== input.document) {
			this.attachedDocument = input.document; this.reading.setInput(input.document);
		}
		if (changed || attached || this.renderedRevision !== input.revision) {
			this.attachedInput = input; this.renderedRevision = input.revision;
			for (const item of input.actions.items) item.checked = this.isActive(item.command);
			layoutWorkbenchActionBar(input.actions, layout.right - 4, layout.top + 2, layout.top + layout.rowHeight + 8,
				measureText, editorViewState.font.renderFont(), layout.left + 4);
			const recipe = `${input.job.request.debug ? 'Debug' : 'Release'} -O${input.job.request.optLevel}`;
			this.heading = measureText(recipe) <= input.actions.bounds.left - layout.left - 12 ? recipe : '';
			write_rect_bounds(this.bodyBounds, layout.left, Math.min(layout.bottom, layout.top + layout.rowHeight + 12), layout.right, layout.bottom);
		}
		this.reading.update(this.bodyBounds, editorViewState.font, layout.rowHeight);
		this.actions.update();
		const item = this.actions.tooltipItem;
		if (item !== undefined) this.tooltip.show(item.tooltip, item.bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.tooltip.hide();
	}
	public draw(): void {
		const { layout, actions } = this.input;
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		api.blit_text_inline_with_font(this.heading, layout.left + 4, layout.top + 4, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, editorViewState.font.renderFont());
		renderWorkbenchActionBar(actions, editorViewState.font.renderFont(), colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
		this.reading.draw();
		if (this.input.channel === 'output' && this.input.document.buffer.length === 0) {
			const bounds = this.input.document.viewport.bounds;
			const text = this.input.outputText === undefined
				? this.input.loading ? 'Loading…' : 'Unavailable' : 'No output';
			api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
			api.blit_text_inline_with_font(text, bounds.left + 4, bounds.top + 4, 0, colors.COLOR_DESCRIPTION_TEXT, editorViewState.font.renderFont());
			api.popClipRect();
		}
	}
	public updateStatus(): void {
		const input = this.input;
		if (this.statusInput === input && this.statusRevision === input.revision) return;
		this.statusInput = input; this.statusRevision = input.revision;
		this.statusItems[0].text = input.readError === undefined
			? `${input.channel === 'error' ? 'Failure diagnostic' : 'Captured output'} | ${input.loading ? 'Reading snapshot…' : input.job.state}`
			: `Read failed: ${input.readError}`;
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot): boolean {
		return this.actions.handlePointer(snapshot) || this.reading.handlePointer(snapshot);
	}
	public handleKeyboard(): void {}
	public handleWheel(event: WheelInputSnapshot): void { this.reading.handleWheel(event, event.deltaY * this.input.layout.rowHeight); }
}
