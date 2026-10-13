import { InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import type { BrowserOnscreenGamepad, OnscreenActionGeometry, OnscreenGamepadGeometry, OnscreenDirectionalMode } from './onscreen_gamepad';
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

const PAD_DIRECTIONS = [
	{ id: 'd-pad-u', buttons: 1 << InputControllerGamepadButtonBit.Up },
	{ id: 'd-pad-d', buttons: 1 << InputControllerGamepadButtonBit.Down },
	{ id: 'd-pad-l', buttons: 1 << InputControllerGamepadButtonBit.Left },
	{ id: 'd-pad-r', buttons: 1 << InputControllerGamepadButtonBit.Right },
] as const;

const ACTION_SURFACES = ['button-controls', 'select-controls', 'start-controls', 'ls-controls', 'rs-controls',
	'lb-controls', 'rb-controls', 'lt-controls', 'rt-controls'] as const;
const PAD_SIZE = 180;
const CONTROL_GAP = 12;
const MENU_SIZE = 52;
const STICK_CLICK_SIZE = 44;
const SHOULDER_THICKNESS = 56;
const LANDSCAPE_SHOULDER_HALF_SWEEP = 70 * Math.PI / 180;
const LANDSCAPE_MARGIN = 16;

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
		padX: 0, padY: 0, padRadius: 0, padNeutralRadius: 0,
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
	private keyboardVisible = false;

	public constructor(
		document: Document,
		private readonly window: Window,
		private readonly model: BrowserOnscreenGamepad,
	) {
		this.layoutObserver = window.bmsxInputTrace;
		this.padSurface = document.getElementById('d-pad-controls');
		this.padArtwork = document.getElementById('d-pad-artwork') as unknown as SVGGElement;
		this.stickArtwork = document.getElementById('left-stick-artwork') as unknown as SVGGElement;
		this.stickTip = document.getElementById('left-stick-tip') as unknown as SVGCircleElement;
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
					radius: circle.r.baseVal.value, buttons: action.buttons,
				});
				this.actions.push({ x: 0, y: 0, radius: 0, buttons: action.buttons });
			} else {
				const geometry: OnscreenActionGeometry = { x: 0, y: 0, radius: 0, buttons: action.buttons, outline: {
					centerX: 0, centerY: 0, radius: 0, halfWidth: 0,
					startX: 0, startY: 0, endX: 0, endY: 0, quarterTurns: 0, startT: 0, endT: 0,
					left: 0, top: 0, right: 0, bottom: 0,
				} };
				this.actions.push(geometry);
				this.shoulderActions.push(geometry);
				this.shoulderLabels.push(document.getElementById(action.id + '_text') as unknown as SVGTextElement);
			}
		}
		this.unsubscribeView = model.subscribeView(this.scheduleRender);
		this.scheduleRender();
	}

	/** Upper limit of portrait video, authored with the actual lower control deck. */
	public get portraitDeckTop(): number | null { return this.portraitControlTop; }

	/** Host keyboard context keeps the touch gamepad at the surrounding hand edges. */
	public readonly setKeyboardVisible = (visible: boolean): void => {
		if (visible === this.keyboardVisible) return;
		this.keyboardVisible = visible;
		const width = this.layoutWidth;
		this.layoutWidth = -1;
		this.layout(this.layoutLeft, this.layoutTop, width, this.layoutHeight);
	};

	/** Layout and acquisition share the same uniform CSS-client transforms. */
	public layout(left: number, top: number, width: number, height: number): void {
		if (left === this.layoutLeft && top === this.layoutTop && width === this.layoutWidth && height === this.layoutHeight) return;
		this.layoutLeft = left;
		this.layoutTop = top;
		this.layoutWidth = width;
		this.layoutHeight = height;
		const landscape = width >= height;
		const gameplayLandscape = landscape && !this.keyboardVisible;
		// Delta's four-button handheld deck keeps both primary controls on one
		// hand row. Its geometry is a reference, not a source of copied artwork:
		// https://github.com/rileytestut/SNESDeltaCore/blob/ed3a432616bfabaa376c554f7d352958e5bfb13b/SNESDeltaCore/Controller%20Skin/info.json#L343-L509
		const faceSurface = this.actionSurfaces[ActionSurfaceIndex.Face];
		const nominalHalfWidth = SHOULDER_THICKNESS / 2;
		const nominalLeftRing = PAD_SIZE / 2 + CONTROL_GAP + nominalHalfWidth;
		const nominalRightRing = faceSurface.artworkWidth / 2 + CONTROL_GAP + nominalHalfWidth;
		const leftHandReach = nominalLeftRing * Math.sin(LANDSCAPE_SHOULDER_HALF_SWEEP) + nominalHalfWidth;
		const rightHandReach = nominalRightRing * Math.sin(LANDSCAPE_SHOULDER_HALF_SWEEP) + nominalHalfWidth;
		const handTopReach = Math.sqrt(nominalRightRing * nominalRightRing
			- (nominalHalfWidth + CONTROL_GAP / 2) * (nominalHalfWidth + CONTROL_GAP / 2)) + nominalHalfWidth;
		const primaryBottomReach = Math.max(PAD_SIZE, faceSurface.artworkHeight) / 2;
		// Pack the entire hand silhouette, not just the D-pad acquisition frame.
		// In landscape this leaves room for the finite shoulder ring to follow
		// the hand around both upper corners instead of flattening at an edge.
		const landscapeWidth = 2 * (LANDSCAPE_MARGIN + leftHandReach + rightHandReach) + CONTROL_GAP;
		const landscapeHeight = 2 * LANDSCAPE_MARGIN + handTopReach + primaryBottomReach;
		const viewportScale = landscape
			? Math.min(1.1, width / landscapeWidth, height / landscapeHeight)
			: Math.min(1.1, (width - CONTROL_GAP * 3) / (PAD_SIZE + faceSurface.artworkWidth), height / 500);
		const margin = landscape ? LANDSCAPE_MARGIN * viewportScale : CONTROL_GAP;
		const bottom = 16 * viewportScale;
		const gap = CONTROL_GAP * viewportScale;
		const padScale = PAD_SIZE / this.padArtworkWidth * viewportScale;
		const faceScale = viewportScale;
		const menuScale = landscape ? viewportScale : Math.max(0.85, viewportScale);
		const menuSize = MENU_SIZE * menuScale;
		const clickSize = STICK_CLICK_SIZE * menuScale;
		const menuY = top + height - bottom - menuSize / 2;
		const primaryRadius = Math.max(this.padArtworkHeight * padScale, faceSurface.artworkHeight * faceScale) / 2;
		const primaryY = gameplayLandscape
			? top + Math.max(margin + handTopReach * viewportScale,
				Math.min(height / 2, height - margin - primaryRadius))
			: landscape ? top + height - bottom - primaryRadius
				: menuY - menuSize / 2 - 16 * viewportScale - primaryRadius;
		const padLeft = left + margin + (gameplayLandscape ? (leftHandReach - PAD_SIZE / 2) * viewportScale : 0);
		const padTop = primaryY - this.nominalPadY * padScale;
		const padX = padLeft + this.nominalPadX * padScale;
		const padY = primaryY;
		const padRadius = this.nominalPadRadius * padScale;
		const faceLeft = left + width - margin - faceSurface.artworkWidth * faceScale
			- (gameplayLandscape ? (rightHandReach - faceSurface.artworkWidth / 2) * viewportScale : 0);
		const faceCenterX = faceLeft + faceSurface.artworkWidth * faceScale / 2;
		const faceCenterY = primaryY;
		const faceTop = primaryY - faceSurface.artworkHeight * faceScale / 2;
		this.padSurface.style.left = '0px';
		this.padSurface.style.top = '0px';
		this.padSurface.style.transform = `translate(${padLeft}px, ${padTop}px) scale(${padScale})`;
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
		// Each hand has one shoulder ring, split into two adjacent finite bands.
		// The centerline chord between the inner round caps reserves the true
		// gap; both halves share a center, radius and radial target thickness.
		const faceRadius = faceSurface.artworkWidth * faceScale / 2;
		const shoulderThickness = landscape ? SHOULDER_THICKNESS * viewportScale
			: Math.min(SHOULDER_THICKNESS * viewportScale,
				primaryY - top - 4 * viewportScale - Math.max(padRadius, faceRadius) - gap);
		const halfWidth = shoulderThickness / 2;
		const laneHalfWidth = Math.min(padX - left - margin,
			left + width - margin - faceCenterX, (faceCenterX - padX - gap) / 2);
		const leftShoulderRadius = padRadius + gap + halfWidth;
		const rightShoulderRadius = faceRadius + gap + halfWidth;
		const leftHalfAngle = gameplayLandscape ? LANDSCAPE_SHOULDER_HALF_SWEEP
			: Math.asin((laneHalfWidth - halfWidth) / leftShoulderRadius);
		const rightHalfAngle = gameplayLandscape ? LANDSCAPE_SHOULDER_HALF_SWEEP
			: Math.asin((laneHalfWidth - halfWidth) / rightShoulderRadius);
		const leftGapAngle = Math.asin((halfWidth + gap / 2) / leftShoulderRadius);
		const rightGapAngle = Math.asin((halfWidth + gap / 2) / rightShoulderRadius);
		const upward = -Math.PI / 2;
		this.placeShoulder(ActionSurfaceIndex.LeftBumper, padX, primaryY,
			leftShoulderRadius, halfWidth, upward + leftGapAngle, upward + leftHalfAngle);
		this.placeShoulder(ActionSurfaceIndex.RightBumper, faceCenterX, primaryY,
			rightShoulderRadius, halfWidth, upward - rightHalfAngle, upward - rightGapAngle);
		this.placeShoulder(ActionSurfaceIndex.LeftTrigger, padX, primaryY,
			leftShoulderRadius, halfWidth, upward - leftHalfAngle, upward - leftGapAngle);
		this.placeShoulder(ActionSurfaceIndex.RightTrigger, faceCenterX, primaryY,
			rightShoulderRadius, halfWidth, upward + rightGapAngle, upward + rightHalfAngle);
		// Shoulder paths already use CSS-client units (their SVG scale is 1).
		// Scale their labels with the controller just like the other artwork.
		for (const label of this.shoulderLabels) label.style.fontSize = `${17 * viewportScale}px`;
		this.portraitControlTop = landscape ? null
			: Math.min(this.shoulderActions[0].y + this.shoulderActions[0].outline.top,
				this.shoulderActions[1].y + this.shoulderActions[1].outline.top) - CONTROL_GAP;
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
			this.stickTip.cx.baseVal.value = 50 + model.stickX * 24;
			this.stickTip.cy.baseVal.value = 50 + model.stickY * 24;
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
