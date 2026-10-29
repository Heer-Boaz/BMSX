import type { Clipboard } from '../../../../hosts/common/clipboard';
import { copy_rect_bounds, create_rect_bounds, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandId } from '../../../common/commands';
import * as colors from '../../../common/constants';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { measureText } from '../../../editor/common/text/layout';
import type { EditorFont } from '../../../editor/ui/view/font';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type FocusCommand, type InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { mainWorkspaceActivityHeaderHeight, type MainWorkspaceActivityClient,
	type MainWorkspaceActivitySizeConstraints } from '../../common/main_workspace_activity';
import { STATUS_PRIORITY_CONTENT, type WorkbenchStatusItem } from '../../common/status_bar';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { createWorkbenchActionBar, layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchMenu, type WorkbenchMenuCommandDefinition } from '../../ui/menu/model';
import { BuildLogControl } from './control';
import type { BuildOutput } from './output';
import { BuildLogViewModel } from './view_model';

const HEADER_ACTIONS: readonly WorkbenchMenuCommandDefinition<BuildOutputActivity>[] = [
	{ type: 'command', command: 'builds.output.choose' },
];

/** Main owns a reader and request selection, never an editor input or the workspace build producer. */
export class BuildOutputActivity implements MainWorkspaceActivityClient {
	private readonly control: BuildLogControl;
	private readonly focusTarget: InputFocusTarget;
	private readonly chooseActions: WorkbenchActionBarControl;
	private readonly chooseModel = createWorkbenchActionBar(new WorkbenchMenu(HEADER_ACTIONS, this), true);
	private readonly unboundStatus: readonly WorkbenchStatusItem[] = [
		{ text: 'No build selected', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' },
	];
	private readonly bounds = create_rect_bounds();
	private readonly headerBounds = create_rect_bounds();
	private readonly controlHeaderBounds = create_rect_bounds();
	private headerFont: EditorFont | undefined;
	private view: BuildLogViewModel | undefined;
	private attachedValue = false;
	private attachmentRevision = 0;

	public constructor(clipboard: Clipboard, contextMenu: ContextMenuController, private readonly surfaces: WorkbenchSurfaceService,
		owner: WorkbenchSurface, workArea: Readonly<RectBounds>, public readonly scope: InputFocusScope,
		focusReturn: InputFocusTarget, private readonly chooseBuild: FocusCommand) {
		this.focusTarget = inputFocus.createTarget(focusReturn, scope);
		this.focusTarget.canFocus = () => this.attached;
		this.focusTarget.registerCommand('builds.output.choose', { isEnabled: () => this.isEnabled('builds.output.choose'), run: () => this.chooseBuild.run() });
		this.chooseActions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this,
			this.focusTarget, () => this.focus(), contextMenu);
		this.chooseModel.menu!.refresh();
		this.control = new BuildLogControl(clipboard, contextMenu, surfaces, owner, workArea, scope, focusReturn);
		this.control.commandTarget.previous = this.chooseActions.focusTarget;
		this.chooseActions.focusTarget.previous = focusReturn;
		this.chooseActions.focusTarget.next = () => {
			if (this.view === undefined) focusReturn.focus(); else this.control.focus();
		};
	}

	public get attached(): boolean { return this.attachedValue; }
	public get selectedResult(): BuildOutput | undefined { return this.view?.result; }
	public get commandTarget(): InputFocusTarget { return this.view === undefined ? this.chooseActions.focusTarget : this.control.commandTarget; }
	public get statusItems(): readonly WorkbenchStatusItem[] { return this.view === undefined ? this.unboundStatus : this.control.statusItems; }

