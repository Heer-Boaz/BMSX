import type { VideoPresenter } from '../../../../machine/ts/render/video_presenter';
import type { BFont } from '../../../../machine/ts/render/shared/bitmap_font';
import * as constants from '../../../common/constants';
import { api } from '../../../runtime/overlay_api';
import type { OverlayRenderer } from '../../../runtime/overlay_renderer';
import {
	STUDIO_CHROME_PANEL_HEADER_HEIGHT,
	STUDIO_CHROME_TREE_ROW_HEIGHT,
	STUDIO_CHROME_TOP_HEIGHT,
} from './chrome_layout';
import {
	StudioChromeTargetKind,
	type StudioChromeState,
} from './chrome_state';
import type { StudioDescriptorModel } from './model';
import { STUDIO_FLAG_GAMEPLAY_RUNNING } from './protocol';

function renderStudioTreeRow(
	label: string,
	x: number,
	rowTop: number,
	rowRight: number,
	selected: boolean,
	hovered: boolean,
	font: BFont,
): void {
	if (selected || hovered) {
		api.fill_rect(
			0,
			rowTop,
			rowRight,
			rowTop + STUDIO_CHROME_TREE_ROW_HEIGHT,
			1,
			selected
				? constants.COLOR_RESOURCE_PANEL_HIGHLIGHT
				: constants.HIGHLIGHT_OVERLAY,
		);
	}
	api.blit_text_inline_with_font(
		label,
		x,
		rowTop + 1,
		2,
		selected
			? constants.COLOR_RESOURCE_PANEL_HIGHLIGHT_TEXT
			: constants.COLOR_RESOURCE_PANEL_TEXT,
		font,
	);
}

