import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { EditorCommandRunner } from '../../../common/commands';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { executeTextHistoryCommand } from '../../../editor/editing/history_commands';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { api } from '../../../runtime/overlay_api';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { getTextFileRuntimeSourceStatus } from '../../services/working_copy/runtime_source_status';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchTooltip } from '../../ui/tooltip';
import { SceneDetailsControl } from './details_control';
import { SceneHierarchyControl } from './hierarchy_control';
import { layoutSceneEditor } from './layout';
import { SceneEditorNavigationSelection } from './navigation_selection';
import { drawSceneEditor } from './render';
import type { SceneEditorSectionCommands } from './option_editor';
import type { SceneEditorSection, SceneEditorViewState } from './view_state';

/** Actual document/Main composition; sibling widgets own their own input and presentation. */
export class SceneEditorControl {
	public readonly focusTarget: InputFocusTarget;
	public readonly hierarchy: SceneHierarchyControl;
	public readonly details: SceneDetailsControl;
	private readonly actionBar: WorkbenchActionBarControl;
	private readonly tooltip = new WorkbenchTooltip();
	private readonly unbindKeyboard: () => void;
	private readonly unbindFocus: () => void;
	private viewValue: SceneEditorViewState | undefined;
	private bounds!: Readonly<RectBounds>;
	private attachmentRevision = 0;
	private measuredRevision = -1;
	private focusRegions = -1;
	private subscriptions: (() => void)[] = [];
	private sourceHovered = false;
	private status = '';
	public get view(): SceneEditorViewState { return this.viewValue!; }
	public get inputScope(): InputFocusScope { return this.focusTarget.scope; }
	public get hasView(): boolean { return this.viewValue !== undefined; }
	public get canOpenSource(): boolean { return this.hasView; }
	public getSourceLocation() { return this.viewValue?.authoring.getSourceLocation(); }
	public captureSourceLocation() { return this.viewValue?.authoring.captureSourceLocation(); }
	public getSelection(): SceneEditorNavigationSelection {
		return new SceneEditorNavigationSelection(this.view);
	}

