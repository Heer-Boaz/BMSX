import type { InputFocusScope } from '../../../input/focus';
import type { InputRecipient } from '../../../../hosts/common/input/channel';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../../../machine/ts/render/video_presenter';
import type { PointerInputSnapshot } from '../../../common/models';
import type { IdeCommandController } from '../../../commands/controller';
import * as colors from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';
import { layoutGameFrame } from '../../common/game_frame';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import type { GameViewInput } from './editor_input';
import { GameInputControl } from './game_input';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';

/** A large game viewport; transport commands share host execution and rewind. */
export class GameViewEditorPane extends WorkbenchViewEditorPane<GameViewInput> {
	private readonly gameInput: GameInputControl;
	private shownFrame = -1;
	private shownHistory = false;
	private frameLabel = '';
	public constructor(private readonly commands: IdeCommandController,
		private readonly contextMenu: ContextMenuController, private readonly runtime: Runtime, recipient: InputRecipient, presenter: VideoPresenter, scope: InputFocusScope) {
		super(scope);
		this.gameInput = new GameInputControl(this.focusTarget, recipient, { kind: 'direct', presenter });
		this.focusTarget.registerCommand('pause', { isEnabled: () => commands.transport.playbackEnabled, run: () => { commands.transport.togglePlayback(); } });
		this.focusTarget.next = this.gameInput.focusTarget;
		this.focusTarget.previous = this.gameInput.focusTarget;
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => this.hasInput
			&& this.contentBounds.left < this.contentBounds.right && this.contentBounds.top < this.contentBounds.bottom,
			run: () => this.openContextMenu(this.contentBounds.left, this.contentBounds.top, true) });
	}
	public override get suspendsRuntime(): boolean { return false; }
	public override get companionGameMinimumWidth(): undefined { return undefined; }
	public override get runtimeTransport() { return this.runtimeControlContext === undefined ? undefined : this.commands.transport; }
	public override get runtimeControlContext() { return this.focusTarget; }
	protected override activate(): void {
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
			layoutGameFrame(frameBounds, layout.left + 4, layout.top + 4, layout.right - 4, layout.bottom - 4);
		}
		const frame = this.runtime.frameScheduler.lastTickSequence;
		const history = this.commands.transport.rewind.active;
		if (frame !== this.shownFrame || history !== this.shownHistory) {
			this.shownFrame = frame; this.shownHistory = history;
			this.frameLabel = `${history ? 'HISTORY REVIEW | ' : ''}FRAME ${frame}`;
		}
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
		if (snapshot.valid && snapshot.insideViewport && (snapshot.justPressedButtons & PointerButton.Secondary) !== 0
			&& point_in_rect(snapshot.viewportX, snapshot.viewportY, this.contentBounds)) {
			this.openContextMenu(snapshot.viewportX, snapshot.viewportY, false);
			return true;
		}
		return super.handleViewPointer(snapshot, justPressed, now);
	}
	private openContextMenu(x: number, y: number, keyboard: boolean): void {
		this.contextMenu.show(x, y, WORKBENCH_MENUS['gamePanel.context'], this.commands,
			{ invocationOrigin: this.focusTarget, returnFocus: this.focusTarget, commandTarget: this.focusTarget, selectFirst: keyboard });
	}
	public handleKeyboard(): void {}
	public handleWheel(): void {}
}
