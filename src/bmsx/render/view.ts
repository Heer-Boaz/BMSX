import { BaseModel } from '../core/basemodel';
import { BFont } from '../core/font';
import { GameOptions } from '../core/gameoptions';
import type { Mesh } from '../core/mesh';
import { Registry } from '../core/registry';
import { GateGroup, taskGate } from '../core/taskgate';
import { copy_vector } from '../core/utils';
import { Input } from '../input/input';
import type { Area, Polygon, Size, Vector, id2imgres, vec2 } from '../rompack/rompack';
import { Identifier, type RegisterablePersistent } from '../rompack/rompack';
import { AmbientLight, DirectionalLight, PointLight } from './3d/light';

// Global gate used to coordinate rendering. When blocked, frames are skipped.
export const renderGate: GateGroup = taskGate.group('render:main');

export interface FlipOptions {
	flip_h: boolean;
	flip_v: boolean;
}

export interface DrawRectOptions {
	area: Area;
	color: Color;
}

export interface DrawImgOptions {
	imgid: string;
	pos: Vector;
	scale?: vec2;
	flip?: FlipOptions;
	colorize?: Color;
}

export type Color = {
	r: number;
	g: number;
	b: number;
	a: number;
};

export type color_arr = [number, number, number, number];

export class PixelData {
	public B: number;
	public G: number;
	public R: number;
}

export interface DrawMeshOptions {
	mesh: Mesh;
	matrix: Float32Array;
	jointMatrices?: Float32Array[];
	morphWeights?: number[];
}

export interface SkyboxImageIds {
	posX: string;
	negX: string;
	posY: string;
	negY: string;
	posZ: string;
	negZ: string;
}

const atlasNameCache = new Map<number, string>(); // Cache for atlas names to avoid regenerating them for each request
export function generateAtlasName(atlasIndex: number): string {
	// Check if the atlas name is already cached
	if (atlasNameCache.has(atlasIndex)) {
		return atlasNameCache.get(atlasIndex)!;
	}
	// Generate a new atlas name and cache it
	const idxStr = atlasIndex.toString().padStart(2, '0');
	const atlasName = atlasIndex === 0 ? '_atlas' : `_atlas_${idxStr}`;
	atlasNameCache.set(atlasIndex, atlasName);
	return atlasName;
}

/**
 * The `BaseView` class is an abstract class that serves as the base for all views in the application.
 * It provides common functionality and properties that are shared across all views.
 */
export abstract class BaseView implements RegisterablePersistent {
	get registrypersistent(): true {
		return true;
	}

	public get id(): Identifier { return 'view'; }
	public dispose(): void {
		// Deregister from registry
		Registry.instance.deregister(this);
	}

	public canvas: HTMLCanvasElement;
	public context: CanvasRenderingContext2D;
	public static imgassets: id2imgres = {};
	public accessor default_font: BFont;

	public windowSize: Size;
	public availableWindowSize: Size;
	public viewportSize: Size; // The size of the viewport, which is the size of the game buffer (e.g. 256x212 for the MSX2)
	public canvasSize: Size; // The size of the canvas, which may be different from the viewport size (e.g. when the GLView renders the game buffer to a larger canvas so that it can have more granular control over applying effects)
	public dx: number;
	public dy: number;
	public viewportScale: number;

	public canvas_dx: number;
	public canvas_dy: number;
	public canvasScale: number;

	constructor(viewportSize: Size, canvasSize?: Size) {
		Registry.instance.register(this);
		this.viewportSize = copy_vector(viewportSize);
		this.canvasSize = copy_vector(canvasSize) ?? copy_vector(viewportSize);
		this.canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
	}

	public init(): void {
		this.calculateSize();
		this.canvas.width = this.canvasSize.x;
		this.canvas.height = this.canvasSize.y;
		this.handleResize();
		this.listenToMediaEvents();
	}

	protected drawbase(clearCanvas: boolean = true): void {
		// Base drawing logic goes here
		const model: BaseModel = $.model;
		model.applyViewSettings();
		if (clearCanvas) $.view.clear();
		$.model.currentSpace.sort_by_depth(); // Required for each frame as objects can change depth during the flow of the game
		$.model.currentSpace.objects.forEach(o => !o.disposeFlag && o.visible && (o.updateComponentsWithTag?.('render'), o.paint?.()));
	}

