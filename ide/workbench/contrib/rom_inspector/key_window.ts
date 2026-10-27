import { formatByteSize } from '../../../../machine/ts/common/byte_hex_string';
import type { RectBounds } from '../../../../machine/ts/common/rect';
import type { EditorCommandRunner } from '../../../common/commands';
import * as colors from '../../../common/constants';
import { measureText, measureTextRange } from '../../../editor/common/text/layout';
import { editorViewState } from '../../../editor/ui/view/state';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import { isKeyJustPressed } from '../../../input/keyboard/key_input';
import { pointerCapture } from '../../../input/pointer/capture';
import { pointerHover } from '../../../input/pointer/hover';
import { api } from '../../../runtime/overlay_api';
import type { WorkbenchSurface } from '../../services/windows/model';
import type { WorkbenchSurfaceService } from '../../services/windows/service';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import { WorkbenchScrollControl } from '../../ui/scroll_control';
import { WorkbenchFloatingWindow } from '../../ui/window/control';
import type { RomInspectorInput } from './editor_input';

/** A snapshot's passive physical-byte key; the existing container owns all window interaction. */
export class RomMapKeyWindow {
	public readonly window: WorkbenchFloatingWindow;
	public readonly scroll: WorkbenchScrollControl;
	private readonly sizeWidths: number[] = [];
	private readonly total: string;
	private totalWidth = 0;
	private measuredFont: typeof editorViewState.font | undefined;
	private rowHeight = 0;

	public constructor(private readonly input: RomInspectorInput, commands: EditorCommandRunner,
		surfaces: WorkbenchSurfaceService, owner: WorkbenchSurface, focusReturn: InputFocusTarget,
		workArea: Readonly<RectBounds>) {
		this.total = formatByteSize(input.snapshot.rom.byteLength);
		input.keyWindow.title = `Map key: ${input.snapshot.label}`;
		this.window = new WorkbenchFloatingWindow(inputFocus, pointerCapture, pointerHover, surfaces, commands, {
			model: input.keyWindow, actionBar: input.keyActions, lifetimeOwner: owner,
			presentationParent: surfaces.windowContext(owner), focusScope: focusReturn.scope, focusReturn, workArea,
			content: {
				draw: () => this.draw(),
				handlePointer: snapshot => { this.scroll.handlePointer(snapshot); },
				handleWheel: event => this.scroll.handleWheel(event, event.deltaY * this.rowHeight * 3),
			},
			layoutContent: bounds => input.keyViewport.layout(bounds.left + 4, bounds.top + 4, bounds.right - 4,
				bounds.bottom - this.rowHeight - 4, input.model.keyEntries.length * this.rowHeight),
			restoreContentInput: () => {
				this.scroll.setInput(input.keyViewport);
				this.window.actionFocusTarget.next = this.scroll.focusTarget;
				this.window.focusTarget.previous = this.scroll.focusTarget;
			},
			retireContentInput: () => this.scroll.clearInput(),
			focusContent: () => this.scroll.focusTarget.focus(),
		});
		this.scroll = new WorkbenchScrollControl(inputFocus, pointerCapture, this.window.clientFocusTarget, event => {
			if (!isKeyJustPressed('Escape', event)) return false;
			this.window.focusTarget.handleKeyboard(event);
			return true;
		}, this.window.clientScope);
		for (const command of ['window.collapse', 'window.hide'] as const)
			this.scroll.focusTarget.registerCommand(command, this.window.focusTarget.getCommand(command)!);
		this.scroll.focusTarget.previous = this.window.actionFocusTarget;
		this.scroll.focusTarget.next = this.window.focusTarget;
	}

	public show(): void { this.input.keyWindow.open = true; this.update(); this.window.show(); }
	public dispose(): void { this.window.dispose(); this.scroll.dispose(); }

	public update(): void {
		const { input } = this, model = input.keyWindow;
		if (!model.open) return;
		const font = editorViewState.font;
		if (this.measuredFont !== font) {
			this.measuredFont = font;
			this.rowHeight = Math.max(font.lineHeight, WORKBENCH_ICON_SIZE) + 6;
			this.scroll.lineStep = this.rowHeight;
			this.totalWidth = measureText(this.total);
			let labelWidth = measureText('Total'), sizeWidth = this.totalWidth;
			for (let index = 0; index < input.model.keyEntries.length; index++) {
				const entry = input.model.keyEntries[index];
				labelWidth = Math.max(labelWidth, measureText(entry.category.label));
				this.sizeWidths[index] = measureText(entry.sizeText);
				sizeWidth = Math.max(sizeWidth, this.sizeWidths[index]);
			}
			const minimumWidth = WORKBENCH_ICON_SIZE + labelWidth + sizeWidth + 30;
			model.setMinimumSize(minimumWidth, font.lineHeight + 8 + this.rowHeight * 3 + 9);
			if (!input.keyPlacementInitialized) {
				const width = Math.max(minimumWidth, editorViewState.charAdvance * 30 + 16);
				const height = font.lineHeight + 8 + this.rowHeight * (Math.min(input.model.keyEntries.length, 10) + 1) + 9;
				model.setRequestedBounds({ left: input.layout.right - width - 4, top: input.layout.bottom - height - 4,
					right: input.layout.right - 4, bottom: input.layout.bottom - 4 });
				input.keyPlacementInitialized = true;
			}
		}
		if (!this.window.visible) this.window.show(false);
		this.window.layout(font.renderFont(), measureTextRange, measureText);
		this.window.update();
	}

	private draw(): void {
		const { input } = this, view = input.keyViewport, entries = input.model.keyEntries;
		const font = editorViewState.font.renderFont(), bounds = input.keyWindow.client;
		api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, colors.COLOR_RESOURCE_VIEWER_BACKGROUND);
		api.pushClipRect(view.bounds.left, view.bounds.top, view.bounds.right, view.bounds.bottom);
		const first = Math.trunc(view.scrollTop / this.rowHeight);
		const end = Math.min(entries.length, Math.trunc((view.scrollTop + view.height + this.rowHeight - 1) / this.rowHeight));
		for (let index = first; index < end; index++) {
			const entry = entries[index], top = view.offsetTop + index * this.rowHeight;
			api.fill_rect(view.bounds.left, top + 3, view.bounds.left + WORKBENCH_ICON_SIZE, top + 3 + WORKBENCH_ICON_SIZE, 0, entry.category.color);
			api.blit_text_inline_with_font(entry.category.label, view.bounds.left + WORKBENCH_ICON_SIZE + 5, top + 3, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
			api.blit_text_inline_with_font(entry.sizeText, view.bounds.right - this.sizeWidths[index] - 4, top + 3, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
		}
		api.popClipRect();
		view.scrollbar.draw(colors.SCROLLBAR_TRACK_COLOR, colors.SCROLLBAR_THUMB_COLOR);
		const totalTop = bounds.bottom - this.rowHeight;
		api.blit_text_inline_with_font('Total', bounds.left + 4, totalTop + 3, 0, colors.COLOR_INSPECTOR_LABEL, font);
		api.blit_text_inline_with_font(this.total, bounds.right - this.totalWidth - 8, totalTop + 3, 0, colors.COLOR_RESOURCE_VIEWER_TEXT, font);
	}
}
