import * as constants from '../constants';
import type { RectBounds } from '../../../rompack/rompack';
import type { LuaDebuggerSessionMetrics } from '../../../lua/debugger';
import { ide_state } from '../ide_state';
import { getConsoleRuntime, isDebugPanelActive } from '../console_cart_editor';
import { measureText } from '../text_utils';
import { drawEditorText } from '../text_renderer';
import { TopBarButtonId } from '../types';
import { api } from '../../runtime';

export function renderTopBar(): void {
	const primaryBarHeight = ide_state.headerHeight;
	api.rectfill(0, 0, ide_state.viewportWidth, primaryBarHeight, constants.COLOR_TOP_BAR);

	const buttonTop = 1;
	const buttonHeight = ide_state.lineHeight + constants.HEADER_BUTTON_PADDING_Y * 2;
	const iconButtonSize = buttonHeight;
	const resolutionRight = ide_state.viewportWidth - 4;
	const resolutionLeft = resolutionRight - iconButtonSize;
	const resolutionBottom = buttonTop + buttonHeight;
	const wrapRight = resolutionLeft - constants.HEADER_BUTTON_SPACING;
	const wrapLeft = wrapRight - iconButtonSize;
	ide_state.topBarButtonBounds.resolution = { left: resolutionLeft, top: buttonTop, right: resolutionRight, bottom: resolutionBottom };
	ide_state.topBarButtonBounds.wrap = { left: wrapLeft, top: buttonTop, right: wrapRight, bottom: resolutionBottom };
	ide_state.topBarButtonBounds.resume = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.topBarButtonBounds.reboot = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.topBarButtonBounds.save = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.topBarButtonBounds.resources = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.topBarButtonBounds.problems = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.topBarButtonBounds.filter = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.topBarButtonBounds.debugObjects = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.topBarButtonBounds.debugEvents = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.topBarButtonBounds.debugRegistry = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.topBarButtonBounds.debugContinue = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.topBarButtonBounds.debugStepOver = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.topBarButtonBounds.debugStepInto = { left: 0, top: 0, right: 0, bottom: 0 };
	ide_state.topBarButtonBounds.debugStepOut = { left: 0, top: 0, right: 0, bottom: 0 };
	let buttonX = 4;
	const buttonEntries: Array<{ id: TopBarButtonId; label: string; disabled: boolean; active?: boolean }> = [
		{ id: 'resume', label: 'RESUME', disabled: false },
		{ id: 'reboot', label: 'REBOOT', disabled: false },
		{ id: 'save', label: 'SAVE', disabled: !ide_state.dirty },
		{ id: 'resources', label: 'FILES', disabled: false, active: ide_state.resourcePanelVisible },
	];
	const debuggerPaused = ide_state.debuggerControls.executionState === 'paused';
	const debuggerButtonDisabled = !debuggerPaused;
	buttonEntries.push(
		{ id: 'debugContinue', label: 'CONT', disabled: debuggerButtonDisabled },
		{ id: 'debugStepOver', label: 'OVER', disabled: debuggerButtonDisabled },
		{ id: 'debugStepInto', label: 'INTO', disabled: debuggerButtonDisabled },
		{ id: 'debugStepOut', label: 'OUT', disabled: debuggerButtonDisabled },
	);
	buttonEntries.push({ id: 'problems', label: 'PROBLEMS', disabled: false, active: ide_state.problemsPanel.isVisible() });
	buttonEntries.push({ id: 'debugObjects', label: 'OBJECTS', disabled: false, active: isDebugPanelActive('objects') });
	buttonEntries.push({ id: 'debugEvents', label: 'EVENTS', disabled: false, active: isDebugPanelActive('events') });
	buttonEntries.push({ id: 'debugRegistry', label: 'REGISTRY', disabled: false, active: isDebugPanelActive('registry') });
	if (ide_state.resourcePanelVisible) {
		const filterMode = ide_state.resourcePanel.getFilterMode();
		const filterLabel = filterMode === 'lua_only' ? 'LUA' : 'ALL';
		buttonEntries.push({
			id: 'filter',
			label: filterLabel,
			disabled: false,
			active: filterMode === 'lua_only',
		});
	}
	const availableRight = wrapLeft - constants.HEADER_BUTTON_SPACING;
	for (let i = 0; i < buttonEntries.length; i++) {
		const entry = buttonEntries[i];
		const textWidth = measureText(entry.label);
		const buttonWidth = textWidth + constants.HEADER_BUTTON_PADDING_X * 2;
		const right = buttonX + buttonWidth;
		if (right > availableRight) {
			ide_state.topBarButtonBounds[entry.id] = { left: 0, top: 0, right: 0, bottom: 0 };
			break;
		}
		const bottom = buttonTop + buttonHeight;
		const bounds: RectBounds = { left: buttonX, top: buttonTop, right, bottom };
		ide_state.topBarButtonBounds[entry.id] = bounds;
		const fillColor = entry.active
			? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND
			: (entry.disabled ? constants.COLOR_HEADER_BUTTON_DISABLED_BACKGROUND : constants.COLOR_HEADER_BUTTON_BACKGROUND);
		const textColor = entry.active
			? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT
			: (entry.disabled ? constants.COLOR_HEADER_BUTTON_TEXT_DISABLED : constants.COLOR_HEADER_BUTTON_TEXT);
		api.rectfill(bounds.left, bounds.top, bounds.right, bounds.bottom, fillColor);
		api.rect(bounds.left, bounds.top, bounds.right, bounds.bottom, constants.COLOR_HEADER_BUTTON_BORDER);
		drawEditorText(api, ide_state.font, entry.label, bounds.left + constants.HEADER_BUTTON_PADDING_X, bounds.top + constants.HEADER_BUTTON_PADDING_Y, textColor);
		buttonX = right + constants.HEADER_BUTTON_SPACING;
	}
	const debuggerSummary =
		debuggerPaused && ide_state.debuggerControls.sessionMetrics
			? formatDebuggerTopBarMetrics(ide_state.debuggerControls.sessionMetrics)
			: null;

	const wrapActive = ide_state.wordWrapEnabled;
	const wrapFill = wrapActive ? constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND : constants.COLOR_HEADER_BUTTON_BACKGROUND;
	const wrapTextColor = wrapActive ? constants.COLOR_HEADER_BUTTON_ACTIVE_TEXT : constants.COLOR_HEADER_BUTTON_TEXT;
	const wrapBounds = ide_state.topBarButtonBounds.wrap;
	api.rectfill(wrapBounds.left, wrapBounds.top, wrapBounds.right, wrapBounds.bottom, wrapFill);
	api.rect(wrapBounds.left, wrapBounds.top, wrapBounds.right, wrapBounds.bottom, constants.COLOR_HEADER_BUTTON_BORDER);
	const wrapLabel = 'w';
	const wrapLabelWidth = measureText(wrapLabel);
	const wrapLabelX = wrapBounds.left + Math.max(1, Math.floor((iconButtonSize - wrapLabelWidth) / 2));
	const wrapLabelY = wrapBounds.top + constants.HEADER_BUTTON_PADDING_Y;
	drawEditorText(api, ide_state.font, wrapLabel, wrapLabelX, wrapLabelY, wrapTextColor);

	const resolutionActive = getConsoleRuntime().overlayResolutionMode === 'viewport';
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
	if (getConsoleRuntime().overlayResolutionMode === 'viewport') {
		api.rectfill(frameX + innerMargin, indicatorY, frameX + frameSize - innerMargin, indicatorY + indicatorHeight, resolutionTextColor);
	} else {
		const segmentWidth = Math.max(1, Math.floor((frameSize - innerMargin * 2) / 2));
		api.rectfill(frameX + innerMargin, indicatorY, frameX + innerMargin + segmentWidth, indicatorY + indicatorHeight, resolutionTextColor);
		api.rectfill(frameX + frameSize - innerMargin - segmentWidth, indicatorY, frameX + frameSize - innerMargin, indicatorY + indicatorHeight, resolutionTextColor);
	}
	const resolutionLabel = 'R';
	const resolutionLabelX = resolutionLeft + Math.max(1, Math.floor((iconButtonSize - measureText(resolutionLabel)) / 2));
	const resolutionLabelY = buttonTop + constants.HEADER_BUTTON_PADDING_Y;
	drawEditorText(api, ide_state.font, resolutionLabel, resolutionLabelX, resolutionLabelY, resolutionTextColor);

	const titleY = primaryBarHeight + 1;
	drawEditorText(api, ide_state.font, ide_state.metadata.title.toUpperCase(), 4, titleY, constants.COLOR_TOP_BAR_TEXT);
	const versionSuffix = ide_state.dirty ? '*' : '';
	const version = `v${ide_state.metadata.version}${versionSuffix}`;
	const versionWidth = measureText(version);
	let versionX = ide_state.viewportWidth - versionWidth - 4;
	if (debuggerSummary) {
		const summaryWidth = measureText(debuggerSummary);
		const summaryX = Math.max(4, versionX - summaryWidth - 8);
		drawEditorText(api, ide_state.font, debuggerSummary, summaryX, titleY, constants.COLOR_TOP_BAR_TEXT);
		versionX = Math.max(summaryX - 4, versionX);
	}
	drawEditorText(api, ide_state.font, version, versionX, titleY, constants.COLOR_TOP_BAR_TEXT);
}

function formatDebuggerTopBarMetrics(metrics: LuaDebuggerSessionMetrics): string {
	const parts: string[] = [`S${metrics.sessionId}`, `P${metrics.pauseCount}`];
	if (metrics.exceptionCount > 0) {
		parts.push(`E${metrics.exceptionCount}`);
	}
	if (metrics.skippedExceptionCount > 0) {
		parts.push(`Sk${metrics.skippedExceptionCount}`);
	}
	return parts.join(' ');
}
