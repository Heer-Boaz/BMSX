import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import * as colors from '../../../common/constants';
import { editorViewState } from '../../../editor/ui/view/state';
import { api } from '../../../runtime/overlay_api';
import { RuntimeDebuggerStopReason } from '../../../runtime/source_debugger';
import { layoutGameFrame } from '../../common/game_frame';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import type { PlaySession } from '../../services/play/session';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { EditorNavigationController } from '../resources/navigation';
import { GameInputControl } from '../game_view/game_input';
import type { PlayEditorInput } from './editor_input';
import type { IdeCommandController } from '../../../commands/controller';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { inputFocus } from '../../../input/focus';
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

/** A completed bitmap and physical input recipient from the same independent Play target. */
export class PlayEditorPane extends FullWidthWorkbenchEditorPane<PlayEditorInput> {
	private session: PlaySession | undefined;
	private gameInput: GameInputControl | undefined;
	private status = '';
	private state = '';
	private tick = -1;
	private title = '';
	private titleSource = '';
	private readonly actions: WorkbenchActionBarControl;
	private readonly details = new WorkbenchPropertyInspector<PlayDetailsProperty>(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	public constructor(resourcePanel: ResourcePanelController, commands: IdeCommandController, private readonly contextMenu: ContextMenuController,
		navigation: EditorNavigationController) {
		super(resourcePanel);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus());
		this.focusTarget.next = this.actions.focusTarget; this.focusTarget.previous = this.actions.focusTarget;
		this.actions.focusTarget.next = this.focusTarget; this.actions.focusTarget.previous = this.focusTarget;
		this.focusTarget.registerCommand('play.more', { isEnabled: () => true, run: () => {
			const bounds = this.input.actionBar.items.find(item => item.command === 'play.more')!.bounds;
			this.contextMenu.show(bounds.left, bounds.bottom, WORKBENCH_MENUS['play.context'], commands, { selectFirst: true });
		} });
		this.focusTarget.registerCommand('play.details', { isEnabled: () => true, run: () => {
			this.details.show({ title: 'Play session', items: describePlaySession(this.input.handle),
				canOpenSource: item => item.location !== undefined,
				openSource: item => navigation.focusChunkSourceForContext(item.location!.resource.domain, item.location!.resource.path,
					{ row: item.location!.line - 1, startColumn: item.location!.column - 1, endColumn: item.location!.column - 1 }),
			});
		} });
		this.focusTarget.registerCommand('pause', { isEnabled: () => this.session?.transport.playbackEnabled === true,
			run: () => { this.session!.transport.togglePlayback(); } });
		for (const [command, direction] of [['stepFrame', 1], ['stepFrameBack', -1]] as const) {
			this.focusTarget.registerCommand(command, { isEnabled: () => this.session?.ready === true && this.session.navigation.canStep(direction),
				run: () => { this.session!.navigation.step(direction); } });
		}
	}
	public override get showsGameFrame(): boolean { return true; }
	public override get suspendsRuntime(): boolean { return false; }
	public override get runtimeControlContext() { return this.session?.ready === true ? this.focusTarget : undefined; }
	public override get runtimeTransport() { return this.session?.ready === true ? this.session.transport : undefined; }
	protected override activate(): void { super.activate(); this.actions.setInput(this.input.actionBar, this.focusTarget); this.titleSource = ''; this.update(); }
	public override clearInput(): void {
		this.details.hide(); this.actions.clearInput();
		this.gameInput?.dispose(); this.gameInput = undefined; this.session = undefined;
		super.clearInput();
	}
	public override dispose(): void { this.clearInput(); this.details.dispose(); this.actions.dispose(); super.dispose(); }
	public override update(): void {
		const session = this.input.handle.session;
		if (session !== this.session) {
			this.details.hide();
			this.gameInput?.dispose(); this.gameInput = undefined; this.session = session;
			this.focusTarget.next = this.actions.focusTarget; this.actions.focusTarget.previous = this.focusTarget;
			if (session !== undefined) {
				this.gameInput = new GameInputControl(this.focusTarget, session.input.physical, { kind: 'offscreen', frames: session.frames });
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
		if (this.actions.handlePointer(snapshot)) return true;
		if (this.gameInput?.handlePointer(snapshot)) return false;
		return super.handleViewPointer(snapshot, justPressed, now);
	}
	public handleKeyboard(): void {}
	public handleWheel(event: WheelInputSnapshot): void {
		if (this.details.visible) this.details.handleWheel(event, event.deltaY * editorViewState.font.lineHeight);
	}
}
