import { create_rect_bounds, point_in_rect, write_rect_bounds, type RectBounds } from '../../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../../common/models';
import type { EditorCommandRunner } from '../../../common/commands';
import * as colors from '../../../common/constants';
import { writeWrappedMeasuredLine } from '../../../common/text';
import { ValueInput } from '../../../editor/ui/inline/value_input';
import { drawValueInput } from '../../../editor/ui/inline/value_input_render';
import { editorViewState } from '../../../editor/ui/view/state';
import type { EditorFont } from '../../../editor/ui/view/font';
import { inputFocus, type InputFocusScope, type InputFocusTarget } from '../../../input/focus';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import type { EditorPaneClearReason, EditorPaneConstraints } from '../../services/editor/editor_pane';
import type { QuickInputController } from '../../services/quick_input/controller';
import { WorkbenchViewEditorPane } from '../../ui/editor_pane/workbench_view_pane';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import { WorkbenchTreeControl } from '../../ui/tree_control';
import { WorkbenchSplitControl } from '../../ui/split_control';
import { WORKBENCH_SPLIT_SIZE } from '../../ui/split_view';
import { drawWorkbenchSplit } from '../../render/split_view';
import type { SettingsInput } from './editor_input';
import { SETTINGS, SETTINGS_CATEGORIES, type SettingsCategory } from './model';
import { SettingControl } from './setting_control';

type SettingRow = { control: SettingControl; title: string[]; description: string[]; top: number; controlTop: number; bottom: number };

/** Both navigation and a value field remain reachable at the window's minimum size. */
export function measureSettingsEditor(_input: SettingsInput, font: EditorFont, _companion: boolean, target: EditorPaneConstraints): void {
	target.minimumWidth = font.charAdvance * 15 + WORKBENCH_SPLIT_SIZE * 2 + 12;
	target.minimumHeight = Math.max(font.lineHeight + 6, 12) + font.lineHeight * 3 + 24;
	target.companionWidth = undefined;
}