	/**
	 * Draws the game on the canvas. If `clearCanvas` is set to `true`, the canvas will be cleared before drawing.
	 * The method sorts the objects in the current space by depth and then iterates over them, calling their `paint` method
	 * if they are visible and not flagged for disposal.
	 *
	 * Rendering should be guarded by a global {@link renderGate}. When the gate is blocked (e.g. while the game state is being
	 * revived), this method immediately returns so no WebGL state is touched prematurely.
	 */
	public abstract drawgame(clearCanvas?: boolean): void;

	/**
	 * Calculates the size of the canvas and the scale factor based on the current viewport size and window size.
	 * The `dx` and `dy` properties represent the ratio of the window size to the viewport size in the x and y directions, respectively.
	 * The `scale` property represents the minimum of `dx` and `dy`.
	 */
	public calculateSize(): void {
		const self = $.view || this;

		let w = Math.max(document.documentElement.clientWidth, window.innerWidth || screen.width);
		let h = Math.max(document.documentElement.clientHeight, window.innerHeight || screen.height);

		self.windowSize = { x: w, y: h };

		// We need to respect the size of the onscreen gamepad, but only if the onscreen gamepad is visible and only in landscape mode
		if (Input.instance.isOnscreenGamepadEnabled && GameOptions.canvas_or_onscreengamepad_must_respect_lebensraum === 'canvas') {
			// Determine whether we are in landscape or portrait mode
			const isLandscape = window.innerWidth > window.innerHeight;

			if (isLandscape) {
				const maxSvgScale = Math.max(window.innerWidth, window.innerHeight) * 0.20 / 100;
				// Get the SVG element
				const dpad_svg = document.querySelector<HTMLElement>('#d-pad-svg');
				const actionbuttons_svg = document.querySelector<HTMLElement>('#action-buttons-svg');

				const dpadWidth = parseInt(dpad_svg.getAttribute('width')!) * maxSvgScale;
				const actionButtonsWidth = parseInt(actionbuttons_svg.getAttribute('width')!) * maxSvgScale;

				// Calculate the maximum width of the windowSize based on the SVG elements
				w -= dpadWidth + actionButtonsWidth;
			}
		}

		self.availableWindowSize = { x: ~~w, y: ~~h };
		self.dx = self.availableWindowSize.x / self.viewportSize.x;
		self.dy = self.availableWindowSize.y / self.viewportSize.y;
		self.viewportScale = Math.min(self.dx, self.dy);

		self.canvas_dx = self.availableWindowSize.x / self.canvasSize.x;
		self.canvas_dy = self.availableWindowSize.y / self.canvasSize.y;
		self.canvasScale = Math.min(self.canvas_dx, self.canvas_dy);
	}

