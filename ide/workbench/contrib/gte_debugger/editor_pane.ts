import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import { toLuaModulePath } from '../../../../toolchain/ts/lua/module_path';
import { blua32SourceRangeAtPc } from '../../../../toolchain/ts/rompack/blua32_symbols';
import { readBlua32CompiledSource, type Blua32CompiledSource } from '../../../../toolchain/ts/rompack/blua32_sources';
import type { ExecutionDomainId } from '../../../../machine/ts/spec/blua32/execution_domain';
import type { IdeCommandController } from '../../../commands/controller';
import type { EditorCommandId } from '../../../common/commands';
import * as colors from '../../../common/constants';
import { showEditorMessage } from '../../../common/feedback_state';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import { truncateMeasuredText } from '../../../common/text';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus } from '../../../input/focus';
import { consumeIdeKey, isKeyDown, isKeyJustPressed } from '../../../input/keyboard/key_input';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import type { RuntimeFrameNavigation } from '../../../runtime/frame_navigation';
import type { GteCommandSnapshot } from '../../../runtime/gte_history';
import { api } from '../../../runtime/overlay_api';
import { resolveRuntimeLuaSource, type RuntimeSourceState } from '../../../runtime/sources';
import { readWorkspaceLuaSourceText } from '../../../workspace/files';
import { updateFullWidthWorkbenchLayout } from '../../common/layout';
import { drawWorkbenchPropertyInspector } from '../../render/property_inspector';
import type { ContextMenuController } from '../../services/context_menu/controller';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { layoutWorkbenchActionBar } from '../../ui/action_bar';
import { WorkbenchActionBarControl } from '../../ui/action_bar_control';
import { FullWidthWorkbenchEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WORKBENCH_MENUS } from '../../ui/menu/registry';
import { WorkbenchPropertyInspector } from '../../ui/property_inspector/control';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import type { EditorNavigationController } from '../resources/navigation';
import type { ResourcePanelController } from '../resources/panel/controller';
import type { GteDebuggerInput } from './editor_input';
import { GteDebugPresentation, gteCommandName, type GteDebugPlane, type GteDebugView } from './presentation';
import { drawGteDebugger, GteDebugCanvas, type GteCommandRow } from './render';

const COMMANDS = ['gte.follow', 'gte.view', 'gte.details', 'gte.source', 'gte.goToFrame', 'gte.filter', 'gte.clear', 'gte.more'] as const;
const NAVIGATION = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'] as const;
type GteViewChoice = { label: string; description: string; detail: string; view: GteDebugView; plane?: GteDebugPlane };
const VIEWS: GteViewChoice[] = [
	{ label: 'Automatic', description: 'Relevant output for the selected command', detail: '', view: 'auto' },
	{ label: 'Input XY', description: 'Raw input XY plane; XYZ in numeric rows', detail: '', view: 'input' },
	{ label: 'Projected SXY', description: 'Actual projection or NCLIP operands', detail: '', view: 'projected' },
	{ label: 'Output RGB', description: 'Actual color FIFO result', detail: '', view: 'color' },
];
const PLUS_VIEWS: GteViewChoice[] = [
	{ label: 'Vector XY', description: 'ADD, MUL and actual result; raw XYZ in rows', detail: '', view: 'input', plane: 'xy' },
	{ label: 'Vector XZ', description: 'Depth plane; raw XYZ in rows', detail: '', view: 'input', plane: 'xz' },
	{ label: 'Vector YZ', description: 'Depth plane; raw XYZ in rows', detail: '', view: 'input', plane: 'yz' },
];

