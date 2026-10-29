import { STATUS_PRIORITY_CONTENT, type WorkbenchStatusItem } from '../../common/status_bar';
import type { Clipboard } from '../../../../hosts/common/clipboard';
import { copy_rect_bounds, create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandId } from '../../../common/commands';
import * as colors from '../../../common/constants';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { truncateMeasuredText } from '../../../common/text';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../../../input/focus';
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
import { WorkbenchTextViewControl } from '../../ui/text_view/control';
import type { WorkbenchTextViewModel } from '../../ui/text_view/model';
import { WorkbenchTooltip } from '../../ui/tooltip';
import type { BuildLogViewModel } from './view_model';

const ACTIONS = ['buildLog.error', 'buildLog.output', 'buildLog.refresh', 'buildLog.copyAll'] as const;

/** Captured stdout/stderr and a failure diagnostic are separate documents of the same request. */
export class BuildLogControl {
	public readonly scope: InputFocusScope;
	private readonly focusTarget: InputFocusTarget;
	private readonly surface: WorkbenchSurface;
	private attachedValue = false;
	private attachmentRevision = 0;
	private view: BuildLogViewModel | undefined;
	private readonly bounds = create_rect_bounds();
	private readonly header = create_rect_bounds();
	private externalHeader: Readonly<RectBounds> | undefined;
	public readonly statusItems: readonly WorkbenchStatusItem[] = [
		{ text: '', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' },
	];
	private readonly reading: WorkbenchTextViewControl;
	private readonly actions: WorkbenchActionBarControl;
	private readonly tooltip = new WorkbenchTooltip();
	private readonly bodyBounds = create_rect_bounds();
	private attachedDocument: WorkbenchTextViewModel | undefined;
	private attachedView: BuildLogViewModel | undefined;
	private renderedRevision = -1;
	private heading = '';
	private headingTop = 0;
	private fullHeading = '';
	private statusView: BuildLogViewModel | undefined;
	private statusRevision = -1;
	private unbindDocument: (() => void) | undefined;

	public constructor(private readonly clipboard: Clipboard, contextMenu: ContextMenuController,
		private readonly surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>,
		parentScope: InputFocusScope, focusReturn?: InputFocusTarget) {
		this.scope = new InputFocusScope(Symbol('build output control'), parentScope);
		this.focusTarget = inputFocus.createTarget(focusReturn === undefined ? null : focusReturn, this.scope);
		this.focusTarget.canFocus = () => this.attached;
		this.reading = new WorkbenchTextViewControl(this.focusTarget);
		this.surface = surfaces.attach({ role: 'content', lifetimeOwner: owner, presentationParent: owner,
			captureScope: this.scope.surfaceScope, getBounds: () => this.bounds, getClip: () => owner.getClip(),
			isVisible: () => this.attachedValue,
			// The document/activity adapter paints once in its owner's content pass.
			draw() {}, handlePointer: snapshot => this.handlePointer(snapshot), handleWheel: event => this.handleWheel(event),
			onRetire: () => this.detach() });
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget, () => this.focus(), contextMenu);
		this.actions.onDidOpenOverflow = () => this.tooltip.hide();
		this.tooltip.attach(surfaces, this.surface, workArea);
		for (const target of [this.focusTarget, this.reading.focusTarget, this.reading.findField.focusTarget]) {
			for (const command of ACTIONS) target.registerCommand(command, { isEnabled: () => this.isEnabled(command),
				isChecked: () => this.isActive(command), run: () => this.execute(command) });
		}
		for (const target of [this.focusTarget, this.actions.focusTarget]) for (const command of ['text.find', 'text.findNext', 'text.findPrevious'] as const)
			target.registerCommand(command, this.reading.focusTarget.getCommand(command)!);
		this.reading.focusTarget.next = this.actions.focusTarget;
		this.reading.focusTarget.previous = focusReturn === undefined ? this.actions.focusTarget : focusReturn;
		this.actions.focusTarget.previous = this.reading.focusTarget;
		this.actions.focusTarget.next = focusReturn === undefined ? this.reading.focusTarget : focusReturn;
	}

	public get commandTarget(): InputFocusTarget { return this.reading.focusTarget; }
	public get attached(): boolean { return this.attachedValue; }
	public focus(): void { this.commandTarget.focus(); }
	public attach(view: BuildLogViewModel, bounds: Readonly<RectBounds>, headerBounds?: Readonly<RectBounds>): void {
		const revision = ++this.attachmentRevision;
		this.attachedValue = true;
		this.layout(bounds, headerBounds);
		if (this.view !== view) {
			this.unbindDocument?.();
			this.view = view;
			const request = view.result.job.request;
			this.fullHeading = `${request.target} | ${request.debug ? 'Debug' : 'Release'} -O${request.optLevel}`;
			this.attachedView = undefined;
			this.unbindDocument = view.onDidChangeDocument(document => {
				if (!this.attached) return;
				const revision = this.attachmentRevision;
				this.attachedDocument = document;
				this.reading.setInput(document);
				if (revision === this.attachmentRevision) this.reading.update(this.bodyBounds, editorViewState.font, view.layout.rowHeight);
			});
			this.attachedDocument = view.document;
			this.updateStatus();
			this.reading.setInput(view.document);
			if (revision !== this.attachmentRevision) return;
			this.scope.retireContext();
			if (revision !== this.attachmentRevision) return;
		}
		this.actions.setInput(view.actions, this.focusTarget);
		if (revision !== this.attachmentRevision) return;
		this.update();
		if (revision === this.attachmentRevision) this.surfaces.changed();
	}
	public layout(bounds: Readonly<RectBounds>, headerBounds?: Readonly<RectBounds>): void {
		copy_rect_bounds(this.bounds, bounds); this.externalHeader = headerBounds;
	}
	public detach(): void {
		if (!this.attached) return;
		const revision = ++this.attachmentRevision;
		this.attachedValue = false;
		this.scope.interaction = undefined; this.scope.runtime = undefined;
		this.scope.retireContext();
		if (revision !== this.attachmentRevision) return;
		this.tooltip.hide(); this.actions.clearInput();
		if (revision !== this.attachmentRevision) return;
		pointerCapture.cancelScope(this.scope.surfaceScope);
		this.reading.onPointerLeave();
		if (revision !== this.attachmentRevision) return;
		this.surfaces.changed();
		if (revision !== this.attachmentRevision) return;
		this.reading.findField.focusTarget.release();
		if (revision === this.attachmentRevision) this.reading.focusTarget.release();
	}
	public dispose(): void {
		this.detach(); this.unbindDocument?.(); this.unbindDocument = undefined;
		this.surface.dispose(); this.tooltip.detach(); this.actions.dispose(); this.reading.dispose();
	}

