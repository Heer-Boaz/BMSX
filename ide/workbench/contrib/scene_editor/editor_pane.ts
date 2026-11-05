import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { inputFocus, InputFocusScope } from '../../../input/focus';
import { EditorPane } from '../../services/editor/editor_pane';
import type { EditorGroupView } from '../../services/editor/editor_group';
import { STATUS_PRIORITY_CONTENT, STATUS_PRIORITY_ERROR, type WorkbenchStatusItem } from '../../common/status_bar';
import { getTextFileRuntimeSourceStatus } from '../../services/working_copy/runtime_source_status';
import { WorkbenchMenu } from '../../ui/menu/model';
import { WorkbenchViewMessageControl } from '../../ui/view_panel/message';
import { WorkbenchTooltip } from '../../ui/tooltip';
import { editorViewState } from '../../../editor/ui/view/state';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { SceneEditorInput, UnavailableSceneEditorInput } from './editor_input';
import { SceneEditorNavigationSelection } from './navigation_selection';
import { SceneViewportControl, VIEWPORT_CONTEXT_ACTIONS } from './viewport/control';
import type { NavigationLocation } from '../../../navigation/navigation_history';
import { SceneNavigationLocation } from './scene_navigation';
import type { SceneEditorController } from './controller';
import { ScenePrimaryClient, type ScenePrimaryClientOptions } from './primary_client';
import { SCENE_SOURCE_STATUS } from './source_status';

