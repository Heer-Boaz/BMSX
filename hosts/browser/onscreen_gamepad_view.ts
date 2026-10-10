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
const COMPACT_PROFILE = { margin: 16, bottom: 16, stickSize: 128 };
const LANDSCAPE_PROFILE = { margin: 32, bottom: 32, stickSize: 144 };
const PORTRAIT_PROFILE = { margin: 24, bottom: 32, stickSize: 144 };
const MIN_ACTION_SCALE = 44 / 52;
const UTILITY_SIZE = 44;
const UTILITY_PITCH = 56;
const UTILITY_TOP = 16;

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
		const compact = landscape ? width < 640 || height < 280 : width < 360;
		const profile = compact ? COMPACT_PROFILE : landscape ? LANDSCAPE_PROFILE : PORTRAIT_PROFILE;
		const availableWidth = Math.max(0, width - profile.margin * 2);
		const availableHeight = Math.max(0, height - profile.bottom - UTILITY_TOP);
		const viewportScale = Math.min(1.15, Math.max(MIN_ACTION_SCALE, Math.min(width, height) / 390));
		const stickScale = Math.min(
			profile.stickSize / this.stickArtworkWidth * viewportScale,
			availableWidth / this.stickArtworkWidth,
			availableHeight / this.stickArtworkHeight,
		);
		const faceSurface = this.actionSurfaces[ActionSurfaceIndex.Face];
		const faceScale = Math.min(
			viewportScale,
			availableWidth / faceSurface.artworkWidth,
			availableHeight / faceSurface.artworkHeight,
		);
		const stickLeft = left + profile.margin;
		const stickTop = top + height - profile.bottom - this.stickArtworkHeight * stickScale;
		this.stickSurface.style.left = `${stickLeft}px`;
		this.stickSurface.style.top = `${stickTop}px`;
		this.stickSurface.style.transform = `scale(${stickScale})`;
		this.placeActionSurface(ActionSurfaceIndex.Face,
			left + width - profile.margin - faceSurface.artworkWidth * faceScale,
			top + height - profile.bottom - faceSurface.artworkHeight * faceScale, faceScale);
		const utilityTop = top + UTILITY_TOP;
		const utilityLeft = left + profile.margin;
		const utilityRight = left + width - profile.margin - UTILITY_SIZE;
		this.placeActionSurface(ActionSurfaceIndex.Select, utilityLeft + UTILITY_PITCH, utilityTop, 1);
		this.placeActionSurface(ActionSurfaceIndex.Start, utilityRight - UTILITY_PITCH, utilityTop, 1);
		this.placeActionSurface(ActionSurfaceIndex.LeftStick, utilityLeft, utilityTop, 1);
		this.placeActionSurface(ActionSurfaceIndex.RightStick, utilityRight, utilityTop, 1);
		const geometry = this.geometry;
		geometry.stickX = stickLeft + this.nominalStickX * stickScale;
		geometry.stickY = stickTop + this.nominalStickY * stickScale;
		geometry.stickRadius = this.nominalStickRadius * stickScale;
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
