import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { PointerSnapshot } from '../../../common/models';
import type { IdeCommandController } from '../../../commands/controller';
import * as colors from '../../../common/constants';
import { measureText } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { layoutGameFrame } from '../../common/game_frame';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { GameViewInput } from './editor_input';

/** A large game viewport; transport commands share host execution and rewind. */
export class GameViewEditorPane extends FullWidthWorkbenchEditorPane<GameViewInput> {
	private readonly actions: WorkbenchActionBarControl;
	private shownFrame = -1;
	private frameLabel = '';
	public constructor(resourcePanel: ResourcePanelController, private readonly commands: IdeCommandController,
		private readonly runtime: Runtime) {
		super(resourcePanel);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget);
		this.focusTarget.next = this.actions.focusTarget;
		this.actions.focusTarget.previous = this.focusTarget;
	}
	public override get suspendsRuntime(): boolean { return false; }
	protected override activate(): void {
		super.activate();
		this.actions.setInput(this.input.actionBar, this.focusTarget);
		this.update();
	}
	public override clearInput(): void { this.actions.clearInput(); super.clearInput(); }
	public override dispose(): void { this.actions.dispose(); super.dispose(); }
	public override update(): void {
		const { layout, actionBar, frameBounds } = this.input;
		if (updateFullWidthWorkbenchLayout(layout)) {
			layoutWorkbenchActionBar(actionBar, layout.right - 4, layout.top, layout.top + layout.rowHeight + 4, measureText);
			layoutGameFrame(frameBounds, 4, layout.top + layout.rowHeight + 8, layout.right - 4, layout.bottom - 4);
		}
		const frame = this.runtime.frameScheduler.lastTickSequence;
		if (frame !== this.shownFrame) { this.shownFrame = frame; this.frameLabel = `FRAME ${frame}`; }
		this.actions.update();
	}
	public draw(): void {
		const { layout, actionBar, frameBounds: bounds } = this.input;
		const font = editorViewState.font.renderFont();
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		renderWorkbenchActionBar(actionBar, this.commands, font);
		api.blit_text_inline_with_font(this.commands.gamePlaybackState,
			4, layout.top + 2, 0, colors.COLOR_STATUS_TEXT, font);
		api.drawFrame(bounds.left, bounds.top, bounds.right, bounds.bottom);
	}
	public drawStatusBar(top: number, color: number): void {
		api.blit_text_inline_with_font(this.frameLabel, 4, top + 2, 0, color, editorViewState.font.renderFont());
	}
	protected override handleViewPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
		if (this.actions.handlePointer(snapshot)) return true;
		if (justPressed) this.focus();
		return false;
	}
	public handleKeyboard(): void {}
	public handleWheel(): void {}
}
