import { STATUS_PRIORITY_CONTENT, type WorkbenchStatusItem } from '../../common/status_bar';
import type { InputFocusScope } from '../../../input/focus';
import type { InputRecipient } from '../../../../hosts/common/input/channel';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../../../machine/ts/render/video_presenter';
import type { PointerInputSnapshot } from '../../../common/models';
import type { IdeCommandController } from '../../../commands/controller';
import * as colors from '../../../common/constants';
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
import type { EditorPaneClearReason } from '../../services/editor/editor_pane';

/** A large game viewport; transport commands share host execution and rewind. */
export class GameViewEditorPane extends WorkbenchViewEditorPane<GameViewInput> {
	private readonly gameInput: GameInputControl;
	private shownFrame = -1;
	private shownHistory = false;
	private readonly statusItem: WorkbenchStatusItem = { text: '', alignment: 'left', priority: STATUS_PRIORITY_CONTENT, overflow: 'ellipsis', tone: 'normal' };
	public readonly statusItems = [this.statusItem];
	public constructor(private readonly commands: IdeCommandController,
		private readonly contextMenu: ContextMenuController, private readonly runtime: Runtime, recipient: InputRecipient, presenter: VideoPresenter, scope: InputFocusScope) {
		super(scope);
		this.gameInput = new GameInputControl(this.focusTarget, recipient, { kind: 'direct', presenter }, commands.transport);
		this.focusTarget.registerCommand('pause', { isEnabled: () => commands.isEnabled('runtime.playback', this.focusTarget),
			run: () => commands.execute('runtime.playback', this.focusTarget) });
		this.focusTarget.next = this.gameInput.focusTarget;
		this.focusTarget.previous = this.gameInput.focusTarget;
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => this.hasInput
			&& this.contentBounds.left < this.contentBounds.right && this.contentBounds.top < this.contentBounds.bottom,
			run: () => this.openContextMenu(this.contentBounds.left, this.contentBounds.top, true) });
	}
	protected override activate(): void {
		const interaction = this.input.interaction;
		interaction.setRuntime(this.commands.transport, interaction.running);
		this.focusTarget.scope.interaction = interaction;
		this.focusTarget.scope.runtime = { target: this.focusTarget, interaction };
		this.update();
		this.gameInput.setInput(this.input.frameBounds);
	}
	public override clearInput(reason: EditorPaneClearReason = 'deactivate'): void {
		if (reason !== 'move') this.input.interaction.running = false;
		this.gameInput.clearInput();
		super.clearInput(reason);
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
			this.statusItem.text = `${history ? 'HISTORY REVIEW | ' : ''}FRAME ${frame}`;
		}
	}
	public draw(): void {
		const { layout, frameBounds: bounds } = this.input;
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		api.drawFrame(bounds.left, bounds.top, bounds.right, bounds.bottom);
		this.gameInput.draw();
	}
	public updateStatus(): void {}
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
		this.focusTarget.activate();
		this.contextMenu.show(x, y, WORKBENCH_MENUS['gamePanel.context'], this.commands,
			{ invocationOrigin: this.focusTarget, returnFocus: this.focusTarget, commandTarget: this.focusTarget, selectFirst: keyboard });
	}
	public handleKeyboard(): void {}
	public handleWheel(): void {}
}
