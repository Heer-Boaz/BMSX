import type { PointerSnapshot } from '../../common/models';
import type { EditorCommandRunner } from '../../common/commands';
import { editorViewState } from '../../editor/ui/view/state';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../input/focus';
import { pointerCapture } from '../../input/pointer/capture';
import { pointerHover } from '../../input/pointer/hover';
import type { FrameNavigationOperation } from '../../runtime/frame_navigation';
import type { RuntimeTransport } from '../../runtime/transport';
import { statusAreaHeight } from '../common/layout';
import { WorkbenchActionBarControl } from './action_bar_control';
import { createWorkbenchActionBar } from './action_bar';
import { WorkbenchSlider } from './slider';
import { WorkbenchSliderControl } from './slider_control';
import { RuntimeTimelineLayout } from './runtime_timeline';
import { drawRuntimeTimeline } from '../render/runtime_timeline';
import { WorkbenchTooltip } from './tooltip';
import type { WorkbenchSurfaceService } from '../services/windows/service';
import type { WorkbenchSurface } from '../services/windows/model';
import type { RectBounds } from '../../../machine/ts/common/rect';
import { measureText, measureTextRange } from '../../editor/common/text/layout';
import { editorCommandTitle } from '../../commands/catalog';

/** Docked host timeline. Ordinary controls feed the existing finite navigation owner. */
export class RuntimeTimelineControl {
	public readonly focusScope: InputFocusScope;
	private readonly layout = new RuntimeTimelineLayout();
	private readonly actionState = createWorkbenchActionBar('runtime.title');
	private readonly actions: WorkbenchActionBarControl;
	private readonly range = new WorkbenchSlider();
	private readonly slider: WorkbenchSliderControl;
	private readonly tooltip = new WorkbenchTooltip();
	private getWorkArea!: () => Readonly<RectBounds>;
	private context: InputFocusTarget | undefined;
	private transport: RuntimeTransport | undefined;
	private requestedCycles: number | undefined;
	private seekOperation: FrameNavigationOperation | undefined;
	public constructor(private readonly commands: EditorCommandRunner, focusContent: () => void) {
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, null, focusContent);
		this.focusScope = this.actions.focusTarget.scope;
		this.slider = new WorkbenchSliderControl(inputFocus, pointerCapture, this.actions.focusTarget,
			value => this.requestSeek(value), () => { this.requestedCycles = undefined; });
		this.actions.focusTarget.next = this.slider.focusTarget;
		this.slider.focusTarget.previous = this.actions.focusTarget;
	}
	public get height(): number { return this.context === undefined ? 0 : RuntimeTimelineLayout.height(editorViewState.font.renderFont()); }
	public get visible(): boolean { return this.context !== undefined; }
	public focus(): void { this.actions.focusTarget.focus(); }
	public attach(surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, getWorkArea: () => Readonly<RectBounds>): void {
		this.getWorkArea = getWorkArea;
		this.tooltip.attach(surfaces, owner, getWorkArea);
	}
	public setContext(context: InputFocusTarget | undefined, transport: RuntimeTransport | undefined): void {
		if (context === this.context && transport === this.transport) return;
		this.slider.clearInput(); this.actions.clearInput(); this.tooltip.hide(); this.requestedCycles = undefined;
		if (this.seekOperation !== undefined) this.transport!.navigation.cancel(this.seekOperation);
		this.seekOperation = undefined; this.context = context; this.transport = transport;
		if (context !== undefined) {
			this.actions.setInput(this.actionState, context);
			this.actions.focusTarget.previous = context;
			this.slider.focusTarget.commandContext = context;
			this.slider.focusTarget.next = context;
			this.slider.setInput(this.range);
		} else { this.actions.focusTarget.previous = null; this.slider.focusTarget.next = null; }
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
		const history = runtime.history;
		if (this.requestedCycles !== undefined && navigation.available) {
			const cycles = this.requestedCycles; this.requestedCycles = undefined;
			if (cycles !== rewind.positionCycles) {
				this.seekOperation = navigation.seek(cycles);
			}
		}
		const playing = !rewind.stopped && (this.transport!.state === 'LIVE' || this.transport!.state === 'REPLAY');
		this.actionState.items[1].icon = playing ? 'pause' : 'play';
		this.actions.update();
		this.actionState.items[1].tooltip = editorCommandTitle('pause', !playing);
		const top = editorViewState.viewportHeight - statusAreaHeight() - this.height;
		const offsetTenths = rewind.active ? Math.trunc((history.latestCycles - rewind.positionCycles) * 10 / runtime.timing.cpuHz) : 0;
		const durationTenths = Math.trunc((history.latestCycles - history.earliestCycles) * 10 / runtime.timing.cpuHz);
		this.layout.update(this.actionState, this.range, editorViewState.font.renderFont(), 0, top, editorViewState.viewportWidth, offsetTenths, durationTenths);
		this.range.setRange(history.earliestCycles, history.latestCycles, 1);
		this.range.enabled = rewind.available && (navigation.available || navigation.active === this.seekOperation && this.seekOperation !== undefined);
		if (this.requestedCycles === undefined && this.seekOperation === undefined) this.range.value = rewind.positionCycles;
		this.slider.update();
		this.actions.focusTarget.next = this.range.interactive ? this.slider.focusTarget : this.context;
		const tooltipItem = this.actions.tooltipItem;
		if (tooltipItem !== undefined) this.tooltip.show(tooltipItem.tooltip, tooltipItem.bounds,
			editorViewState.font.renderFont(), measureTextRange, measureText, this.getWorkArea());
		else this.tooltip.hide();
	}
	public handlePointer(snapshot: PointerSnapshot): boolean {
		return this.context !== undefined && (this.slider.handlePointer(snapshot) || this.actions.handlePointer(snapshot));
	}
	public draw(): void {
		if (this.context !== undefined) drawRuntimeTimeline(this.layout, this.actionState, this.range,
			this.slider.focusTarget.hasFocus, editorViewState.font.renderFont());
	}
	public dispose(): void { this.setContext(undefined, undefined); this.tooltip.detach(); this.slider.dispose(); this.actions.dispose(); }
}
