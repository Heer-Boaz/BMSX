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
import type { ContextMenuController } from '../services/context_menu/controller';

/** Docked host timeline. Ordinary controls feed the existing finite navigation owner. */
export class RuntimeTimelineControl {
	public readonly focusScope: InputFocusScope;
	private readonly layout = new RuntimeTimelineLayout();
	private readonly actionState = createWorkbenchActionBar('runtime.title');
	private readonly actions: WorkbenchActionBarControl;
	private readonly range = new WorkbenchSlider();
	private readonly slider: WorkbenchSliderControl;
	private readonly tooltip = new WorkbenchTooltip();
	private workArea!: Readonly<RectBounds>;
	private context: InputFocusTarget | undefined;
	private transport: RuntimeTransport | undefined;
	private contextMenu!: ContextMenuController;
	private requestedValue = false;
	private presented = false;
	private requestedCycles: number | undefined;
	private seekOperation: FrameNavigationOperation | undefined;
	public constructor(private readonly commands: EditorCommandRunner, private readonly focusContent: () => void) {
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, null, focusContent);
		this.focusScope = this.actions.focusTarget.scope;
		this.slider = new WorkbenchSliderControl(inputFocus, pointerCapture, this.actions.focusTarget,
			value => this.requestSeek(value), () => { this.requestedCycles = undefined; });
		this.actions.focusTarget.next = this.slider.focusTarget;
		this.slider.focusTarget.previous = this.actions.focusTarget;
	}
	public get available(): boolean { return this.context !== undefined; }
	public get requested(): boolean { return this.requestedValue; }
	public get height(): number { return this.presented ? RuntimeTimelineLayout.height(editorViewState.font.renderFont()) : 0; }
	public get visible(): boolean { return this.presented; }
	/** Review decisions remain available until their physical navigation has settled. */
	public get canHide(): boolean { return this.available && this.requestedValue && !this.reviewRequired; }
	private get reviewRequired(): boolean {
		return this.transport!.rewind.active || this.requestedCycles !== undefined
			|| this.seekOperation !== undefined && this.seekOperation.result === undefined
				&& this.transport!.navigation.active === this.seekOperation;
	}
	public focus(): void {
		if (!this.available) return;
		this.requestedValue = true;
		this.update();
		this.actions.focusTarget.focus();
	}
	/** Presentation intent is independent of the attached target and its owned seek. */
	public hide(): void { this.requestedValue = false; this.updatePresentation(); }
	public attach(surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, workArea: Readonly<RectBounds>, contextMenu: ContextMenuController): void {
		this.workArea = workArea;
		this.contextMenu = contextMenu;
		this.tooltip.attach(surfaces, owner, workArea);
	}
	public setContext(context: InputFocusTarget | undefined, transport: RuntimeTransport | undefined): void {
		if (context !== this.context || transport !== this.transport) {
			this.clearPresentation();
			// Outline/graph are concrete command clients of the same physical transport.
			if (transport !== this.transport) {
				this.requestedCycles = undefined;
				if (this.seekOperation !== undefined) this.transport!.navigation.cancel(this.seekOperation);
				this.seekOperation = undefined;
			}
			this.context = context; this.transport = transport;
		}
		// Composition publishes height before update; review can end on an unchanged target.
		this.updatePresentation();
	}
	private updatePresentation(): void {
		const visible = this.available && (this.requestedValue || this.reviewRequired);
		if (visible === this.presented) return;
		if (visible) {
			this.presented = true;
			this.actions.setInput(this.actionState, this.context!);
			this.actions.focusTarget.previous = this.focusContent;
			this.slider.focusTarget.commandContext = this.context!;
			this.slider.focusTarget.next = this.focusContent;
			this.slider.setInput(this.range);
		} else this.clearPresentation();
	}
	private clearPresentation(): void {
		if (!this.presented) return;
		const actions = this.actions.focusTarget, slider = this.slider.focusTarget;
		const menu = this.contextMenu;
		const invokingMenu = menu.visible && (menu.invocationOrigin === actions || menu.invocationOrigin === slider);
		const ownsFocus = actions.hasFocus || slider.hasFocus || invokingMenu
			&& (menu.returnFocus === actions || menu.returnFocus === slider)
			&& (menu.focusTarget.hasFocus || inputFocus.pendingTarget === menu.focusTarget);
		this.presented = false;
		if (invokingMenu) menu.hide(false);
		pointerCapture.cancelTarget(this.slider); pointerCapture.cancelTarget(this.actions);
		this.slider.clearInput(); this.actions.clearInput(); this.tooltip.hide();
		this.actions.focusTarget.previous = null; this.slider.focusTarget.next = null;
		if (ownsFocus) this.focusContent();
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
		this.updatePresentation();
		if (!this.presented) return;
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
		this.actions.focusTarget.next = this.range.interactive ? this.slider.focusTarget : this.focusContent;
		const tooltipItem = this.actions.tooltipItem;
		if (tooltipItem !== undefined) this.tooltip.show(tooltipItem.tooltip, tooltipItem.bounds,
			editorViewState.font.renderFont(), measureTextRange, measureText, this.workArea);
		else this.tooltip.hide();
	}
	public handlePointer(snapshot: PointerSnapshot): boolean {
		return this.presented && (this.slider.handlePointer(snapshot) || this.actions.handlePointer(snapshot));
	}
	public draw(): void {
		if (this.presented) drawRuntimeTimeline(this.layout, this.actionState, this.range,
			this.slider.focusTarget.hasFocus, editorViewState.font.renderFont());
	}
	public dispose(): void { this.setContext(undefined, undefined); this.tooltip.detach(); this.slider.dispose(); this.actions.dispose(); }
}
