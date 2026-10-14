import { InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import { OnscreenActionBank, type BrowserOnscreenGamepad, type OnscreenActionGeometry, type OnscreenGamepadGeometry, type OnscreenDirectionalMode } from './onscreen_gamepad';
import type { BrowserInputDiagnostics } from './input_trace_contract';
import { layoutShoulderOutline } from './onscreen_control_shapes';
import { OnscreenGamepadLayout, CONTROL_GAP, PAINT_CLEARANCE, type OnscreenGamepadLayoutProfile } from './onscreen_gamepad_layout';

const enum ActionSurfaceIndex { Face, Select, Start, LeftStick, RightStick, LeftBumper, RightBumper, LeftTrigger, RightTrigger }

const ACTIONS = [
	{ id: 'a_knop', surface: ActionSurfaceIndex.Face, bank: OnscreenActionBank.Face, buttons: 1 << InputControllerGamepadButtonBit.A },
	{ id: 'b_knop', surface: ActionSurfaceIndex.Face, bank: OnscreenActionBank.Face, buttons: 1 << InputControllerGamepadButtonBit.B },
	{ id: 'x_knop', surface: ActionSurfaceIndex.Face, bank: OnscreenActionBank.Face, buttons: 1 << InputControllerGamepadButtonBit.X },
	{ id: 'y_knop', surface: ActionSurfaceIndex.Face, bank: OnscreenActionBank.Face, buttons: 1 << InputControllerGamepadButtonBit.Y },
	{ id: 'select_knop', surface: ActionSurfaceIndex.Select, bank: OnscreenActionBank.LeftUtility, buttons: 1 << InputControllerGamepadButtonBit.Select },
	{ id: 'start_knop', surface: ActionSurfaceIndex.Start, bank: OnscreenActionBank.RightUtility, buttons: 1 << InputControllerGamepadButtonBit.Start },
	{ id: 'ls_knop', surface: ActionSurfaceIndex.LeftStick, bank: OnscreenActionBank.LeftUtility, buttons: 1 << InputControllerGamepadButtonBit.LeftStick },
	{ id: 'rs_knop', surface: ActionSurfaceIndex.RightStick, bank: OnscreenActionBank.RightUtility, buttons: 1 << InputControllerGamepadButtonBit.RightStick },
	{ id: 'lb_knop', surface: ActionSurfaceIndex.LeftBumper, bank: OnscreenActionBank.LeftShoulder, buttons: 1 << InputControllerGamepadButtonBit.LeftBumper },
	{ id: 'rb_knop', surface: ActionSurfaceIndex.RightBumper, bank: OnscreenActionBank.RightShoulder, buttons: 1 << InputControllerGamepadButtonBit.RightBumper },
	{ id: 'lt_knop', surface: ActionSurfaceIndex.LeftTrigger, bank: OnscreenActionBank.LeftShoulder, buttons: 1 << InputControllerGamepadButtonBit.LeftTrigger },
	{ id: 'rt_knop', surface: ActionSurfaceIndex.RightTrigger, bank: OnscreenActionBank.RightShoulder, buttons: 1 << InputControllerGamepadButtonBit.RightTrigger },
] as const;

const PAD_DIRECTIONS = [
	{ id: 'd-pad-u', buttons: 1 << InputControllerGamepadButtonBit.Up },
	{ id: 'd-pad-d', buttons: 1 << InputControllerGamepadButtonBit.Down },
	{ id: 'd-pad-l', buttons: 1 << InputControllerGamepadButtonBit.Left },
	{ id: 'd-pad-r', buttons: 1 << InputControllerGamepadButtonBit.Right },
] as const;

const ACTION_SURFACES = ['button-controls', 'select-controls', 'start-controls', 'ls-controls', 'rs-controls',
	'lb-controls', 'rb-controls', 'lt-controls', 'rt-controls'] as const;
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
	private readonly hostKeyboardControl: HTMLButtonElement;
	private readonly hostMenuControl: HTMLButtonElement;
	private readonly actionSurfaces: ActionSurface[] = [];
	private readonly padArtworkWidth: number;
	private readonly padArtworkHeight: number;
	private readonly nominalPadX: number;
	private readonly nominalPadY: number;
	private readonly nominalPadRadius: number;
	private readonly nominalStickTravel: number;
	private readonly stickArtworkScale: number;
	private readonly metrics: OnscreenGamepadLayout;
	private readonly padDirections: SVGPathElement[] = [];
	private readonly padArtwork: SVGGElement;
	private readonly stickArtwork: SVGGElement;
	private readonly stickTip: SVGCircleElement;
	private readonly buttonShapes: SVGGeometryElement[] = [];
	private readonly shoulderActions: OnscreenActionGeometry[] = [];
	private readonly shoulderLabels: SVGTextElement[] = [];
	private readonly nominalActions: OnscreenActionGeometry[] = [];
	private readonly actions: OnscreenActionGeometry[] = [];
	private readonly geometry: OnscreenGamepadGeometry = {
		padX: 0, padY: 0, padRadius: 0, padNeutralRadius: 0, stickTravelRadius: 0,
		faceX: 0, faceY: 0, faceRadius: 0, actions: this.actions,
	};
	private readonly layoutObserver: BrowserInputDiagnostics | undefined;
	private readonly unsubscribeView: () => void;
	private animationFrameId = 0;
	private renderedButtons = 0;
	private renderedMode: OnscreenDirectionalMode = 'dpad';
	private renderedStickX = 0;
	private renderedStickY = 0;
	private renderedStickActive = false;
	private layoutLeft = 0;
	private layoutTop = 0;
	private layoutWidth = -1;
	private layoutHeight = -1;
	private portraitControlTop: number | null = null;
	private allocatedPortraitDeckTop: number | undefined;

	public constructor(
		document: Document,
		private readonly window: Window,
		private readonly model: BrowserOnscreenGamepad,
	) {
		this.layoutObserver = window.bmsxInputTrace;
		this.padSurface = document.getElementById('d-pad-controls');
		this.hostKeyboardControl = document.getElementById('host-keyboard-control') as HTMLButtonElement;
		this.hostMenuControl = document.getElementById('host-menu-control') as HTMLButtonElement;
		this.padArtwork = document.getElementById('d-pad-artwork') as unknown as SVGGElement;
		this.stickArtwork = document.getElementById('left-stick-artwork') as unknown as SVGGElement;
		this.stickTip = document.getElementById('left-stick-tip') as unknown as SVGCircleElement;
		const stickRing = this.stickArtwork.querySelector('.stick-outline') as SVGCircleElement;
		this.nominalStickTravel = stickRing.r.baseVal.value - this.stickTip.r.baseVal.value;
		this.stickArtworkScale = this.stickArtwork.transform.baseVal.consolidate().matrix.a;
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
		for (const direction of PAD_DIRECTIONS) {
			this.padDirections.push(document.getElementById(direction.id) as unknown as SVGPathElement);
		}
		for (const action of ACTIONS) {
			const element = document.getElementById(action.id) as unknown as SVGGeometryElement;
			this.buttonShapes.push(element);
			if (action.surface < ActionSurfaceIndex.LeftBumper) {
				const circle = element as SVGCircleElement;
				this.nominalActions.push({
					x: circle.cx.baseVal.value, y: circle.cy.baseVal.value,
					radius: circle.r.baseVal.value, bank: action.bank, buttons: action.buttons,
				});
				this.actions.push({ x: 0, y: 0, radius: 0, bank: action.bank, buttons: action.buttons });
			} else {
				const geometry: OnscreenActionGeometry = { x: 0, y: 0, radius: 0, bank: action.bank, buttons: action.buttons, outline: {
					centerX: 0, centerY: 0, radius: 0, halfWidth: 0,
					startX: 0, startY: 0, endX: 0, endY: 0, quarterTurns: 0, startT: 0, endT: 0,
					left: 0, top: 0, right: 0, bottom: 0,
				} };
				this.actions.push(geometry);
				this.shoulderActions.push(geometry);
				this.shoulderLabels.push(document.getElementById(action.id + '_text') as unknown as SVGTextElement);
			}
		}
		const face = this.actionSurfaces[ActionSurfaceIndex.Face];
		const bottomButton = this.nominalActions[0];
		this.metrics = new OnscreenGamepadLayout(face.artworkWidth, face.artworkHeight,
			bottomButton.y, bottomButton.radius);
		this.unsubscribeView = model.subscribeView(this.scheduleRender);
		this.scheduleRender();
	}

	public get layoutProfile(): OnscreenGamepadLayoutProfile { return this.metrics.profile; }

	/** Upper limit of portrait video, authored with the actual lower control deck. */
	public get portraitDeckTop(): number | null { return this.portraitControlTop; }

	/** Numerical measure pass; arrange reuses these retained metrics without publishing input. */
	public measurePortraitDeckHeight(width: number, height: number): number {
		const metrics = this.metrics.measure(width, height);
		return metrics.portraitDeckHeight;
	}

	/** Layout and acquisition share the same uniform CSS-client transforms. */
	public layout(left: number, top: number, width: number, height: number, portraitDeckTop?: number): void {
		if (left === this.layoutLeft && top === this.layoutTop && width === this.layoutWidth && height === this.layoutHeight
			&& portraitDeckTop === this.allocatedPortraitDeckTop) return;
		this.layoutLeft = left;
		this.layoutTop = top;
		this.layoutWidth = width;
		this.layoutHeight = height;
		this.allocatedPortraitDeckTop = portraitDeckTop;
		const metrics = this.metrics.measure(width, height);
		const overlay = metrics.profile === 'landscape' || metrics.profile === 'compact-overlay';
		const phonePortrait = metrics.profile === 'phone-portrait';
		const faceSurface = this.actionSurfaces[ActionSurfaceIndex.Face];
		const viewportScale = metrics.scale;
		const margin = metrics.margin;
		const padScale = metrics.padSize / this.padArtworkWidth;
		const faceScale = metrics.faceScale;
		const menuSize = metrics.menuSize;
		const clickSize = metrics.clickSize;
		const allocatedDeckTop = portraitDeckTop === undefined ? top + height - metrics.portraitDeckHeight : portraitDeckTop;
		const primaryY = overlay
			? top + Math.max(PAINT_CLEARANCE + metrics.shoulderReach,
				Math.min(height / 2, height - PAINT_CLEARANCE - metrics.utilityReach - menuSize / 2))
			: allocatedDeckTop + metrics.portraitTopReach;
		const menuY = primaryY + metrics.utilityReach;
		const padLeft = left + margin;
		const padTop = primaryY - this.nominalPadY * padScale;
		const padX = padLeft + this.nominalPadX * padScale;
		const padY = primaryY;
		const padRadius = this.nominalPadRadius * padScale;
		const faceLeft = left + width - margin - faceSurface.artworkWidth * faceScale;
		const faceCenterX = faceLeft + faceSurface.artworkWidth * faceScale / 2;
		const faceCenterY = primaryY;
		const faceTop = faceCenterY - faceSurface.artworkHeight * faceScale / 2;
		this.padSurface.style.left = '0px';
		this.padSurface.style.top = '0px';
		this.padSurface.style.transform = `translate(${padLeft}px, ${padTop}px) scale(${padScale})`;
		this.placeActionSurface(ActionSurfaceIndex.Face, faceLeft, faceTop, faceScale);
		const menuArtworkWidth = this.actionSurfaces[ActionSurfaceIndex.Select].artworkWidth;
		const menuSurfaceScale = menuSize / menuArtworkWidth;
		const clickSurfaceScale = clickSize / this.actionSurfaces[ActionSurfaceIndex.LeftStick].artworkWidth;
		const leftClickX = left + metrics.leftClickX;
		const selectX = left + metrics.selectX;
		const rightClickX = left + metrics.rightClickX;
		const startX = left + metrics.startX;
		this.placeActionSurface(ActionSurfaceIndex.Select,
			selectX - menuSize / 2, menuY - menuSize / 2, menuSurfaceScale);
		this.placeActionSurface(ActionSurfaceIndex.Start,
			startX - menuSize / 2, menuY - menuSize / 2, menuSurfaceScale);
		this.placeActionSurface(ActionSurfaceIndex.LeftStick,
			leftClickX - clickSize / 2, menuY - clickSize / 2, clickSurfaceScale);
		this.placeActionSurface(ActionSurfaceIndex.RightStick,
			rightClickX - clickSize / 2, menuY - clickSize / 2, clickSurfaceScale);
		const hostSize = metrics.hostSize;
		this.hostKeyboardControl.style.width = `${hostSize}px`;
		this.hostKeyboardControl.style.height = `${hostSize}px`;
		this.hostKeyboardControl.style.transform = `translate(${left + metrics.leftHostX - hostSize / 2}px, ${menuY - hostSize / 2}px)`;
		this.hostKeyboardControl.hidden = false;
		this.hostMenuControl.style.width = `${hostSize}px`;
		this.hostMenuControl.style.height = `${hostSize}px`;
		this.hostMenuControl.style.transform = `translate(${left + metrics.rightHostX - hostSize / 2}px, ${menuY - hostSize / 2}px)`;
		this.hostMenuControl.hidden = false;
		// Bumpers occupy each ring's outer half, triggers its inner half, above
		// both hand banks in portrait and landscape alike.
		// The centerline chord between the inner round caps reserves the true
		// gap; both halves share a center, radius and radial target thickness.
		const halfWidth = metrics.halfWidth;
		const leftShoulderRadius = metrics.leftRing;
		const rightShoulderRadius = metrics.rightRing;
		const upward = -Math.PI / 2;
		this.placeShoulder(ActionSurfaceIndex.LeftBumper, padX, primaryY,
			leftShoulderRadius, halfWidth, upward - metrics.leftOuter, upward + metrics.leftSplit - metrics.leftGap);
		this.placeShoulder(ActionSurfaceIndex.RightBumper, faceCenterX, faceCenterY,
			rightShoulderRadius, halfWidth, upward - metrics.rightSplit + metrics.rightGap, upward + metrics.rightOuter);
		this.placeShoulder(ActionSurfaceIndex.LeftTrigger, padX, primaryY,
			leftShoulderRadius, halfWidth, upward + metrics.leftSplit + metrics.leftGap, upward + metrics.leftInner);
		this.placeShoulder(ActionSurfaceIndex.RightTrigger, faceCenterX, faceCenterY,
			rightShoulderRadius, halfWidth, upward - metrics.rightInner, upward - metrics.rightSplit - metrics.rightGap);
		// Phone shoulders retain physical target and caption sizes independently
		// of the face bank. Overlay captions retain their existing quiet scale.
		const shoulderLabelSize = 13 * (phonePortrait ? 1 : viewportScale);
		for (const label of this.shoulderLabels) label.style.fontSize = `${shoulderLabelSize}px`;
		this.portraitControlTop = overlay ? null : allocatedDeckTop - CONTROL_GAP;
		const geometry = this.geometry;
		geometry.padX = padX;
		geometry.padY = padY;
		geometry.padRadius = padRadius;
		geometry.padNeutralRadius = padRadius * 0.18;
		geometry.stickTravelRadius = this.nominalStickTravel * this.stickArtworkScale * padScale;
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
		this.hostKeyboardControl.hidden = true;
		this.hostMenuControl.hidden = true;
		for (const surface of this.actionSurfaces) surface.element.hidden = true;
	}

	private placeActionSurface(index: ActionSurfaceIndex, left: number, top: number, scale: number): void {
		const surface = this.actionSurfaces[index];
		surface.left = left;
		surface.top = top;
		surface.scale = scale;
		surface.element.style.left = '0px';
		surface.element.style.top = '0px';
		surface.element.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
		surface.element.hidden = false;
	}

	/** Publishes matching numerical surface and SVG outline at layout time only. */
	private placeShoulder(
		index: ActionSurfaceIndex, centerX: number, centerY: number,
		radius: number, halfWidth: number, startAngle: number, endAngle: number,
	): void {
		const shoulderIndex = index - ActionSurfaceIndex.LeftBumper;
		const action = this.shoulderActions[shoulderIndex];
		const surface = this.actionSurfaces[index];
		const outline = action.outline;
		const path = layoutShoulderOutline(outline, radius, halfWidth, startAngle, endAngle);
		const width = outline.right - outline.left;
		const height = outline.bottom - outline.top;
		// CSS layout quantizes fractional SVG viewport sizes. Integer viewport
		// dimensions and a matching viewBox keep authored path units at scale 1;
		// the extra transparent edge is not part of the contact surface.
		const viewportWidth = Math.trunc(width) + 1;
		const viewportHeight = Math.trunc(height) + 1;
		const x = centerX - outline.centerX;
		const y = centerY - outline.centerY;
		action.x = x;
		action.y = y;
		action.radius = Math.hypot(Math.max(-outline.left, outline.right), Math.max(-outline.top, outline.bottom));
		surface.element.style.width = `${viewportWidth}px`;
		surface.element.style.height = `${viewportHeight}px`;
		surface.artwork.setAttribute('viewBox', `0 0 ${viewportWidth} ${viewportHeight}`);
		surface.artwork.setAttribute('width', `${viewportWidth}`);
		surface.artwork.setAttribute('height', `${viewportHeight}`);
		surface.artwork.firstElementChild.setAttribute('d', path);
		this.buttonShapes[this.nominalActions.length + shoulderIndex].setAttribute('d', path);
		this.shoulderLabels[shoulderIndex].setAttribute('x', `${-outline.left}`);
		this.shoulderLabels[shoulderIndex].setAttribute('y', `${-outline.top}`);
		this.placeActionSurface(index, x + outline.left, y + outline.top, 1);
	}

	private readonly scheduleRender = (): void => {
		if (!this.animationFrameId) this.animationFrameId = this.window.requestAnimationFrame(this.render);
	};

	private readonly render = (): void => {
		this.animationFrameId = 0;
		const model = this.model;
		const mode = model.directionalMode;
		if (mode !== this.renderedMode) {
			this.padArtwork.setAttribute('visibility', mode === 'dpad' ? 'visible' : 'hidden');
			this.stickArtwork.setAttribute('visibility', mode === 'stick' ? 'visible' : 'hidden');
			this.renderedMode = mode;
		}
		if (model.stickX !== this.renderedStickX || model.stickY !== this.renderedStickY) {
			this.stickTip.cx.baseVal.value = 50 + model.stickX * this.nominalStickTravel;
			this.stickTip.cy.baseVal.value = 50 + model.stickY * this.nominalStickTravel;
			this.renderedStickX = model.stickX;
			this.renderedStickY = model.stickY;
		}
		if (model.stickActive !== this.renderedStickActive) {
			this.stickTip.setAttribute('data-touched', model.stickActive ? 'true' : 'false');
			this.renderedStickActive = model.stickActive;
		}
		const buttons = model.buttons;
		const changedButtons = buttons ^ this.renderedButtons;
		if (changedButtons !== 0) {
			for (let index = 0; index < ACTIONS.length; index += 1) {
				const mask = ACTIONS[index].buttons;
				if ((changedButtons & mask) !== 0) {
					this.buttonShapes[index].setAttribute('data-touched', (buttons & mask) !== 0 ? 'true' : 'false');
				}
			}
			for (let index = 0; index < PAD_DIRECTIONS.length; index += 1) {
				const mask = PAD_DIRECTIONS[index].buttons;
				if ((changedButtons & mask) !== 0) {
					this.padDirections[index].setAttribute('data-touched', (buttons & mask) !== 0 ? 'true' : 'false');
				}
			}
		}
		this.renderedButtons = buttons;
	};
}
