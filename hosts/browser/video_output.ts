import type { VideoOutput } from '../../machine/ts/render/video_output';
import { GX_GPU_DISPLAY_ASPECT_HEIGHT, GX_GPU_DISPLAY_ASPECT_WIDTH } from 'bmsx/spec/bmsx/model';
import type { BrowserOnscreenGamepadView } from './onscreen_gamepad_view';

/** Visible player bounds, canvas fitting and independent control-overlay layout. */
export class BrowserVideoOutput implements VideoOutput {
	private renderWidth: number;
	private readonly playerSurface: HTMLElement;
	private readonly controllerViewport: HTMLElement | null;
	private readonly visualViewport: VisualViewport | null;
	private readonly resizeObserver: ResizeObserver;
	private layoutAnimationFrameId = 0;

	public constructor(
		private readonly canvas: HTMLCanvasElement,
		private readonly controlView: BrowserOnscreenGamepadView | null,
	) {
		this.renderWidth = canvas.width;
		this.playerSurface = canvas.ownerDocument.getElementById('player-surface');
		this.controllerViewport = controlView ? canvas.ownerDocument.getElementById('controller-viewport') : null;
		this.visualViewport = window.visualViewport;
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

	public setDisplaySize(width: number, _height: number): void {
		this.renderWidth = width;
		this.scheduleLayout();
	}

	public measureDisplay(): DOMRect {
		return this.canvas.getBoundingClientRect();
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
		const width = Math.max(0, right - left);
		const height = Math.max(0, bottom - top);
		const presentationHeight = this.renderWidth * GX_GPU_DISPLAY_ASPECT_HEIGHT / GX_GPU_DISPLAY_ASPECT_WIDTH;
		const scale = Math.trunc(Math.min(width / this.renderWidth, height / presentationHeight) * 2) / 2;
		const displayWidth = this.renderWidth * scale;
		const displayHeight = presentationHeight * scale;
		this.canvas.style.width = `${displayWidth}px`;
		this.canvas.style.height = `${displayHeight}px`;
		this.canvas.style.left = `${left + (width - displayWidth) / 2}px`;
		this.canvas.style.top = `${top + (height - displayHeight) / 2}px`;
		if (this.controlView) {
			const controls = this.controllerViewport.getBoundingClientRect();
			this.controlView.layout(controls.left + insetLeft, controls.top + insetTop,
				Math.max(0, controls.width - insetLeft - insetRight), Math.max(0, controls.height - insetTop - insetBottom));
		}
	}

	public dispose(): void {
		if (this.layoutAnimationFrameId) window.cancelAnimationFrame(this.layoutAnimationFrameId);
		this.layoutAnimationFrameId = 0;
		this.resizeObserver.disconnect();
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

	private readonly runScheduledLayout = (): void => {
		this.layoutAnimationFrameId = 0;
		this.refreshLayout();
	};
}