/** Settings uses ordinary pane focus, scrolling, fields and buttons, not another window system. */
export class SettingsPane extends WorkbenchViewEditorPane<SettingsInput> {
	public readonly statusItems = [];
	public readonly search = new ValueInput(this.focusTarget, { options: { singleLine: true, allowSpace: true },
		format: String, parse: text => ({ value: text }), invalidBlurMessage: '' }, () => {});
	public readonly categories = new WorkbenchTreeControl<{ readonly id: SettingsCategory; readonly label: string }>(inputFocus, pointerCapture, pointerHover, this.focusTarget, category => {
		this.input.model.filter(this.input.model.query, category.id); this.arrange();
	});
	private readonly split = new WorkbenchSplitControl(inputFocus, pointerCapture, pointerHover, this.focusTarget);
	private readonly navigationBounds = create_rect_bounds();
	private readonly scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, this.focusTarget);
	private readonly searchBounds = create_rect_bounds();
	private readonly rows: SettingRow[] = [];
	private readonly visibleRows: SettingRow[] = [];
	private readonly focusOrder: InputFocusTarget[] = [];
	private font: EditorFont | undefined;
	private measuredWidth = -1;
	private filterRevision = -1;
	private contentHeight = 0;
	private unbindPreferences: (() => void) | undefined;
	private readonly unbindSearch: () => void;
	public constructor(scope: InputFocusScope, private readonly commands: EditorCommandRunner, private readonly quickInput: QuickInputController) {
		super(scope);
		this.search.field.focusTarget.canFocus = () => this.hasInput;
		this.unbindSearch = this.search.field.onDidChangeText(() => {
			if (this.hasInput) this.input.model.filter(this.search.field.text, this.input.model.category);
		});
		this.focusTarget.registerCommand('list.find', { isEnabled: () => this.hasInput, run: () => this.search.field.focusTarget.focus() });
	}
	protected activate(): void {
		if (this.rows.length === 0) for (const setting of SETTINGS) {
			const control = new SettingControl(setting, this.input.preferences, this.focusTarget, this.commands, this.quickInput);
			const row: SettingRow = { control, title: [], description: [], top: 0, controlTop: 0, bottom: 0 };
			this.rows.push(row);
		}
		this.search.setValue(this.input.model.query);
		this.scroll.setInput(this.input.viewport);
		this.categories.setInput(this.input.navigation);
		this.split.setInput(this.input.split);
		this.filterRevision = -1;
		this.unbindPreferences = this.input.preferences.onDidChange(() => { for (const row of this.visibleRows) row.control.refresh(); });
		this.arrange();
	}
	public override focus(): void { this.search.field.focusTarget.focus(); }
	public override layout(bounds: Readonly<RectBounds>): void { super.layout(bounds); if (this.hasInput) this.arrange(); }
	public override update(): void { this.arrange(); }
	private arrange(): void {
		const { model, viewport } = this.input, { font } = editorViewState, area = this.contentBounds;
		const padding = 6, controlHeight = Math.max(font.lineHeight + 6, 12);
		write_rect_bounds(this.searchBounds, area.left + padding, area.top + padding, area.right - padding, area.top + padding + controlHeight);
		this.search.layout(this.searchBounds, area);
		const top = this.searchBounds.bottom + padding, split = this.input.split;
		split.preferredSize = font.charAdvance * 16;
		split.minimumFirstSize = font.charAdvance * 5 + WORKBENCH_SPLIT_SIZE;
		split.minimumSecondSize = font.charAdvance * 10 + WORKBENCH_SPLIT_SIZE;
		split.layout(area.left + padding, top, area.right - padding, area.bottom - padding);
		write_rect_bounds(this.navigationBounds, split.bounds.left, top, split.position - WORKBENCH_SPLIT_SIZE / 2, split.bounds.bottom);
		this.categories.layout(this.navigationBounds, font);
		const contentLeft = split.position + WORKBENCH_SPLIT_SIZE / 2;
		const width = Math.max(1, area.right - padding - contentLeft - colors.SCROLLBAR_WIDTH);
		const filterChanged = this.filterRevision !== model.revision;
		if (filterChanged) {
			this.visibleRows.length = 0;
			for (const row of this.rows) {
				const visible = model.visible.includes(row.control.setting);
				if (visible) { this.visibleRows.push(row); if (!row.control.attached) row.control.attach(); }
				else if (row.control.attached) row.control.detach();
			}
			this.focusOrder.length = 0;
			this.focusOrder.push(this.search.field.focusTarget, this.categories.focusTarget);
			for (const row of this.visibleRows) this.focusOrder.push(...row.control.focusOrder);
			this.focusOrder.push(this.scroll.focusTarget);
			for (let i = 0; i < this.focusOrder.length; i++) {
				this.focusOrder[i].next = () => this.navigate(i, 1);
				this.focusOrder[i].previous = () => this.navigate(i, -1);
			}
			this.input.navigation.selectionIndex = this.input.navigation.rows.findIndex(row => row.element.id === model.category);
		}
		if (filterChanged || this.font !== font || this.measuredWidth !== width) {
			let y = 0;
			for (const row of this.visibleRows) {
				row.top = y; row.title.length = 0; row.description.length = 0;
				const setting = row.control.setting;
				writeWrappedMeasuredLine(row.title, `${SETTINGS_CATEGORIES.find(category => category.id === setting.category)!.label}: ${setting.label}`, width, font.measureTextRange);
				writeWrappedMeasuredLine(row.description, setting.description, width, font.measureTextRange);
				row.controlTop = y + (row.title.length + row.description.length) * font.lineHeight + 6;
				row.bottom = row.controlTop + row.control.measure(width, font) + 8;
				y = row.bottom;
			}
			this.contentHeight = y; this.font = font; this.measuredWidth = width; this.filterRevision = model.revision;
		}
		if (this.input.viewportFilterRevision !== model.revision) {
			viewport.scrollbar.setScroll(0); this.input.viewportFilterRevision = model.revision;
		}
		viewport.layout(contentLeft, top, area.right - padding, area.bottom - padding, this.contentHeight);
		this.scroll.lineStep = font.lineHeight;
		for (const row of this.visibleRows) row.control.layout(viewport.bounds.left, viewport.offsetTop + row.controlTop, viewport.bounds.right, viewport.bounds);
	}
	/** Keyboard traversal reveals the concrete control; pointer focus must not move its click target. */
	private navigate(from: number, direction: 1 | -1): void {
		const { viewport } = this.input, count = this.focusOrder.length;
		for (let step = 1; step <= count; step++) {
			const target = this.focusOrder[(from + direction * step + count) % count];
			if (target.canFocus !== undefined && !target.canFocus()) continue;
			for (const row of this.visibleRows) if (row.control.focusOrder.includes(target)) {
				const bounds = target === row.control.buttons.focusTarget ? row.control.actions.bounds : row.control.fieldBounds;
				viewport.scrollbar.reveal(bounds.top - viewport.offsetTop, bounds.bottom - viewport.offsetTop, 4);
				this.arrange(); break;
			}
			target.focus(); return;
		}
	}
	public override clearInput(reason: EditorPaneClearReason = 'deactivate'): void {
		this.unbindPreferences?.(); this.unbindPreferences = undefined;
		this.search.setValue(this.input.model.query); this.search.field.focusTarget.release();
		for (const row of this.rows) row.control.detach();
		this.scroll.clearInput(); this.categories.clearInput(); this.split.clearInput();
		super.clearInput(reason);
	}
	public override dispose(): void {
		this.unbindPreferences?.(); this.unbindSearch();
		for (const row of this.rows) row.control.dispose();
		this.search.dispose(); this.scroll.dispose(); this.categories.dispose(); this.split.dispose(); super.dispose();
	}
	public handleKeyboard(): void {}
	public updateStatus(): void {}
	protected override handleViewPointer(snapshot: PointerInputSnapshot, justPressed: boolean): boolean {
		if (!snapshot.valid || !snapshot.insideViewport) return false;
		if (point_in_rect(snapshot.viewportX, snapshot.viewportY, this.searchBounds)) {
			this.search.handlePointer(this.searchBounds.left + 3, snapshot.viewportX, justPressed, snapshot.pressedButtons !== 0); return true;
		}
		if (this.split.handlePointer(snapshot) || this.categories.handlePointer(snapshot)) return true;
		if (point_in_rect(snapshot.viewportX, snapshot.viewportY, this.input.viewport.bounds))
			for (const row of this.visibleRows) if (row.control.handlePointer(snapshot)) return true;
		return this.scroll.handlePointer(snapshot);
	}
	public override handleWheel(event: WheelInputSnapshot): boolean { return this.categories.handleWheel(event) || this.scroll.handleWheel(event, event.deltaY * editorViewState.font.lineHeight * 3); }
	public draw(): void {
		const area = this.contentBounds, { viewport } = this.input, font = editorViewState.font.renderFont();
		api.fill_rect(area.left, area.top, area.right, area.bottom, 0, colors.COLOR_WINDOW_BACKGROUND);
		drawValueInput(this.search, this.searchBounds, undefined, 'Search settings');
		this.categories.draw(); drawWorkbenchSplit(this.input.split, this.split);
		api.pushClipRect(viewport.bounds.left, viewport.bounds.top, viewport.bounds.right, viewport.bounds.bottom);
		if (this.visibleRows.length === 0) api.blit_text_inline_with_font('No matching settings', viewport.bounds.left, viewport.bounds.top, 0, colors.COLOR_INPUT_TEXT, font);
		for (const row of this.visibleRows) {
			if (viewport.offsetTop + row.bottom < viewport.bounds.top || viewport.offsetTop + row.top > viewport.bounds.bottom) continue;
			let y = viewport.offsetTop + row.top;
			for (const line of row.title) { api.blit_text_inline_with_font(line, viewport.bounds.left, y, 0, colors.COLOR_INPUT_TEXT, font); y += font.lineHeight; }
			y += 3;
			for (const line of row.description) { api.blit_text_inline_with_font(line, viewport.bounds.left, y, 0, colors.COLOR_STATUS_TEXT, font); y += font.lineHeight; }
			row.control.draw();
		}
		api.popClipRect(); viewport.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
	}
}
