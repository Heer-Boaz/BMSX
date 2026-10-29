import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { KeyInputEvent } from '../../../../hosts/common/input/text';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { EditorCommandRunner } from '../../../common/commands';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { InputFocusScope } from '../../../input/focus';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { EditorPane } from '../../services/editor/editor_pane';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { SceneEditorControl } from './control';
import type { SceneEditorInput } from './editor_input';
import type { SceneEditorNavigationSelection } from './navigation_selection';

/** Document-group adapter; the actual Scene widget also attaches directly to Main. */
export class SceneEditorPane extends EditorPane<SceneEditorInput> {
	public readonly control: SceneEditorControl;

	public constructor(commands: EditorCommandRunner, sources: RuntimeSourceState, contextMenu: ContextMenuController,
		surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, workArea: Readonly<RectBounds>, scope: InputFocusScope) {
		super();
		this.control = new SceneEditorControl(commands, sources, contextMenu, surfaces, owner, workArea, scope);
	}

	public override get commandTarget() { return this.control.commandTarget; }
	public override get inputScope() { return this.control.inputScope; }
	public override getSourceLocation() { return this.control.getSourceLocation(); }
	public override get canOpenSource(): boolean { return this.control.canOpenSource; }
	public override captureSourceLocation() { return this.control.captureSourceLocation(); }
	public override getSelection() { return this.control.getSelection(); }
	protected override activate(): void { this.control.setView(this.input.view, this.contentBounds); }
	public override setOptions(_selection?: EditorTextSelection, navigationSelection?: SceneEditorNavigationSelection): void {
		if (navigationSelection !== undefined) this.control.restoreSelection(navigationSelection);
	}
	public override clearInput(): void { this.control.clearView(); super.clearInput(); }
	public override layout(bounds: Readonly<RectBounds>): void { super.layout(bounds); this.control.layout(bounds); }
	public override update(): void { this.control.update(); }
	public override focus(): void { this.control.focus(); }
	public override draw(): void { this.control.draw(); }
	public override handleKeyboard(event: KeyInputEvent): void { this.control.handleKeyboard(event); }
	public override handlePointer(snapshot: PointerInputSnapshot, justPressed: boolean, secondaryJustPressed: boolean, now: number, gotoModifierActive: boolean): void {
		this.control.handlePointer(snapshot, justPressed, secondaryJustPressed, now, gotoModifierActive);
	}
	public onPointerLeave(): void { this.control.onPointerLeave(); }
	public override handleWheel(event: WheelInputSnapshot): void { this.control.handleWheel(event); }
	public override get statusItems() { return this.control.statusItems; }
	public override updateStatus(): void { this.control.updateStatus(); }
	public override dispose(): void { this.control.dispose(); }
}
