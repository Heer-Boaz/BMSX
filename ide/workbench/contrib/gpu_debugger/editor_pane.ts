import { KeyModifier, type KeyInputEvent } from '../../../../hosts/common/input/text';
import { PointerButton } from '../../../../hosts/common/input/pointer_event';
import { formatNumberAsHex } from '../../../../machine/ts/common/byte_hex_string';
import { point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
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
import { api } from '../../../runtime/overlay_api';
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
import type { ResourcePanelController } from '../resources/panel/controller';
import type { GpuDebuggerInput } from './editor_input';
import { GPU_RAW_WORDS_PER_PAGE, GpuDebugPresentation, gpuOperationName, type GpuDebugView } from './presentation';
import { drawGpuDebugger, GpuDebugCanvas, type GpuOperationRow, type GpuWordRow } from './render';

const COMMANDS = ['gpu.follow', 'gpu.view', 'gpu.details', 'gpu.goToFrame', 'gpu.filter', 'gpu.clear', 'gpu.more'] as const;
const NAVIGATION = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'] as const;
const VIEWS: { label: string; description: string; detail: string; view: GpuDebugView }[] = [
	{ label: 'Geometry', description: 'Decoded drawing coordinates and latched bounds', detail: '', view: 'geometry' },
	{ label: 'UV', description: 'Raw UV coordinates; no historical texture image', detail: '', view: 'uv' },
	{ label: 'Color', description: 'Supplied RGB bytes, not rendered pixel colors', detail: '', view: 'color' },
	{ label: 'Raw words', description: 'Every active operation word; scroll or Home/End', detail: '', view: 'words' },
];

/** Controls project owned operation evidence; all execution remains with the shared transport. */
export class GpuDebuggerPane extends FullWidthWorkbenchEditorPane<GpuDebuggerInput> {
	private readonly actions = new WorkbenchActionBarControl(inputFocus, pointerCapture, pointerHover, this, this.focusTarget);
	private readonly list = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget, event => this.navigate(event, false));
	private readonly words = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget, event => this.navigate(event, true));
	private readonly inspector = new WorkbenchPropertyInspector(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly presentation = new GpuDebugPresentation();
	private readonly canvas = new GpuDebugCanvas();
	private readonly rows: GpuOperationRow[] = [];
	private readonly wordRows: GpuWordRow[] = [];
	private readonly labels = new Map<number, string>();
	private freshLayout = true;
	private diagramDirty = false;
	private wordsActive = false;
	private rowFirst = -1;
	private rowLast = -1;
	private rowOffset: number | undefined;
	private wordFirst = -1;
	private wordLast = -1;
	private wordOffset: number | undefined;
	private wordRevision = -1;
	private firstSequence = -1;
	private historyRevision = -1;
	private following = false;
	private reachable = false;
	private status = '';
	public constructor(resources: ResourcePanelController, private readonly quickInput: QuickInputController,
		private readonly commands: IdeCommandController, private readonly navigation: RuntimeFrameNavigation,
		private readonly contextMenu: ContextMenuController) {
		super(resources);
		this.list.onWillScroll = this.words.onWillScroll = () => { this.input.following = false; };
		for (const command of COMMANDS) this.focusTarget.registerCommand(command, { isEnabled: () => this.isEnabled(command), run: () => this.execute(command) });
		this.focusTarget.registerCommand('pause', { isEnabled: () => commands.transport.playbackEnabled, run: () => { this.input.running = commands.transport.togglePlayback(); } });
		this.focusTarget.registerCommand('runtime.pause', { isEnabled: () => true, run: () => { this.input.running = false; } });
		this.focusTarget.registerCommand('runtime.resume', { isEnabled: () => true, run: () => { this.input.running = true; } });
		for (const [command, direction] of [['stepFrameBack', -1], ['stepFrame', 1]] as const) this.focusTarget.registerCommand(command, {
			isEnabled: () => navigation.canStep(direction), run: () => { this.input.running = false; navigation.step(direction); },
		});
		this.focusTarget.registerCommand('contextMenu', { isEnabled: () => !this.inspector.visible, run: () => {
			this.input.following = false;
			this.contextMenu.show(this.input.list.bounds.left, this.input.list.bounds.top, WORKBENCH_MENUS['gpu.context'], this, { selectFirst: true });
		} });
		this.list.focusTarget.commandContext = this.focusTarget; this.words.focusTarget.commandContext = this.focusTarget;
		this.actions.focusTarget.previous = this.list.focusTarget; this.actions.focusTarget.next = this.list.focusTarget;
		this.list.focusTarget.previous = this.actions.focusTarget; this.list.focusTarget.next = this.actions.focusTarget;
	}
	public override get suspendsRuntime(): boolean { return !this.input.running; }
	public override get runtimeControlContext() { return this.focusTarget; }
	public override get runtimeTransport() { return this.commands.transport; }
	public override focus(): void { (this.inspector.visible ? this.inspector : this.list).focusTarget.focus(); }
	protected override activate(): void {
		super.activate(); this.freshLayout = true; this.historyRevision = -1; this.wordRevision = -1;
		this.actions.setInput(this.input.actions, this.focusTarget); this.list.setInput(this.input.list); this.update();
	}
	public override clearInput(): void {
		this.input.running = false; this.contextMenu.hide(); this.inspector.hide(); this.actions.clearInput(); this.list.clearInput(); this.words.clearInput(); this.wordsActive = false;
		this.presentation.reset(); this.labels.clear(); this.rows.length = 0; this.wordRows.length = 0; super.clearInput();
	}
	public override dispose(): void { if (this.hasInput) this.clearInput(); this.inspector.dispose(); this.actions.dispose(); this.list.dispose(); this.words.dispose(); super.dispose(); }
	private synchronizeSelection(): void {
		const input = this.input;
		if (this.presentation.update(input.selected, input.selectionRevision, input.view)) this.diagramDirty = true;
	}
	public isEnabled(command: EditorCommandId): boolean {
		if (!this.hasInput || this.inspector.visible) return false;
		if (command === 'gpu.details') return this.input.selected.sequence >= 0;
		if (command === 'gpu.goToFrame') return this.input.selected.sequence >= 0 && this.navigation.available && this.input.history.canSeek(this.input.selected);
		if (command === 'gpu.clear') return this.input.history.count > 0;
		return command === 'gpu.follow' || command === 'gpu.view' || command === 'gpu.filter' || command === 'gpu.more';
	}
	public execute(command: EditorCommandId): void {
		if (!this.isEnabled(command)) return;
		this.synchronizeSelection();
		const input = this.input;
		switch (command) {
			case 'gpu.follow': input.following = true; break;
			case 'gpu.view': this.quickInput.pick('GPU VIEW', 'Choose operation evidence', () => new TextQuickPickProvider(VIEWS, VIEWS.findIndex(item => item.view === input.view)), item => { input.view = item.view; input.selectedPoint = 0; }); break;
			case 'gpu.filter': this.quickInput.input('Filter GPU operations', 'Operation or opcode; empty shows all', input.filter, async text => text, text => { input.filter = text; input.list.scrollbar.setScroll(0); }); break;
			case 'gpu.clear': input.clear(); break;
			case 'gpu.more': { input.following = false; const bounds = input.actions.items[2].bounds; this.contextMenu.show(bounds.left, bounds.bottom, WORKBENCH_MENUS['gpu.context'], this); break; }
			case 'gpu.details': {
				input.following = false;
				const rawPage = Math.trunc(input.selectedWord / GPU_RAW_WORDS_PER_PAGE);
				this.inspector.show({ title: `GPU OPERATION #${input.selected.sequence}`, items: this.presentation.details(input.selected, rawPage), canOpenSource: () => false, openSource: () => {} }); break;
			}
			case 'gpu.goToFrame': {
				input.running = false; const sequence = input.selected.sequence;
				void this.navigation.seek(input.selected.cycles).completion.then(result => showEditorMessage(result.status === 'completed'
					? `Frame ${result.after.videoTick} at/before observation #${sequence}` : `GPU: ${result.status}`, colors.COLOR_STATUS_TEXT, 4)); break;
			}
		}
	}
	public override update(): void {
		const input = this.input, { layout, list, words } = input;
		const layoutChanged = updateFullWidthWorkbenchLayout(layout, this.contentBounds) || this.freshLayout; this.freshLayout = false;
		const projectionChanged = input.update(); this.synchronizeSelection();
		const selectedChanged = this.diagramDirty;
		const top = layout.top + layout.rowHeight + 10, split = layout.left + Math.trunc((layout.right - layout.left) * 0.30);
		list.layout(layout.left + 4, top, split, layout.bottom, input.projection.rows.length * layout.rowHeight);
		write_rect_bounds(input.visualBounds, split + 4, top, layout.right - 4, layout.bottom);
		words.layout(split + 8, top + layout.rowHeight + 6, layout.right - 4, layout.bottom, input.selected.wordCount * layout.rowHeight);
		this.list.lineStep = layout.rowHeight; this.words.lineStep = layout.rowHeight;
		if (input.following && input.projection.rows.length > 0) list.scrollbar.reveal(list.contentHeight - layout.rowHeight, list.contentHeight, 0);
		const wordsActive = input.view === 'words';
		if (wordsActive !== this.wordsActive) {
			if (wordsActive) {
				this.words.setInput(words); this.list.focusTarget.next = this.words.focusTarget; this.words.focusTarget.previous = this.list.focusTarget;
				this.words.focusTarget.next = this.actions.focusTarget; this.actions.focusTarget.previous = this.words.focusTarget;
			} else { this.words.clearInput(); this.list.focusTarget.next = this.actions.focusTarget; this.actions.focusTarget.previous = this.list.focusTarget; }
			this.wordsActive = wordsActive;
		}
		layoutWorkbenchActionBar(input.actions, layout.right - 4, layout.top + 2, top - 4, measureText, layout.font!.renderFont());
		input.actions.items[0].checked = input.following; this.actions.update();
		if (selectedChanged || layoutChanged) this.canvas.layout(input, this.presentation, layout.font!.renderFont());
		this.diagramDirty = false;
		if (layoutChanged) this.labels.clear();
		if (this.firstSequence !== input.history.firstSequence) {
			this.firstSequence = input.history.firstSequence; for (const sequence of this.labels.keys()) if (sequence < this.firstSequence) this.labels.delete(sequence);
		}
		const first = Math.max(0, Math.trunc(list.scrollTop / layout.rowHeight)), end = Math.min(input.projection.rows.length, first + Math.trunc(list.height / layout.rowHeight) + 2);
		const firstSequence = input.projection.rows[first] ?? -1, lastSequence = input.projection.rows[end - 1] ?? -1;
		if (layoutChanged || projectionChanged || firstSequence !== this.rowFirst || lastSequence !== this.rowLast || this.rowOffset !== list.offsetTop) {
			let count = 0;
			for (let index = first, y = list.offsetTop + first * layout.rowHeight; index < end && y < list.bounds.bottom; index++, y += layout.rowHeight) {
				const sequence = input.projection.rows[index]; let label = this.labels.get(sequence);
				if (label === undefined) { const record = input.history.at(sequence); label = truncateMeasuredText(`#${sequence} ${formatNumberAsHex(record.opcode, 2)} ${gpuOperationName(record)}`, list.bounds.right - list.bounds.left - 4, measureTextRange); this.labels.set(sequence, label); }
				const row = this.rows[count]; if (row === undefined) this.rows.push({ sequence, top: y, label }); else { row.sequence = sequence; row.top = y; row.label = label; } count++;
			}
			this.rows.length = count; this.rowFirst = firstSequence; this.rowLast = lastSequence; this.rowOffset = list.offsetTop;
		}
		if (wordsActive) this.updateWordRows(layoutChanged);
		const reachable = input.selected.sequence >= 0 && input.history.canSeek(input.selected);
		if (layoutChanged || selectedChanged || this.historyRevision !== input.history.revision || this.following !== input.following || this.reachable !== reachable) {
			const expired = input.selected.sequence >= 0 && (input.selected.sequence < input.history.firstSequence || input.selected.sequence >= input.history.endSequence);
			this.status = truncateMeasuredText(`${input.following ? input.projection.rows.length === 0 ? 'WAITING' : 'FOLLOWING' : 'PINNED'}${this.presentation.summary === '' ? '' : ` | ${this.presentation.summary}`}${expired ? ' | Record expired' : ''}${input.selected.sequence >= 0 && !reachable ? ' | Frame unavailable' : ''}`, layout.right - layout.left - 8, measureTextRange);
			this.historyRevision = input.history.revision; this.following = input.following; this.reachable = reachable;
		}
		if (this.inspector.visible) { this.inspector.layout(layout.font!.renderFont(), measureTextRange, measureText, this.contentBounds); this.inspector.update(); }
	}
	/** Formatting work follows only the visible word window and owned snapshot revision. */
	private updateWordRows(layoutChanged: boolean): void {
		const input = this.input, { words, layout } = input;
		// A new operation and a keyboard selection can arrive before its range is laid out.
		if (this.wordRevision !== input.selectionRevision) words.scrollbar.reveal(input.selectedWord * layout.rowHeight, (input.selectedWord + 1) * layout.rowHeight, 0);
		const first = Math.max(0, Math.trunc(words.scrollTop / layout.rowHeight)), end = Math.min(input.selected.wordCount, first + Math.trunc(words.height / layout.rowHeight) + 2);
		if (!layoutChanged && this.wordFirst === first && this.wordLast === end && this.wordOffset === words.offsetTop && this.wordRevision === input.selectionRevision) return;
		let count = 0;
		for (let index = first, y = words.offsetTop + first * layout.rowHeight; index < end && y < words.bounds.bottom; index++, y += layout.rowHeight) {
			const label = `${formatNumberAsHex(index, 6)}  ${formatNumberAsHex(input.selected.words[index], 8)}`;
			const row = this.wordRows[count]; if (row === undefined) this.wordRows.push({ index, top: y, label }); else { row.index = index; row.top = y; row.label = label; } count++;
		}
		this.wordRows.length = count; this.wordFirst = first; this.wordLast = end; this.wordOffset = words.offsetTop; this.wordRevision = input.selectionRevision;
	}
	public draw(): void { if (this.inspector.visible) drawWorkbenchPropertyInspector(this.inspector); else drawGpuDebugger(this.input, this.presentation, this.canvas, this.rows, this.wordRows); }
	public drawStatusBar(bounds: Readonly<RectBounds>, color: number): void { api.blit_text_inline_with_font(this.status, bounds.left + 4, bounds.top + 2, 0, color, editorViewState.font.renderFont()); }
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (this.inspector.visible) return this.inspector.handlePointer(snapshot);
		if (this.actions.handlePointer(snapshot)) return true;
		const input = this.input, secondary = (snapshot.justPressedButtons & PointerButton.Secondary) !== 0;
		if (snapshot.valid && snapshot.insideViewport && (justPressed || secondary)) {
			if (point_in_rect(snapshot.viewportX, snapshot.viewportY, input.list.bounds)) {
				const index = Math.trunc((snapshot.viewportY - input.list.offsetTop) / input.layout.rowHeight);
				if (index < input.projection.rows.length) input.select(input.projection.rows[index]);
			} else if (this.wordsActive && point_in_rect(snapshot.viewportX, snapshot.viewportY, input.words.bounds)) {
				const index = Math.trunc((snapshot.viewportY - input.words.offsetTop) / input.layout.rowHeight);
				if (index < input.selected.wordCount) { input.selectedWord = index; input.following = false; }
			} else if (point_in_rect(snapshot.viewportX, snapshot.viewportY, input.visualBounds)) {
				const point = this.canvas.hit(snapshot.viewportX, snapshot.viewportY); if (point >= 0) { input.selectedPoint = point; input.following = false; }
			}
		}
		if (secondary) { input.following = false; this.contextMenu.show(snapshot.viewportX, snapshot.viewportY, WORKBENCH_MENUS['gpu.context'], this); return true; }
		return this.wordsActive && this.words.handlePointer(snapshot) || this.list.handlePointer(snapshot);
	}
	private navigate(event: KeyInputEvent, rawWords: boolean): boolean {
		if (event.modifiers !== KeyModifier.none) return false;
		if (isKeyJustPressed('Enter', event)) { consumeIdeKey('Enter', event); this.execute('gpu.details'); return true; }
		const input = this.input;
		for (const key of ['ArrowLeft', 'ArrowRight']) if (!rawWords && isKeyJustPressed(key, event) && this.presentation.points.length > 0) {
			consumeIdeKey(key, event); input.following = false; input.selectedPoint = Math.max(0, Math.min(this.presentation.points.length - 1, input.selectedPoint + (key === 'ArrowLeft' ? -1 : 1))); return true;
		}
		for (const key of NAVIGATION) if (isKeyDown(key, event)) {
			consumeIdeKey(key, event);
			const viewport = rawWords ? input.words : input.list, count = rawWords ? input.selected.wordCount : input.projection.rows.length;
			if (count === 0) return true;
			const current = rawWords ? input.selectedWord : input.projection.rows.indexOf(input.selected.sequence), page = Math.max(1, Math.trunc(viewport.height / input.layout.rowHeight));
			const index = Math.max(0, Math.min(count - 1, key === 'Home' ? 0 : key === 'End' ? count - 1 : current + (key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : key === 'PageUp' ? -page : page)));
			if (rawWords) { input.selectedWord = index; input.following = false; } else input.select(input.projection.rows[index]);
			viewport.scrollbar.reveal(index * input.layout.rowHeight, (index + 1) * input.layout.rowHeight, 0); return true;
		}
		return false;
	}
	public handleKeyboard(event: KeyInputEvent): void { this.navigate(event, false); }
	public handleWheel(event: WheelInputSnapshot): void {
		const delta = event.deltaY * this.input.layout.rowHeight;
		if (this.inspector.visible) this.inspector.handleWheel(event, delta);
		else if (!this.wordsActive || !this.words.handleWheel(event, delta)) this.list.handleWheel(event, delta);
	}
}