	public isEnabled(command: EditorCommandId): boolean {
		if (!this.attached) return false;
		const view = this.view!;
		switch (command) {
			case 'buildLog.refresh': return !view.result.isDisposed && !view.result.loading;
			case 'buildLog.error': return view.error !== undefined;
			case 'buildLog.output': return true;
			case 'buildLog.copyAll': return view.document.buffer.length !== 0;
			default: return false;
		}
	}
	public isActive(command: EditorCommandId): boolean {
		return this.attached && (command === 'buildLog.error' && this.view!.channel === 'error'
			|| command === 'buildLog.output' && this.view!.channel === 'output');
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		const view = this.view!;
		if (command === 'buildLog.refresh') { void view.result.refresh(); return; }
		if (command === 'buildLog.copyAll') {
			void writeClipboard(this.clipboard, view.document.buffer.getText(), 'Copied build document.');
			return;
		}
		const channel = command === 'buildLog.error' ? 'error' : 'output';
		view.channel = channel;
		if (!this.attached || this.view !== view) return;
		this.update(); this.focus();
	}

	public update(): void {
		if (!this.attached) return;
		const revision = this.attachmentRevision;
		const view = this.view!, layout = view.layout;
		let changed = updateFullWidthWorkbenchLayout(layout, this.bounds);
		const header = this.externalHeader;
		const left = header === undefined ? layout.left : header.left;
		const top = header === undefined ? layout.top : header.top;
		const right = header === undefined ? layout.right : header.right;
		const bottom = header === undefined ? Math.min(layout.bottom, layout.top + layout.rowHeight + 12) : header.bottom;
		if (this.header.left !== left || this.header.top !== top || this.header.right !== right || this.header.bottom !== bottom) {
			write_rect_bounds(this.header, left, top, right, bottom); changed = true;
		}
		const attached = this.attachedView !== view;
		if (this.attachedDocument !== view.document) {
			this.attachedDocument = view.document; this.reading.setInput(view.document);
			if (revision !== this.attachmentRevision) return;
		}
		if (changed || attached || this.renderedRevision !== view.revision) {
			this.attachedView = view; this.renderedRevision = view.revision;
			for (const item of view.actions.items) item.checked = this.isActive(item.command);
			layoutWorkbenchActionBar(view.actions, right - 4, top + 1, bottom - 1,
				measureText, editorViewState.font.renderFont(), left + 4);
			this.heading = truncateMeasuredText(this.fullHeading, view.actions.bounds.left - left - 12, measureTextRange);
			this.headingTop = top + Math.trunc((bottom - top - editorViewState.font.lineHeight) / 2);
			write_rect_bounds(this.bodyBounds, layout.left, Math.min(layout.bottom, bottom), layout.right, layout.bottom);
		}
		this.reading.update(this.bodyBounds, editorViewState.font, layout.rowHeight);
		if (revision !== this.attachmentRevision) return;
		this.actions.update();
		if (revision !== this.attachmentRevision) return;
		const item = this.actions.tooltipItem;
		if (item !== undefined) this.tooltip.show(item.tooltip, item.bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.tooltip.hide();
	}
	public draw(): void {
		if (!this.attached) return;
		const view = this.view!, { actions, result } = view, body = this.bodyBounds, header = this.header;
		api.fill_rect(body.left, body.top, body.right, body.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		api.fill_rect(header.left, header.top, header.right, header.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		api.blit_text_inline_with_font(this.heading, header.left + 4, this.headingTop, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, editorViewState.font.renderFont());
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
		if (this.view === undefined) return;
		const view = this.view, result = view.result;
		if (this.statusView === view && this.statusRevision === view.revision) return;
		this.statusView = view; this.statusRevision = view.revision;
		this.statusItems[0].text = result.readError === undefined
			? `${this.fullHeading} | ${view.channel === 'error' ? 'Failure diagnostic' : 'Captured output'} | ${result.loading ? 'Reading snapshot…' : result.job.state}`
			: `${this.fullHeading} | Read failed: ${result.readError}`;
	}
	public handlePointer(snapshot: PointerInputSnapshot): void {
		if (!this.attached) return;
		const activation = inputFocus.interactionRevision;
		this.actions.handlePointer(snapshot) || this.reading.handlePointer(snapshot);
		if (snapshot.valid && snapshot.insideViewport && snapshot.justPressedButtons !== 0
			&& activation === inputFocus.interactionRevision) this.focusTarget.activate();
	}
	public handleWheel(event: WheelInputSnapshot): boolean {
		return this.attached && this.reading.handleWheel(event, event.deltaY * this.view!.layout.rowHeight);
	}
}