	public select(result: BuildOutput, options: { focus?: boolean } = {}): boolean {
		const present = () => {
			if (this.view?.result === result) return;
			const previous = this.view, view = new BuildLogViewModel(result);
			this.view = view;
			previous?.dispose();
			if (this.attached) this.control.attach(view, this.bounds, this.controlHeaderBounds);
		};
		if (options.focus) return inputFocus.setTarget(this.control.commandTarget, present);
		present(); return this.view?.result === result;
	}
	public measure(font: EditorFont, _width: number, target: MainWorkspaceActivitySizeConstraints): void {
		const header = mainWorkspaceActivityHeaderHeight(font);
		target.minimumHeight = header + font.lineHeight * 2 + 8;
		target.preferredHeight = header + font.lineHeight * 8 + 8;
	}
	public attach(bounds: Readonly<RectBounds>, headerBounds: Readonly<RectBounds>): void {
		const revision = ++this.attachmentRevision;
		this.attachedValue = true; this.layout(bounds, headerBounds);
		this.chooseActions.setInput(this.chooseModel, this.focusTarget);
		if (revision !== this.attachmentRevision) return;
		if (this.view !== undefined) this.control.attach(this.view, this.bounds, this.controlHeaderBounds);
		if (revision !== this.attachmentRevision) return;
		this.update();
		if (revision === this.attachmentRevision) this.surfaces.changed();
	}
	public layout(bounds: Readonly<RectBounds>, headerBounds: Readonly<RectBounds>): void {
		const font = editorViewState.font, header = this.headerBounds;
		const changed = this.headerFont !== font || header.left !== headerBounds.left || header.top !== headerBounds.top
			|| header.right !== headerBounds.right || header.bottom !== headerBounds.bottom;
		copy_rect_bounds(this.bounds, bounds); copy_rect_bounds(this.headerBounds, headerBounds);
		if (changed) {
			this.headerFont = font;
			layoutWorkbenchActionBar(this.chooseModel, header.right - 2, header.top + 1, header.bottom - 1, measureText,
				font.renderFont(), header.left, 'start');
			write_rect_bounds(this.controlHeaderBounds, Math.min(header.right, this.chooseModel.bounds.right + 4), header.top, header.right, header.bottom);
		}
		this.control.layout(bounds, this.controlHeaderBounds);
	}
	public detach(): void {
		if (!this.attached) return;
		const revision = ++this.attachmentRevision;
		this.attachedValue = false;
		this.scope.retireContext();
		if (revision !== this.attachmentRevision) return;
		this.control.detach();
		if (revision !== this.attachmentRevision) return;
		this.chooseActions.clearInput();
		if (revision === this.attachmentRevision) this.focusTarget.release();
	}
	public dispose(): void {
		this.detach(); this.control.dispose(); this.chooseActions.dispose(); this.view?.dispose();
	}
	public focus(): void { this.commandTarget.focus(); }
	public isEnabled(command: EditorCommandId): boolean {
		return this.attached && command === 'builds.output.choose' && this.chooseBuild.isEnabled();
	}
	public execute(command: EditorCommandId): void { if (this.isEnabled(command)) this.chooseBuild.run(); }
	public update(): void {
		if (!this.attached) return;
		const revision = this.attachmentRevision;
		this.chooseActions.update();
		if (revision === this.attachmentRevision && this.view !== undefined) this.control.update();
	}
	public updateStatus(): void { if (this.view !== undefined) this.control.updateStatus(); }
	public draw(): void {
		if (!this.attached) return;
		if (this.view !== undefined) this.control.draw();
		else {
			const bounds = this.bounds, top = Math.min(bounds.bottom, bounds.top + mainWorkspaceActivityHeaderHeight(editorViewState.font));
			api.pushClipRect(bounds.left, top, bounds.right, bounds.bottom);
			api.fill_rect(bounds.left, top, bounds.right, bounds.bottom, 0, colors.COLOR_CODE_BACKGROUND);
			api.blit_text_inline_with_font('No build selected.', bounds.left + 4, top + 4,
				0, colors.COLOR_DESCRIPTION_TEXT, editorViewState.font.renderFont());
			api.popClipRect();
		}
		renderWorkbenchActionBar(this.chooseModel, editorViewState.font.renderFont(), colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
	}
	public handlePointer(snapshot: PointerInputSnapshot): void {
		if (!this.attached) return;
		if (!this.chooseActions.handlePointer(snapshot) && this.view !== undefined) this.control.handlePointer(snapshot);
	}
	public handleWheel(event: WheelInputSnapshot): void { if (this.view !== undefined) this.control.handleWheel(event); }
}
