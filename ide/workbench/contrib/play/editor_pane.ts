import type { EditorGroupView } from '../../services/editor/editor_group';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import * as colors from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';
import { RuntimeDebuggerStopReason } from '../../../runtime/source_debugger';
import { layoutGameFrame } from '../../common/game_frame';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import type { PlaySession } from '../../services/play/session';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import type { EditorNavigationController } from '../resources/navigation';
import { GameInputControl } from '../game_view/game_input';
import type { PlayEditorInput } from './editor_input';
import type { IdeCommandController } from '../../../commands/controller';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { inputFocus, type InputFocusScope } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { measureText, measureTextRange, truncateTextToWidth } from '../../../editor/common/text/layout';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import { describePlaySession, type PlayDetailsProperty } from './details';
import { point_in_rect } from '../../../../machine/ts/common/rect';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import type { PlayController } from './controller';
import type { QuickInputController } from '../../services/quick_input/controller';
import type { EditorPaneClearReason } from '../../services/editor/editor_pane';

const COMMANDS = ['play.reveal', 'play.actors', 'play.stop', 'play.reset', 'play.source', 'play.breakpoints',
	'play.continue', 'play.stepInto', 'play.stepOver', 'play.stepOut'] as const;

/** A completed bitmap and physical input recipient from the same independent Play target. */
export class PlayEditorPane extends WorkbenchViewEditorPane<PlayEditorInput> {
	private session: PlaySession | undefined;
	private gameInput: GameInputControl | undefined;
	private status = '';
	private state = '';
	private tick = -1;
	private title = '';
	private titleSource = '';
	private readonly actions: WorkbenchActionBarControl;
	private unbindHandle: (() => void) | undefined;
	private readonly details = new WorkbenchPropertyInspector<PlayDetailsProperty>(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	public constructor(private readonly commands: IdeCommandController, controller: PlayController, private readonly contextMenu: ContextMenuController,
		navigation: EditorNavigationController, group: EditorGroupView, picker: QuickInputController, scope: InputFocusScope) {
		super(scope);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus());
		this.focusTarget.next = this.actions.focusTarget; this.focusTarget.previous = this.actions.focusTarget;
		this.actions.focusTarget.next = this.focusTarget; this.actions.focusTarget.previous = this.focusTarget;
		for (const command of COMMANDS) this.focusTarget.registerCommand(command, {
			isEnabled: () => this.hasInput && controller.isCommandEnabled(command, this.input),
			run: () => controller.execute(command, this.input, group, picker),
		});
		this.focusTarget.registerCommand('play.more', { isEnabled: () => this.hasInput, run: () => {
			const bounds = this.input.actionBar.items.find(item => item.command === 'play.more')!.bounds;
			this.contextMenu.show(bounds.left, bounds.bottom, WORKBENCH_MENUS['play.context'], commands, { selectFirst: true, commandTarget: this.focusTarget });
		} });
		this.focusTarget.registerCommand('play.details', { isEnabled: () => this.hasInput, run: () => {
			this.details.show({ title: 'Play session', items: describePlaySession(this.input.handle),
				canOpenSource: item => item.location !== undefined,
				openSource: item => navigation.focusChunkSourceForContext(group, item.location!.resource.contextId, item.location!.resource.path,
					{ row: item.location!.line - 1, startColumn: item.location!.column - 1, endColumn: item.location!.column - 1 }),
			});
		} });
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => this.hasInput
			&& this.contentBounds.left < this.contentBounds.right && this.contentBounds.top < this.contentBounds.bottom,
			run: () => this.openContextMenu(this.contentBounds.left, this.contentBounds.top, true) });
		this.focusTarget.registerCommand('pause', { isEnabled: () => commands.isEnabled('runtime.playback', this.focusTarget),
			run: () => commands.execute('runtime.playback', this.focusTarget) });
	}
	public override get companionGameMinimumWidth(): undefined { return undefined; }
	protected override activate(): void {
		const interaction = this.input.interaction;
		this.focusTarget.scope.interaction = interaction;
		this.focusTarget.scope.runtime = { target: this.focusTarget, interaction };
		this.unbindHandle = this.input.onWillChangeHandle(() => {
			this.actions.cancelPointer(); this.details.hide(); this.gameInput?.clearInput();
			this.focusTarget.scope.retireContext();
		});
		this.actions.setInput(this.input.actionBar, this.focusTarget); this.titleSource = ''; this.update();
	}
	public override clearInput(reason: EditorPaneClearReason = 'deactivate'): void {
		this.unbindHandle!(); this.unbindHandle = undefined;
		if (reason !== 'move') this.input.interaction.running = false;
		this.details.hide(); this.actions.clearInput();
		this.gameInput?.dispose(); this.gameInput = undefined; this.session = undefined;
		super.clearInput(reason);
	}
	public override dispose(): void { if (this.hasInput) this.clearInput(); this.details.dispose(); this.actions.dispose(); super.dispose(); }
	public override update(): void {
		const session = this.input.handle.session;
		if (session !== this.session) {
			this.details.hide();
			this.gameInput?.dispose(); this.gameInput = undefined; this.session = session;
			this.focusTarget.next = this.actions.focusTarget; this.actions.focusTarget.previous = this.focusTarget;
			if (session !== undefined) {
				this.gameInput = new GameInputControl(this.focusTarget, session.input.physical, { kind: 'offscreen', frames: session.frames }, session.transport);
				this.focusTarget.next = this.gameInput.focusTarget;
				this.gameInput.focusTarget.previous = this.focusTarget; this.gameInput.focusTarget.next = this.actions.focusTarget;
				this.actions.focusTarget.previous = this.gameInput.focusTarget;
			}
		}
		const { frame, layout } = this.input;
		const relayout = updateFullWidthWorkbenchLayout(layout, this.contentBounds);
		if (relayout) {
			layoutWorkbenchActionBar(this.input.actionBar, layout.right - 4, layout.top + 2, layout.top + layout.rowHeight + 4, measureText, layout.font!.renderFont(), layout.left + 4);
			layoutGameFrame(frame, layout.left + 4, layout.top + layout.rowHeight + 10, layout.right - 4, layout.bottom - 4);
		}
		if (relayout || this.titleSource !== this.input.handle.title) {
			this.titleSource = this.input.handle.title;
			this.title = truncateTextToWidth(`PLAY / ${this.titleSource}`, this.input.actionBar.items[0].bounds.left - layout.left - 8);
		}
		this.actions.update(); this.details.update();
		if (this.details.visible) this.details.layout(editorViewState.font.renderFont(), measureTextRange, measureText, this.contentBounds);
		if (session?.ready === true && session.frames.bitmap !== undefined && !this.details.visible) this.gameInput!.setInput(frame);
		else this.gameInput?.clearInput();
		const stop = session?.debugger.source.stop;
		const state = stop !== undefined ? stop.reason === RuntimeDebuggerStopReason.Breakpoint ? 'breakpoint' : 'step'
			: session?.rewind.active === true ? 'history review'
			: session?.ready === true && session.execution.paused ? 'paused' : this.input.handle.state;
		const tick = session === undefined ? -1 : session.target.runtime.frameScheduler.lastTickSequence;
		if (state !== this.state || tick !== this.tick) {
			this.state = state; this.tick = tick;
			this.status = `${state.toUpperCase()}${tick < 0 ? '' : ` | FRAME ${tick}`}`;
		}
	}
	public draw(): void {
		if (this.details.visible) { drawWorkbenchPropertyInspector(this.details); return; }
		const { frame, layout } = this.input;
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
		api.blit_text_inline_with_font(this.title, layout.left + 4, layout.top + 4, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, editorViewState.font.renderFont());
		renderWorkbenchActionBar(this.input.actionBar, editorViewState.font.renderFont(), colors.COLOR_RESOURCE_VIEWER_TEXT, colors.COLOR_DESCRIPTION_TEXT);
		const bitmap = this.session?.frames.bitmap;
		if (bitmap !== undefined) api.drawBitmap(bitmap, frame.left, frame.top, frame.right, frame.bottom);
		else api.blit_text_inline_with_font(this.state.toUpperCase(), layout.left + 4, layout.top + layout.rowHeight + 10, 0,
			colors.COLOR_RESOURCE_VIEWER_TEXT, editorViewState.font.renderFont());
		this.gameInput?.draw();
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		api.blit_text_inline_with_font(this.status, bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont());
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean, now: number,): boolean {
		if (this.details.visible) return this.details.handlePointer(snapshot);
		if (snapshot.valid && snapshot.insideViewport && (snapshot.justPressedButtons & PointerButton.Secondary) !== 0
			&& point_in_rect(snapshot.viewportX, snapshot.viewportY, this.contentBounds)
			&& !point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.frame)) {
			this.openContextMenu(snapshot.viewportX, snapshot.viewportY, false);
			return true;
		}
		if (this.actions.handlePointer(snapshot)) return true;
		if (this.gameInput?.handlePointer(snapshot)) return false;
		return super.handleViewPointer(snapshot, justPressed, now);
	}
	private openContextMenu(x: number, y: number, keyboard: boolean): void {
		this.focusTarget.activate();
		this.contextMenu.show(x, y, WORKBENCH_MENUS['play.context'], this.commands,
			{ invocationOrigin: this.focusTarget, returnFocus: this.focusTarget, commandTarget: this.focusTarget, selectFirst: keyboard });
	}
	public handleKeyboard(): void {}
	public handleWheel(event: WheelInputSnapshot): void {
		if (this.details.visible) this.details.handleWheel(event, event.deltaY * editorViewState.font.lineHeight);
	}
}
