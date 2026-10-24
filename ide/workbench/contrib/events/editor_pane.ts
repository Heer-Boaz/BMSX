import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import { clamp } from '../../../../machine/ts/common/clamp';
import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandId } from '../../../common/commands';
import { showEditorMessage } from '../../../common/feedback_state';
import type { IdeCommandController } from '../../../commands/controller';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { truncateMeasuredText } from '../../../common/text';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import type { EditorFont } from '../../../editor/ui/view/font';
import { inputFocus } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../input/keyboard/key_input';
import { pointerCapture } from '../../../input/pointer/capture';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { formatValueSnapshot } from '../../../runtime/value_snapshot';
import type { RuntimeFrameNavigation } from '../../../runtime/frame_navigation';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import type { QuickInputController } from '../../services/quick_input/controller';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import { WorkbenchTooltip } from '../../ui/tooltip';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import type { HistoricalEvent } from '../../../runtime/event_history';
import type { DisposableStore } from '../../../common/lifecycle';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { EventViewerInput } from './editor_input';
import { EVENT_HISTORY_LABEL, EventViewerPresentation, eventClipboardText, eventProperties } from './presentation';
import { layoutEventViewer } from './layout';
import { drawEventViewer } from './render';

const COMMANDS = ['events.clear', 'events.filter', 'events.details', 'events.goToFrame', 'events.previousFrame', 'events.nextFrame', 'events.more'] as const;
const NAVIGATION = ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'] as const;

