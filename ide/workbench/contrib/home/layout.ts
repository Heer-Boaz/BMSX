import { SCROLLBAR_WIDTH } from '../../../common/constants';
import type { EditorFont } from '../../../editor/ui/view/font';
import type { EditorPaneConstraints } from '../../services/editor/editor_pane';
import { WORKBENCH_ICON_SIZE } from '../../ui/icon';
import type { HomeInput } from './editor_input';

export const HOME_PADDING = 8;
export const HOME_CARD_PADDING = 4;
export const HOME_GAP = 8;
export const HOME_ICON_GAP = 5;

/** Prospective and attached Home share pure label widths, independent of command availability. */
export function measureHomeMinimumCardWidth(input: HomeInput, font: EditorFont): number {
	const renderFont = font.renderFont();
	let labelWidth = 0;
	for (const section of input.sections) {
		const actions = section.actions;
		const remeasure = actions.measuredFont !== renderFont || actions.measuredBy !== font.measure;
		for (const item of actions.items) {
			if (remeasure || item.measuredLabel !== item.label) {
				item.width = font.measure(item.label); item.measuredLabel = item.label;
			}
			labelWidth = Math.max(labelWidth, item.width);
		}
		actions.measuredFont = renderFont; actions.measuredBy = font.measure;
	}
	return labelWidth + HOME_CARD_PADDING * 2 + WORKBENCH_ICON_SIZE + HOME_ICON_GAP + 4;
}

export function measureHomeEditor(input: HomeInput, font: EditorFont, _companionRequested: boolean, target: EditorPaneConstraints): void {
	target.minimumWidth = measureHomeMinimumCardWidth(input, font) + HOME_PADDING * 2 + SCROLLBAR_WIDTH;
	target.minimumHeight = 0; target.companionWidth = undefined;
}