export class GteDebuggerPane extends FullWidthWorkbenchEditorPane<GteDebuggerInput> {
	private readonly actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget);
	private readonly scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget, event => this.navigate(event));
	private readonly inspector = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly presentation = new GteDebugPresentation();
	private readonly canvas = new GteDebugCanvas();
	private readonly rows: GteCommandRow[] = [];
	private readonly labels = new Map<number, string>();
	private status = '';
	private historyRevision = -1;
	private following = false;
	private selectedReachable = false;
	private sourceLocation: { range: NonNullable<ReturnType<typeof blua32SourceRangeAtPc>>; domain: ExecutionDomainId; compiled: Blua32CompiledSource } | undefined;
	private sourceChanged = false;
	private sourceUnavailable = false;
	private sourceSnapshot: GteCommandSnapshot | undefined;
	private sourceRevision = -1;
	private diagramDirty = false;
	private rowFirst = -1;
	private rowLast = -1;
	private listOffset: number | undefined;
	private firstSequence = -1;
	private freshLayout = true;
	public constructor(resources: ResourcePanelController, private readonly quickInput: QuickInputController,
		private readonly commands: IdeCommandController, private readonly navigation: RuntimeFrameNavigation,
		private readonly contextMenu: ContextMenuController, private readonly sources: RuntimeSourceState,
		private readonly sourceNavigation: EditorNavigationController) {
		super(resources);
		for (const command of COMMANDS) this.focusTarget.registerCommand(command, { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) });
		this.focusTarget.registerCommand('pause', { isEnabled: () => commands.transport.playbackEnabled,
			run: () => { this.input.running = commands.transport.togglePlayback(); } });
		this.focusTarget.registerCommand('runtime.pause', { isEnabled: () => true, run: () => { this.input.running = false; } });
		this.focusTarget.registerCommand('runtime.resume', { isEnabled: () => true, run: () => { this.input.running = true; } });
		for (const [command, direction] of [['stepFrameBack', -1], ['stepFrame', 1]] as const) this.focusTarget.registerCommand(command, {
			isEnabled: () => navigation.canStep(direction), run: () => { this.input.running = false; navigation.step(direction); },
		});
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => !this.inspector.visible, run: () => {
			this.input.following = false; this.refreshSource();
			this.contextMenu.show(this.input.list.bounds.left, this.input.list.bounds.top, WORKBENCH_MENUS['gte.context'], this, { selectFirst: true });
		} });
		this.scroll.focusTarget.commandContext = this.focusTarget;
		this.actions.focusTarget.next = this.scroll.focusTarget; this.actions.focusTarget.previous = this.scroll.focusTarget;
		this.scroll.focusTarget.next = this.actions.focusTarget; this.scroll.focusTarget.previous = this.actions.focusTarget;
	}
	public override get suspendsRuntime(): boolean { return !this.input.running; }
	public override get runtimeControlContext() { return this.focusTarget; }
	public override get runtimeTransport() { return this.commands.transport; }
	public override focus(): void { (this.inspector.visible ? this.inspector : this.scroll).focusTarget.focus(); }
	protected override activate(): void {
		super.activate(); this.freshLayout = true; this.historyRevision = -1; this.labels.clear();
		this.actions.setInput(this.input.actions, this.focusTarget); this.scroll.setInput(this.input.list); this.update();
		this.refreshSource();
	}
	public override clearInput(): void {
		this.input.running = false; this.contextMenu.hide(); this.inspector.hide();
		this.actions.clearInput(); this.scroll.clearInput();
		this.sourceSnapshot = undefined; this.sourceLocation = undefined;
		this.presentation.reset(); this.labels.clear(); this.rows.length = 0;
		super.clearInput();
	}
	public override dispose(): void { if (this.hasInput) this.clearInput(); this.inspector.dispose(); this.actions.dispose(); this.scroll.dispose(); super.dispose(); }
	private cacheSource(): void {
		const record = this.input.selected, image = record.image;
		this.sourceLocation = undefined; this.sourceChanged = false; this.sourceUnavailable = false;
		if (record.domain === undefined || record.pc === undefined || image === null || image.symbols === null) return;
		const range = blua32SourceRangeAtPc(image.symbols, image.layout.header.textAddress, record.pc);
		if (range === null) return;
		const compiled = image.sources.get(toLuaModulePath(range.path));
		if (compiled !== undefined) this.sourceLocation = { range, domain: record.domain, compiled };
	}
	/** Input events may select and inspect another command before the next host frame. */
	private synchronizeSelection(): void {
		const input = this.input;
		if (this.presentation.update(input.selected, input.selectionRevision, input.view, input.plane)) this.diagramDirty = true;
		if (this.sourceSnapshot !== input.selected || this.sourceRevision !== input.selectionRevision) {
			this.sourceSnapshot = input.selected; this.sourceRevision = input.selectionRevision;
			this.cacheSource();
		}
	}
	/** Authored-source comparison occurs at action admission, not in the drawing loop. */
	private refreshSource() {
		const location = this.sourceLocation;
		if (location === undefined) return undefined;
		const current = resolveRuntimeLuaSource(this.sources, { domain: location.domain, path: location.range.path });
		this.sourceUnavailable = current === null;
		if (current === null) return undefined;
		this.sourceChanged = readBlua32CompiledSource(location.compiled) !== readWorkspaceLuaSourceText(current.registry, current.record);
		return current;
	}
	private openSource(): void {
		this.synchronizeSelection();
		const current = this.refreshSource();
		if (current === undefined || this.sourceChanged) { showEditorMessage('Source changed or unavailable.', colors.COLOR_STATUS_WARNING, 3); return; }
		const range = this.sourceLocation!.range;
		this.sourceNavigation.focusChunkSourceForContext(current.domain, current.record.source_path,
			{ row: range.start.line - 1, startColumn: range.start.column - 1, endColumn: range.end.line === range.start.line ? range.end.column - 1 : range.start.column });
	}
	public isEnabled(command: EditorCommandId): boolean {
		if (!this.hasInput || this.inspector.visible) return false;
		const input = this.input, selected = input.selected.sequence >= 0;
		if (command === 'gte.source') {
			this.synchronizeSelection();
			return this.sourceLocation !== undefined && !this.sourceChanged && !this.sourceUnavailable;
		}
		if (command === 'gte.goToFrame') return selected && this.navigation.available && input.history.canSeek(input.selected);
		if (command === 'gte.details') return selected;
		if (command === 'gte.clear') return input.history.count > 0;
		return command === 'gte.follow' || command === 'gte.view' || command === 'gte.filter' || command === 'gte.more';
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		this.synchronizeSelection();
		const input = this.input;
		switch (command) {
			case 'gte.follow': input.following = true; break;
			case 'gte.view': {
				const plus = input.selected.kind !== 'normal', choices = plus ? PLUS_VIEWS : VIEWS;
				this.quickInput.pick('GTE VIEW', 'Choose captured data', () => new TextQuickPickProvider(choices, choices.findIndex(item => plus ? item.plane === input.plane : item.view === input.view)), item => {
					input.view = item.view; if (item.plane !== undefined) input.plane = item.plane;
				}); break;
			}
			case 'gte.filter': this.quickInput.input('Filter GTE events', 'Opcode or PLUS phase; empty shows all', input.filter, async text => text, text => { input.filter = text; input.list.scrollbar.setScroll(0); }); break;
			case 'gte.clear': input.clear(); break;
			case 'gte.more': { input.following = false; this.refreshSource(); const bounds = input.actions.items[2].bounds; this.contextMenu.show(bounds.left, bounds.bottom, WORKBENCH_MENUS['gte.context'], this); break; }
			case 'gte.source': this.openSource(); break;
			case 'gte.goToFrame': {
				input.running = false; const sequence = input.selected.sequence;
				void this.navigation.seek(input.selected.cycles).completion.then(result => showEditorMessage(
					result.status === 'completed' ? `Frame ${result.after.videoTick} at/before #${sequence}` : `GTE: ${result.status}`, colors.COLOR_STATUS_TEXT, 4)); break;
			}
			case 'gte.details': {
				input.following = false;
				this.refreshSource();
				const source = this.sourceLocation, properties = this.presentation.details(input.selected).slice();
				properties.splice(1, 0, { label: input.selected.kind === 'normal' ? 'Issuing source' : 'Acceptance source', value: source === undefined || this.sourceUnavailable ? 'Source unavailable' : `${source.range.path}:${source.range.start.line}:${source.range.start.column}`,
					description: this.sourceChanged ? 'Source changed since this command was compiled. Source navigation is disabled.' : input.selected.kind === 'normal' ? 'Location belongs to the captured installed program.' : 'Location belongs to the observed command acceptance, not an instruction which later synchronized publication.', warning: this.sourceChanged });
				this.inspector.show({ title: `GTE EVENT #${input.selected.sequence}`, items: properties, canOpenSource: () => source !== undefined && !this.sourceChanged && !this.sourceUnavailable,
					openSource: () => this.openSource() }); break;
			}
		}
	}
	public override update(): void {
		const input = this.input, { layout, list } = input;
		const layoutChanged = updateFullWidthWorkbenchLayout(layout, this.contentBounds) || this.freshLayout;
		this.freshLayout = false; input.update();
		const top = layout.top + layout.rowHeight + 10, split = layout.left + Math.trunc((layout.right - layout.left) * 0.30);
		list.layout(layout.left + 4, top, split, layout.bottom, input.projection.rows.length * layout.rowHeight);
		write_rect_bounds(input.visualBounds, split + 4, top, layout.right - 4, layout.bottom);
		this.scroll.lineStep = layout.rowHeight;
		if (input.following && input.projection.rows.length > 0) list.scrollbar.reveal(list.contentHeight - layout.rowHeight, list.contentHeight, 0);
		layoutWorkbenchActionBar(input.actions, layout.right - 4, layout.top + 2, top - 4, measureText, layout.font!.renderFont());
		input.actions.items[0].checked = input.following; this.actions.update();
		this.synchronizeSelection();
		const selectedChanged = this.diagramDirty;
		if (selectedChanged || layoutChanged) this.canvas.layout(this.presentation, input.visualBounds, layout.font!.renderFont());
		this.diagramDirty = false;
		if (layoutChanged) this.labels.clear();
		if (this.firstSequence !== input.history.firstSequence) {
			this.firstSequence = input.history.firstSequence;
			for (const sequence of this.labels.keys()) if (sequence < this.firstSequence) this.labels.delete(sequence);
		}
		const first = Math.max(0, Math.trunc(list.scrollTop / layout.rowHeight));
		const end = Math.min(input.projection.rows.length, first + Math.trunc(list.height / layout.rowHeight) + 2);
		const firstSequence = input.projection.rows[first] ?? -1, lastSequence = input.projection.rows[end - 1] ?? -1;
		if (layoutChanged || firstSequence !== this.rowFirst || lastSequence !== this.rowLast || this.listOffset !== list.offsetTop) {
			let count = 0;
			for (let index = first, y = list.offsetTop + first * layout.rowHeight; index < end && y < list.bounds.bottom; index++, y += layout.rowHeight) {
				const sequence = input.projection.rows[index];
				let label = this.labels.get(sequence);
				if (label === undefined) {
					const record = input.history.at(sequence);
					label = truncateMeasuredText(`#${sequence} ${gteCommandName(record.commandWord, record.kind)}`, list.bounds.right - list.bounds.left - 4, measureTextRange); this.labels.set(sequence, label);
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
			this.status = truncateMeasuredText(`${input.following ? input.projection.rows.length === 0 ? 'WAITING' : 'FOLLOWING' : 'PINNED'} | ${input.history.observing ? 'Observing' : 'Stopped'}${this.presentation.summary === '' ? '' : ` | ${this.presentation.summary}`}${outsideList ? ' | Record expired' : ''}${input.selected.sequence >= 0 && !selectedReachable ? ' | Frame unavailable' : ''}`, layout.right - layout.left - 8, measureTextRange);
			this.historyRevision = input.history.revision; this.following = input.following; this.selectedReachable = selectedReachable;
		}
		if (this.inspector.visible) { this.inspector.layout(layout.font!.renderFont(), measureTextRange, measureText, this.contentBounds); this.inspector.update(); }
	}
	public draw(): void { if (this.inspector.visible) drawWorkbenchPropertyInspector(this.inspector); else drawGteDebugger(this.input, this.presentation, this.canvas, this.rows); }
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void { api.blit_text_inline_with_font(this.status, bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont()); }
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (this.inspector.visible) return this.inspector.handlePointer(snapshot);
		if (this.actions.handlePointer(snapshot)) return true;
		const secondary = (snapshot.justPressedButtons & PointerButton.Secondary) !== 0;
		if (snapshot.valid && snapshot.insideViewport && (justPressed || secondary)) {
			if (point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.list.bounds)) {
				const index = Math.trunc((snapshot.viewportY - this.input.list.offsetTop) / this.input.layout.rowHeight);
				if (index < this.input.projection.rows.length) this.input.select(this.input.projection.rows[index]);
			} else if (point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.visualBounds)) {
				const point = this.canvas.hit(snapshot.viewportX, snapshot.viewportY);
				if (point >= 0) { this.input.following = false; this.input.selectedPoint = point; }
			}
		}
		if (secondary) { this.input.following = false; this.refreshSource(); this.contextMenu.show(snapshot.viewportX, snapshot.viewportY, WORKBENCH_MENUS['gte.context'], this); return true; }
		return this.scroll.handlePointer(snapshot);
	}
	private navigate(event: KeyInputEvent): boolean {
		if (event.modifiers !== KeyModifier.none) return false;
		if (isKeyJustPressed('Enter', event)) { consumeIdeKey('Enter', event); this.execute('gte.details'); return true; }
		for (const key of ['ArrowLeft', 'ArrowRight']) if (isKeyJustPressed(key, event) && this.presentation.points.length > 0) {
			consumeIdeKey(key, event); this.input.following = false;
			this.input.selectedPoint = Math.max(0, Math.min(this.presentation.points.length - 1, this.input.selectedPoint + (key === 'ArrowLeft' ? -1 : 1)));
			return true;
		}
		for (const key of NAVIGATION) if (isKeyDown(key, event)) {
			consumeIdeKey(key, event);
			const input = this.input, rows = input.projection.rows;
			if (rows.length === 0) return true;
			const current = rows.indexOf(input.selected.sequence), page = Math.max(1, Math.trunc(input.list.height / input.layout.rowHeight));
			const index = Math.max(0, Math.min(rows.length - 1, key === 'Home' ? 0 : key === 'End' ? rows.length - 1 : current + (key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : key === 'PageUp' ? -page : page)));
			input.select(rows[index]); input.list.scrollbar.reveal(index * input.layout.rowHeight, (index + 1) * input.layout.rowHeight, 0); return true;
		}
		return false;
	}
	public handleKeyboard(event: KeyInputEvent): void { this.navigate(event); }
	public handleWheel(event: WheelInputSnapshot): void {
		if (!this.inspector.visible && event.deltaY !== 0 && point_in_rect(event.viewportX, event.viewportY, this.input.list.bounds)) this.input.following = false;
		(this.inspector.visible ? this.inspector : this.scroll).handleWheel(event, event.deltaY * this.input.layout.rowHeight);
	}
}
