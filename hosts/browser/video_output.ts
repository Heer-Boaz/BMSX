import type { VideoOutput } from '../../machine/ts/render/video_output';
import { GX_GPU_DISPLAY_ASPECT_HEIGHT, GX_GPU_DISPLAY_ASPECT_WIDTH } from 'bmsx/spec/bmsx/model';
import type { BrowserOnscreenGamepad } from './onscreen_gamepad';

const ONSCREEN_LAYOUT_MODE: 'canvas' | 'gamepad' = 'canvas';

interface BrowserViewportMetrics {
	document: { width: number; height: number; };
	windowInner: { width: number; height: number; };
	screen: { width: number; height: number; };
	visible: {
		width: number;
		height: number;
		offsetTop: number;
		offsetLeft: number;
	};
}

/** Browser render target and canvas layout. */
export class BrowserVideoOutput implements VideoOutput {
	private renderWidth: number;
	private readonly visualViewport: VisualViewport | null;
	private layoutAnimationFrameId = 0;
	private readonly viewportMetrics: BrowserViewportMetrics = {
		document: { width: 0, height: 0 },
		windowInner: { width: 0, height: 0 },
		screen: { width: 0, height: 0 },
		visible: {
			width: 0,
			height: 0,
			offsetTop: 0,
			offsetLeft: 0,
		},
	};