	public constructor(commands: EditorCommandRunner, private readonly sources: RuntimeSourceState,
		contextMenu: ContextMenuController, surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface,
		private readonly workArea: Readonly<RectBounds>, scope: InputFocusScope) {
		this.focusTarget = inputFocus.createTarget(null, new InputFocusScope(scope.surfaceScope, scope));
		this.focusTarget.canFocus = () => this.hasView && (this.hierarchy.canFocus || this.details.canFocus || this.actionBar.focusTarget.canFocus!());
		this.unbindKeyboard = this.focusTarget.bindKeyboard(event => this.handleKeyboard(event));
		this.unbindFocus = this.focusTarget.onDidFocus(() => this.focus());
		const sections: SceneEditorSectionCommands = {
			outline: { isEnabled: () => this.hasView, run: () => this.showSection('outline') },
			details: { isEnabled: () => this.hasView && this.view.authoring.hasSelection, run: () => this.showSection('details') },
		};
		this.focusTarget.registerCommand('sceneEditor.outline', sections.outline);
		this.focusTarget.registerCommand('sceneEditor.details', sections.details);
		this.hierarchy = new SceneHierarchyControl(commands, contextMenu, surfaces, owner, workArea, this.inputScope, this.focusTarget, sections);
		this.details = new SceneDetailsControl(commands, contextMenu, this.inputScope, this.focusTarget, sections);
		this.focusTarget.registerCommand('contextMenu', {
			isEnabled: () => this.hasView && (this.view.section === 'details' ? this.details.canFocus : this.hierarchy.canFocus)
				&& this.commandTarget.getCommand('contextMenu')!.isEnabled(),
			run: () => commands.execute('contextMenu', this.commandTarget),
		});
		this.actionBar = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands,
			this.focusTarget, () => this.focus(), contextMenu);
		this.actionBar.focusTarget.canFocus = () => this.hasView && this.view.actionBar.bounds.left < this.view.actionBar.bounds.right
			&& this.view.actionBar.bounds.top < this.view.actionBar.bounds.bottom;
		this.actionBar.onDidOpenOverflow = lifetime => {
			this.tooltip.hide(); this.sourceHovered = false;
			const view = this.view;
			lifetime.add({ dispose: view.authoring.workingCopy.onDidChangeContent(() => contextMenu.hide()) });
			lifetime.add({ dispose: view.authoring.onDidChangeSelection(() => contextMenu.hide()) });
		};
		this.tooltip.attach(surfaces, owner, workArea);
		this.focusTarget.registerCommand('sceneEditor.removeMember', {
			contextual: true,
			isEnabled: () => this.hasView && this.view.authoring.canRemoveSelectedMember(),
			run: () => this.view.authoring.removeSelectedMember(),
			capture: () => {
				if (!this.hasView) return;
				const view = this.view, intent = view.authoring.selectionRevision, generation = this.inputScope.contextGeneration;
				const current = () => this.viewValue === view && this.inputScope.contextGeneration === generation && view.authoring.selectionRevision === intent;
				return { isEnabled: () => current() && view.authoring.canRemoveSelectedMember(),
					run: () => { if (current()) view.authoring.removeSelectedMember(); } };
			},
		});
		for (const [command, direction] of [['sceneEditor.moveMemberUp', -1], ['sceneEditor.moveMemberDown', 1]] as const) {
			this.focusTarget.registerCommand(command, {
				contextual: true,
				isEnabled: () => this.hasView && this.view.authoring.canMoveSelectedMember(direction),
				run: () => this.moveSelectedMember(direction),
				capture: () => {
					if (!this.hasView) return;
					const view = this.view, intent = view.authoring.selectionRevision, generation = this.inputScope.contextGeneration;
					const current = () => this.viewValue === view && this.inputScope.contextGeneration === generation && view.authoring.selectionRevision === intent;
					return { isEnabled: () => current() && view.authoring.canMoveSelectedMember(direction),
						run: () => { if (current()) this.moveSelectedMember(direction); } };
				},
			});
		}
		for (const direction of ['undo', 'redo'] as const) this.focusTarget.registerCommand(direction, {
			contextual: true,
			isEnabled: () => this.hasView && !this.view.authoring.workingCopy.readOnly
				&& (direction === 'undo' ? this.view.authoring.workingCopy.canUndo : this.view.authoring.workingCopy.canRedo),
			run: () => { executeTextHistoryCommand(this.view.authoring.workingCopy, direction); },
		});
	}

	public setView(view: SceneEditorViewState, bounds: Readonly<RectBounds>): void {
		const revision = ++this.attachmentRevision;
		this.detach();
		if (revision !== this.attachmentRevision) return;
		this.viewValue = view; this.bounds = bounds; this.measuredRevision = -1; this.focusRegions = -1;
		layoutSceneEditor(view, true, false, bounds);
		this.actionBar.setInput(view.actionBar, this.focusTarget);
		this.subscriptions = [view.authoring.workingCopy.onWillDispose(() => {
			if (revision === this.attachmentRevision) this.clearView();
		}), view.authoring.onDidChangeSelection(() => {
			if (revision !== this.attachmentRevision || view.authoring.selection !== undefined) return;
			view.section = 'outline';
			this.update();
		}), inputFocus.onDidActivateInteraction(target => {
			if (revision !== this.attachmentRevision) return;
			if (this.hierarchy.inputScope.contains(target.scope)) view.section = 'outline';
			else if (this.details.inputScope.contains(target.scope)) view.section = 'details';
		})];
		this.hierarchy.setView(view.hierarchy, view.layout.hierarchyBounds);
		if (revision !== this.attachmentRevision) return;
		this.details.setView(view.details, view.layout.detailsBounds);
		if (revision !== this.attachmentRevision) return;
		this.update();
	}
	public layout(bounds: Readonly<RectBounds>): void { this.bounds = bounds; this.update(); }
	public update(): void {
		if (!this.hasView) return;
		const view = this.view, revision = this.attachmentRevision;
		view.authoring.refresh();
		if (revision !== this.attachmentRevision) return;
		layoutSceneEditor(view, this.measuredRevision !== view.authoring.revision, false, this.bounds);
		this.measuredRevision = view.authoring.revision;
		this.hierarchy.layout(view.layout.hierarchyBounds);
		if (revision !== this.attachmentRevision) return;
		this.details.layout(view.layout.detailsBounds);
		if (revision !== this.attachmentRevision) return;
		this.bindFocusOrder(); this.actionBar.update();
		const hint = this.actionBar.tooltipItem;
		if (hint !== undefined) this.tooltip.show(hint.tooltip, hint.bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else if (this.sourceHovered) this.tooltip.show(view.authoring.workingCopy.resource.path, view.layout.sourceBounds,
			editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.tooltip.hide();
		this.status = SOURCE_STATUS[getTextFileRuntimeSourceStatus(this.sources, view.authoring.workingCopy)];
	}
	private bindFocusOrder(): void {
		const actions = this.actionBar.focusTarget;
		const regions = (this.hierarchy.canFocus ? 1 : 0) | (this.details.canFocus ? 2 : 0) | (actions.canFocus!() ? 4 : 0);
		if (regions === this.focusRegions) return;
		this.focusRegions = regions;
		let previous = actions;
		this.hierarchy.focusTarget.next = this.hierarchy.focusTarget.previous = null;
		if (this.hierarchy.canFocus) {
			previous.next = this.hierarchy.focusTarget; this.hierarchy.focusTarget.previous = previous; previous = this.hierarchy.focusTarget;
		}
		if (this.details.canFocus) this.details.setFocusNeighbors(previous, actions);
		else { previous.next = actions; actions.previous = previous; }
	}
	public get commandTarget(): InputFocusTarget {
		if (this.view.section === 'details' && this.details.canFocus) return this.details.commandTarget;
		if (this.hierarchy.canFocus) return this.hierarchy.focusTarget;
		if (this.details.canFocus) return this.details.commandTarget;
		return this.actionBar.focusTarget;
	}
	public focus(): void {
		const revision = this.attachmentRevision;
		this.update();
		if (revision === this.attachmentRevision) this.commandTarget.focus();
	}
	private showSection(section: SceneEditorSection): void {
		const view = this.view, revision = this.attachmentRevision, focusRevision = inputFocus.revision;
		if (inputFocus.target?.edit?.commit() === false || revision !== this.attachmentRevision || focusRevision !== inputFocus.revision) return;
		const target = section === 'details' ? this.details.commandTarget : this.hierarchy.focusTarget;
		inputFocus.setTarget(target, () => {
			if (revision !== this.attachmentRevision) return;
			view.section = section; this.onPointerLeave(); this.update();
		});
	}
	public restoreSelection(selection: SceneEditorNavigationSelection): void {
		const view = this.view, revision = this.attachmentRevision;
		selection.restore(view);
		if (revision === this.attachmentRevision) this.update();
	}
	private moveSelectedMember(direction: -1 | 1): void {
		if (!this.view.authoring.moveSelectedMember(direction)) return;
		this.hierarchy.update(); this.hierarchy.revealSelection();
	}
	public handleKeyboard(event: KeyInputEvent): void { this.hierarchy.handleKeyboard(event); }
	public handlePointer(snapshot: PointerInputSnapshot, justPressed: boolean, _secondary: boolean, _now: number, _goto: boolean): void {
		if (!this.hasView) return;
		this.sourceHovered = snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.view.layout.sourceBounds);
		if (this.sourceHovered) { pointerHover.visit(this); if (justPressed) this.focus(); return; }
		if (this.actionBar.handlePointer(snapshot)) return;
		if (this.details.handlePointer(snapshot, justPressed)) return;
		if (this.hierarchy.handlePointer(snapshot, justPressed)) return;
		if (justPressed && snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, this.view.layout)) this.focus();
	}
	public handleWheel(event: WheelInputSnapshot): void { if (this.hasView && !this.details.handleWheel(event)) this.hierarchy.handleWheel(event); }
	public onPointerLeave(): void { this.sourceHovered = false; this.hierarchy.onPointerLeave(); }
	public draw(): void {
		if (!this.hasView) return;
		drawSceneEditor(this.view); this.hierarchy.draw(); this.details.draw();
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		if (this.hasView) api.blit_text_inline_with_font(this.status, bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont());
	}
	public clearView(): void { this.attachmentRevision++; this.detach(); }
	private detach(): void {
		if (!this.hasView) return;
		const revision = this.attachmentRevision;
		this.viewValue = undefined;
		const subscriptions = this.subscriptions; this.subscriptions = [];
		for (const unbind of subscriptions) unbind();
		this.tooltip.hide(); this.sourceHovered = false; pointerHover.release(this);
		this.inputScope.interaction = undefined; this.inputScope.runtime = undefined;
		this.inputScope.retireContext();
		if (revision !== this.attachmentRevision) return;
		this.actionBar.clearInput();
		if (revision !== this.attachmentRevision) return;
		this.hierarchy.clearView();
		if (revision !== this.attachmentRevision) return;
		this.details.clearView();
		if (revision === this.attachmentRevision) this.focusTarget.release();
	}
	public dispose(): void {
		this.clearView(); this.hierarchy.dispose(); this.details.dispose();
		this.actionBar.dispose(); this.tooltip.detach(); this.unbindKeyboard(); this.unbindFocus(); pointerHover.release(this);
	}
}

const SOURCE_STATUS = {
	applied: 'SOURCE APPLIED', pending: 'SOURCE NOT APPLIED', failed: 'SOURCE APPLY FAILED',
	untracked: 'SOURCE STATUS UNKNOWN', source_only: 'SOURCE ONLY',
};
