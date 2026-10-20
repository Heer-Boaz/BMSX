import type { InputRecipient } from '../../../../hosts/common/input/channel';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { PointerInputSnapshot } from '../../../common/models';
import type { IdeCommandController } from '../../../commands/controller';
import * as colors from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';
import { layoutGameFrame } from '../../common/game_frame';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { GameViewInput } from './editor_input';
import { GameInputControl } from './game_input';

/** A large game viewport; transport commands share host execution and rewind. */
export class GameViewEditorPane extends FullWidthWorkbenchEditorPane<GameViewInput> {
	private readonly gameInput: GameInputControl;
	private shownFrame = -1;
	private frameLabel = '';
	public constructor(resourcePanel: ResourcePanelController, private readonly commands: IdeCommandController,
		private readonly runtime: Runtime, recipient: InputRecipient) {
		super(resourcePanel);
		this.gameInput = new GameInputControl(this.focusTarget, recipient);
		this.focusTarget.registerCommand('pause', { isEnabled: () => commands.transport.playbackEnabled, run: () => { commands.transport.togglePlayback(); } });
		this.focusTarget.next = this.gameInput.focusTarget;
		this.focusTarget.previous = this.gameInput.focusTarget;
	}
	public override get suspendsRuntime(): boolean { return false; }
	public override get showsGameFrame(): boolean { return true; }
	public override get runtimeTransport() { return this.runtimeControlContext === undefined ? undefined : this.commands.transport; }
	public override get runtimeControlContext() { return this.focusTarget; }
	protected override activate(): void {
		super.activate();
		this.update();
		this.gameInput.setInput(this.input.frameBounds);
	}
	public override clearInput(): void {
		this.gameInput.clearInput();
		super.clearInput();
	}
	public override dispose(): void {
		this.gameInput.dispose();
		super.dispose();
	}
	public override update(): void {
		const { layout, frameBounds } = this.input;
		if (updateFullWidthWorkbenchLayout(layout, this.contentBounds)) {
			layoutGameFrame(frameBounds, 4, layout.top + 4, layout.right - 4, layout.bottom - 4);
		}
		const frame = this.runtime.frameScheduler.lastTickSequence;
		if (frame !== this.shownFrame) { this.shownFrame = frame; this.frameLabel = `FRAME ${frame}`; }
	}
	public draw(): void {
		const { layout, frameBounds: bounds } = this.input;
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		api.drawFrame(bounds.left, bounds.top, bounds.right, bounds.bottom);
		this.gameInput.draw();
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		api.blit_text_inline_with_font(this.frameLabel, bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont());
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean, now: number,): boolean {
		if (this.gameInput.handlePointer(snapshot)) return false;
		return super.handleViewPointer(snapshot, justPressed, now);
	}
	public handleKeyboard(): void {}
	public handleWheel(): void {}
}
