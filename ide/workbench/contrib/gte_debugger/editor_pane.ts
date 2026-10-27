import type { EditorGroupView } from '../../services/editor/editor_group';
import { SCROLLBAR_WIDTH } from '../../../common/constants';
import { clamp } from '../../../../machine/ts/common/clamp';
import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import type { IdeCommandController } from '../../../commands/controller';
import type { EditorCommandId } from '../../../common/commands';
import { showEditorMessage } from '../../../common/feedback_state';
import type { DisposableStore } from '../../../common/lifecycle';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { truncateMeasuredText, writeWrappedMeasuredLine } from '../../../common/text';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorTextModelService } from '../../../editor/model/model_service';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusScope } from '../../../input/focus';
import { consumeIdeKey, isKeyDown, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import type { RuntimeFrameNavigation } from '../../../runtime/frame_navigation';
import { api } from '../../../runtime/overlay_api';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import type { ContextMenuController } from '../../services/context_menu/controller';
import { CapturedLuaSourceBinding } from '../../services/working_copy/captured_lua_source';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import type { QuickInputController } from '../../services/quick_input/controller';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import { WorkbenchTooltip } from '../../ui/tooltip';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import type { EditorNavigationController } from '../resources/navigation';
import type { GteDebuggerInput } from './editor_input';
import { gteCommandName } from './presentation';
import { GteDetailsWindow } from './details_window';
import { drawGteDebugger, type GteCommandRow } from './render';

const COMMANDS = ['gte.follow', 'gte.view', 'gte.details', 'gte.source', 'gte.goToFrame', 'gte.filter', 'gte.clear'] as const;
const CLIENT_COMMANDS = [...COMMANDS, 'pause', 'stepFrameBack', 'stepFrame'] as const;
const NAVIGATION = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'] as const;
// Keep a command identity and sequence readable beside the observed scanout.
const COMMAND_READING_COLUMNS = 32;

export class GteDebuggerPane extends WorkbenchViewEditorPane<GteDebuggerInput> {
	public override get companionGameMinimumWidth(): number { return editorViewState.charAdvance * COMMAND_READING_COLUMNS + SCROLLBAR_WIDTH + 12; }

	private readonly actions: WorkbenchActionBarControl;
	private readonly scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget, event => this.navigate(event));
	private details: GteDetailsWindow | undefined;
	private readonly tooltip = new WorkbenchTooltip();
	private readonly emptyLines: string[] = [];
	private emptyFiltered: boolean | undefined;
	private popup: DisposableStore | undefined;
	private unbindSelection: (() => void) | undefined;
	private readonly unbindSource: () => void;
	private readonly rows: GteCommandRow[] = [];
	private readonly labels = new Map<number, string>();
	private status = '';
	private historyRevision = -1;
	private following = false;
	private selectedReachable = false;
	private sourceRevision = -1;
	private readonly source: CapturedLuaSourceBinding;
	private selectionRevision = -1;
	private rowFirst = -1;
	private rowLast = -1;
	private listOffset: number | undefined;
	private firstSequence = -1;
	private labelGeneration = -1;
	private freshLayout = true;
	public constructor(private readonly quickInput: QuickInputController,
		private readonly commands: IdeCommandController, private readonly navigation: RuntimeFrameNavigation,
		private readonly contextMenu: ContextMenuController, sources: RuntimeSourceState,
		private readonly sourceNavigation: EditorNavigationController, private readonly surfaces: WorkbenchSurfaceService,
		private readonly paneSurface: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>, private readonly group: EditorGroupView, scope: InputFocusScope) {
		super(scope);
		this.source = new CapturedLuaSourceBinding(editorTextModelService, sources.catalog);
		this.unbindSource = this.source.onDidChange(() => this.retireContextMenu());
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, commands, this.focusTarget, () => this.focus(), contextMenu);
		this.actions.onDidOpenOverflow = lifetime => {
			this.input.following = false; this.source.update(); this.ownContextMenu(lifetime);
		};
		this.scroll.onWillScroll = () => { this.input.following = false; };
		for (const command of COMMANDS) this.focusTarget.registerCommand(command, { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) });
		this.focusTarget.registerCommand('pause', { isEnabled: () => commands.transport.playbackEnabled,
			run: () => { this.input.interaction.running = commands.transport.togglePlayback(); } });
		for (const [command, direction] of [['stepFrameBack', -1], ['stepFrame', 1]] as const) this.focusTarget.registerCommand(command, {
			isEnabled: () => navigation.canStep(direction), run: () => { this.input.interaction.running = false; navigation.step(direction); },
		});
		for (const command of CLIENT_COMMANDS) this.scroll.focusTarget.registerCommand(command, this.focusTarget.getCommand(command)!);
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => this.hasInput, run: () => {
			this.input.following = false;
			this.showContextMenu(this.input.list.bounds.left, this.input.list.bounds.top, true);
		} });
		this.scroll.focusTarget.commandContext = this.focusTarget;
		this.scroll.focusTarget.registerCommand('contextMenu', this.focusTarget.getCommand('contextMenu')!);
		this.scroll.focusTarget.registerCommand('list.find', this.focusTarget.getCommand('gte.filter')!);
		// The full-width history and its actions are the main pane's reading controls.
		this.actions.focusTarget.next = this.scroll.focusTarget; this.actions.focusTarget.previous = this.scroll.focusTarget;
		this.scroll.focusTarget.next = this.actions.focusTarget; this.scroll.focusTarget.previous = this.actions.focusTarget;
		this.focusTarget.next = this.actions.focusTarget; this.focusTarget.previous = this.scroll.focusTarget;
	}
	public override get commandTarget() { return this.scroll.focusTarget; }
	protected override activate(): void {
		this.input.interaction.setRuntime(this.commands.transport);
		this.focusTarget.scope.interaction = this.input.interaction;
		this.focusTarget.scope.runtime = { target: this.focusTarget, interaction: this.input.interaction };
		this.freshLayout = true; this.historyRevision = -1; this.labels.clear();
		this.actions.setInput(this.input.actions, this.focusTarget); this.scroll.setInput(this.input.list);
		this.unbindSelection = this.input.onWillChangeSelection(() => { this.retireContextMenu(); this.actions.cancelCommand('gte.details'); });
		this.tooltip.attach(this.surfaces, this.paneSurface, this.workArea);
		const details = this.details = new GteDetailsWindow(this.input, this.commands, this.surfaces, this.paneSurface, this.scroll.focusTarget,
			this.workArea, this.quickInput, this.contextMenu, this.source, () => this.openSource());
		for (const target of [details.window.focusTarget, details.inspector.focusTarget, details.diagramControl.focusTarget, details.viewActions.focusTarget])
			for (const command of CLIENT_COMMANDS)
				if (command !== 'gte.source' && command !== 'gte.view') target.registerCommand(command, this.focusTarget.getCommand(command)!);
		this.sourceRevision = -1;
		this.update();
	}
	public override clearInput(): void {
		this.input.interaction.setRuntime(null);
		this.unbindSelection!(); this.unbindSelection = undefined; this.retireContextMenu(); this.tooltip.detach(); this.details!.dispose(); this.details = undefined;
		this.actions.clearInput(); this.scroll.clearInput();
		this.source.clear(); this.labels.clear(); this.rows.length = 0;
		super.clearInput();
	}
	public override dispose(): void { if (this.hasInput) this.clearInput(); this.unbindSource(); this.source.clear(); this.actions.dispose(); this.scroll.dispose(); super.dispose(); }
	/** Input events may select and inspect another command before the next host frame. */
	private synchronizeSelection(): void {
		const input = this.input;
		if (this.sourceRevision !== input.selectionRevision) {
			this.sourceRevision = input.selectionRevision;
			if (input.selected.sequence < 0) this.source.clear();
			else this.source.bind(input.selected.image, input.selected.pc);
		}
	}

	private ownContextMenu(lifetime: DisposableStore): void {
		this.popup = lifetime; this.tooltip.hide();
		lifetime.add({ dispose: () => { if (this.popup === lifetime) this.popup = undefined; } });
	}
	private retireContextMenu(): void { if (this.popup !== undefined) this.contextMenu.hide(); }
	/** The actual menu lifetime retires with its captured selection or authored-source generation. */
	private showContextMenu(x: number, y: number, selectFirst = false): void {
		this.synchronizeSelection(); this.source.update();
		this.contextMenu.show(x, y, WORKBENCH_MENUS['gte.context'], this.commands, {
			selectFirst, invocationOrigin: this.scroll.focusTarget, commandTarget: this.focusTarget, onWillShow: lifetime => this.ownContextMenu(lifetime),
		});
	}

	private openSource(): void {
		this.synchronizeSelection(); this.source.update();
		if (this.source.status !== 'available') return;
		const { resource, range } = this.source.location!;
		void this.sourceNavigation.focusChunkSource(this.group, resource,
			{ row: range.start.line - 1, startColumn: range.start.column - 1,
				endColumn: range.end.line === range.start.line ? range.end.column - 1 : range.start.column });
	}
	public isEnabled(command: EditorCommandId): boolean {
		if (!this.hasInput) return false;
		const input = this.input, selected = input.selected.sequence >= 0;
		if (command === 'gte.source') {
			this.synchronizeSelection(); this.source.update();
			return this.source.status === 'available';
		}
		if (command === 'gte.goToFrame') return selected && this.navigation.available && input.history.canSeek(input.selected);
		if (command === 'gte.details') return selected || input.detailsWindow.open;
		if (command === 'gte.view') return selected;
		if (command === 'gte.clear') return input.history.count > 0;
		return command === 'gte.follow' || command === 'gte.filter';
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		this.synchronizeSelection();
		const input = this.input;
		switch (command) {
			case 'gte.follow': input.following = true; break;
			case 'gte.view': input.following = false; this.details!.show(); this.details!.chooseView(); break;
			case 'gte.filter': this.quickInput.input('Filter GTE events', 'Opcode or PLUS phase; empty shows all', input.filter, async text => text, text => { input.filter = text; input.list.scrollbar.setScroll(0); }); break;
			case 'gte.clear': input.clear(); break;
			case 'gte.source': this.openSource(); break;
			case 'gte.goToFrame': {
				input.interaction.running = false; const sequence = input.selected.sequence;
				void this.navigation.seek(input.selected.cycles).completion.then(result => showEditorMessage(
					result.status === 'completed' ? `Frame ${result.after.videoTick} at/before #${sequence}` : `GTE: ${result.status}`, 'info', 4)); break;
			}
			case 'gte.details': {
				input.following = false;
				this.details!.show(); break;
			}
		}
	}
	public override update(): void {
		const input = this.input, { layout, list } = input;
		const layoutChanged = updateFullWidthWorkbenchLayout(layout, this.contentBounds) || this.freshLayout;
		this.freshLayout = false; const projectionChanged = input.update();
		const top = layout.top + layout.rowHeight + 10;
		list.layout(layout.left + 4, top, layout.right - 4, layout.bottom, input.projection.rows.length * layout.rowHeight);
		this.scroll.lineStep = layout.rowHeight;
		if (input.following && input.projection.rows.length > 0) list.scrollbar.reveal(list.contentHeight - layout.rowHeight, list.contentHeight, 0);
		layoutWorkbenchActionBar(input.actions, layout.right - 4, layout.top + 2, top - 4, measureText, layout.font!.renderFont(), layout.left + 4);
		input.actions.items[0].checked = input.following; this.actions.update();
		this.synchronizeSelection();
		const selectedChanged = this.selectionRevision !== input.selectionRevision;
		this.selectionRevision = input.selectionRevision;
		this.source.update();
		const hint = this.actions.tooltipItem;
		if (hint === undefined) this.tooltip.hide();
		else this.tooltip.show(hint.tooltip, hint.bounds, layout.font!.renderFont(), measureTextRange, measureText, this.workArea);
		if (layoutChanged || this.emptyFiltered !== (input.filter !== '')) {
			this.emptyFiltered = input.filter !== ''; this.emptyLines.length = 0;
			writeWrappedMeasuredLine(this.emptyLines, this.emptyFiltered ? 'No matching GTE events.' : 'No GTE events observed. Play or step the existing runtime.', list.bounds.right - list.bounds.left - 8, measureTextRange);
		}
		if (layoutChanged || this.labelGeneration !== input.history.generation) {
			this.labelGeneration = input.history.generation; this.labels.clear();
		}
		if (this.firstSequence !== input.history.firstSequence) {
			this.firstSequence = input.history.firstSequence;
			for (const sequence of this.labels.keys()) if (sequence < this.firstSequence) this.labels.delete(sequence);
		}
		const first = Math.max(0, Math.trunc(list.scrollTop / layout.rowHeight));
		const end = Math.min(input.projection.rows.length, first + Math.trunc(list.height / layout.rowHeight) + 2);
		const firstSequence = input.projection.rows[first] ?? -1, lastSequence = input.projection.rows[end - 1] ?? -1;
		if (layoutChanged || projectionChanged || firstSequence !== this.rowFirst || lastSequence !== this.rowLast || this.listOffset !== list.offsetTop) {
			let count = 0;
			for (let index = first, y = list.offsetTop + first * layout.rowHeight; index < end && y < list.bounds.bottom; index++, y += layout.rowHeight) {
				const sequence = input.projection.rows[index];
				let label = this.labels.get(sequence);
				if (label === undefined) {
					const record = input.history.at(sequence);
					label = truncateMeasuredText(`${gteCommandName(record.commandWord, record.kind)} #${sequence}`, list.bounds.right - list.bounds.left - 4, measureTextRange); this.labels.set(sequence, label);
				}
				const row = this.rows[count];
				if (row === undefined) this.rows.push({ sequence, top: y, label });
				else { row.sequence = sequence; row.top = y; row.label = label; }
				count++;
			}
			this.rows.length = count; this.rowFirst = firstSequence; this.rowLast = lastSequence; this.listOffset = list.offsetTop;
		}
		const selectedReachable = input.selected.sequence >= 0 && input.history.canSeek(input.selected);
		if (layoutChanged || selectedChanged || this.historyRevision !== input.history.revision || this.following !== input.following || this.selectedReachable !== selectedReachable) {
			const outsideList = input.selected.sequence >= 0 && (input.selected.sequence < input.history.firstSequence || input.selected.sequence >= input.history.endSequence);
			this.status = truncateMeasuredText(`${input.following ? input.projection.rows.length === 0 ? 'WAITING' : 'FOLLOWING' : 'PINNED'} | ${input.history.observing ? 'Observing' : 'Stopped'}${input.selected.sequence < 0 ? '' : ` | #${input.selected.sequence} T${input.selected.timeline} | tick ${input.selected.completedTick} | cycle ${input.selected.cycles}`}${outsideList ? ' | Record expired' : ''}${input.selected.sequence >= 0 && !selectedReachable ? ' | Frame unavailable' : ''}`, layout.right - layout.left - 8, measureTextRange);
			this.historyRevision = input.history.revision; this.following = input.following; this.selectedReachable = selectedReachable;
		}
		this.details!.update();
	}
	public draw(): void { drawGteDebugger(this.input, this.rows, this.emptyLines); }
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void { api.blit_text_inline_with_font(this.status, bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont()); }
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (this.actions.handlePointer(snapshot)) return true;
		const secondary = (snapshot.justPressedButtons & PointerButton.Secondary) !== 0;
		if ((justPressed || secondary) && snapshot.valid && snapshot.insideViewport
			&& point_in_rect(snapshot.viewportX, snapshot.viewportY, this.contentBounds)) {
			if (point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.list.bounds)) {
				const index = Math.trunc((snapshot.viewportY - this.input.list.offsetTop) / this.input.layout.rowHeight);
				if (index < this.input.projection.rows.length) this.input.select(this.input.projection.rows[index]);
			}
			if (secondary) { this.input.following = false; this.showContextMenu(snapshot.viewportX, snapshot.viewportY); return true; }
		}
		return this.scroll.handlePointer(snapshot);
	}
	private navigate(event: KeyInputEvent): boolean {
		if (event.modifiers !== KeyModifier.none) return false;
		if (isKeyJustPressed('Enter', event)) { consumeIdeKey('Enter', event); this.execute('gte.details'); return true; }

		for (const key of NAVIGATION) if (isKeyDown(key, event)) {
			consumeIdeKey(key, event);
			const input = this.input, rows = input.projection.rows;
			if (rows.length === 0) return true;
			const current = rows.indexOf(input.selected.sequence), page = Math.max(1, Math.trunc(input.list.height / input.layout.rowHeight));
			const index = clamp(key === 'Home' ? 0 : key === 'End' ? rows.length - 1
				: current + (key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : key === 'PageUp' ? -page : page), 0, rows.length - 1);
			input.select(rows[index]); input.list.scrollbar.reveal(index * input.layout.rowHeight, (index + 1) * input.layout.rowHeight, 0); return true;
		}
		return false;
	}
	public handleKeyboard(event: KeyInputEvent): void { this.navigate(event); }
	public handleWheel(event: WheelInputSnapshot): void {
		this.scroll.handleWheel(event, event.deltaY * this.input.layout.rowHeight);
	}
}