	public handleResize(): void {
		if (document.getElementById('gamescreen')!.style.visibility === 'hidden') return;
		// Determine whether we are in landscape or portrait mode
		const isLandscape = window.innerWidth > window.innerHeight;

		let self = $.view || this;
		self.calculateSize();
		self.canvas.style.width = `${~~(self.canvasSize.x * self.canvasScale)}px`;
		self.canvas.style.height = `${~~(self.canvasSize.y * self.canvasScale)}px`;
		self.canvas.style.left = `${~~((self.windowSize.x - self.canvas.width * self.canvasScale) / 2)}px`;
		let canvasTop: number;
		if (isLandscape || !Input.instance.isOnscreenGamepadEnabled) {
			canvasTop = ~~((self.windowSize.y - self.canvas.height * self.canvasScale) / 2);
		}
		else {
			canvasTop = 0;
		}
		self.canvas.style.top = `${canvasTop}px`;

		if (Input.instance.isOnscreenGamepadEnabled) {
			// Get the SVG element
			const dpad_svg = document.querySelector<HTMLElement>('#d-pad-svg');
			const actionbuttons_svg = document.querySelector<HTMLElement>('#action-buttons-svg');
			function updateBottomPosition(element: HTMLElement, isRightSide: boolean) {
				let newBottom: number;
				if (isLandscape) {
					newBottom = (self.availableWindowSize.y - element.getBoundingClientRect().height) / 2;
				}
				else {
					if (isRightSide) {
						newBottom = 0;
					}
					else {
						// Place the left side element such that it's middle is aligned with the middle of the right side element (actionbuttons_svg)
						const rightside_height = actionbuttons_svg.getBoundingClientRect().height
						const leftside_height = element.getBoundingClientRect().height;
						newBottom = (rightside_height - leftside_height) / 2;
					}
				}

				// Apply the new bottom position
				element.style.bottom = `${newBottom}`;
			}

			// Function to update the scale
			// @ts-ignore
			function updateScale(element: HTMLElement, isRightSide: boolean) {
				// Calculate the new scale
				let newScale = Math.max(window.innerWidth, window.innerHeight) * 0.20 / 100;

				// If in landscape mode, limit the scale so that the SVG element does not overlap with the canvas
				if (isLandscape && GameOptions.canvas_or_onscreengamepad_must_respect_lebensraum === 'gamepad') {
					const canvasRect = self.canvas.getBoundingClientRect();
					let maxSvgWidth: number;
					if (isRightSide) {
						maxSvgWidth = ~~(window.innerWidth - (canvasRect.left + canvasRect.width));
					} else {
						maxSvgWidth = canvasRect.left;
					}
					const svgWidth = parseInt(element.getAttribute('width')!);
					if (svgWidth * newScale > maxSvgWidth) {
						newScale = maxSvgWidth / svgWidth;
					}
				}

				// Apply the new scale
				element.style.transform = `scale(${newScale})`;
			}

			// Update the scaling of the SVG elements
			updateScale(dpad_svg!, false);
			updateScale(actionbuttons_svg!, true);

			// Update the bottom position of the SVG elements
			updateBottomPosition(dpad_svg!, false);
			updateBottomPosition(actionbuttons_svg!, true);
		}
	}

	public abstract reset(): void;

	/**
	 * Registers event listeners for window resize, orientation change, and fullscreen mode change.
	 * When any of these events occur, the `handleResize` method is called to recalculate the size of the canvas and adjust its position and scale.
	 */
	protected listenToMediaEvents(): void {
		const view = $.view;

		function handleResizeHelper() {
			view.handleResize.call(view);
		}

		window.addEventListener('resize', handleResizeHelper, false);
		window.addEventListener('orientationchange', handleResizeHelper, false);
		// https://stackoverflow.com/a/70719693
		window.matchMedia('(display-mode: fullscreen)').addEventListener('change', ({ matches }) => {
			if (matches) {
				window['isFullScreen'] = true;
			} else {
				window['isFullScreen'] = false;
			}
		});
	}

	/**
	 * Determines the maximum scale factor that can be applied to the original buffer dimensions to fit the current client dimensions while maintaining aspect ratio.
	 * @param clientWidth The current width of the client.
	 * @param clientHeight The current height of the client.
	 * @param originalBufferWidth The original width of the buffer.
	 * @param originalBufferHeight The original height of the buffer.
	 * @returns The maximum scale factor that can be applied to the original buffer dimensions.
	 */
	public determineMaxScaleForFullscreen(clientWidth: number, clientHeight: number, originalBufferWidth: number, originalBufferHeight: number): number {
		if (clientWidth >= clientHeight) {
			return clientHeight / originalBufferHeight;
		}
		else {
			return clientWidth / originalBufferWidth;
		}
	}

	public toFullscreen(): void {
		// https://zinoui.com/blog/javascript-fullscreen-api
		window.addEventListener('keyup', BaseView.triggerFullScreenOnFakeUserEvent);
	}

	public get isFullscreen() {
		return window['isFullScreen'] ?? false;
	}

	public static get fullscreenEnabled() {
		return document.fullscreenEnabled || document['webkitFullscreenEnabled'] || document['webkitFullScreenEnabled'] || document['mozFullScreenEnabled'];
	}

