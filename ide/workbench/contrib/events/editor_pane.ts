import { KeyModifier, type PlayerInput } from '../../../../hosts/common/input/player';
import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandId } from '../../../common/commands';
import type { IdeCommandController } from '../../../commands/controller';
import * as colors from '../../../common/constants';
import type { PointerSnapshot } from '../../../common/models';
import { truncateMeasuredText } from '../../../common/text';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus } from '../../../input/focus';
import { consumeIdeKey, isKeyJustPressed, shouldRepeatKeyFromPlayer } from '../../../input/keyboard/key_input';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import type { RuntimeFrameNavigation } from '../../../runtime/frame_navigation';
import { STATUS_BAR_CONNECTION_WIDTH, updateFullWidthWorkbenchLayout } from '../../common/layout';
import { renderWorkbenchActionBar } from '../../render/action_bar';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import type { QuickInputController } from '../../services/quick_input/controller';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { EventViewerInput } from './editor_input';
import { EVENT_CAPTURE_LABEL, eventClipboardText, eventProperties } from './presentation';

const COMMANDS = ['events.record', 'events.clear', 'events.filter', 'events.details'] as const;
const NAVIGATION = ['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'] as const;

export class EventViewerPane extends FullWidthWorkbenchEditorPane<EventViewerInput> {
	private readonly actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget);
	private readonly scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget, input => this.navigate(input));
	private readonly inspector = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly labels = new Map<number, string>();
	private generation = -1;
	private status = '';
	private captureRevision = -1;
	private captureStatus = '';
	private filter = '';
	private running = false;
	public constructor(resources: ResourcePanelController, private readonly quickInput: QuickInputController,
		commands: IdeCommandController, navigation: RuntimeFrameNavigation) {
		super(resources);
		this.focusTarget.registerCommand('pause', { isEnabled: () => commands.isEnabled('gameView.playback'),
			run: () => { this.running = commands.toggleGamePlayback(); } });
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
		this.scroll.focusTarget.clipboard = { copy: () => {
			const record = this.input.projection.rows[this.input.selected];
			return record === undefined ? null : eventClipboardText(record);
		} };
		this.focusTarget.next = this.actions.focusTarget;
		this.actions.focusTarget.next = this.scroll.focusTarget; this.actions.focusTarget.previous = this.scroll.focusTarget;
		this.scroll.focusTarget.next = this.actions.focusTarget; this.scroll.focusTarget.previous = this.actions.focusTarget;
	}
	public override get suspendsRuntime(): boolean { return !this.running; }
	public override get runtimeControlContext() { return this.focusTarget; }
	public override focus(): void { this.scroll.focusTarget.focus(); }
	protected override activate(): void {
		super.activate(); this.labels.clear(); this.captureRevision = -1;
		this.actions.setInput(this.input.actions, this.focusTarget); this.scroll.setInput(this.input.viewport); this.update();
	}
	public override clearInput(): void {
		this.running = false;
		this.inspector.hide(); this.actions.clearInput(); this.scroll.clearInput(); this.labels.clear(); super.clearInput();
	}
	public override dispose(): void { this.clearInput(); this.inspector.dispose(); this.actions.dispose(); this.scroll.dispose(); super.dispose(); }
	public isEnabled(command: EditorCommandId): boolean {
		if (command === 'events.details') return this.input.selected >= 0 && this.input.selected < this.input.projection.rows.length;
		if (command === 'events.clear') return this.input.capture.records.length !== 0;
		return command === 'events.record' || command === 'events.filter';
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		const input = this.input;
		switch (command) {
			case 'events.record': input.capture.status === 'recording' ? input.capture.stop() : input.capture.start(); break;
			case 'events.clear': input.capture.clear(); input.selected = -1; input.viewport.scrollbar.setScroll(0); break;
			case 'events.filter': this.quickInput.input('Filter events', 'Event or emitter contains; empty shows all', input.filter, async text => text,
				filter => { input.filter = filter; input.selected = -1; input.viewport.scrollbar.setScroll(0); }); break;
			case 'events.details': {
				const record = input.projection.rows[input.selected];
				this.inspector.show({ title: `Event #${record.sequence}`, items: eventProperties(record), canOpenSource: () => false, openSource: () => {} }); break;
			}
		}
	}
	public override update(): void {
		const input = this.input, { layout, viewport, capture } = input;
		const changed = updateFullWidthWorkbenchLayout(layout, this.contentBounds), row = layout.rowHeight;
		if (this.generation !== capture.generation) {
			this.generation = capture.generation;
			input.selected = -1;
			this.inspector.hide();
			this.labels.clear();
		}
		if (changed) this.labels.clear();
		const atEnd = viewport.scrollTop + viewport.height >= viewport.contentHeight;
		const projected = input.projection.update(capture, input.filter);
		if (changed || projected) {
			viewport.layout(layout.left + 4, layout.top + row * 2 + 12, layout.right, layout.bottom, input.projection.rows.length * row);
			if (atEnd && input.selected < 0) viewport.scrollbar.setScroll(viewport.contentHeight);
		}
		this.scroll.lineStep = row;
		input.actions.items[0].label = capture.status === 'recording' ? 'Stop' : 'Record';
		layoutWorkbenchActionBar(input.actions, layout.right - 4, layout.top + 2, layout.top + row + 6, measureText, layout.font!.renderFont());
		this.actions.update();
		if (changed || this.captureRevision !== capture.revision || this.captureStatus !== capture.status || this.filter !== input.filter) {
			this.captureRevision = capture.revision; this.captureStatus = capture.status; this.filter = input.filter;
			const filter = input.filter === '' ? '' : ` | filter: ${input.filter}`;
			const status = EVENT_CAPTURE_LABEL[capture.status];
			this.status = truncateMeasuredText(`${status} | ${input.projection.rows.length}/${capture.records.length} events${filter}`, layout.right - STATUS_BAR_CONNECTION_WIDTH - 8, measureTextRange);
		}
		if (this.inspector.visible) { this.inspector.layout(layout.font!.renderFont(), measureTextRange, measureText, this.contentBounds); this.inspector.update(); }
	}
	public draw(): void {
		if (this.inspector.visible) { drawWorkbenchPropertyInspector(this.inspector); return; }
		const input = this.input, { layout, viewport } = input, font = layout.font!.renderFont();
		api.fill_rect(layout.left, layout.top, layout.right, layout.bottom, 0, colors.COLOR_CODE_BACKGROUND);
		renderWorkbenchActionBar(input.actions, font);
		api.blit_text_inline_with_font('Tick  Event / Emitter', layout.left + 4, layout.top + layout.rowHeight + 10, 0, colors.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM, font);
		api.pushClipRect(viewport.bounds.left, viewport.bounds.top, viewport.bounds.right, viewport.bounds.bottom);
		const rows = input.projection.rows;
		if (rows.length === 0) api.blit_text_inline_with_font(input.filter !== '' ? 'No matching events'
			: input.capture.status === 'recording' ? 'Waiting for events' : 'Record to capture cart events', viewport.bounds.left, viewport.bounds.top + 4, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		for (let i = Math.trunc(viewport.scrollTop / layout.rowHeight), top = viewport.offsetTop + i * layout.rowHeight;
			i < rows.length && top < viewport.bounds.bottom; i++, top += layout.rowHeight) {
			const event = rows[i], selected = i === input.selected;
			let label = this.labels.get(event.sequence);
			if (label === undefined) {
				label = truncateMeasuredText(`${event.completedTick}  ${event.event.display} / ${event.emitter.display}`, viewport.bounds.right - viewport.bounds.left - 4, measureTextRange);
				this.labels.set(event.sequence, label);
			}
			if (selected) api.fill_rect(viewport.bounds.left, top, viewport.bounds.right, top + layout.rowHeight, 0, colors.SELECTION_OVERLAY);
			api.blit_text_inline_with_font(label, viewport.bounds.left, top, 0, selected ? colors.COLOR_SELECTION_TEXT : colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		}
		api.popClipRect(); viewport.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	}
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void {
		api.blit_text_inline_with_font(this.status, bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont());
	}
	protected override handleViewPointer(snapshot: PointerSnapshot, justPressed: boolean): boolean {
		if (this.inspector.visible) return this.inspector.handlePointer(snapshot);
		if (this.actions.handlePointer(snapshot)) return true;
		const input = this.input;
		if (justPressed && snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, input.viewport.bounds)) {
			const index = Math.trunc((snapshot.viewportY - input.viewport.offsetTop) / input.layout.rowHeight);
			input.selected = index < input.projection.rows.length ? index : -1;
		}
		return this.scroll.handlePointer(snapshot);
	}
	private navigate(input: PlayerInput): boolean {
		if (input.getModifiers() !== KeyModifier.none) return false;
		const view = this.input;
		if (isKeyJustPressed('Enter', input)) { consumeIdeKey('Enter', input); this.execute('events.details'); return true; }
		for (const key of NAVIGATION) if (shouldRepeatKeyFromPlayer(key, input)) {
			consumeIdeKey(key, input);
			const count = view.projection.rows.length, page = Math.max(1, Math.trunc(view.viewport.height / view.layout.rowHeight));
			view.selected = Math.max(-1, Math.min(count - 1, key === 'Home' ? 0 : key === 'End' ? count - 1
				: view.selected + (key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : key === 'PageUp' ? -page : page)));
			if (view.selected >= 0) view.viewport.scrollbar.reveal(view.selected * view.layout.rowHeight, (view.selected + 1) * view.layout.rowHeight, 0);
			return true;
		}
		return false;
	}
	public handleKeyboard(input: PlayerInput): void { this.navigate(input); }
	public handleWheel(direction: number, steps: number, pointer: PointerSnapshot | null): void {
		if (pointer !== null) (this.inspector.visible ? this.inspector : this.scroll).handleWheel(pointer, direction * steps * this.input.layout.rowHeight);
	}
}
