import { SCROLLBAR_WIDTH } from '../../../common/constants';
import { clamp } from '../../../../machine/ts/common/clamp';
import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { formatNumberAsHex } from '../../../../machine/ts/common/byte_hex_string';
import { point_in_rect, type RectBounds } from '../../../../machine/ts/common/rect';
import type { IdeCommandController } from '../../../commands/controller';
import type { EditorCommandId } from '../../../common/commands';
import type { DisposableStore } from '../../../common/lifecycle';
import { showEditorMessage } from '../../../common/feedback_state';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { truncateMeasuredText, writeWrappedMeasuredLine } from '../../../common/text';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusScope } from '../../../input/focus';
import { consumeIdeKey, isKeyDown, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import type { RuntimeFrameNavigation } from '../../../runtime/frame_navigation';
import { api } from '../../../runtime/overlay_api';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import type { QuickInputController } from '../../services/quick_input/controller';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import { WorkbenchTooltip } from '../../ui/tooltip';
import type { GpuDebuggerInput } from './editor_input';
import { gpuOperationName } from './presentation';
import { drawGpuDebugger, type GpuOperationRow } from './render';
import { GpuDetailsWindow } from './details_window';
import type { EditorPaneClearReason } from '../../services/editor/editor_pane';

const COMMANDS = ['gpu.follow', 'gpu.view', 'gpu.details', 'gpu.goToFrame', 'gpu.filter', 'gpu.clear'] as const;
const CLIENT_COMMANDS = [...COMMANDS, 'pause', 'stepFrameBack', 'stepFrame'] as const;
const NAVIGATION = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'] as const;

// Keep an operation identity and sequence readable beside the observed scanout.
const OPERATION_READING_COLUMNS = 32;

/** History selection and shared transport; optional observation decoding belongs to Details. */
export class GpuDebuggerPane extends WorkbenchViewEditorPane<GpuDebuggerInput> {
	public override get companionGameMinimumWidth(): number { return editorViewState.charAdvance * OPERATION_READING_COLUMNS + SCROLLBAR_WIDTH + 12; }

	private readonly actions: WorkbenchActionBarControl;
	private readonly list = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget, event => this.navigate(event));
	private details: GpuDetailsWindow | undefined;
	private readonly rows: GpuOperationRow[] = [];
	private readonly labels = new Map<number, string>();
	private readonly emptyLines: string[] = [];
	private readonly tooltip = new WorkbenchTooltip();
	private menuSession: DisposableStore | undefined;
	private filterSession: DisposableStore | undefined;
	private unbindSelection: (() => void) | undefined;
	private freshLayout = true;
	private rowFirst = -1;
	private rowLast = -1;
	private rowOffset: number | undefined;
	private firstSequence = -1;
	private labelGeneration = -1;
	private historyRevision = -1;
	private selectedRevision = -1;
	private following = false;
	private reachable = false;
	private status = '';
	private emptyFiltered: boolean | undefined;
	public constructor(private readonly quickInput: QuickInputController,
		private readonly commands: IdeCommandController, private readonly navigation: RuntimeFrameNavigation,
		private readonly contextMenu: ContextMenuController, private readonly surfaces: WorkbenchSurfaceService,
		private readonly paneSurface: WorkbenchSurface, private readonly workArea: Readonly<RectBounds>, scope: InputFocusScope) {
		super(scope);
		this.actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget, () => this.focus(), contextMenu);
		this.actions.onDidOpenOverflow = lifetime => { this.input.following = false; this.ownMenu(lifetime); };
		this.list.onWillScroll = () => { this.input.following = false; };
		for (const command of COMMANDS) this.focusTarget.registerCommand(command, { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) });
		this.list.focusTarget.registerCommand('list.find', this.focusTarget.getCommand('gpu.filter')!);
		this.focusTarget.registerCommand('pause', { isEnabled: () => commands.transport.playbackEnabled, run: () => { this.input.interaction.running = commands.transport.togglePlayback(); } });
		for (const [command, direction] of [['stepFrameBack', -1], ['stepFrame', 1]] as const) this.focusTarget.registerCommand(command, {
			isEnabled: () => navigation.canStep(direction), run: () => { this.input.interaction.running = false; navigation.step(direction); },
		});
		for (const command of CLIENT_COMMANDS) this.list.focusTarget.registerCommand(command, this.focusTarget.getCommand(command)!);
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => this.hasInput, run: () => this.showContextMenu(this.input.list.bounds.left, this.input.list.bounds.top, true) });
		this.list.focusTarget.registerCommand('contextMenu', this.focusTarget.getCommand('contextMenu')!);
		this.list.focusTarget.commandContext = this.focusTarget;
		this.actions.focusTarget.previous = this.list.focusTarget; this.actions.focusTarget.next = this.list.focusTarget;
		this.list.focusTarget.previous = this.actions.focusTarget; this.list.focusTarget.next = this.actions.focusTarget;
	}
	public override get commandTarget() { return this.list.focusTarget; }
	protected override activate(): void {
		this.input.interaction.setRuntime(this.commands.transport, this.input.interaction.running);
		this.focusTarget.scope.interaction = this.input.interaction;
		this.focusTarget.scope.runtime = { target: this.focusTarget, interaction: this.input.interaction };
		this.freshLayout = true; this.historyRevision = -1; this.selectedRevision = -1;
		this.actions.setInput(this.input.actions, this.focusTarget); this.list.setInput(this.input.list);
		this.tooltip.attach(this.surfaces, this.paneSurface, this.workArea);
		const details = this.details = new GpuDetailsWindow(this.input, this.commands, this.quickInput, this.contextMenu,
			this.surfaces, this.paneSurface, this.list.focusTarget, this.workArea);
		for (const target of [details.window.focusTarget, details.inspector.focusTarget, details.diagram.focusTarget, details.words.focusTarget])
			for (const command of CLIENT_COMMANDS)
				if (command !== 'gpu.view') target.registerCommand(command, this.focusTarget.getCommand(command)!);
		this.unbindSelection = this.input.onWillChangeSelection(() => this.retireMenu());
		this.update();
	}
	public override clearInput(reason: EditorPaneClearReason = 'deactivate'): void {
		if (reason !== 'move') this.input.interaction.setRuntime(null);
		this.retireMenu();
		if (this.filterSession !== undefined) this.quickInput.hide();
		this.unbindSelection!(); this.unbindSelection = undefined;
		this.details!.dispose(); this.details = undefined; this.tooltip.detach();
		this.actions.clearInput(); this.list.clearInput(); this.labels.clear(); this.rows.length = 0; super.clearInput(reason);
	}
	public override dispose(): void { if (this.hasInput) this.clearInput(); this.actions.dispose(); this.list.dispose(); super.dispose(); }
	private ownMenu(lifetime: DisposableStore): void {
		this.tooltip.hide(); this.menuSession = lifetime;
		lifetime.add({ dispose: () => { if (this.menuSession === lifetime) this.menuSession = undefined; } });
	}
	private retireMenu(): void { if (this.menuSession !== undefined) this.contextMenu.hide(); }
	private showContextMenu(x: number, y: number, selectFirst = false): void {
		this.input.following = false;
		this.contextMenu.show(x, y, WORKBENCH_MENUS['gpu.context'], this,
			{ selectFirst, invocationOrigin: this.list.focusTarget, onWillShow: lifetime => this.ownMenu(lifetime) });
	}
	public isEnabled(command: EditorCommandId): boolean {
		if (!this.hasInput) return false;
		if (command === 'gpu.details' || command === 'gpu.view') return this.input.selected.sequence >= 0 || this.input.detailsWindow.open;
		if (command === 'gpu.goToFrame') return this.input.selected.sequence >= 0 && this.navigation.available && this.input.history.canSeek(this.input.selected);
		if (command === 'gpu.clear') return this.input.history.count > 0;
		return command === 'gpu.follow' || command === 'gpu.filter';
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		const input = this.input;
		switch (command) {
			case 'gpu.follow': input.following = true; break;
			case 'gpu.view': this.details!.show(); this.details!.chooseView(); break;
			case 'gpu.filter': {
				this.quickInput.input('Filter GPU operations', 'Operation or opcode; empty shows all', input.filter,
					async text => text, text => { input.filter = text; input.list.scrollbar.setScroll(0); }, lifetime => {
						this.filterSession = lifetime;
						lifetime.add({ dispose: () => { if (this.filterSession === lifetime) this.filterSession = undefined; } });
					}); break;
			}
			case 'gpu.clear': input.clear(); break;
			case 'gpu.details': input.following = false; this.details!.show(); break;
			case 'gpu.goToFrame': {
				input.interaction.running = false; const sequence = input.selected.sequence;
				void this.navigation.seek(input.selected.cycles).completion.then(result => showEditorMessage(result.status === 'completed'
					? `Frame ${result.after.videoTick} at/before observation #${sequence}` : `GPU: ${result.status}`, 'info', 4)); break;
			}
		}
	}
	public override update(): void {
		const input = this.input, { layout, list } = input;
		const layoutChanged = updateFullWidthWorkbenchLayout(layout, this.contentBounds) || this.freshLayout; this.freshLayout = false;
		const projectionChanged = input.update();
		const top = layout.top + layout.rowHeight + 10;
		list.layout(layout.left + 4, top, layout.right - 4, layout.bottom, input.projection.rows.length * layout.rowHeight);
		this.list.lineStep = layout.rowHeight;
		if (input.following && input.projection.rows.length > 0) list.scrollbar.reveal(list.contentHeight - layout.rowHeight, list.contentHeight, 0);
		layoutWorkbenchActionBar(input.actions, layout.right - 4, layout.top + 2, top - 4, measureText, layout.font!.renderFont(), layout.left + 4);
		input.actions.items[0].checked = input.following; this.actions.update();
		if (layoutChanged || this.labelGeneration !== input.history.generation) {
			this.labelGeneration = input.history.generation; this.labels.clear();
		}
		if (this.firstSequence !== input.history.firstSequence) {
			this.firstSequence = input.history.firstSequence; for (const sequence of this.labels.keys()) if (sequence < this.firstSequence) this.labels.delete(sequence);
		}
		const first = Math.max(0, Math.trunc(list.scrollTop / layout.rowHeight)), end = Math.min(input.projection.rows.length, first + Math.trunc(list.height / layout.rowHeight) + 2);
		const firstSequence = input.projection.rows[first] ?? -1, lastSequence = input.projection.rows[end - 1] ?? -1;
		if (layoutChanged || projectionChanged || firstSequence !== this.rowFirst || lastSequence !== this.rowLast || this.rowOffset !== list.offsetTop) {
			let count = 0;
			for (let index = first, y = list.offsetTop + first * layout.rowHeight; index < end && y < list.bounds.bottom; index++, y += layout.rowHeight) {
				const sequence = input.projection.rows[index]; let label = this.labels.get(sequence);
				if (label === undefined) {
					const record = input.history.at(sequence), operation = gpuOperationName(record), available = list.bounds.right - list.bounds.left - 4;
					const qualified = `${operation} #${sequence} ${formatNumberAsHex(record.opcode, 2)}`;
					label = measureText(qualified) <= available ? qualified : truncateMeasuredText(operation, available, measureTextRange); this.labels.set(sequence, label);
				}
				const row = this.rows[count]; if (row === undefined) this.rows.push({ sequence, top: y, label }); else { row.sequence = sequence; row.top = y; row.label = label; } count++;
			}
			this.rows.length = count; this.rowFirst = firstSequence; this.rowLast = lastSequence; this.rowOffset = list.offsetTop;
		}
		if (layoutChanged || this.emptyFiltered !== (input.filter !== '')) {
			this.emptyFiltered = input.filter !== ''; this.emptyLines.length = 0;
			const width = list.bounds.right - list.bounds.left - 4;
			writeWrappedMeasuredLine(this.emptyLines, input.filter === '' ? 'No GPU operations observed.' : 'No matching operations.', width, measureTextRange);
			writeWrappedMeasuredLine(this.emptyLines, input.filter === '' ? 'Play or step the existing runtime.' : 'Change or clear the filter.', width, measureTextRange);
		}
		const reachable = input.selected.sequence >= 0 && input.history.canSeek(input.selected);
		if (layoutChanged || this.selectedRevision !== input.selectionRevision || this.historyRevision !== input.history.revision || this.following !== input.following || this.reachable !== reachable) {
			const record = input.selected, expired = record.sequence >= 0 && (record.sequence < input.history.firstSequence || record.sequence >= input.history.endSequence);
			this.status = truncateMeasuredText(`${input.following ? input.projection.rows.length === 0 ? 'Waiting' : 'Following' : 'Pinned'}${record.sequence < 0 ? '' : ` | ${gpuOperationName(record)} #${record.sequence} T${record.timeline} | tick ${record.completedTick} | observed ${record.cycles}`}${expired ? ' | Record expired' : ''}${record.sequence >= 0 && !reachable ? ' | Frame unavailable' : ''}`, layout.right - layout.left - 8, measureTextRange);
			this.historyRevision = input.history.revision; this.following = input.following; this.reachable = reachable; this.selectedRevision = input.selectionRevision;
		}
		this.details!.update();
		const item = this.actions.tooltipItem;
		if (item !== undefined) this.tooltip.show(item.tooltip, item.bounds, layout.font!.renderFont(), measureTextRange, measureText, this.workArea); else this.tooltip.hide();
	}
	public draw(): void { drawGpuDebugger(this.input, this.rows, this.emptyLines); }
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void { api.blit_text_inline_with_font(this.status, bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont()); }
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (this.actions.handlePointer(snapshot)) return true;
		const input = this.input, secondary = (snapshot.justPressedButtons & PointerButton.Secondary) !== 0;
		if ((justPressed || secondary) && snapshot.valid && snapshot.insideViewport && point_in_rect(snapshot.viewportX, snapshot.viewportY, input.list.bounds)) {
			const index = Math.trunc((snapshot.viewportY - input.list.offsetTop) / input.layout.rowHeight);
			if (index < input.projection.rows.length) input.select(input.projection.rows[index]);
			if (secondary) { this.showContextMenu(snapshot.viewportX, snapshot.viewportY); return true; }
		}
		return this.list.handlePointer(snapshot);
	}
	private navigate(event: KeyInputEvent): boolean {
		if (event.modifiers !== KeyModifier.none) return false;
		if (isKeyJustPressed('Enter', event)) { consumeIdeKey('Enter', event); this.execute('gpu.details'); return true; }
		for (const key of NAVIGATION) if (isKeyDown(key, event)) {
			consumeIdeKey(key, event); const input = this.input, rows = input.projection.rows;
			if (rows.length === 0) return true;
			const current = rows.indexOf(input.selected.sequence), page = Math.max(1, Math.trunc(input.list.height / input.layout.rowHeight));
			const index = clamp(key === 'Home' ? 0 : key === 'End' ? rows.length - 1
				: current + (key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : key === 'PageUp' ? -page : page), 0, rows.length - 1);
			input.select(rows[index]); input.list.scrollbar.reveal(index * input.layout.rowHeight, (index + 1) * input.layout.rowHeight, 0); return true;
		}
		return false;
	}
	public handleKeyboard(event: KeyInputEvent): void { this.navigate(event); }
	public handleWheel(event: WheelInputSnapshot): void { this.list.handleWheel(event, event.deltaY * this.input.layout.rowHeight); }
}
