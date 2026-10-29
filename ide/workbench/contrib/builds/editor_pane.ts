import type { Clipboard } from '../../../../hosts/common/clipboard';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { InputFocusScope } from '../../../input/focus';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { EditorPane, type EditorPaneClearReason } from '../../services/editor/editor_pane';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { BuildLogControl } from './control';
import type { BuildLogInput } from './editor_input';

/** The editor group borrows the same native reader used by the Build Output activity. */
export class BuildLogPane extends EditorPane<BuildLogInput> {
	private readonly control: BuildLogControl;

	public constructor(clipboard: Clipboard, contextMenu: ContextMenuController, surfaces: WorkbenchSurfaceService,
		owner: WorkbenchSurface, workArea: Readonly<RectBounds>, scope: InputFocusScope) {
		super(); this.control = new BuildLogControl(clipboard, contextMenu, surfaces, owner, workArea, scope);
	}
	public override get commandTarget() { return this.control.commandTarget; }
	public override get inputScope() { return this.control.scope; }
	public get statusItems() { return this.control.statusItems; }
	protected activate(): void { this.control.attach(this.input.view, this.contentBounds); }
	public override layout(bounds: Readonly<RectBounds>): void { super.layout(bounds); this.control.layout(bounds); }
	public override clearInput(reason: EditorPaneClearReason = 'deactivate'): void { super.clearInput(reason); this.control.detach(); }
	public focus(): void { this.control.focus(); }
	public dispose(): void { this.control.dispose(); }
	public override update(): void { this.control.update(); }
	public draw(): void { this.control.draw(); }
	public updateStatus(): void { this.control.updateStatus(); }
	public handleKeyboard(): void {}
	public handlePointer(snapshot: PointerInputSnapshot): void { this.control.handlePointer(snapshot); }
	public handleWheel(event: WheelInputSnapshot): void { this.control.handleWheel(event); }
}
