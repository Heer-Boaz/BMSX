import * as constants from '../../common/constants';
import type { EditorCommandId } from '../../common/commands';
import { EDITOR_COMMAND_PRESENTATION } from '../../commands/catalog';
import { EDITOR_COMMAND_KEYBINDING_LABELS } from '../../input/keyboard/command_keybindings';
import { measureText } from '../../editor/common/text/layout';
import { drawEditorText } from '../../editor/render/text_renderer';
import type { EditorFont } from '../../editor/ui/view/font';
import { editorViewState } from '../../editor/ui/view/state';
import { api } from '../../runtime/overlay_api';
import { getWorkbenchEditorBounds } from '../common/layout';

/** Entry points for an empty editor group, as VS Code's editor group watermark. */
const WATERMARK_COMMANDS: readonly EditorCommandId[] = ['commandPalette', 'resourceSearch', 'resources', 'createResource'];
const WATERMARK_COLUMN_GAP_CHARS = 3;

const titles = WATERMARK_COMMANDS.map(command => EDITOR_COMMAND_PRESENTATION[command].title.toUpperCase());
const keys = WATERMARK_COMMANDS.map(command => EDITOR_COMMAND_KEYBINDING_LABELS.get(command)!);
let measuredFont: EditorFont | null = null;
let titleColumnWidth = 0;
let rowWidth = 0;
let stackedWidth = 0;

function measureWatermark(font: EditorFont): void {
	measuredFont = font;
	titleColumnWidth = 0;
	let keyColumnWidth = 0;
	for (let index = 0; index < titles.length; index += 1) {
		const titleWidth = measureText(titles[index]);
		if (titleWidth > titleColumnWidth) titleColumnWidth = titleWidth;
		const keyWidth = measureText(keys[index]);
		if (keyWidth > keyColumnWidth) keyColumnWidth = keyWidth;
	}
	stackedWidth = Math.max(titleColumnWidth, keyColumnWidth);
	titleColumnWidth += editorViewState.charAdvance * WATERMARK_COLUMN_GAP_CHARS;
	rowWidth = titleColumnWidth + keyColumnWidth;
}

export function drawEditorGroupWatermark(): void {
	const bounds = getWorkbenchEditorBounds();
	api.fill_rect(bounds.left, bounds.top, bounds.right, bounds.bottom, 0, constants.COLOR_CODE_BACKGROUND);
	const font = editorViewState.font;
	if (font !== measuredFont) measureWatermark(font);
	const lineHeight = editorViewState.lineHeight;
	const availableWidth = bounds.right - bounds.left - 8;
	const stacked = rowWidth > availableWidth;
	const width = stacked ? stackedWidth : rowWidth;
	if (width > availableWidth) return;
	const rowHeight = lineHeight * (stacked ? 3 : 2);
	const count = Math.min(titles.length, Math.trunc((bounds.bottom - bounds.top - 8) / rowHeight));
	if (count <= 0) return;
	const left = bounds.left + Math.trunc((bounds.right - bounds.left - width) / 2);
	let top = bounds.top + Math.trunc((bounds.bottom - bounds.top - rowHeight * count) / 2);
	for (let index = 0; index < count; index += 1) {
		drawEditorText(font, titles[index], left, top, 0, constants.COLOR_DESCRIPTION_TEXT);
		drawEditorText(font, keys[index], stacked ? left : left + titleColumnWidth,
			stacked ? top + lineHeight : top, 0, constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT);
		top += rowHeight;
	}
}