/** The Scene document owns the viewport; its companions attach independently. */
export class SceneEditorPane extends EditorPane<SceneEditorInput | UnavailableSceneEditorInput> {
	private commandTargetValue: ReturnType<typeof inputFocus.createTarget> | undefined;
	private controlValue: SceneViewportControl | undefined;
	private messageValue: WorkbenchViewMessageControl | undefined;
	private unbindMessageKeyboard: (() => void) | undefined;
	private readonly tooltip = new WorkbenchTooltip();
	private readonly statusItem: WorkbenchStatusItem = { text: '', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' };
	public readonly statusItems = [this.statusItem];
	public override get commandTarget() { return this.commandTargetValue!; }
	public get control(): SceneViewportControl { return this.controlValue!; }
	public override get inputScope() { return this.controlValue?.focusTarget.scope; }
	public override get canOpenSource(): boolean { return this.hasInput && this.input instanceof SceneEditorInput; }
	public override get sourcePlacement(): 'side' { return 'side'; }
	public override getSourceLocation() { return this.hasInput && this.input instanceof SceneEditorInput ? this.input.view.authoring.getSourceLocation() : undefined; }
	public override captureSourceLocation() { return this.hasInput && this.input instanceof SceneEditorInput ? this.input.view.authoring.captureSourceLocation() : undefined; }
	public override getSelection() { return this.input instanceof SceneEditorInput ? new SceneEditorNavigationSelection(this.input.view) : undefined; }
	public override captureNavigationLocation(): NavigationLocation | undefined {
		return this.input instanceof SceneEditorInput && this.input.view.authoring.subjectSpan !== undefined
			? new SceneNavigationLocation(this.input, this.group, this.sceneEditor) : undefined;
	}

	public constructor(private readonly group: EditorGroupView, private readonly sceneEditor: SceneEditorController,
		private readonly options: Omit<ScenePrimaryClientOptions, 'presentations' | 'scope' | 'isCurrent'>) {
		super();
	}

	protected override activate(): void {
		const input = this.input;
		const scope = this.group.focusScope;
		const target = this.commandTargetValue = inputFocus.createTarget(null, new InputFocusScope(scope.surfaceScope, scope));
		if (input instanceof UnavailableSceneEditorInput) {
			this.unbindMessageKeyboard = target.bindKeyboard(() => {});
			this.messageValue = new WorkbenchViewMessageControl(target);
			this.messageValue.setView({ paragraphs: ['Scene unavailable', input.snapshot.description], warning: true }, this.contentBounds);
			return;
		}
		const view = input.view.viewport;
		const control = this.controlValue = new SceneViewportControl(this.options.commands, this.options.contextMenu, scope, target,
			new WorkbenchMenu(VIEWPORT_CONTEXT_ACTIONS, view));
		control.setView(view, this.contentBounds);
		this.tooltip.attach(this.options.surfaces, this.group.paneSurface, this.options.workArea);
	}
	public override prepareToActivate(input: SceneEditorInput | UnavailableSceneEditorInput): boolean {
		if (input instanceof SceneEditorInput) return this.options.main.preparePrimaryActivation(input);
		const primary = this.options.main.primary;
		return primary === undefined || this.options.main.preparePrimaryUnbind(primary.input, primary.viewportTarget);
	}
	public override setOptions(_selection?: EditorTextSelection, navigationSelection?: SceneEditorNavigationSelection): void {
		if (navigationSelection !== undefined && this.input instanceof SceneEditorInput) navigationSelection.restore(this.input.view);
	}
	public override prepareToClearInput(): boolean {
		return !(this.input instanceof SceneEditorInput) || this.options.main.preparePrimaryUnbind(this.input, this.control.focusTarget);
	}
	public override clearInput(): void {
		const input = this.hasInput ? this.input : undefined, control = this.controlValue, message = this.messageValue;
		const unbindMessageKeyboard = this.unbindMessageKeyboard;
		this.controlValue = undefined; this.messageValue = undefined; this.unbindMessageKeyboard = undefined;
		this.tooltip.detach();
		this.commandTargetValue = undefined; super.clearInput();
		if (input instanceof SceneEditorInput && control !== undefined) this.options.main.retirePrimary(input, control.focusTarget);
		control?.dispose(); message?.dispose(); unbindMessageKeyboard?.();
	}
	public override layout(bounds: Readonly<RectBounds>): void { super.layout(bounds); this.controlValue?.layout(bounds); this.messageValue?.layout(bounds); }
	public override update(): void {
		this.controlValue?.update();
		const hint = this.controlValue?.tooltipItem;
		if (hint !== undefined) this.tooltip.show(hint.tooltip, hint.bounds, editorViewState.font.renderFont(), measureTextRange, measureText, this.options.workArea);
		else this.tooltip.hide();
	}
	public admitInteraction(): boolean {
		const input = this.input, control = this.controlValue;
		if (input instanceof UnavailableSceneEditorInput) {
			const primary = this.options.main.primary;
			if (primary === undefined) return true;
			if (!this.options.main.preparePrimaryUnbind(primary.input, primary.viewportTarget)) return false;
			this.options.main.retirePrimary(primary.input, primary.viewportTarget);
			return this.options.main.primary === undefined;
		}
		const current = () => this.hasInput && this.input === input && this.controlValue === control;
		return control !== undefined && this.options.main.bindPrimary(input, control.focusTarget,
			(presentations, scope) => new ScenePrimaryClient(input, control, { ...this.options, presentations, scope, isCurrent: current }),
			current, () => current() ? this.group.captureNavigationEntry() : null) && current();
	}
	public override focus(): void {
		if (!this.admitInteraction()) return;
		if (this.controlValue !== undefined) this.controlValue.focus(); else this.messageValue?.focus();
	}
	public override draw(): void { this.controlValue?.draw(); this.messageValue?.draw(); }
	public override handleKeyboard(event: KeyInputEvent): void {
		if (this.controlValue !== undefined) this.controlValue.focusTarget.handleKeyboard(event); else this.commandTarget.handleKeyboard(event);
	}
	public override handlePointer(snapshot: PointerInputSnapshot, justPressed: boolean): void {
		if (snapshot.justPressedButtons !== 0 && !this.admitInteraction()) return;
		this.controlValue?.handlePointer(snapshot, justPressed); this.messageValue?.handlePointer(snapshot, justPressed);
	}
	public onPointerLeave(): void { this.controlValue?.onPointerLeave(); }
	public override handleWheel(event: WheelInputSnapshot): void { this.controlValue?.handleWheel(event); }
	public override updateStatus(): void {
		if (this.input instanceof UnavailableSceneEditorInput) {
			this.statusItem.text = 'SCENE UNAVAILABLE'; this.statusItem.tone = 'warning'; this.statusItem.priority = STATUS_PRIORITY_CONTENT;
			return;
		}
		const status = getTextFileRuntimeSourceStatus(this.options.sources, this.input.workingCopy);
		this.statusItem.text = SCENE_SOURCE_STATUS[status];
		this.statusItem.tone = status === 'failed' ? 'error' : 'normal';
		this.statusItem.priority = status === 'failed' ? STATUS_PRIORITY_ERROR : STATUS_PRIORITY_CONTENT;
	}
	public override dispose(): void { this.clearInput(); }
}
