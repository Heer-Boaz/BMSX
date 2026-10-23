import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandId } from '../../../common/commands';
import { showEditorMessage } from '../../../common/feedback_state';
import type { IdeCommandController } from '../../../commands/controller';
import * as colors from '../../../common/constants';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { truncateMeasuredText } from '../../../common/text';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed, isKeyDown } from '../../../input/keyboard/key_input';
import { pointerCapture } from '../../../input/pointer/capture';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import { formatValueSnapshot } from '../../../runtime/value_snapshot';
import type { RuntimeFrameNavigation } from '../../../runtime/frame_navigation';
import { STATUS_BAR_CONNECTION_WIDTH, updateFullWidthWorkbenchLayout } from '../../common/layout';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import type { QuickInputController } from '../../services/quick_input/controller';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { EventViewerInput } from './editor_input';
import { EVENT_HISTORY_LABEL, eventClipboardText, eventProperties } from './presentation';

const COMMANDS = ['events.clear', 'events.filter', 'events.details', 'events.goToFrame', 'events.previousFrame', 'events.nextFrame', 'events.more'] as const;
const NAVIGATION = ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'] as const;

export class EventViewerPane extends FullWidthWorkbenchEditorPane<EventViewerInput> {
	private readonly actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget, () => this.focus());
	private readonly scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget, input => this.navigate(input));
	private readonly inspector = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly labels = new Map<number, { timeline: string; tick: string; event: string }>();
	private timelineWidth = 0;
	private tickWidth = 0;
	private digitWidth = 0;
	private generation = -1;
	private firstSequence = 0;
	private status = '';
	private historyRevision = -1;
	private historyStatus = '';
	private filter = '';
	private selectedSequence = -1;
	private selectedReachable = false;
	private running = false;
	public constructor(resources: ResourcePanelController, private readonly quickInput: QuickInputController,
		private readonly commands: IdeCommandController, private readonly navigation: RuntimeFrameNavigation, private readonly contextMenu: ContextMenuController) {
		super(resources);
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
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => !this.inspector.visible, run: () => {
			const input = this.input, viewport = input.viewport;
			const top = viewport.offsetTop + input.selected * input.layout.rowHeight;
			this.contextMenu.show(viewport.bounds.left + 4, Math.max(viewport.bounds.top, Math.min(viewport.bounds.bottom, top)),
				WORKBENCH_MENUS['events.context'], this, { selectFirst: true });
		} });
		this.scroll.focusTarget.clipboard = { copy: () => {
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
		super.activate(); this.labels.clear(); this.historyRevision = -1;
		this.actions.setInput(this.input.actions, this.focusTarget); this.scroll.setInput(this.input.viewport);
	}
	public override clearInput(): void {
		this.running = false;
		this.contextMenu.hide();
		this.inspector.hide(); this.actions.clearInput(); this.scroll.clearInput(); this.labels.clear(); super.clearInput();
	}
	public override dispose(): void { this.clearInput(); this.inspector.dispose(); this.actions.dispose(); this.scroll.dispose(); super.dispose(); }
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
		const input = this.input;
		switch (command) {
			case 'events.clear': input.history.clear(); input.selected = -1; input.viewport.scrollbar.setScroll(0); break;
			case 'events.filter': this.quickInput.input('Filter events', 'Event or emitter contains; empty shows all', input.filter, async text => text,
				filter => { input.filter = filter; input.selected = -1; input.viewport.scrollbar.setScroll(0); }); break;
			case 'events.details': {
				const record = input.projection.rows[input.selected];
				this.inspector.show({ title: `Event #${record.sequence}`, items: eventProperties(record), canOpenSource: () => false, openSource: () => {} }); break;
			}
			case 'events.more': {
				const bounds = input.actions.items.find(item => item.command === 'events.more')!.bounds;
				this.contextMenu.show(bounds.left, bounds.bottom, WORKBENCH_MENUS['events.context'], this, { selectFirst: true }); break;
			}
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
					: `Event #${record.sequence}: ${result.status}${result.reason === undefined ? '' : ` (${result.reason})`}.`, colors.COLOR_STATUS_TEXT, 4));
				break;
			}
		}
	}
	public override update(): void {
		const input = this.input, { layout, viewport, history } = input;
		const changed = updateFullWidthWorkbenchLayout(layout, this.contentBounds), row = layout.rowHeight;
		if (this.generation !== history.generation) {
			this.generation = history.generation;
			input.selected = -1;
			this.inspector.hide();
			this.contextMenu.hide();
			this.labels.clear();
		}
		if (changed || this.filter !== input.filter) this.labels.clear();
		if (this.firstSequence !== history.firstSequence) {
			this.firstSequence = history.firstSequence;
			for (const sequence of this.labels.keys()) if (sequence < history.firstSequence) this.labels.delete(sequence);
		}
		const atEnd = viewport.scrollTop + viewport.height >= viewport.contentHeight;
		const scrollTop = viewport.scrollTop;
		const projected = input.projection.update(history, input.filter);
		if (changed) {
			this.digitWidth = 0;
			for (const digit of '0123456789') this.digitWidth = Math.max(this.digitWidth, measureText(digit));
		}
		if (changed || projected) {
			const timelineWidth = Math.max(measureText('Timeline'), measureText('T') + String(input.projection.maxTimeline).length * this.digitWidth) + 8;
			const tickWidth = Math.max(measureText('Tick'), String(input.projection.maxCompletedTick).length * this.digitWidth) + 8;
			if (this.timelineWidth !== timelineWidth || this.tickWidth !== tickWidth) this.labels.clear();
			this.timelineWidth = timelineWidth; this.tickWidth = tickWidth;
		}
		if (input.projection.removed > 0) {
			input.selected = Math.max(-1, input.selected - input.projection.removed);
		}
		if (changed || projected) {
			viewport.layout(layout.left + 4, layout.top + row * 2 + 12, layout.right, layout.bottom, input.projection.rows.length * row);
			if (atEnd && input.selected < 0) viewport.scrollbar.setScroll(viewport.contentHeight);
			else if (input.projection.removed > 0) viewport.scrollbar.setScroll(scrollTop - input.projection.removed * row);
		}
		this.scroll.lineStep = row;
		layoutWorkbenchActionBar(input.actions, layout.right - 4, layout.top + 2, layout.top + row + 6, measureText, layout.font!.renderFont(), layout.left + 4);
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
			const selection = selected === undefined ? '' : `#${selected.sequence} T${selected.timeline}${selectedReachable ? '' : ' | Frame unavailable'} | `;
			this.status = truncateMeasuredText(`${selection}${status} | ${input.projection.rows.length}/${history.count} events${history.expired === 0 ? '' : ` | ${history.expired} older expired`}${filter}`, layout.right - STATUS_BAR_CONNECTION_WIDTH - 8, measureTextRange);
		}
		if (this.inspector.visible) { this.inspector.layout(layout.font!.renderFont(), measureTextRange, measureText, this.contentBounds); this.inspector.update(); }
	}
	public draw(): void {
		if (this.inspector.visible) { drawWorkbenchPropertyInspector(this.inspector); return; }
		const input = this.input, { layout, viewport } = input, font = layout.font!.renderFont();
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		renderWorkbenchActionBar(input.actions, font);
		const timelineLeft = viewport.bounds.left, tickLeft = timelineLeft + this.timelineWidth, eventLeft = tickLeft + this.tickWidth;
		const headerTop = layout.top + layout.rowHeight + 10, headerColor = colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM;
		api.blit_text_inline_with_font('Timeline', timelineLeft, headerTop, 0, headerColor, font);
		api.blit_text_inline_with_font('Tick', tickLeft, headerTop, 0, headerColor, font);
		api.blit_text_inline_with_font('Event / Emitter', eventLeft, headerTop, 0, headerColor, font);
		api.pushClipRect(viewport.bounds.left, viewport.bounds.top, viewport.bounds.right, viewport.bounds.bottom);
		const rows = input.projection.rows;
		if (rows.length === 0) api.blit_text_inline_with_font(input.filter !== '' ? 'No matching events'
			: input.history.status !== 'live' ? EVENT_HISTORY_LABEL[input.history.status] : 'No events yet', viewport.bounds.left, viewport.bounds.top + 4, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		for (let i = Math.trunc(viewport.scrollTop / layout.rowHeight), top = viewport.offsetTop + i * layout.rowHeight;
			i < rows.length && top < viewport.bounds.bottom; i++, top += layout.rowHeight) {
			const event = rows[i], selected = i === input.selected;
			let label = this.labels.get(event.sequence);
			if (label === undefined) {
				label = { timeline: `T${event.timeline}`, tick: String(event.completedTick),
					event: truncateMeasuredText(`${formatValueSnapshot(event.event)} / ${formatValueSnapshot(event.emitter)}`, viewport.bounds.right - eventLeft - 4, measureTextRange) };
				this.labels.set(event.sequence, label);
			}
			if (selected) api.fill_rect(viewport.bounds.left, top, viewport.bounds.right, top + layout.rowHeight, 0, colors.SELECTION_OVERLAY);
			const color = selected ? colors.COLOR_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT;
			api.blit_text_inline_with_font(label.timeline, timelineLeft, top, 0, color, font);
			api.blit_text_inline_with_font(label.tick, tickLeft, top, 0, color, font);
			api.blit_text_inline_with_font(label.event, eventLeft, top, 0, color, font);
		}
		api.popClipRect(); viewport.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		api.blit_text_inline_with_font(this.status, bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont());
	}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (this.inspector.visible) return this.inspector.handlePointer(snapshot);
		if (this.actions.handlePointer(snapshot)) return true;
		const input = this.input;
		const secondary = (snapshot.justPressedButtons & PointerButton.Secondary) !== 0;
		if ((justPressed || secondary) && snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, input.viewport.bounds)) {
			const index = Math.trunc((snapshot.viewportY - input.viewport.offsetTop) / input.layout.rowHeight);
			input.selected = index < input.projection.rows.length ? index : -1;
			if (secondary) {
				this.focus();
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