	public static triggerFullScreenOnFakeUserEvent(): void {
		if (BaseView.fullscreenEnabled) {
			try {
				global.$.paused = true;
				document.documentElement.requestFullscreen?.()
					.then(() => {
						global.$.paused = false;
					})
					.catch(e => {
						global.$.paused = false;
						console.error(e);
					});

				document.documentElement['mozRequestFullScreen']?.()
					.then(() => global.$.paused = false)
					.catch(e => {
						global.$.paused = false;
						console.error(e);
					});
				document.documentElement['webkitRequestFullScreen']?.();
				document.documentElement['webkitRequestFullscreen']?.();
			}
			catch (error) {
				console.error(error);
			}
		}
		window.removeEventListener('keyup', BaseView.triggerFullScreenOnFakeUserEvent);
	}

	public ToWindowed(): void {
		window.addEventListener('keyup', BaseView.triggerWindowedOnFakeUserEvent);
	}

	public static triggerWindowedOnFakeUserEvent(): void {
		if (BaseView.fullscreenEnabled) {
			try {
				global.$.paused = true;
				document.exitFullscreen?.()
					.then(() => global.$.paused = false)
					.catch(e => {
						global.$.paused = false;
						console.error(e);
					});
				document['webkitExitFullscreen']?.();
				document['mozExitFullScreen']?.();
			}
			catch (error) {
				// !BUG: Heb een bug gezien waarbij dit voorkomt.
				// Lijkt overeen te komen met het gebruik van de debugger-mogelijkheden van Boaz
				console.error(error);
			}
		}
		window.removeEventListener('keyup', BaseView.triggerWindowedOnFakeUserEvent);
	}


	public showFadingOverlay(text: string) {
		let pauseOverlay = document.getElementById('pause-overlay');
		if (!pauseOverlay) {
			pauseOverlay = document.createElement('div');
			pauseOverlay.id = 'pause-overlay';
			document.body.appendChild(pauseOverlay);
		}
		pauseOverlay.textContent = text;

		// Remove the fade-out class to reset the animation
		pauseOverlay.classList.remove('fade-out');

		// Add the visible class to show the overlay by setting the opacity to 1
		pauseOverlay.classList.add('visible');
	}

	public hideFadingOverlay() {
		let pauseOverlay = document.getElementById('pause-overlay');
		if (pauseOverlay) {
			// Add the fade-out class to start the animation
			pauseOverlay.classList.add('fade-out');
			// Remove the visible class to hide the overlay by setting the opacity to 0
			pauseOverlay.classList.remove('visible');
			// Force a reflow to restart the animation
			void pauseOverlay.offsetWidth;

			pauseOverlay.onanimationend = () => {
				pauseOverlay?.remove();
			}
		}
	}

	public showPauseOverlay() {
		$.view.showFadingOverlay('⏸️');
	}

	public showResumeOverlay() {
		$.view.hideFadingOverlay();
	}

	public clear(): void {
		$.view.context.translate(0.5, 0.5);
		$.view.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
		$.view.context.translate(-0.5, -0.5);
	}

	public abstract drawImg(options: DrawImgOptions): void;

	public abstract drawRectangle(options: DrawRectOptions): void;

	public abstract fillRectangle(options: DrawRectOptions): void;

	/**
	 * Draws the outline of a polygon by drawing lines between its vertices.
	 * @param points Array of {x, y, z?} points (polygon vertices, in order)
	 * @param color Color to use for the outline
	 * @param thickness Line thickness in pixels (default 1)
	 */
	public abstract drawPolygon(points: Polygon, z: number, color: Color, thickness: number): void;

	public abstract drawMesh(options: DrawMeshOptions): void;

	public abstract getPointLight(id: Identifier): PointLight | undefined;
	public abstract setPointLight(id: Identifier, light: PointLight): void;
	public abstract removePointLight(id: Identifier): void;

	public abstract addDirectionalLight(id: Identifier, light: DirectionalLight): void;
	public abstract removeDirectionalLight(id: Identifier): void;
	public abstract clearLights(): void;
	public abstract setAmbientLight(light: AmbientLight): void;
	public abstract setSkybox(images: SkyboxImageIds): void;
	public abstract get skyboxFaceIds(): SkyboxImageIds | undefined;

	public abstract get dynamicAtlas(): number | null;
	public abstract set dynamicAtlas(value: number | null);
}