export function renderStudioChrome(
	overlayRenderer: OverlayRenderer,
	presenter: VideoPresenter,
	model: StudioDescriptorModel,
	state: StudioChromeState,
): void {
	const rendererViewport = overlayRenderer.viewportSize;
	if (rendererViewport === null
		|| rendererViewport.width !== state.layout.viewportWidth
		|| rendererViewport.height !== state.layout.viewportHeight) {
		overlayRenderer.setViewportSize({
			width: state.layout.viewportWidth,
			height: state.layout.viewportHeight,
		});
	}
	const renderer = overlayRenderer;
	const font = presenter.default_font;
	const layout = state.layout;
	const snapshot = model.snapshot;
	const pending = model.connection.commandPending;
	const activeButtonColor = constants.COLOR_HEADER_BUTTON_ACTIVE_BACKGROUND;
	const buttonColor = constants.COLOR_HEADER_BUTTON_BACKGROUND;
	const buttonTextColor = constants.COLOR_HEADER_BUTTON_TEXT;
	const headerButtonTextColor = pending
		? constants.COLOR_HEADER_BUTTON_TEXT_DISABLED
		: buttonTextColor;
	const panelTextColor = constants.COLOR_RESOURCE_PANEL_TEXT;
	const detailsTextColor = constants.COLOR_RESOURCE_VIEWER_TEXT;
	const dimTextColor = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_DIM;
	const detailsX = layout.rightPanel.left + 4;
	const detailsTop = STUDIO_CHROME_TOP_HEIGHT + STUDIO_CHROME_PANEL_HEADER_HEIGHT + 2;
	try {
		renderer.beginFrame(presenter);
		api.beginFrame(renderer);
		api.fill_rect(
			layout.topBar.left,
			layout.topBar.top,
			layout.topBar.right,
			layout.topBar.bottom,
			0,
			constants.COLOR_TOP_BAR,
		);
		api.blit_text_inline_with_font('STUDIO', 4, 4, 1, constants.COLOR_TOP_BAR_TEXT, font);

		const gameplayRunning = model.ready
			&& (snapshot.flags & STUDIO_FLAG_GAMEPLAY_RUNNING) !== 0;
		api.fill_rect(
			layout.playButton.left,
			layout.playButton.top,
			layout.playButton.right,
			layout.playButton.bottom,
			1,
			gameplayRunning
				? activeButtonColor
				: buttonColor,
		);
		api.blit_text_inline_with_font(
			'PLAY',
			layout.playButton.left + 5,
			layout.playButton.top + 2,
			2,
			headerButtonTextColor,
			font,
		);
		api.fill_rect(
			layout.editButton.left,
			layout.editButton.top,
			layout.editButton.right,
			layout.editButton.bottom,
			1,
			model.ready && !gameplayRunning
				? activeButtonColor
				: buttonColor,
		);
		api.blit_text_inline_with_font(
			'EDIT',
			layout.editButton.left + 5,
			layout.editButton.top + 2,
			2,
			headerButtonTextColor,
			font,
		);
		if (pending) {
			api.blit_text_inline_with_font('SYNC', 132, 4, 1, constants.COLOR_STATUS_WARNING, font);
		}

		api.fill_rect(
			layout.leftPanel.left,
			layout.leftPanel.top,
			layout.leftPanel.right,
			layout.leftPanel.bottom,
			0,
			constants.COLOR_RESOURCE_PANEL_BACKGROUND,
		);
		api.fill_rect(
			layout.rightPanel.left,
			layout.rightPanel.top,
			layout.rightPanel.right,
			layout.rightPanel.bottom,
			0,
			constants.COLOR_RESOURCE_PANEL_BACKGROUND,
		);
		api.fill_rect(
			layout.leftPanel.right - 1,
			layout.leftPanel.top,
			layout.leftPanel.right,
			layout.leftPanel.bottom,
			1,
			constants.RESOURCE_PANEL_DIVIDER_COLOR,
		);
		api.fill_rect(
			layout.rightPanel.left,
			layout.rightPanel.top,
			layout.rightPanel.left + 1,
			layout.rightPanel.bottom,
			1,
			constants.RESOURCE_PANEL_DIVIDER_COLOR,
		);
		api.blit_text_inline_with_font(
			'OUTLINER',
			4,
			STUDIO_CHROME_TOP_HEIGHT + 2,
			1,
			panelTextColor,
			font,
		);
		api.blit_text_inline_with_font(
			'DETAILS',
			detailsX,
			STUDIO_CHROME_TOP_HEIGHT + 2,
			1,
			panelTextColor,
			font,
		);

		if (!model.ready) {
			api.blit_text_inline_with_font(
				'WAITING',
				4,
				detailsTop,
				1,
				dimTextColor,
				font,
			);
			api.blit_text_inline_with_font(
				'BOARD',
				detailsX,
				detailsTop,
				1,
				dimTextColor,
				font,
			);
			return;
		}

		let flatRow = 0;
		let visibleRow = 0;
		let objectIndex = 0;
		let componentIndex = -1;
		let rowTop = layout.outlinerList.top;
		const rowRight = layout.outlinerList.right - 1;
		while (objectIndex < snapshot.objects.size && visibleRow < layout.visibleTreeRows) {
			const object = snapshot.objects.peek(objectIndex);
			if (flatRow >= state.outlinerScroll) {
				if (componentIndex < 0) {
					renderStudioTreeRow(
						object.label,
						4,
						rowTop,
						rowRight,
						snapshot.selectedObjectHandle === object.handle
							&& snapshot.selectedComponentHandle === 0,
						state.hoverTarget.kind === StudioChromeTargetKind.Object
							&& state.hoverTarget.objectHandle === object.handle,
						font,
					);
				} else {
					const component = snapshot.components.peek(object.firstComponent + componentIndex);
					renderStudioTreeRow(
						component.label,
						10,
						rowTop,
						rowRight,
						snapshot.selectedComponentHandle === component.handle,
						state.hoverTarget.kind === StudioChromeTargetKind.Component
							&& state.hoverTarget.componentHandle === component.handle,
						font,
					);
				}
				visibleRow += 1;
				rowTop += STUDIO_CHROME_TREE_ROW_HEIGHT;
			}
			flatRow += 1;
			componentIndex += 1;
			if (componentIndex >= object.componentCount) {
				objectIndex += 1;
				componentIndex = -1;
			}
		}

		api.blit_text_inline_with_font(state.details.title, detailsX, detailsTop, 1, detailsTextColor, font);
		api.blit_text_inline_with_font(state.details.line1, detailsX, detailsTop + 10, 1, detailsTextColor, font);
		api.blit_text_inline_with_font(state.details.line2, detailsX, detailsTop + 20, 1, detailsTextColor, font);
		api.blit_text_inline_with_font(state.details.line3, detailsX, detailsTop + 30, 1, detailsTextColor, font);

		if (state.details.kind === 1) {
			for (let axis = 0; axis < 3; axis += 1) {
				const minus = layout.positionMinus[axis];
				const plus = layout.positionPlus[axis];
				const rowTop = minus.top;
				let positionLabel = state.details.z;
				if (axis === 0) {
					positionLabel = state.details.x;
				} else if (axis === 1) {
					positionLabel = state.details.y;
				}
				api.blit_text_inline_with_font(
					positionLabel,
					detailsX,
					rowTop + 2,
					1,
					detailsTextColor,
					font,
				);
				api.fill_rect(
					minus.left,
					minus.top,
					minus.right,
					minus.bottom,
					1,
					state.hoverTarget.kind === StudioChromeTargetKind.PositionMinus
						&& state.hoverTarget.axis === axis
							? activeButtonColor
							: buttonColor,
				);
				api.blit_text_inline_with_font('-', minus.left + 5, minus.top + 2, 2, buttonTextColor, font);
				api.fill_rect(
					plus.left,
					plus.top,
					plus.right,
					plus.bottom,
					1,
					state.hoverTarget.kind === StudioChromeTargetKind.PositionPlus
						&& state.hoverTarget.axis === axis
							? activeButtonColor
							: buttonColor,
				);
				api.blit_text_inline_with_font('+', plus.left + 4, plus.top + 2, 2, buttonTextColor, font);
			}
			const visible = layout.visibleToggle;
			api.fill_rect(
				visible.left,
				visible.top,
				visible.right,
				visible.bottom,
				1,
				state.hoverTarget.kind === StudioChromeTargetKind.Visible
					? activeButtonColor
					: buttonColor,
			);
			api.blit_text_inline_with_font(state.details.toggle, visible.left + 3, visible.top + 2, 2, buttonTextColor, font);
		} else if (state.details.kind === 2) {
			const enabled = layout.componentEnabledToggle;
			api.fill_rect(
				enabled.left,
				enabled.top,
				enabled.right,
				enabled.bottom,
				1,
				state.hoverTarget.kind === StudioChromeTargetKind.ComponentEnabled
					? activeButtonColor
					: buttonColor,
			);
			api.blit_text_inline_with_font(state.details.toggle, enabled.left + 3, enabled.top + 2, 2, buttonTextColor, font);
		}
	} finally {
		renderer.endFrame();
	}
}
