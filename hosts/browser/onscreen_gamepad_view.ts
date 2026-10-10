import { InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import type { BrowserOnscreenGamepad, OnscreenActionGeometry, OnscreenGamepadGeometry } from './onscreen_gamepad';

const ACTIONS = [
	{ id: 'a_knop', buttons: 1 << InputControllerGamepadButtonBit.A },
	{ id: 'b_knop', buttons: 1 << InputControllerGamepadButtonBit.B },
	{ id: 'x_knop', buttons: 1 << InputControllerGamepadButtonBit.X },
	{ id: 'y_knop', buttons: 1 << InputControllerGamepadButtonBit.Y },
	{ id: 'select_knop', buttons: 1 << InputControllerGamepadButtonBit.Select },
	{ id: 'start_knop', buttons: 1 << InputControllerGamepadButtonBit.Start },
	{ id: 'ls_knop', buttons: 1 << InputControllerGamepadButtonBit.LeftStick },
	{ id: 'rs_knop', buttons: 1 << InputControllerGamepadButtonBit.RightStick },
] as const;

const LANDSCAPE_PROFILE = { margin: 16, referenceSide: 360, stickSize: 136, actionScale: 1 };
const PORTRAIT_PROFILE = { margin: 16, referenceSide: 390, stickSize: 144, actionScale: 1.08 };

/** Passive controller artwork and its authored numerical layout. */
export class BrowserOnscreenGamepadView {
	private readonly stickSurface: HTMLElement;
	private readonly actionSurface: HTMLElement;
	private readonly stickBase: SVGCircleElement;
	private readonly stickTip: SVGCircleElement;
	private readonly stickArtworkWidth: number;
	private readonly stickArtworkHeight: number;
	private readonly actionArtworkWidth: number;
	private readonly actionArtworkHeight: number;
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
		this.actionSurface = document.getElementById('button-controls');
		this.stickBase = document.getElementById('d-pad-base') as unknown as SVGCircleElement;
		this.stickTip = document.getElementById('d-pad-tip') as unknown as SVGCircleElement;
		const stickArtwork = document.getElementById('d-pad-svg') as unknown as SVGSVGElement;
		const actionArtwork = document.getElementById('action-buttons-svg') as unknown as SVGSVGElement;
		this.stickArtworkWidth = stickArtwork.viewBox.baseVal.width;
		this.stickArtworkHeight = stickArtwork.viewBox.baseVal.height;
		this.actionArtworkWidth = actionArtwork.viewBox.baseVal.width;
		this.actionArtworkHeight = actionArtwork.viewBox.baseVal.height;
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
		const profile = width >= height ? LANDSCAPE_PROFILE : PORTRAIT_PROFILE;
		const availableWidth = Math.max(0, width - profile.margin * 2);
		const availableHeight = Math.max(0, height - profile.margin * 2);
		const viewportScale = Math.min(1.2, Math.min(width, height) / profile.referenceSide);
		const stickScale = Math.min(
			profile.stickSize / this.stickArtworkWidth * viewportScale,
			availableWidth / this.stickArtworkWidth,
			availableHeight / this.stickArtworkHeight,
		);
		const actionScale = Math.min(
			profile.actionScale * viewportScale,
			availableWidth / this.actionArtworkWidth,
			availableHeight / this.actionArtworkHeight,
		);
		const stickLeft = left + profile.margin;
		const stickTop = top + height - profile.margin - this.stickArtworkHeight * stickScale;
		const actionLeft = left + width - profile.margin - this.actionArtworkWidth * actionScale;
		const actionTop = top + height - profile.margin - this.actionArtworkHeight * actionScale;
		this.stickSurface.style.left = `${stickLeft}px`;
		this.stickSurface.style.top = `${stickTop}px`;
		this.stickSurface.style.transform = `scale(${stickScale})`;
		this.actionSurface.style.left = `${actionLeft}px`;
		this.actionSurface.style.top = `${actionTop}px`;
		this.actionSurface.style.transform = `scale(${actionScale})`;
		const geometry = this.geometry;
		geometry.stickX = stickLeft + this.nominalStickX * stickScale;
		geometry.stickY = stickTop + this.nominalStickY * stickScale;
		geometry.stickRadius = this.nominalStickRadius * stickScale;
		geometry.stickDeadzoneRadius = this.nominalDeadzoneRadius * stickScale;
		for (let index = 0; index < this.actions.length; index += 1) {
			const nominal = this.nominalActions[index];
			const action = this.actions[index];
			action.x = actionLeft + nominal.x * actionScale;
			action.y = actionTop + nominal.y * actionScale;
			action.radius = nominal.radius * actionScale;
		}
		this.model.setGeometry(geometry);
		this.stickSurface.hidden = false;
		this.actionSurface.hidden = false;
	}

	public dispose(): void {
		this.unsubscribeView();
		if (this.animationFrameId) this.window.cancelAnimationFrame(this.animationFrameId);
		this.animationFrameId = 0;
		this.stickSurface.hidden = true;
		this.actionSurface.hidden = true;
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
