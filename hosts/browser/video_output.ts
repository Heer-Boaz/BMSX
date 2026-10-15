import type { VideoOutput } from '../../machine/ts/render/video_output';
import { write_rect_bounds, type RectBounds } from '../../machine/ts/common/rect';
import { GX_GPU_DISPLAY_ASPECT_HEIGHT, GX_GPU_DISPLAY_ASPECT_WIDTH } from 'bmsx/spec/bmsx/model';
import type { BrowserOnscreenGamepadView } from './onscreen_gamepad_view';
import { CONTROL_GAP } from './onscreen_gamepad_layout';

export type BrowserScreenFit = 'fit' | 'overscan';
// An explicit presentation policy, not a claim that carts author safe borders.
const OVERSCAN_VISIBLE_FRACTION = 0.9;

/** Visible player bounds, canvas fitting and independent control-overlay layout. */
export class BrowserVideoOutput implements VideoOutput {
	private renderWidth: number;
	private renderHeight: number;
	public readonly visibleViewportBounds: RectBounds;
	private readonly playerSurface: HTMLElement;
	private readonly controllerViewport: HTMLElement | null;
	private readonly visualViewport: VisualViewport | null;
	private readonly resizeObserver: ResizeObserver;
	private resolutionQuery: MediaQueryList;
	private layoutAnimationFrameId = 0;
	private selectedScreenFit: BrowserScreenFit;