export class EventViewerPane extends FullWidthWorkbenchEditorPane<EventViewerInput> {
	private readonly actions: WorkbenchActionBarControl;
	private readonly scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget, input => this.navigate(input));
	private readonly inspector = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly presentation = new EventViewerPresentation();
	private readonly tooltip = new WorkbenchTooltip();
	private readonly feedbackBounds = create_rect_bounds();
	private readonly unbindListBlur: () => void;
	private keyboardFeedback = false;
	private hovered = false;
	private pointerX = 0;
	private pointerY = 0;
	private feedbackRecord: HistoricalEvent | undefined;
	private feedbackText = '';
	private generation = -1;
	private status = '';
	private statusText = '';
	private statusWidth = -1;
	private statusFont: EditorFont | undefined;
	private statusDirty = true;
	private historyRevision = -1;
	private historyStatus = '';
	private filter = '';
	private selectedSequence = -1;
	private selectedReachable = false;
	private running = false;
	private filterSession: DisposableStore | undefined;
	public constructor(resources: ResourcePanelController, private readonly quickInput: QuickInputController,
		private readonly commands: IdeCommandController, private readonly navigation: RuntimeFrameNavigation, private readonly contextMenu: ContextMenuController,
		private readonly surfaces: WorkbenchSurfaceService, private readonly owner: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>) {
		super(resources);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget, () => this.focus(), contextMenu);
		this.actions.onDidOpenOverflow = () => { this.tooltip.hide(); this.keyboardFeedback = false; };
		this.tooltip.attach(surfaces, owner, workArea);
		this.unbindListBlur = this.scroll.focusTarget.onDidBlur(() => { this.keyboardFeedback = false; this.tooltip.hide(); });
		this.focusTarget.registerCommand('pause', { isEnabled: () => commands.transport.playbackEnabled,
			run: () => { this.running = commands.transport.togglePlayback(); } });
		this.focusTarget.registerCommand('runtime.pause', { isEnabled: () => true, run: () => { this.running = false; } });
		this.focusTarget.registerCommand('runtime.resume', { isEnabled: () => true, run: () => { this.running = true; } });
		for (const [command, direction] of [['stepFrameBack', -1], ['stepFrame', 1]] as const) {
			this.focusTarget.registerCommand(command, {
				isEnabled: () => navigation.canStep(direction),
				run: () => { this.running = false; navigation.step(direction); },
			});
		}
		this.scroll.focusTarget.commandContext = this.focusTarget;
		for (const command of COMMANDS) this.focusTarget.registerCommand(command, { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) });
		this.scroll.focusTarget.registerCommand('list.find', this.focusTarget.getCommand('events.filter')!);
		const context = { isEnabled: () => !this.inspector.visible, run: () => {
			const input = this.input, viewport = input.viewport;
			const top = viewport.offsetTop + input.selected * input.layout.rowHeight;
			this.tooltip.hide(); this.keyboardFeedback = false;
			this.contextMenu.show(viewport.bounds.left + 4, clamp(top, viewport.bounds.top, viewport.bounds.bottom),
				WORKBENCH_MENUS['events.context'], this, { selectFirst: true });
		} };
		this.focusTarget.registerCommand('contextMenu', context);
		this.scroll.focusTarget.registerCommand('contextMenu', context);
		this.scroll.focusTarget.clipboard = { readOnly: true, copy: () => {
			const record = this.input.projection.rows[this.input.selected];
			return record === undefined ? null : eventClipboardText(record);
		} };
		this.focusTarget.next = this.actions.focusTarget;
		this.actions.focusTarget.next = this.scroll.focusTarget; this.actions.focusTarget.previous = this.scroll.focusTarget;
		this.scroll.focusTarget.next = this.actions.focusTarget; this.scroll.focusTarget.previous = this.actions.focusTarget;
	}
	public override get suspendsRuntime(): boolean { return !this.running; }
	public override get runtimeTransport() { return this.runtimeControlContext === undefined ? undefined : this.commands.transport; }
	public override get runtimeControlContext() { return this.focusTarget; }
	public override focus(): void { (this.inspector.visible ? this.inspector : this.scroll).focusTarget.focus(); }
	protected override activate(): void {
		super.activate(); this.presentation.reset(); this.historyRevision = -1;
		this.actions.setInput(this.input.actions, this.focusTarget); this.scroll.setInput(this.input.viewport);
	}
	public override clearInput(): void {
		this.running = false;
		if (this.filterSession !== undefined) this.quickInput.hide();
		this.tooltip.hide(); pointerHover.release(this); this.feedbackRecord = undefined;
		this.contextMenu.hide();
		this.inspector.hide(); this.actions.clearInput(); this.scroll.clearInput(); this.presentation.reset(); super.clearInput();
	}
	public override dispose(): void {
		this.clearInput(); this.tooltip.detach(); this.unbindListBlur();
		this.inspector.dispose(); this.actions.dispose(); this.scroll.dispose(); super.dispose();
	}
	public isEnabled(command: EditorCommandId): boolean {
		if (this.inspector.visible) return false;
		const record = this.input.projection.rows[this.input.selected];
		if (command === 'events.details') return record !== undefined;
		if (command === 'events.goToFrame') return record !== undefined && this.navigation.available && this.input.history.canSeek(record);
		if (command === 'events.previousFrame' || command === 'events.nextFrame') return this.navigation.available
			&& this.adjacentEvent(command === 'events.previousFrame' ? -1 : 1) >= 0;
		if (command === 'events.clear') return this.input.history.count !== 0;
		return command === 'events.filter' || command === 'events.more';
	}
	private adjacentEvent(direction: -1 | 1): number {
		const input = this.input;
		if (input.selected < 0) return -1;
		for (let index = input.selected + direction; index >= 0 && index < input.projection.rows.length; index += direction) {
			if (input.history.canSeek(input.projection.rows[index])) return index;
		}
		return -1;
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		this.tooltip.hide(); this.keyboardFeedback = false;
		const input = this.input;
		switch (command) {
			case 'events.clear': input.history.clear(); input.selected = -1; input.viewport.scrollbar.setScroll(0); break;
			case 'events.filter': {
				this.quickInput.input('Filter events', 'Event or emitter contains; empty shows all', input.filter, async text => text,
					filter => { input.filter = filter; input.selected = -1; input.viewport.scrollbar.setScroll(0); }, lifetime => {
						this.filterSession = lifetime;
						lifetime.add({ dispose: () => { if (this.filterSession === lifetime) this.filterSession = undefined; } });
					}); break;
			}
			case 'events.details': {
				const record = input.projection.rows[input.selected];
				this.inspector.attachFeedback(this.surfaces, this.owner, this.workArea);
				this.inspector.show({ title: `Event #${record.sequence}`, items: eventProperties(record), canOpenSource: () => false, openSource: () => {} }); break;
			}
			case 'events.more': this.actions.openOverflow(); break;
			case 'events.goToFrame': case 'events.previousFrame': case 'events.nextFrame': {
				if (command !== 'events.goToFrame') {
					input.selected = this.adjacentEvent(command === 'events.previousFrame' ? -1 : 1);
					input.viewport.scrollbar.reveal(input.selected * input.layout.rowHeight, (input.selected + 1) * input.layout.rowHeight, 0);
				}
				const record = input.projection.rows[input.selected];
				this.running = false;
				const operation = this.navigation.seek(record.cycles);
				void operation.completion.then(result => showEditorMessage(result.status === 'completed'
					? `Frame ${result.after.videoTick} at/before event #${record.sequence} (timeline ${record.timeline}).`
					: `Event #${record.sequence}: ${result.status}${result.reason === undefined ? '' : ` (${result.reason})`}.`, 'info', 4));
				break;
			}
		}
	}
	public override update(): void {
		const input = this.input, { layout, viewport, history } = input;
		if (this.generation !== history.generation) {
			this.generation = history.generation;
			if (this.filterSession !== undefined) this.quickInput.hide();
			input.selected = -1;
			this.inspector.hide();
			this.contextMenu.hide();
			this.tooltip.hide(); pointerHover.release(this); this.feedbackRecord = undefined;
		}
		const atEnd = viewport.scrollTop + viewport.height >= viewport.contentHeight;
		const leadingRow = layout.font === null ? 0 : viewport.scrollTop / layout.rowHeight;
		const projected = input.projection.update(history, input.filter);
		const changed = layoutEventViewer(input, this.contentBounds, projected), row = layout.rowHeight;
		if (input.projection.removed > 0) {
			input.selected = Math.max(-1, input.selected - input.projection.removed);
		}
		if (changed || projected) {
			if (atEnd && input.selected < 0) viewport.scrollbar.setScroll(viewport.contentHeight);
			else if (input.projection.removed > 0) viewport.scrollbar.setScroll((leadingRow - input.projection.removed) * row);
		}
		this.scroll.lineStep = row;
		const filterAction = input.actions.items[0];
		if (this.filter !== input.filter) filterAction.checked = input.filter !== '';
		this.actions.update();
		const historyStatus = history.status;
		const selected = input.projection.rows[input.selected], selectedSequence = selected === undefined ? -1 : selected.sequence;
		const selectedReachable = selected !== undefined && history.canSeek(selected);
		if (changed || this.historyRevision !== history.revision || this.historyStatus !== historyStatus || this.filter !== input.filter
			|| this.selectedSequence !== selectedSequence || this.selectedReachable !== selectedReachable) {
			this.historyRevision = history.revision; this.historyStatus = historyStatus; this.filter = input.filter;
			this.selectedSequence = selectedSequence; this.selectedReachable = selectedReachable;
			const filter = input.filter === '' ? '' : ` | filter: ${input.filter}`;
			const status = EVENT_HISTORY_LABEL[historyStatus];
			const selection = selected === undefined ? '' : `${formatValueSnapshot(selected.event)} | #${selected.sequence} T${selected.timeline} | tick ${selected.completedTick}${selectedReachable ? '' : ' | Frame unavailable'} | `;
			this.status = `${selection}${status} | ${input.projection.rows.length}/${history.count} events${history.expired === 0 ? '' : ` | ${history.expired} older expired`}${filter}`;
			this.statusDirty = true;
		}
		this.presentation.update(input, changed, projected);
		if (this.inspector.visible) {
			this.tooltip.hide();
			this.inspector.layout(layout.font!.renderFont(), measureTextRange, measureText, this.contentBounds); this.inspector.update();
		} else this.updateFeedback();
	}
	public draw(): void {
		if (this.inspector.visible) { drawWorkbenchPropertyInspector(this.inspector); return; }
		drawEventViewer(this.input, this.presentation, this.scroll.focusTarget.hasFocus);
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		const width = bounds.right - bounds.left - 8, font = editorViewState.font;
		if (this.statusDirty || this.statusWidth !== width || this.statusFont !== font) {
			this.statusText = truncateMeasuredText(this.status, width, measureTextRange);
			this.statusDirty = false; this.statusWidth = width; this.statusFont = font;
		}
		api.pushClipRect(bounds.left, bounds.top, bounds.right, bounds.bottom);
		api.blit_text_inline_with_font(this.statusText, bounds.left + 4, bounds.top + 2, 0, color, font.renderFont());
		api.popClipRect();
	}
	private updateFeedback(): void {
		const input = this.input, { layout, viewport } = input, font = layout.font!.renderFont();
		const action = this.actions.tooltipItem;
		if (action !== undefined) {
			this.tooltip.show(action.tooltip, action.bounds, font, measureTextRange, measureText, this.workArea); return;
		}
		const pointer = this.hovered && pointerHover.has(this) && point_in_rect(this.pointerX, this.pointerY, viewport.bounds);
		const index = this.keyboardFeedback && this.scroll.focusTarget.hasFocus ? input.selected
			: pointer ? Math.trunc((this.pointerY - viewport.offsetTop) / layout.rowHeight) : -1;
		if (index < 0) { this.tooltip.hide(); return; }
		for (const row of this.presentation.rows) if (row.index === index) {
			if (!layout.compact && row.label.event === row.label.fullEvent) break;
			const record = input.projection.rows[index];
			if (record !== this.feedbackRecord) {
				this.feedbackRecord = record;
				this.feedbackText = `${row.label.fullEvent}\n#${record.sequence} | T${record.timeline} | tick ${record.completedTick}`;
			}
			write_rect_bounds(this.feedbackBounds, layout.eventLeft, row.top, layout.eventLeft + layout.eventWidth, row.top + layout.rowHeight);
			this.tooltip.show(this.feedbackText, this.feedbackBounds, font, measureTextRange, measureText, this.workArea); return;
		}
		this.tooltip.hide();
	}
	public onPointerLeave(): void { this.hovered = false; this.tooltip.hide(); }
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		this.hovered = false;
		if (this.inspector.visible) return this.inspector.handlePointer(snapshot);
		if (this.actions.handlePointer(snapshot)) return true;
		const input = this.input;
		const secondary = (snapshot.justPressedButtons & PointerButton.Secondary) !== 0;
		if (snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, input.viewport.bounds)) {
			if (snapshot.viewportX !== this.pointerX || snapshot.viewportY !== this.pointerY || justPressed || secondary) this.keyboardFeedback = false;
			this.pointerX = snapshot.viewportX; this.pointerY = snapshot.viewportY; this.hovered = true;
			pointerHover.visit(this);
		}
		if ((justPressed || secondary) && snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, input.viewport.bounds)) {
			const index = Math.trunc((snapshot.viewportY - input.viewport.offsetTop) / input.layout.rowHeight);
			input.selected = index < input.projection.rows.length ? index : -1;
			if (secondary) {
				this.focus();
				this.tooltip.hide();
				this.contextMenu.show(snapshot.viewportX, snapshot.viewportY, WORKBENCH_MENUS['events.context'], this);
				return true;
			}
		}
		return this.scroll.handlePointer(snapshot);
	}
	private navigate(input: KeyInputEvent): boolean {
		if (input.modifiers !== KeyModifier.none) return false;
		const view = this.input;
		if (isKeyJustPressed('Enter', input)) { consumeIdeKey('Enter', input); this.execute('events.details'); return true; }
		for (const key of NAVIGATION) if (isKeyDown(key, input)) {
			consumeIdeKey(key, input);
			this.keyboardFeedback = true;
			const count = view.projection.rows.length, page = Math.max(1, Math.trunc(view.viewport.height / view.layout.rowHeight));
			view.selected = Math.max(-1, Math.min(count - 1, key === 'Home' ? 0 : key === 'End' ? count - 1
				: view.selected + (key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : key === 'PageUp' ? -page : page)));
			if (view.selected >= 0) view.viewport.scrollbar.reveal(view.selected * view.layout.rowHeight, (view.selected + 1) * view.layout.rowHeight, 0);
			return true;
		}
		return false;
	}
	public handleKeyboard(input: KeyInputEvent): void { this.navigate(input); }
	public handleWheel(event: WheelInputSnapshot): void {
		(this.inspector.visible ? this.inspector : this.scroll).handleWheel(event, event.deltaY * this.input.layout.rowHeight);
	}
}
