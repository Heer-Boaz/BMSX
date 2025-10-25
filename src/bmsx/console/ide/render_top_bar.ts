import { BmsxConsoleApi } from '../api';
import * as constants from './constants';
import type { BmsxConsoleMetadata } from '../types';
import type { EditorResolutionMode, RectBounds, TopBarButtonId } from './types';

export interface TopBarHost {
	viewportWidth: number;
	headerHeight: number;
	lineHeight: number;
	measureText: (text: string) => number;
	drawText: (api: BmsxConsoleApi, text: string, x: number, y: number, color: number) => void;
	wordWrapEnabled: boolean;
	resolutionMode: EditorResolutionMode;
	metadata: BmsxConsoleMetadata;
	dirty: boolean;
	resourcePanelVisible: boolean;
	resourcePanelFilterMode: 'lua_only' | 'all';
	topBarButtonBounds: Record<TopBarButtonId, RectBounds>;
}

export function renderTopBar(api: BmsxConsoleApi, host: TopBarHost): void {
	const primaryBarHeight = host.headerHeight;
	api.rectfill(0, 0, host.viewportWidth, primaryBarHeight, constants.COLOR_TOP_BAR);

	const buttonTop = 1;
	const buttonHeight = host.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
	const iconButtonSize = buttonHeight;
	const resolutionRight = host.viewportWidth - 4;
	const resolutionLeft = resolutionRight - iconButtonSize;
	const resolutionBottom = buttonTop + buttonHeight;
	const wrapRight = resolutionLeft - constants.HEADER_BUTTON_SPACING;
	const wrapLeft = wrapRight - iconButtonSize;
	host.topBarButtonBounds.resolution = { left: resolutionLeft, top: buttonTop, right: resolutionRight, bottom: resolutionBottom };
	host.topBarButtonBounds.wrap = { left: wrapLeft, top: buttonTop, right: wrapRight, bottom: resolutionBottom };
	host.topBarButtonBounds.resume = { left: 0, top: 0, right: 0, bottom: 0 };
	host.topBarButtonBounds.reboot = { left: 0, top: 0, right: 0, bottom: 0 };
	host.topBarButtonBounds.save = { left: 0, top: 0, right: 0, bottom: 0 };
	host.topBarButtonBounds.resources = { left: 0, top: 0, right: 0, bottom: 0 };
	host.topBarButtonBounds.filter = { left: 0, top: 0, right: 0, bottom: 0 };
	let buttonX = 4;
	const buttonEntries: Array<{ id: TopBarButtonId; label: string; disabled: boolean; active?: boolean }> = [
		{ id: 'resume', label: 'RESUME', disabled: false },
		{ id: 'reboot', label: 'REBOOT', disabled: false },
		{ id: 'save', label: 'SAVE', disabled: !host.dirty },
		{ id: 'resources', label: 'FILES', disabled: false, active: host.resourcePanelVisible },
	];
	if (host.resourcePanelVisible) {
		const filterLabel = host.resourcePanelFilterMode === 'lua_only' ? 'LUA' : 'ALL';
		buttonEntries.push({
			id: 'filter',
			label: filterLabel,
			disabled: false,
			active: host.resourcePanelFilterMode === 'lua_only',
		});
	}
	const availableRight = wrapLeft - constants.HEADER_BUTTON_SPACING;
	for (let i = 0; i < buttonEntries.length; i++) {
		const entry = buttonEntries[i];
		const textWidth = host.measureText(entry.label);
		const buttonWidth = textWidth + constants.HEADER_BUTTON_PADDING_X * 2;
		const right = buttonX + buttonWidth;
		if (right > availableRight) {
			host.topBarButtonBounds[entry.id] = { left: 0, top: 0, right: 0, bottom: 0 };
			break;
		}
		const bottom = buttonTop + buttonHeight;
		const bounds: RectBounds = { left: buttonX, top: buttonTop, right, bottom };
		host.topBarButtonBounds[entry.id] = bounds;
		const fillColor = entry.active
			? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND
			: (entry.disabled ? constants.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND : constants.COLOR_HEADER_BUTTON_BACKGROUND);
		const textColor = entry.active
			? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT
			: (entry.disabled ? constants.COLOR_HEADER_BUTTON_TEXT_DISABLED : constants.COLOR_HEADER_BUTTON_TEXT);
		api.rectfill(bounds.left, bounds.top, bounds.right, bounds.bottom, fillColor);
		api.rect(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_HEADER_BUTTON_BORDER);
		host.drawText(api, entry.label, bounds.left + constants.HEADER_BUTTON_PADDING_X, bounds.top + constants.HEADER_BUTTON_PADDING_Y, textColor);
		buttonX = right + constants.HEADER_BUTTON_SPACING;
	}

	const wrapActive = host.wordWrapEnabled;
	const wrapFill = wrapActive ? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND : constants.COLOR_HEADER_BUTTON_BACKGROUND;
	const wrapTextColor = wrapActive ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.COLOR_HEADER_BUTTON_TEXT;
	const wrapBounds = host.topBarButtonBounds.wrap;
	api.rectfill(wrapBounds.left, wrapBounds.top, wrapBounds.right, wrapBounds.bottom, wrapFill);
	api.rect(wrapBounds.left, wrapBounds.top, wrapBounds.right, wrapBounds.bottom, constants.COLOR_HEADER_BUTTON_BORDER);
	const wrapLabel = 'w';
	const wrapLabelWidth = host.measureText(wrapLabel);
	const wrapLabelX = wrapBounds.left + Math.max(1, Math.floor((iconButtonSize - wrapLabelWidth) / 2));
	const wrapLabelY = wrapBounds.top + constants.HEADER_BUTTON_PADDING_Y;
	host.drawText(api, wrapLabel, wrapLabelX, wrapLabelY, wrapTextColor);

	const resolutionActive = host.resolutionMode === 'viewport';
	const resolutionFill = resolutionActive ? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND : constants.COLOR_HEADER_BUTTON_BACKGROUND;
	const resolutionTextColor = resolutionActive ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.COLOR_HEADER_BUTTON_TEXT;
	api.rectfill(resolutionLeft, buttonTop, resolutionRight, resolutionBottom, resolutionFill);
	api.rect(resolutionLeft, buttonTop, resolutionRight, resolutionBottom, constants.COLOR_HEADER_BUTTON_BORDER);
	const iconPadding = Math.max(2, Math.floor(constants.HEADER_BUTTON_PADDING_X * 0.75));

	const frameX = resolutionLeft + iconPadding;
	const frameY = buttonTop + iconPadding;
	const frameSize = iconButtonSize - iconPadding * 2;
	api.rectfill(frameX, frameY, frameX + frameSize, frameY + frameSize, resolutionTextColor);
	const innerMargin = Math.max(1, Math.floor(frameSize / 4));
	api.rectfill(
		frameX + innerMargin,
		frameY + innerMargin,
		frameX + frameSize - innerMargin,
		frameY + frameSize - innerMargin,
		constants.COLOR_TOP_BAR,
	);
	const indicatorY = frameY + frameSize - innerMargin - 1;
	const indicatorHeight = Math.max(1, Math.floor(frameSize / 5));
	if (host.resolutionMode === 'viewport') {
		api.rectfill(frameX + innerMargin, indicatorY, frameX + frameSize - innerMargin, indicatorY + indicatorHeight, resolutionTextColor);
	} else {
		const segmentWidth = Math.max(1, Math.floor((frameSize - innerMargin * 2) / 2));
		api.rectfill(frameX + innerMargin, indicatorY, frameX + innerMargin + segmentWidth, indicatorY + indicatorHeight, resolutionTextColor);
		api.rectfill(frameX + frameSize - innerMargin - segmentWidth, indicatorY, frameX + frameSize - innerMargin, indicatorY + indicatorHeight, resolutionTextColor);
	}
	const resolutionLabel = 'R';
	const resolutionLabelX = resolutionLeft + Math.max(1, Math.floor((iconButtonSize - host.measureText(resolutionLabel)) / 2));
	const resolutionLabelY = buttonTop + constants.HEADER_BUTTON_PADDING_Y;
	host.drawText(api, resolutionLabel, resolutionLabelX, resolutionLabelY, resolutionTextColor);

	host.drawText(api, host.metadata.title.toUpperCase(), 4, primaryBarHeight + 1, constants.COLOR_TOP_BAR_TEXT);
	const versionSuffix = host.dirty ? '*' : '';
	const version = `v${host.metadata.version}${versionSuffix}`;
	host.drawText(api, version, host.viewportWidth - host.measureText(version) - 4, primaryBarHeight + 1, constants.COLOR_TOP_BAR_TEXT);
}