	public constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly controlView: BrowserOnscreenGamepadView | null,
		screenFit: BrowserScreenFit,
	) {
		this.selectedScreenFit = screenFit;
		this.renderWidth = canvas.width;
		this.renderHeight = canvas.height;
		this.visibleViewportBounds = { left: 0, top: 0, right: canvas.width, bottom: canvas.height };
		this.playerSurface = canvas.ownerDocument.getElementById('player-surface');
		this.controllerViewport = controlView ? canvas.ownerDocument.getElementById('controller-viewport') : null;
		this.visualViewport = window.visualViewport;
		// Re-arm a resolution query on DPR changes, as VS Code's pixel-ratio
		// owner does; logical player bounds need not change with the monitor.
		this.resolutionQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
		this.resolutionQuery.addEventListener('change', this.onResolutionChange);
		this.resizeObserver = new ResizeObserver(this.scheduleLayout);
		this.resizeObserver.observe(this.playerSurface);
		if (this.controllerViewport) this.resizeObserver.observe(this.controllerViewport);
		window.addEventListener('resize', this.scheduleLayout);
		window.addEventListener('orientationchange', this.scheduleLayout);
		if (this.visualViewport) {
			this.visualViewport.addEventListener('resize', this.scheduleLayout);
			this.visualViewport.addEventListener('scroll', this.scheduleLayout);
		}
	}

	public setDisplaySize(width: number, height: number): void {
		// Until the scheduled CSS layout, the existing clip keeps its source
		// fractions. Publish that region in the new target coordinates now.
		const widthScale = width / this.renderWidth;
		const heightScale = height / this.renderHeight;
		this.visibleViewportBounds.left *= widthScale;
		this.visibleViewportBounds.right *= widthScale;
		this.visibleViewportBounds.top *= heightScale;
		this.visibleViewportBounds.bottom *= heightScale;
		this.renderWidth = width;
		this.renderHeight = height;
		this.scheduleLayout();
	}

	public measureDisplay(): DOMRect {
		return this.canvas.getBoundingClientRect();
	}

	public get screenFit(): BrowserScreenFit { return this.selectedScreenFit; }

	public setScreenFit(mode: BrowserScreenFit): void {
		if (mode === this.selectedScreenFit) return;
		this.selectedScreenFit = mode;
		this.refreshLayout();
	}

	/** Initial geometry is published synchronously before the input source activates. */
	public refreshLayout(): void {
		if (this.layoutAnimationFrameId) window.cancelAnimationFrame(this.layoutAnimationFrameId);
		this.layoutAnimationFrameId = 0;
		const document = this.canvas.ownerDocument;
		const viewport = this.visualViewport;
		const viewportLeft = viewport ? viewport.offsetLeft : 0;
		const viewportTop = viewport ? viewport.offsetTop : 0;
		const viewportWidth = viewport ? viewport.width : document.documentElement.clientWidth;
		const viewportHeight = viewport ? viewport.height : document.documentElement.clientHeight;
		const player = this.playerSurface.getBoundingClientRect();
		const style = window.getComputedStyle(this.playerSurface);
		const insetLeft = Number.parseFloat(style.paddingLeft);
		const insetTop = Number.parseFloat(style.paddingTop);
		const insetRight = Number.parseFloat(style.paddingRight);
		const insetBottom = Number.parseFloat(style.paddingBottom);
		const left = Math.max(player.left, viewportLeft + insetLeft);
		const top = Math.max(player.top, viewportTop + insetTop);
		const right = Math.min(player.right, viewportLeft + viewportWidth - insetRight);
		const bottom = Math.min(player.bottom, viewportTop + viewportHeight - insetBottom);
		if (this.controlView) {
			const controls = this.controllerViewport.getBoundingClientRect();
			const controlWidth = Math.max(0, controls.width - insetLeft - insetRight);
			const controlHeight = Math.max(0, controls.height - insetTop - insetBottom);
			const deckHeight = this.controlView.measurePortraitDeckHeight(controlWidth, controlHeight);
			const portrait = deckHeight !== 0;
			// A width-derived video slot keeps control placement independent of
			// scanout resolution, DPR, overscan and visual-only viewport changes.
			// Portrait has vertical room: reserve the tallest permitted width
			// even in Fit, instead of needlessly cropping top/bottom game text.
			const slotHeight = Math.min(controlWidth * GX_GPU_DISPLAY_ASPECT_HEIGHT
				/ (GX_GPU_DISPLAY_ASPECT_WIDTH * OVERSCAN_VISIBLE_FRACTION),
				controlHeight - deckHeight - CONTROL_GAP);
			this.controlView.layout(controls.left + insetLeft, controls.top + insetTop,
				controlWidth, controlHeight, portrait ? controls.top + insetTop + slotHeight + CONTROL_GAP : undefined);
		}
		// The authored portrait deck owns its boundary; canvas fitting consumes it.
		// Landscape controls remain overlays on the full dynamic visible space.
		const portraitDeckTop = this.controlView ? this.controlView.portraitDeckTop : null;
		const width = Math.max(0, right - left);
		const height = Math.max(0, (portraitDeckTop === null ? bottom : Math.min(bottom, portraitDeckTop)) - top);
		const presentationHeight = this.renderWidth * GX_GPU_DISPLAY_ASPECT_HEIGHT / GX_GPU_DISPLAY_ASPECT_WIDTH;
		const overscan = this.selectedScreenFit === 'overscan';
		const visibleFraction = overscan ? OVERSCAN_VISIBLE_FRACTION : 1;
		const dpr = window.devicePixelRatio;
		// Quantize the presentation in physical display pixels, not UI CSS
		// units. Source render targets and touch geometry remain unchanged.
		const scale = Math.trunc(Math.min(width / this.renderWidth, height / presentationHeight)
			* dpr * 2 / visibleFraction) / (dpr * 2);
		const displayWidth = this.renderWidth * scale;
		const displayHeight = presentationHeight * scale;
		const displayLeft = left + (width - displayWidth) / 2;
		const displayTop = portraitDeckTop === null ? top + (height - displayHeight) / 2
			: top + (overscan ? Math.min(0, (height - displayHeight) / 2) : 0);
		this.canvas.style.width = `${displayWidth}px`;
		this.canvas.style.height = `${displayHeight}px`;
		this.canvas.style.left = `${displayLeft}px`;
		this.canvas.style.top = `${displayTop}px`;
		// Clip the actual safe video frame, including the portrait deck edge.
		// CSS clipping also excludes hidden pixels from native hit testing;
		// measureDisplay retains the complete image transform for coordinates.
		const clipTop = Math.max(0, top - displayTop);
		const clipRight = Math.max(0, displayLeft + displayWidth - right);
		const clipBottom = Math.max(0, displayTop + displayHeight - top - height);
		const clipLeft = Math.max(0, left - displayLeft);
		this.canvas.style.clipPath = overscan
			? `inset(${clipTop}px ${clipRight}px ${clipBottom}px ${clipLeft}px)`
			: 'none';
		write_rect_bounds(this.visibleViewportBounds,
			clipLeft / displayWidth * this.renderWidth,
			clipTop / displayHeight * this.renderHeight,
			(displayWidth - clipRight) / displayWidth * this.renderWidth,
			(displayHeight - clipBottom) / displayHeight * this.renderHeight);
	}

	public dispose(): void {
		if (this.layoutAnimationFrameId) window.cancelAnimationFrame(this.layoutAnimationFrameId);
		this.layoutAnimationFrameId = 0;
		this.resizeObserver.disconnect();
		this.resolutionQuery.removeEventListener('change', this.onResolutionChange);
		window.removeEventListener('resize', this.scheduleLayout);
		window.removeEventListener('orientationchange', this.scheduleLayout);
		if (this.visualViewport) {
			this.visualViewport.removeEventListener('resize', this.scheduleLayout);
			this.visualViewport.removeEventListener('scroll', this.scheduleLayout);
		}
		this.controlView?.dispose();
	}

	private readonly scheduleLayout = (): void => {
		if (!this.layoutAnimationFrameId) this.layoutAnimationFrameId = window.requestAnimationFrame(this.runScheduledLayout);
	};

	private readonly onResolutionChange = (): void => {
		this.resolutionQuery.removeEventListener('change', this.onResolutionChange);
		this.resolutionQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
		this.resolutionQuery.addEventListener('change', this.onResolutionChange);
		this.scheduleLayout();
	};

	private readonly runScheduledLayout = (): void => {
		this.layoutAnimationFrameId = 0;
		this.refreshLayout();
	};
}
