import type { CodeEditorControl } from '../../ui/code_editor_control';
import { CodeTextDecoration } from '../../../common/models';
import type { Font } from '../../../../machine/ts/render/shared/bmsx_font';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import type { CodeRowDecorations } from './decorations';

export function drawHighlightSlice(code: CodeEditorControl,
	renderFont: Font,
	renderText: string,
	colors: readonly number[],
	advancePrefix: readonly number[],
	startDisplay: number,
	endDisplay: number,
	originX: number,
	originY: number,
	z: number,
	decorations: CodeRowDecorations,
): void {
	let cursorX = originX;
	let index = startDisplay;
	while (index < endDisplay) {
		const role = decorations.hasDecorations ? decorations.roles[index - decorations.startDisplay] : CodeTextDecoration.None;
		let roleEnd = endDisplay;
		if (decorations.hasDecorations) {
			roleEnd = index + 1;
			while (roleEnd < endDisplay && decorations.roles[roleEnd - decorations.startDisplay] === role) roleEnd++;
		}
		const style = constants.CODE_TEXT_DECORATION_STYLES[role];
		if (role !== CodeTextDecoration.None) {
			api.fill_rect(cursorX, originY, cursorX + advancePrefix[roleEnd] - advancePrefix[index],
				originY + code.lineHeight, z, style.background);
		}
		while (index < roleEnd) {
			const color = role === CodeTextDecoration.None ? colors[index] : style.foreground;
			let end = index + 1;
			if (role === CodeTextDecoration.None) while (end < roleEnd && colors[end] === color) end++;
			else end = roleEnd;
			api.blit_text_inline_span_with_font(renderText, index, end, cursorX, originY, z, color, renderFont);
			cursorX += advancePrefix[end] - advancePrefix[index];
			index = end;
		}
	}
}
