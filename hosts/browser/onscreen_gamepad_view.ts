import { InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import type { BrowserOnscreenGamepad, OnscreenActionGeometry, OnscreenGamepadGeometry } from './onscreen_gamepad';
import type { BrowserInputDiagnostics } from './input_trace_contract';
import { layoutShoulderOutline } from './onscreen_control_shapes';

const enum ActionSurfaceIndex { Face, Select, Start, LeftStick, RightStick, LeftBumper, RightBumper, LeftTrigger, RightTrigger }

const ACTIONS = [
	{ id: 'a_knop', surface: ActionSurfaceIndex.Face, buttons: 1 << InputControllerGamepadButtonBit.A },
	{ id: 'b_knop', surface: ActionSurfaceIndex.Face, buttons: 1 << InputControllerGamepadButtonBit.B },
	{ id: 'x_knop', surface: ActionSurfaceIndex.Face, buttons: 1 << InputControllerGamepadButtonBit.X },
	{ id: 'y_knop', surface: ActionSurfaceIndex.Face, buttons: 1 << InputControllerGamepadButtonBit.Y },
	{ id: 'select_knop', surface: ActionSurfaceIndex.Select, buttons: 1 << InputControllerGamepadButtonBit.Select },
	{ id: 'start_knop', surface: ActionSurfaceIndex.Start, buttons: 1 << InputControllerGamepadButtonBit.Start },
	{ id: 'ls_knop', surface: ActionSurfaceIndex.LeftStick, buttons: 1 << InputControllerGamepadButtonBit.LeftStick },
	{ id: 'rs_knop', surface: ActionSurfaceIndex.RightStick, buttons: 1 << InputControllerGamepadButtonBit.RightStick },
	{ id: 'lb_knop', surface: ActionSurfaceIndex.LeftBumper, buttons: 1 << InputControllerGamepadButtonBit.LeftBumper },
	{ id: 'rb_knop', surface: ActionSurfaceIndex.RightBumper, buttons: 1 << InputControllerGamepadButtonBit.RightBumper },
	{ id: 'lt_knop', surface: ActionSurfaceIndex.LeftTrigger, buttons: 1 << InputControllerGamepadButtonBit.LeftTrigger },
	{ id: 'rt_knop', surface: ActionSurfaceIndex.RightTrigger, buttons: 1 << InputControllerGamepadButtonBit.RightTrigger },
] as const;

const DIRECTION_BUTTONS = (1 << InputControllerGamepadButtonBit.Up) | (1 << InputControllerGamepadButtonBit.Right)
	| (1 << InputControllerGamepadButtonBit.Down) | (1 << InputControllerGamepadButtonBit.Left);
// Artwork rows for the signed direction axes: up, neutral, down.
const PAD_IMAGES = ['lu', 'u', 'ru', 'l', 'neutral', 'r', 'ld', 'd', 'rd'] as const;

const ACTION_SURFACES = ['button-controls', 'select-controls', 'start-controls', 'ls-controls', 'rs-controls',
	'lb-controls', 'rb-controls', 'lt-controls', 'rt-controls'] as const;
const PAD_SIZE = 180;
const CONTROL_GAP = 12;
const MENU_SIZE = 52;
const STICK_CLICK_SIZE = 44;
const SHOULDER_WIDTH = 112;
const SHOULDER_HEIGHT = 56;

interface ActionSurface {
	element: HTMLElement;
	artwork: SVGSVGElement;
	artworkWidth: number;
	artworkHeight: number;
	left: number;
	top: number;
	scale: number;
}

/** Passive controller artwork and its authored numerical layout. */
export class BrowserOnscreenGamepadView {
	private readonly padSurface: HTMLElement;
	private readonly actionSurfaces: ActionSurface[] = [];
	private readonly padArtworkWidth: number;
	private readonly padArtworkHeight: number;
	private readonly nominalPadX: number;
	private readonly nominalPadY: number;
	private readonly nominalPadRadius: number;
	private readonly padImages: SVGImageElement[] = [];
	private readonly buttonShapes: SVGGeometryElement[] = [];
	private readonly shoulderActions: OnscreenActionGeometry[] = [];
	private readonly shoulderLabels: SVGTextElement[] = [];
	private readonly nominalActions: OnscreenActionGeometry[] = [];
	private readonly actions: OnscreenActionGeometry[] = [];
	private readonly geometry: OnscreenGamepadGeometry = {
		padX: 0, padY: 0, padRadius: 0, padNeutralRadius: 0,
		faceX: 0, faceY: 0, faceRadius: 0, actions: this.actions,
	};
	private readonly layoutObserver: BrowserInputDiagnostics | undefined;
	private readonly unsubscribeView: () => void;
	private animationFrameId = 0;
	private renderedButtons = 0;
	private renderedPadImage = 4;
	private layoutLeft = 0;
	private layoutTop = 0;
	private layoutWidth = -1;
	private layoutHeight = -1;
	private portraitControlTop: number | null = null;

	public constructor(
		document: Document,
		private readonly window: Window,
		private readonly model: BrowserOnscreenGamepad,
	) {
		this.layoutObserver = window.bmsxInputTrace;
		this.padSurface = document.getElementById('d-pad-controls');
		const padArtwork = document.getElementById('d-pad-svg') as unknown as SVGSVGElement;
		this.padArtworkWidth = padArtwork.viewBox.baseVal.width;
		this.padArtworkHeight = padArtwork.viewBox.baseVal.height;
		for (const id of ACTION_SURFACES) {
			const element = document.getElementById(id);
			const artwork = element.firstElementChild as SVGSVGElement;
			this.actionSurfaces.push({
				element, artwork, artworkWidth: artwork.viewBox.baseVal.width, artworkHeight: artwork.viewBox.baseVal.height,
				left: 0, top: 0, scale: 1,
			});
		}
		this.nominalPadX = this.padArtworkWidth / 2;
		this.nominalPadY = this.padArtworkHeight / 2;
		this.nominalPadRadius = this.padArtworkWidth / 2;
		for (const direction of PAD_IMAGES) {
			this.padImages.push(document.getElementById(`svgimg-d-pad-${direction}`) as unknown as SVGImageElement);
		}
		for (const action of ACTIONS) {
			const element = document.getElementById(action.id) as unknown as SVGGeometryElement;
			this.buttonShapes.push(element);
			if (action.surface < ActionSurfaceIndex.LeftBumper) {
				const circle = element as SVGCircleElement;
				this.nominalActions.push({
					x: circle.cx.baseVal.value, y: circle.cy.baseVal.value,
					radius: circle.r.baseVal.value, buttons: action.buttons,
				});
				this.actions.push({ x: 0, y: 0, radius: 0, buttons: action.buttons });
			} else {
				const geometry = { x: 0, y: 0, radius: 0, buttons: action.buttons, outline: { halfLength: 0, radius: 0 } };
				this.actions.push(geometry);
				this.shoulderActions.push(geometry);
				this.shoulderLabels.push(document.getElementById(action.id + '_text') as unknown as SVGTextElement);
			}
		}
		this.unsubscribeView = model.subscribeView(this.scheduleRender);
	}

	/** Upper limit of portrait video, authored with the actual lower control deck. */
	public get portraitDeckTop(): number | null { return this.portraitControlTop; }

	/** Layout and acquisition share the same uniform CSS-client transforms. */
	public layout(left: number, top: number, width: number, height: number): void {
		if (left === this.layoutLeft && top === this.layoutTop && width === this.layoutWidth && height === this.layoutHeight) return;
		this.layoutLeft = left;
		this.layoutTop = top;
		this.layoutWidth = width;
		this.layoutHeight = height;
		const landscape = width >= height;
		// Delta's four-button handheld deck keeps both primary controls on one
		// hand row. Its geometry is a reference, not a source of copied artwork:
		// https://github.com/rileytestut/SNESDeltaCore/blob/ed3a432616bfabaa376c554f7d352958e5bfb13b/SNESDeltaCore/Controller%20Skin/info.json#L343-L509
		const faceSurface = this.actionSurfaces[ActionSurfaceIndex.Face];
		const viewportScale = landscape
			? Math.min(1.1, width / 568, height / 360)
			: Math.min(1.1, (width - CONTROL_GAP * 3) / (PAD_SIZE + faceSurface.artworkWidth), height / 568);
		const margin = landscape ? 16 * viewportScale : CONTROL_GAP;
		const bottom = 16 * viewportScale;
		const gap = CONTROL_GAP * viewportScale;
		const padScale = PAD_SIZE / this.padArtworkWidth * viewportScale;
		const faceScale = viewportScale;
		const menuScale = landscape ? viewportScale : Math.max(0.85, viewportScale);
		const menuSize = MENU_SIZE * menuScale;
		const clickSize = STICK_CLICK_SIZE * menuScale;
		const menuY = top + height - bottom - menuSize / 2;
		const primaryRadius = Math.max(this.padArtworkHeight * padScale, faceSurface.artworkHeight * faceScale) / 2;
		const primaryY = landscape
			? top + height - bottom - primaryRadius
			: menuY - menuSize / 2 - 16 * viewportScale - primaryRadius;
		const padLeft = left + margin;
		const padTop = primaryY - this.nominalPadY * padScale;
		const padX = padLeft + this.nominalPadX * padScale;
		const padY = primaryY;
		const padRadius = this.nominalPadRadius * padScale;
		const faceLeft = left + width - margin - faceSurface.artworkWidth * faceScale;
		const faceCenterX = faceLeft + faceSurface.artworkWidth * faceScale / 2;
		const faceCenterY = primaryY;
		const faceTop = primaryY - faceSurface.artworkHeight * faceScale / 2;
		this.padSurface.style.left = `${padLeft}px`;
		this.padSurface.style.top = `${padTop}px`;
		this.padSurface.style.transform = `scale(${padScale})`;
		this.placeActionSurface(ActionSurfaceIndex.Face, faceLeft, faceTop, faceScale);
		const menuArtworkWidth = this.actionSurfaces[ActionSurfaceIndex.Select].artworkWidth;
		const menuSurfaceScale = menuSize / menuArtworkWidth;
		const clickSurfaceScale = clickSize / this.actionSurfaces[ActionSurfaceIndex.LeftStick].artworkWidth;
		const centerX = left + width / 2;
		this.placeActionSurface(ActionSurfaceIndex.Select,
			centerX - 32 * menuScale - menuSize / 2, menuY - menuSize / 2, menuSurfaceScale);
		this.placeActionSurface(ActionSurfaceIndex.Start,
			centerX + 32 * menuScale - menuSize / 2, menuY - menuSize / 2, menuSurfaceScale);
		const clickOffset = (32 + MENU_SIZE / 2 + CONTROL_GAP + STICK_CLICK_SIZE / 2) * menuScale;
		this.placeActionSurface(ActionSurfaceIndex.LeftStick,
			(landscape ? centerX - clickOffset : padX) - clickSize / 2, menuY - clickSize / 2, clickSurfaceScale);
		this.placeActionSurface(ActionSurfaceIndex.RightStick,
			(landscape ? centerX + clickOffset : faceCenterX) - clickSize / 2, menuY - clickSize / 2, clickSurfaceScale);
		const shoulderScale = landscape ? viewportScale : Math.max(0.875, viewportScale);
		const shoulderWidth = landscape ? Math.min(SHOULDER_WIDTH * shoulderScale,
			faceCenterX - 100 * viewportScale - (padX + 130 * viewportScale) - gap)
			: Math.min(SHOULDER_WIDTH * shoulderScale, (width - margin * 2 - gap * 3) / 4);
		const shoulderHeight = Math.min(Math.max(44, SHOULDER_HEIGHT * shoulderScale), shoulderWidth / 1.5);
		if (landscape) {
			// Wide bumpers stay on the inward thumb arcs, clear of the D-pad body.
			this.placeShoulder(ActionSurfaceIndex.LeftBumper,
				padX + 130 * viewportScale, padY - 96 * viewportScale, shoulderWidth, shoulderHeight);
			this.placeShoulder(ActionSurfaceIndex.RightBumper,
				faceCenterX - 100 * viewportScale, faceCenterY - 84 * viewportScale, shoulderWidth, shoulderHeight);
			this.placeShoulder(ActionSurfaceIndex.LeftTrigger,
				padX + 30 * viewportScale, padY - 156 * viewportScale, shoulderWidth, shoulderHeight);
			this.placeShoulder(ActionSurfaceIndex.RightTrigger,
				faceCenterX - 28 * viewportScale, faceCenterY - 156 * viewportScale, shoulderWidth, shoulderHeight);
			this.portraitControlTop = null;
		} else {
			const shoulderY = primaryY - primaryRadius - gap - shoulderHeight / 2;
			this.placeShoulder(ActionSurfaceIndex.LeftTrigger,
				left + margin + shoulderWidth / 2, shoulderY, shoulderWidth, shoulderHeight);
			this.placeShoulder(ActionSurfaceIndex.LeftBumper,
				left + margin + shoulderWidth * 1.5 + gap, shoulderY, shoulderWidth, shoulderHeight);
			this.placeShoulder(ActionSurfaceIndex.RightBumper,
				left + width - margin - shoulderWidth * 1.5 - gap, shoulderY, shoulderWidth, shoulderHeight);
			this.placeShoulder(ActionSurfaceIndex.RightTrigger,
				left + width - margin - shoulderWidth / 2, shoulderY, shoulderWidth, shoulderHeight);
			this.portraitControlTop = shoulderY - shoulderHeight / 2 - CONTROL_GAP;
		}
		const geometry = this.geometry;
		geometry.padX = padX;
		geometry.padY = padY;
		geometry.padRadius = padRadius;
		geometry.padNeutralRadius = padRadius * 0.18;
		geometry.faceX = faceCenterX;
		geometry.faceY = faceCenterY;
		geometry.faceRadius = faceSurface.artworkWidth * faceScale / 2;
		for (let index = 0; index < this.nominalActions.length; index += 1) {
			const surface = this.actionSurfaces[ACTIONS[index].surface];
			const nominal = this.nominalActions[index];
			const action = this.actions[index];
			action.x = surface.left + nominal.x * surface.scale;
			action.y = surface.top + nominal.y * surface.scale;
			action.radius = nominal.radius * surface.scale;
		}
		const observer = this.layoutObserver;
		const before = this.model.buttons;
		const commonBefore = observer && observer.commonGamepad ? observer.commonGamepad.physicalGamepadButtonsWord() : -1;
		this.model.setGeometry(geometry);
		observer?.controllerLayout(this.model.geometryRevision, left, top, width, height, before, this.model.buttons, commonBefore);
		this.padSurface.hidden = false;
	}

	public dispose(): void {
		this.unsubscribeView();
		if (this.animationFrameId) this.window.cancelAnimationFrame(this.animationFrameId);
		this.animationFrameId = 0;
		this.padSurface.hidden = true;
		for (const surface of this.actionSurfaces) surface.element.hidden = true;
	}

	private placeActionSurface(index: ActionSurfaceIndex, left: number, top: number, scale: number): void {
		const surface = this.actionSurfaces[index];
		surface.left = left;
		surface.top = top;
		surface.scale = scale;
		surface.element.style.left = `${left}px`;
		surface.element.style.top = `${top}px`;
		surface.element.style.transform = `scale(${scale})`;
		surface.element.hidden = false;
	}

	/** Publishes matching numerical surface and SVG outline at layout time only. */
	private placeShoulder(index: ActionSurfaceIndex, x: number, y: number, width: number, height: number): void {
		const shoulderIndex = index - ActionSurfaceIndex.LeftBumper;
		const action = this.shoulderActions[shoulderIndex];
		const surface = this.actionSurfaces[index];
		const path = layoutShoulderOutline(action.outline, width, height);
		action.x = x;
		action.y = y;
		action.radius = width / 2;
		surface.element.style.width = `${width}px`;
		surface.element.style.height = `${height}px`;
		surface.artwork.setAttribute('viewBox', `0 0 ${width} ${height}`);
		surface.artwork.setAttribute('width', `${width}`);
		surface.artwork.setAttribute('height', `${height}`);
		surface.artwork.firstElementChild.setAttribute('d', path);
		this.buttonShapes[this.nominalActions.length + shoulderIndex].setAttribute('d', path);
		this.shoulderLabels[shoulderIndex].setAttribute('x', `${width / 2}`);
		this.shoulderLabels[shoulderIndex].setAttribute('y', `${height / 2}`);
		this.placeActionSurface(index, x - width / 2, y - height / 2, 1);
	}

	private readonly scheduleRender = (): void => {
		if (!this.animationFrameId) this.animationFrameId = this.window.requestAnimationFrame(this.render);
	};

	private readonly render = (): void => {
		this.animationFrameId = 0;
		const model = this.model;
		const buttons = model.buttons;
		const changedButtons = buttons ^ this.renderedButtons;
		if (changedButtons !== 0) {
			for (let index = 0; index < ACTIONS.length; index += 1) {
				const mask = ACTIONS[index].buttons;
				if ((changedButtons & mask) !== 0) {
					this.buttonShapes[index].setAttribute('data-touched', (buttons & mask) !== 0 ? 'true' : 'false');
				}
			}
			if ((changedButtons & DIRECTION_BUTTONS) !== 0) {
				// Opposing presses balance the disc's visual tilt, not the raw input bits.
				const x = ((buttons >>> InputControllerGamepadButtonBit.Right) & 1) - ((buttons >>> InputControllerGamepadButtonBit.Left) & 1);
				const y = ((buttons >>> InputControllerGamepadButtonBit.Down) & 1) - ((buttons >>> InputControllerGamepadButtonBit.Up) & 1);
				const image = (y + 1) * 3 + x + 1;
				if (image !== this.renderedPadImage) {
					this.padImages[this.renderedPadImage].setAttribute('data-active', 'false');
					this.padImages[image].setAttribute('data-active', 'true');
					this.renderedPadImage = image;
				}
			}
		}
		this.renderedButtons = buttons;
	};
}
