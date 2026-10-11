import { InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import type { BrowserOnscreenGamepad, OnscreenActionGeometry, OnscreenGamepadGeometry } from './onscreen_gamepad';

const enum ActionSurfaceIndex { Face, Select, Start, LeftStick, RightStick }

const ACTIONS = [
	{ id: 'a_knop', surface: ActionSurfaceIndex.Face, buttons: 1 << InputControllerGamepadButtonBit.A },
	{ id: 'b_knop', surface: ActionSurfaceIndex.Face, buttons: 1 << InputControllerGamepadButtonBit.B },
	{ id: 'x_knop', surface: ActionSurfaceIndex.Face, buttons: 1 << InputControllerGamepadButtonBit.X },
	{ id: 'y_knop', surface: ActionSurfaceIndex.Face, buttons: 1 << InputControllerGamepadButtonBit.Y },
	{ id: 'select_knop', surface: ActionSurfaceIndex.Select, buttons: 1 << InputControllerGamepadButtonBit.Select },
	{ id: 'start_knop', surface: ActionSurfaceIndex.Start, buttons: 1 << InputControllerGamepadButtonBit.Start },
	{ id: 'ls_knop', surface: ActionSurfaceIndex.LeftStick, buttons: 1 << InputControllerGamepadButtonBit.LeftStick },
	{ id: 'rs_knop', surface: ActionSurfaceIndex.RightStick, buttons: 1 << InputControllerGamepadButtonBit.RightStick },
] as const;

const ACTION_SURFACES = ['button-controls', 'select-controls', 'start-controls', 'ls-controls', 'rs-controls'] as const;
const COMPACT_PROFILE = { margin: 20, bottom: 24 };
const SMALL_PLAYER_PROFILE = { margin: 20, bottom: 20 };
const LANDSCAPE_PROFILE = { margin: 32, bottom: 32 };
const PORTRAIT_PROFILE = { margin: 24, bottom: 32 };
const STICK_SIZE = 180;
const CONTROL_GAP = 12;
const UTILITY_SIZE = 52;
const PORTRAIT_FACE_LIFT = 144;
const NARROW_PORTRAIT_FACE_LIFT = 208;

interface ActionSurface {
	element: HTMLElement;
	artworkWidth: number;
	artworkHeight: number;
	left: number;
	top: number;
	scale: number;
}

/** Passive controller artwork and its authored numerical layout. */
export class BrowserOnscreenGamepadView {
	private readonly stickSurface: HTMLElement;
	private readonly actionSurfaces: ActionSurface[] = [];
	private readonly stickBase: SVGCircleElement;
	private readonly stickTip: SVGCircleElement;
	private readonly stickArtworkWidth: number;
	private readonly stickArtworkHeight: number;
	private readonly nominalStickX: number;
	private readonly nominalStickY: number;
	private readonly nominalStickRadius: number;
	private readonly nominalDeadzoneRadius: number;
	private readonly tipTravel: number;
	private readonly circles: SVGCircleElement[] = [];
	private readonly nominalActions: OnscreenActionGeometry[] = [];
	private readonly actions: OnscreenActionGeometry[] = [];
	private readonly geometry: OnscreenGamepadGeometry = {
		stickX: 0, stickY: 0, stickRadius: 0, stickDeadzoneRadius: 0, actions: this.actions,
	};
	private readonly unsubscribeView: () => void;
	private animationFrameId = 0;
	private renderedButtons = 0;
	private renderedStickX = 0;
	private renderedStickY = 0;
	private renderedStickActive = false;
	private layoutLeft = 0;
	private layoutTop = 0;
	private layoutWidth = -1;
	private layoutHeight = -1;

	public constructor(
		document: Document,
		private readonly window: Window,
		private readonly model: BrowserOnscreenGamepad,
	) {
		this.stickSurface = document.getElementById('d-pad-controls');
		this.stickBase = document.getElementById('d-pad-base') as unknown as SVGCircleElement;
		this.stickTip = document.getElementById('d-pad-tip') as unknown as SVGCircleElement;
		const stickArtwork = document.getElementById('d-pad-svg') as unknown as SVGSVGElement;
		this.stickArtworkWidth = stickArtwork.viewBox.baseVal.width;
		this.stickArtworkHeight = stickArtwork.viewBox.baseVal.height;
		for (const id of ACTION_SURFACES) {
			const element = document.getElementById(id);
			const artwork = element.firstElementChild as SVGSVGElement;
			this.actionSurfaces.push({
				element, artworkWidth: artwork.viewBox.baseVal.width, artworkHeight: artwork.viewBox.baseVal.height,
				left: 0, top: 0, scale: 1,
			});
		}
		this.nominalStickX = this.stickBase.cx.baseVal.value;
		this.nominalStickY = this.stickBase.cy.baseVal.value;
		this.nominalStickRadius = this.stickBase.r.baseVal.value;
		const deadzone = document.getElementById('d-pad-deadzone') as unknown as SVGCircleElement;
		this.nominalDeadzoneRadius = deadzone.r.baseVal.value;
		this.tipTravel = this.nominalStickRadius - this.stickTip.r.baseVal.value - 2;
		for (const action of ACTIONS) {
			const circle = document.getElementById(action.id) as unknown as SVGCircleElement;
			this.circles.push(circle);
			this.nominalActions.push({
				x: circle.cx.baseVal.value, y: circle.cy.baseVal.value,
				radius: circle.r.baseVal.value, buttons: action.buttons,
			});
			this.actions.push({ x: 0, y: 0, radius: 0, buttons: action.buttons });
		}
		this.unsubscribeView = model.subscribeView(this.scheduleRender);
	}

	/** Layout and acquisition share the same uniform CSS-client transforms. */
	public layout(left: number, top: number, width: number, height: number): void {
		if (left === this.layoutLeft && top === this.layoutTop && width === this.layoutWidth && height === this.layoutHeight) return;
		this.layoutLeft = left;
		this.layoutTop = top;
		this.layoutWidth = width;
		this.layoutHeight = height;
		const landscape = width >= height;
		const smallPlayer = landscape ? width < 568 || height < 239 : height < 568;
		const compact = width < 360 || landscape && width < 640;
		const shortLandscape = landscape && height < 320;
		const profile = smallPlayer ? SMALL_PLAYER_PROFILE : compact ? COMPACT_PROFILE : landscape ? LANDSCAPE_PROFILE : PORTRAIT_PROFILE;
		const viewportScale = smallPlayer
			? Math.min(1, width / 568, height / 239)
			: Math.min(1.1, Math.max(1, Math.min(width, height) / 390));
		const margin = smallPlayer ? profile.margin * viewportScale : shortLandscape ? 20 : profile.margin;
		const stickBottom = smallPlayer ? profile.bottom * viewportScale : shortLandscape ? 20 : profile.bottom;
		const faceBottom = smallPlayer ? 16 * viewportScale : shortLandscape ? 16 : profile.bottom;
		const stickScale = STICK_SIZE / this.stickArtworkWidth * viewportScale;
		const faceSurface = this.actionSurfaces[ActionSurfaceIndex.Face];
		const faceScale = viewportScale;
		const stickLeft = left + margin;
		const stickTop = top + height - stickBottom - this.stickArtworkHeight * stickScale;
		const stickX = stickLeft + this.nominalStickX * stickScale;
		const stickY = stickTop + this.nominalStickY * stickScale;
		const stickRadius = this.nominalStickRadius * stickScale;
		const faceLeft = left + width - margin - faceSurface.artworkWidth * faceScale;
		const faceCenterX = faceLeft + faceSurface.artworkWidth * faceScale / 2;
		const faceCenterY = landscape
			? top + height - faceBottom - faceSurface.artworkHeight * faceScale / 2
			: stickY - (width < 380 ? NARROW_PORTRAIT_FACE_LIFT : PORTRAIT_FACE_LIFT) * viewportScale;
		const faceTop = faceCenterY - faceSurface.artworkHeight * faceScale / 2;
		this.stickSurface.style.left = `${stickLeft}px`;
		this.stickSurface.style.top = `${stickTop}px`;
		this.stickSurface.style.transform = `scale(${stickScale})`;
		this.placeActionSurface(ActionSurfaceIndex.Face, faceLeft, faceTop, faceScale);
		// Lemuroid/PadKit's primary/secondary grouping: secondary controls follow
		// their own hand, not the viewport top or a shared central packing area.
		const utilitySize = UTILITY_SIZE * (smallPlayer ? viewportScale : 1);
		const utilityRadius = utilitySize / 2;
		const utilityScale = utilitySize / this.actionSurfaces[ActionSurfaceIndex.Select].artworkWidth;
		if (landscape) {
			// Inward arcs also fit the short visual viewport left by Safari chrome.
			this.placeActionSurface(ActionSurfaceIndex.LeftStick,
				stickX + 100 * viewportScale - utilityRadius, stickY - 80 * viewportScale - utilityRadius, utilityScale);
			this.placeActionSurface(ActionSurfaceIndex.Select,
				stickX + 128 * viewportScale - utilityRadius, stickY + 10 * viewportScale - utilityRadius, utilityScale);
			this.placeActionSurface(ActionSurfaceIndex.RightStick,
				faceCenterX - 100 * viewportScale - utilityRadius, faceCenterY - 70 * viewportScale - utilityRadius, utilityScale);
			this.placeActionSurface(ActionSurfaceIndex.Start,
				faceCenterX - 140 * viewportScale - utilityRadius, faceCenterY + 20 * viewportScale - utilityRadius, utilityScale);
		} else {
			const leftUtilityY = stickY - stickRadius - utilityRadius - CONTROL_GAP * viewportScale;
			const rightUtilityY = faceTop - utilityRadius - CONTROL_GAP * viewportScale;
			this.placeActionSurface(ActionSurfaceIndex.LeftStick,
				stickX - 64 * viewportScale - utilityRadius, leftUtilityY - utilityRadius, utilityScale);
			this.placeActionSurface(ActionSurfaceIndex.Select,
				stickX - utilityRadius, leftUtilityY - utilityRadius, utilityScale);
			this.placeActionSurface(ActionSurfaceIndex.RightStick,
				faceCenterX + 78 * viewportScale - utilityRadius, rightUtilityY - utilityRadius, utilityScale);
			this.placeActionSurface(ActionSurfaceIndex.Start,
				faceCenterX + 14 * viewportScale - utilityRadius, rightUtilityY - utilityRadius, utilityScale);
		}
		const geometry = this.geometry;
		geometry.stickX = stickX;
		geometry.stickY = stickY;
		geometry.stickRadius = stickRadius;
		geometry.stickDeadzoneRadius = this.nominalDeadzoneRadius * stickScale;
		for (let index = 0; index < this.actions.length; index += 1) {
			const surface = this.actionSurfaces[ACTIONS[index].surface];
			const nominal = this.nominalActions[index];
			const action = this.actions[index];
			action.x = surface.left + nominal.x * surface.scale;
			action.y = surface.top + nominal.y * surface.scale;
			action.radius = nominal.radius * surface.scale;
		}
		this.model.setGeometry(geometry);
		this.stickSurface.hidden = false;
	}

	public dispose(): void {
		this.unsubscribeView();
		if (this.animationFrameId) this.window.cancelAnimationFrame(this.animationFrameId);
		this.animationFrameId = 0;
		this.stickSurface.hidden = true;
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
					this.circles[index].setAttribute('data-touched', (buttons & mask) !== 0 ? 'true' : 'false');
				}
			}
		}
		this.renderedButtons = buttons;
		const active = model.stickActive;
		if (active !== this.renderedStickActive) {
			this.stickBase.setAttribute('data-touched', active ? 'true' : 'false');
			this.renderedStickActive = active;
		}
		const x = model.stickX;
		const y = model.stickY;
		if (x !== this.renderedStickX || y !== this.renderedStickY) {
			this.stickTip.setAttribute('transform', `translate(${x * this.tipTravel} ${y * this.tipTravel})`);
			this.renderedStickX = x;
			this.renderedStickY = y;
		}
	};
}
