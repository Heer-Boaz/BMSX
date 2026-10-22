import { HostRewindTimeline, TimelineAction, type TimelineState, type TimelineStyle } from '../../../hosts/common/rewind_timeline';
import { write_rect_bounds } from '../../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../common/models';
import type { IdeCommandController } from '../../commands/controller';
import { editorViewState } from '../../editor/ui/view/state';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../input/focus';
import { pointerCapture } from '../../input/pointer/capture';
import { pointerHover } from '../../input/pointer/hover';
import type { FrameNavigationOperation } from '../../runtime/frame_navigation';
import type { RuntimeTransport } from '../../runtime/transport';
import type { OverlayRenderer } from '../../runtime/overlay_renderer';
import { resolveThemeTokenColor } from '../../theme/tokens';
import * as colors from '../../common/constants';
import { statusAreaHeight } from '../common/layout';
import { WorkbenchActionBarControl } from './action_bar_control';
import { createWorkbenchActionBar } from './action_bar';
import { WorkbenchSlider } from './slider';
import { WorkbenchSliderControl } from './slider_control';

const ACTIONS = [TimelineAction.Previous, TimelineAction.Playback, TimelineAction.Next, TimelineAction.Resume, TimelineAction.Cancel] as const;

/** Docked host timeline. Ordinary controls feed the existing finite navigation owner. */
export class RuntimeTimelineControl {
	public readonly focusScope: InputFocusScope;
	private readonly style: TimelineStyle = { panel: 0, track: 0, accent: 0, text: 0, disabled: 0, highlight: 0, highlightText: 0,
		z: 0, actions: ['<|', '>', '|>', '', 'OK', 'BACK'], pauseLabel: '||', visibleActions: 0x0f };
	private readonly view = new HostRewindTimeline(this.style);
	private readonly state: TimelineState = { earliestCycles: 0, latestCycles: 0, positionCycles: 0, cpuHz: 1,
		status: 'PAUSED', enabledActions: 0, hoveredAction: TimelineAction.None, focusedAction: TimelineAction.None };
	private readonly actionState = createWorkbenchActionBar('runtime.title');
	private readonly actions: WorkbenchActionBarControl;
	private readonly range = new WorkbenchSlider();
	private readonly slider: WorkbenchSliderControl;
	private context: InputFocusTarget | undefined;
	private transport: RuntimeTransport | undefined;
	private requestedCycles: number | undefined;
	private seekOperation: FrameNavigationOperation | undefined;
	public constructor(private readonly commands: IdeCommandController, focusContent: () => void) {
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, null, focusContent);
		this.focusScope = this.actions.focusTarget.scope;
		this.slider = new WorkbenchSliderControl(inputFocus, pointerCapture, this.actions.focusTarget,
			value => this.requestSeek(value), () => { this.requestedCycles = undefined; });
		this.actions.focusTarget.next = this.slider.focusTarget;
		this.slider.focusTarget.previous = this.actions.focusTarget;
	}
	public get height(): number { return this.context === undefined ? 0 : HostRewindTimeline.height(editorViewState.font.renderFont()); }
	public setContext(context: InputFocusTarget | undefined, transport: RuntimeTransport | undefined): void {
		if (context === this.context && transport === this.transport) return;
		this.slider.clearInput(); this.actions.clearInput(); this.requestedCycles = undefined;
		if (this.seekOperation !== undefined) this.transport!.navigation.cancel(this.seekOperation);
		this.seekOperation = undefined; this.context = context; this.transport = transport;
		if (context !== undefined) {
			this.actions.setInput(this.actionState, context);
			this.actions.focusTarget.previous = context;
			this.slider.focusTarget.commandContext = context;
			this.slider.setInput(this.range);
		}
	}
	private requestSeek(cycles: number): void {
		if (this.seekOperation === undefined) this.commands.execute('runtime.pause', this.context);
		this.requestedCycles = cycles;
	}
	public update(): void {
		if (this.context === undefined) return;
		const { runtime, rewind, navigation } = this.transport!;
		if (this.seekOperation?.result !== undefined) {
			if (this.seekOperation.result.status !== 'completed') {
				this.slider.cancelPointer(); this.requestedCycles = undefined;
			}
			this.seekOperation = undefined;
		}
		if (this.seekOperation !== undefined && navigation.active !== this.seekOperation) {
			this.requestedCycles = undefined; this.seekOperation = undefined;
		}
		const history = runtime.history, state = this.state;
		if (this.requestedCycles !== undefined && navigation.available) {
			const cycles = this.requestedCycles; this.requestedCycles = undefined;
			if (cycles !== rewind.positionCycles) {
				this.seekOperation = navigation.seek(cycles);
			}
		}
		state.earliestCycles = history.earliestCycles; state.latestCycles = history.latestCycles;
		state.positionCycles = rewind.positionCycles; state.cpuHz = runtime.timing.cpuHz;
		state.status = rewind.stopped ? 'STOPPED' : this.transport!.state;
		state.enabledActions = rewind.available && (navigation.available || navigation.active === this.seekOperation && this.seekOperation !== undefined)
			? 1 << TimelineAction.Seek : 0;
		state.hoveredAction = TimelineAction.None;
		for (let index = 0; index < ACTIONS.length; index++) this.actionState.items[index].visible = index < 3 || rewind.active;
		this.style.visibleActions = rewind.active ? 0x6f : 0x0f;
		this.actions.update();
		for (let index = 0; index < ACTIONS.length; index++) {
			const item = this.actionState.items[index];
			if (item.enabled) state.enabledActions |= 1 << ACTIONS[index];
			if (item.command === this.actionState.hoveredCommand) state.hoveredAction = ACTIONS[index];
		}
		state.focusedAction = this.actionState.hasFocus && this.actionState.focusedIndex >= 0 ? ACTIONS[this.actionState.focusedIndex] : TimelineAction.None;
		this.style.panel = resolveThemeTokenColor(colors.COLOR_STATUS_BACKGROUND);
		this.style.track = resolveThemeTokenColor(colors.COLOR_TIMELINE_TRACK);
		this.style.accent = resolveThemeTokenColor(colors.COLOR_TIMELINE_POSITION);
		this.style.text = resolveThemeTokenColor(colors.COLOR_STATUS_TEXT);
		this.style.disabled = resolveThemeTokenColor(colors.COLOR_HEADER_BUTTON_TEXT_DISABLED);
		this.style.highlight = resolveThemeTokenColor(colors.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND);
		this.style.highlightText = resolveThemeTokenColor(colors.COLOR_HEADER_BUTTON_ACTIVE_TEXT);
		const top = editorViewState.viewportHeight - statusAreaHeight() - this.height;
		this.view.update(state, 0, top, editorViewState.viewportWidth, editorViewState.font.renderFont());
		for (let index = 0; index < ACTIONS.length; index++) {
			const bounds = this.view.hitRects[ACTIONS[index]], item = this.actionState.items[index];
			write_rect_bounds(item.bounds, bounds.left, bounds.top, bounds.right, bounds.bottom);
		}
		const seek = this.view.hitRects[TimelineAction.Seek];
		this.range.layout(seek.left, seek.top, seek.right, seek.bottom);
		this.range.setRange(state.earliestCycles, state.latestCycles, 1);
		this.range.enabled = (state.enabledActions & (1 << TimelineAction.Seek)) !== 0;
		if (this.requestedCycles === undefined && this.seekOperation === undefined) this.range.value = state.positionCycles;
		this.slider.update();
	}
	public handlePointer(snapshot: PointerSnapshot): boolean {
		return this.context !== undefined && (this.slider.handlePointer(snapshot) || this.actions.handlePointer(snapshot));
	}
	public draw(renderer: OverlayRenderer): void { if (this.context !== undefined) renderer.appendFrame(this.view.frame); }
	public dispose(): void { this.setContext(undefined, undefined); this.slider.dispose(); this.actions.dispose(); }
}