	public constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly onscreenGamepad: BrowserOnscreenGamepad | null,
	) {
		this.renderWidth = canvas.width;
		this.visualViewport = window.visualViewport;
		window.addEventListener('resize', this.scheduleLayout);
		window.addEventListener('orientationchange', this.scheduleLayout);
		if (this.visualViewport) {
			this.visualViewport.addEventListener('resize', this.scheduleLayout);
			this.visualViewport.addEventListener('scroll', this.scheduleLayout);
		}
	}

	public setDisplaySize(width: number, _height: number): void {
		this.renderWidth = width;
		this.scheduleLayout();
	}

	public measureDisplay(): DOMRect {
		return this.canvas.getBoundingClientRect();
	}

	private computeViewportMetrics(): BrowserViewportMetrics {
		const metrics = this.viewportMetrics;
		const documentElement = document.documentElement;
		metrics.document.width = documentElement.clientWidth;
		metrics.document.height = documentElement.clientHeight;
		metrics.windowInner.width = window.innerWidth;
		metrics.windowInner.height = window.innerHeight;
		metrics.screen.width = window.screen.width;
		metrics.screen.height = window.screen.height;
		if (this.visualViewport) {
			metrics.visible.width = this.visualViewport.width;
			metrics.visible.height = this.visualViewport.height;
			metrics.visible.offsetTop = this.visualViewport.offsetTop;
			metrics.visible.offsetLeft = this.visualViewport.offsetLeft;
		} else {
			metrics.visible.width = metrics.windowInner.width > 0
				? metrics.windowInner.width
				: metrics.screen.width;
			metrics.visible.height = metrics.windowInner.height > 0
				? metrics.windowInner.height
				: metrics.screen.height;
			metrics.visible.offsetTop = 0;
			metrics.visible.offsetLeft = 0;
		}
		return metrics;
	}

	private readonly scheduleLayout = (): void => {
		if (this.layoutAnimationFrameId) {
			return;
		}
		this.layoutAnimationFrameId = window.requestAnimationFrame(this.runScheduledLayout);
	};

	private readonly runScheduledLayout = (): void => {
		this.layoutAnimationFrameId = 0;
		this.layout();
	};

	private readonly layout = (): void => {
		const metrics = this.computeViewportMetrics();
		const documentWidth = metrics.document.width;
		const documentHeight = metrics.document.height;
		const innerWidth = metrics.windowInner.width;
		const innerHeight = metrics.windowInner.height;
		const screenWidth = metrics.screen.width;
		const screenHeight = metrics.screen.height;

		const fallbackWidth = innerWidth > 0 ? innerWidth : screenWidth;
		const fallbackHeight = innerHeight > 0 ? innerHeight : screenHeight;
		let effectiveWidth = documentWidth;
		let effectiveHeight = documentHeight;
		if (fallbackWidth > effectiveWidth) {
			effectiveWidth = fallbackWidth;
		}
		if (fallbackHeight > effectiveHeight) {
			effectiveHeight = fallbackHeight;
		}

		const viewportWidth = innerWidth > 0 ? innerWidth : screenWidth;
		const viewportHeight = innerHeight > 0 ? innerHeight : screenHeight;
		const viewportIsLandscape = viewportWidth > viewportHeight && viewportWidth !== 0 && viewportHeight !== 0;

		let adjustedWidth = effectiveWidth;
		const onscreenGamepad = this.onscreenGamepad;
		if (onscreenGamepad
			&& ONSCREEN_LAYOUT_MODE === 'canvas'
			&& viewportIsLandscape) {
			const referenceDimension = viewportWidth > viewportHeight ? viewportWidth : viewportHeight;
			const maxControlScale = referenceDimension * 0.20 / 100;
			const dpadWidth = Number(onscreenGamepad.dpadElement.dataset.width) * maxControlScale;
			const actionButtonsWidth = Number(onscreenGamepad.actionButtonsElement.dataset.width) * maxControlScale;
			adjustedWidth = Math.max(0, adjustedWidth - dpadWidth - actionButtonsWidth);
		}

		const presentationHeight = this.renderWidth * GX_GPU_DISPLAY_ASPECT_HEIGHT / GX_GPU_DISPLAY_ASPECT_WIDTH;
		const dx = adjustedWidth / this.renderWidth;
		const dy = effectiveHeight / presentationHeight;
		const viewportScale = Math.floor(Math.min(dx, dy) * 2) / 2;

		this.performLayout(metrics, adjustedWidth, effectiveHeight, viewportScale);
	};

	private performLayout(
		metrics: BrowserViewportMetrics,
		availableWidth: number,
		availableHeight: number,
		viewportScale: number,
	): void {
		const viewportWidth = metrics.windowInner.width > 0 ? metrics.windowInner.width : metrics.screen.width;
		const viewportHeight = metrics.windowInner.height > 0 ? metrics.windowInner.height : metrics.screen.height;
		const visibleViewportHeight = metrics.visible.height;
		const visibleViewportBottom = metrics.visible.offsetTop + visibleViewportHeight;
		const viewportBottomInset = Math.max(0, viewportHeight - visibleViewportBottom);

		const displayWidth = Math.round(this.renderWidth * viewportScale);
		const displayHeight = Math.round(this.renderWidth * GX_GPU_DISPLAY_ASPECT_HEIGHT / GX_GPU_DISPLAY_ASPECT_WIDTH * viewportScale);

		const horizontalContainer = Math.max(viewportWidth, availableWidth, displayWidth);
		const verticalContainer = Math.max(viewportHeight, availableHeight, displayHeight);
		let displayLeft = ~~((horizontalContainer - displayWidth) / 2);
		if (displayLeft < 0) displayLeft = 0;

		const isLandscape = availableWidth >= availableHeight;
		let displayTop = isLandscape || !this.onscreenGamepad
			? ~~((verticalContainer - displayHeight) / 2)
			: 0;
		if (displayTop < 0) displayTop = 0;

		this.canvas.style.width = `${displayWidth}px`;
		this.canvas.style.height = `${displayHeight}px`;
		this.canvas.style.left = `${displayLeft}px`;
		this.canvas.style.top = `${displayTop}px`;

		const onscreenGamepad = this.onscreenGamepad;
		if (onscreenGamepad) {
			const dpad = onscreenGamepad.dpadElement;
			const actionButtons = onscreenGamepad.actionButtonsElement;
			const referenceDimension = viewportWidth > viewportHeight ? viewportWidth : viewportHeight;
			const canvasRect = this.measureDisplay();

			this.updateControlScale(
				dpad,
				false,
				isLandscape,
				referenceDimension,
				viewportWidth,
				canvasRect,
				visibleViewportHeight,
			);
			this.updateControlScale(
				actionButtons,
				true,
				isLandscape,
				referenceDimension,
				viewportWidth,
				canvasRect,
				visibleViewportHeight,
			);
			const dpadHeight = dpad.getBoundingClientRect().height;
			const actionHeight = actionButtons.getBoundingClientRect().height;
			this.updateControlBottom(
				dpad,
				dpadHeight,
				false,
				isLandscape,
				viewportBottomInset,
				visibleViewportHeight,
				actionHeight,
			);
			this.updateControlBottom(
				actionButtons,
				actionHeight,
				true,
				isLandscape,
				viewportBottomInset,
				visibleViewportHeight,
				actionHeight,
			);
		}
	}

	private updateControlScale(
		control: HTMLElement,
		isRightSide: boolean,
		isLandscape: boolean,
		referenceDimension: number,
		viewportWidth: number,
		canvasRect: DOMRect,
		visibleViewportHeight: number,
	): void {
		let newScale = referenceDimension * 0.20 / 100;
		if (isLandscape && ONSCREEN_LAYOUT_MODE === 'gamepad') {
			let maxControlWidth = isRightSide
				? viewportWidth - (canvasRect.left + canvasRect.width)
				: canvasRect.left;
			if (maxControlWidth < 0) maxControlWidth = 0;
			const width = Number(control.dataset.width);
			if (width * newScale > maxControlWidth) {
				newScale = maxControlWidth / width;
			}
		}
		const height = Number(control.dataset.height);
		if (visibleViewportHeight > 0) {
			const maxScaleByHeight = visibleViewportHeight / height;
			if (maxScaleByHeight > 0 && newScale > maxScaleByHeight) {
				newScale = maxScaleByHeight;
			}
		}
		control.style.transform = `scale(${newScale})`;
	}

	private updateControlBottom(
		control: HTMLElement,
		height: number,
		isRightSide: boolean,
		isLandscape: boolean,
		bottomInset: number,
		visibleViewportHeight: number,
		actionHeight: number,
	): void {
		let newBottom: number;
		if (isLandscape) {
			const verticalRoom = Math.max(visibleViewportHeight - height, 0);
			newBottom = bottomInset + verticalRoom / 2;
		} else if (isRightSide) {
			newBottom = bottomInset;
		} else {
			const verticalRoom = Math.max(Math.max(actionHeight, height) - height, 0);
			newBottom = bottomInset + verticalRoom / 2;
		}
		control.style.bottom = `${newBottom > 0 ? Math.round(newBottom) : 0}px`;
	}

}
