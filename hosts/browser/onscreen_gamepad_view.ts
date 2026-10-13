import { InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import { OnscreenActionBank, type BrowserOnscreenGamepad, type OnscreenActionGeometry, type OnscreenGamepadGeometry, type OnscreenDirectionalMode } from './onscreen_gamepad';
import type { BrowserInputDiagnostics } from './input_trace_contract';
import { layoutShoulderOutline } from './onscreen_control_shapes';

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
const PAD_SIZE = 180;
const CONTROL_GAP = 12;
const MENU_SIZE = 52;
const STICK_CLICK_SIZE = 44;
const SHOULDER_THICKNESS = 56;
const SHOULDER_INWARD_SWEEP = Math.PI / 3;
const BUMPER_SWEEP_ADVANTAGE = 2 * Math.PI / 180;
const CONTROL_MARGIN = 4;
const MIN_GAMEPLAY_SHOULDER_THICKNESS = 44;
const SHOULDER_PAINT_RADIUS = 1.5;
const PAINT_CLEARANCE = 4;
const PORTRAIT_SHOULDER_WIDTH = 88;
const PORTRAIT_SHOULDER_RADIUS = 100;
const PORTRAIT_SHOULDER_PRIMARY_GAP = 24;

interface ActionSurface {
	element: HTMLElement;
	artwork: SVGSVGElement;
	artworkWidth: number;
	artworkHeight: number;
	left: number;
	top: number;
	scale: number;
}

interface ControlLayoutMetrics {
	width: number;
	height: number;
	landscape: boolean;
	scale: number;
	margin: number;
	bottom: number;
	gap: number;
	menuScale: number;
	menuSize: number;
	clickSize: number;
	padRadius: number;
	faceRadius: number;
	primaryRadius: number;
	halfWidth: number;
	leftRing: number;
	rightRing: number;
	leftOuter: number;
	rightOuter: number;
	leftInner: number;
	rightInner: number;
	leftSplit: number;
	rightSplit: number;
	utilityDrop: number;
	leftGap: number;
	rightGap: number;
	topReach: number;
	portraitShoulderWidth: number;
	portraitShoulderHalfAngle: number;
	portraitTopReach: number;
	portraitDeckHeight: number;
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
	private readonly metrics: ControlLayoutMetrics = {
		width: -1, height: -1, landscape: false, scale: 1, margin: 0, bottom: 0, gap: 0,
		menuScale: 1, menuSize: 0, clickSize: 0, padRadius: 0, faceRadius: 0, primaryRadius: 0,
		halfWidth: 0, leftRing: 0, rightRing: 0, leftOuter: 0, rightOuter: 0,
		leftInner: 0, rightInner: 0, leftSplit: 0, rightSplit: 0,
		utilityDrop: 0,
		leftGap: 0, rightGap: 0, topReach: 0, portraitShoulderWidth: 0, portraitShoulderHalfAngle: 0,
		portraitTopReach: 0, portraitDeckHeight: 0,
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
		this.unsubscribeView = model.subscribeView(this.scheduleRender);
		this.scheduleRender();
	}

	/** Upper limit of portrait video, authored with the actual lower control deck. */
	public get portraitDeckTop(): number | null { return this.portraitControlTop; }

	/** Numerical measure pass; arrange reuses these retained metrics without publishing input. */
	public measurePortraitDeckHeight(width: number, height: number): number {
		return this.prepareLayoutMetrics(width, height).portraitDeckHeight;
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
		const metrics = this.prepareLayoutMetrics(width, height);
		const landscape = metrics.landscape;
		// Delta's four-button handheld deck keeps both primary controls on one
		// hand row. Its geometry is a reference, not a source of copied artwork:
		// https://github.com/rileytestut/SNESDeltaCore/blob/ed3a432616bfabaa376c554f7d352958e5bfb13b/SNESDeltaCore/Controller%20Skin/info.json#L343-L509
		const faceSurface = this.actionSurfaces[ActionSurfaceIndex.Face];
		const viewportScale = metrics.scale;
		const margin = metrics.margin;
		const padScale = PAD_SIZE / this.padArtworkWidth * viewportScale;
		const faceScale = viewportScale;
		const menuScale = metrics.menuScale;
		const menuSize = metrics.menuSize;
		const clickSize = metrics.clickSize;
		const primaryRadius = metrics.primaryRadius;
		const allocatedDeckTop = portraitDeckTop === undefined ? top + height - metrics.portraitDeckHeight : portraitDeckTop;
		const primaryY = landscape
			? top + Math.max(PAINT_CLEARANCE + metrics.topReach,
				Math.min(height / 2, height - PAINT_CLEARANCE - primaryRadius))
			: allocatedDeckTop + metrics.portraitTopReach;
		const menuY = landscape ? Math.min(primaryY + metrics.utilityDrop, top + height - PAINT_CLEARANCE - menuSize / 2)
			: primaryY + metrics.utilityDrop;
		const padLeft = left + margin;
		const padTop = primaryY - this.nominalPadY * padScale;
		const padX = padLeft + this.nominalPadX * padScale;
		const padY = primaryY;
		const padRadius = this.nominalPadRadius * padScale;
		const faceLeft = left + width - margin - faceSurface.artworkWidth * faceScale;
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
		const pairSpacing = (STICK_CLICK_SIZE / 2 + MENU_SIZE / 2 + CONTROL_GAP) * menuScale;
		const pairHalf = pairSpacing / 2;
		const utilityDY = menuY - primaryY;
		const menuRadius = menuSize / 2;
		const clickRadius = clickSize / 2;
		// A short viewport can compress the vertical hand deck. Retain the
		// physical circle clearance by rolling its utility pair sideways, only
		// when the centered below-hand pair no longer fits that actual height.
		const leftSelectOffset = Math.max(pairHalf, Math.sqrt(Math.max(0,
			(padRadius + menuRadius + metrics.gap) ** 2 - utilityDY ** 2)));
		const leftClickOffset = Math.max(pairHalf, Math.sqrt(Math.max(0,
			(padRadius + clickRadius + metrics.gap) ** 2 - utilityDY ** 2)));
		const leftOuterRoom = padX - left - clickRadius - PAINT_CLEARANCE;
		const leftClickX = leftClickOffset <= leftOuterRoom ? padX - leftClickOffset : padX + leftClickOffset;
		const selectX = leftClickOffset <= leftOuterRoom ? padX + leftSelectOffset : leftClickX + pairSpacing;
		const a = this.nominalActions[0];
		const aOffset = (a.y - faceSurface.artworkHeight / 2) * faceScale;
		const aRadius = a.radius * faceScale;
		const startOffset = Math.max(pairHalf, Math.sqrt(Math.max(0,
			(aRadius + menuRadius + metrics.gap) ** 2 - (utilityDY - aOffset) ** 2)));
		const rightClickOffset = Math.max(pairHalf, Math.sqrt(Math.max(0,
			(aRadius + clickRadius + metrics.gap) ** 2 - (utilityDY - aOffset) ** 2)));
		const rightOuterRoom = left + width - faceCenterX - clickRadius - PAINT_CLEARANCE;
		const rightClickX = rightClickOffset <= rightOuterRoom ? faceCenterX + rightClickOffset : faceCenterX - rightClickOffset;
		const startX = rightClickOffset <= rightOuterRoom ? faceCenterX - startOffset : rightClickX - pairSpacing;
		this.placeActionSurface(ActionSurfaceIndex.Select,
			selectX - menuSize / 2, menuY - menuSize / 2, menuSurfaceScale);
		this.placeActionSurface(ActionSurfaceIndex.Start,
			startX - menuSize / 2, menuY - menuSize / 2, menuSurfaceScale);
		this.placeActionSurface(ActionSurfaceIndex.LeftStick,
			leftClickX - clickSize / 2, menuY - clickSize / 2, clickSurfaceScale);
		this.placeActionSurface(ActionSurfaceIndex.RightStick,
			rightClickX - clickSize / 2, menuY - clickSize / 2, clickSurfaceScale);
		// Gameplay puts the easier bumper on the outer/top part of one ring
		// and the trigger inward. No full outer flank displaces the primary bank.
		// The centerline chord between the inner round caps reserves the true
		// gap; both halves share a center, radius and radial target thickness.
		const halfWidth = metrics.halfWidth;
		const leftShoulderRadius = metrics.leftRing;
		const rightShoulderRadius = metrics.rightRing;
		if (!landscape) {
			// Portrait owns a detached handheld shoulder strip. Unlike landscape's
			// wrapping ring, the strip leaves a real empty band above both thumb banks.
			// Delta likewise authors independent orientation representations:
			// https://github.com/rileytestut/SNESDeltaCore/blob/ed3a432616bfabaa376c554f7d352958e5bfb13b/SNESDeltaCore/Controller%20Skin/info.json#L343-L673
			const width = metrics.portraitShoulderWidth;
			const angle = metrics.portraitShoulderHalfAngle;
			const centerY = allocatedDeckTop + halfWidth + PORTRAIT_SHOULDER_RADIUS;
			const upward = -Math.PI / 2;
			this.placeShoulder(ActionSurfaceIndex.LeftBumper, left + margin + width / 2, centerY,
				PORTRAIT_SHOULDER_RADIUS, halfWidth, upward - angle, upward + angle);
			this.placeShoulder(ActionSurfaceIndex.LeftTrigger, left + margin + width * 1.5 + CONTROL_GAP, centerY,
				PORTRAIT_SHOULDER_RADIUS, halfWidth, upward - angle, upward + angle);
			this.placeShoulder(ActionSurfaceIndex.RightBumper, left + metrics.width - margin - width / 2, centerY,
				PORTRAIT_SHOULDER_RADIUS, halfWidth, upward - angle, upward + angle);
			this.placeShoulder(ActionSurfaceIndex.RightTrigger, left + metrics.width - margin - width * 1.5 - CONTROL_GAP, centerY,
				PORTRAIT_SHOULDER_RADIUS, halfWidth, upward - angle, upward + angle);
		} else {
			const upward = -Math.PI / 2;
			this.placeShoulder(ActionSurfaceIndex.LeftBumper, padX, primaryY,
				leftShoulderRadius, halfWidth, upward - metrics.leftOuter, upward + metrics.leftSplit - metrics.leftGap);
			this.placeShoulder(ActionSurfaceIndex.RightBumper, faceCenterX, primaryY,
				rightShoulderRadius, halfWidth, upward - metrics.rightSplit + metrics.rightGap, upward + metrics.rightOuter);
			this.placeShoulder(ActionSurfaceIndex.LeftTrigger, padX, primaryY,
				leftShoulderRadius, halfWidth, upward + metrics.leftSplit + metrics.leftGap, upward + metrics.leftInner);
			this.placeShoulder(ActionSurfaceIndex.RightTrigger, faceCenterX, primaryY,
				rightShoulderRadius, halfWidth, upward - metrics.rightInner, upward - metrics.rightSplit - metrics.rightGap);
		}
		// Shoulder paths already use CSS-client units (their SVG scale is 1).
		// Scale their labels with the controller just like the other artwork.
		for (const label of this.shoulderLabels) label.style.fontSize = `${13 * viewportScale}px`;
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

	/** Intrinsic hand/deck measure, retained across composition and arrange passes. */
	private prepareLayoutMetrics(width: number, height: number): ControlLayoutMetrics {
		const metrics = this.metrics;
		if (width === metrics.width && height === metrics.height) return metrics;
		const face = this.actionSurfaces[ActionSurfaceIndex.Face];
		const nominalPadRadius = PAD_SIZE / 2;
		const nominalFaceRadius = face.artworkWidth / 2;
		const nominalPrimaryRadius = Math.max(PAD_SIZE, face.artworkHeight) / 2;
		const nominalHalfWidth = SHOULDER_THICKNESS / 2;
		const nominalLeftRing = nominalPadRadius + CONTROL_GAP + nominalHalfWidth;
		const nominalRightRing = nominalFaceRadius + CONTROL_GAP + nominalHalfWidth;
		const nominalTopReach = Math.sqrt(nominalRightRing * nominalRightRing
			- (nominalHalfWidth + CONTROL_GAP / 2) * (nominalHalfWidth + CONTROL_GAP / 2)) + nominalHalfWidth;
		const nominalPairSpacing = STICK_CLICK_SIZE / 2 + MENU_SIZE / 2 + CONTROL_GAP;
		// Retain the established authored thumb-size calibration while changing
		// shoulder roles and edge placement; minimum shoulder targets never
		// silently shrink the primary banks to fit an ornamental outer ring.
		const landscapeWidth = 32 + nominalPadRadius + nominalFaceRadius
			+ nominalLeftRing + nominalRightRing + nominalHalfWidth * 2 + CONTROL_GAP;
		const landscapeHeight = 32 + nominalTopReach + nominalPrimaryRadius;
		// A circular-tube top bound gives a finite portrait deck height even when
		// menu targets retain their minimum scale below the primary width scale.
		const portraitPrimaryHeight = nominalRightRing + nominalHalfWidth + nominalPrimaryRadius + 32;
		const portraitHeightScale = height >= (portraitPrimaryHeight + MENU_SIZE) * 0.85
			? height / (portraitPrimaryHeight + MENU_SIZE)
			: (height - MENU_SIZE * 0.85) / portraitPrimaryHeight;
		metrics.width = width;
		metrics.height = height;
		metrics.landscape = width >= height;
		metrics.scale = metrics.landscape
			? Math.min(1.1, width / landscapeWidth, height / landscapeHeight)
			: Math.min(1.1, (width - CONTROL_GAP * 3) / (PAD_SIZE + face.artworkWidth), portraitHeightScale);
		const scale = metrics.scale;
		metrics.margin = CONTROL_MARGIN;
		metrics.bottom = 16 * scale;
		metrics.gap = CONTROL_GAP * scale;
		metrics.menuScale = metrics.landscape ? scale : Math.max(0.85, scale);
		metrics.menuSize = MENU_SIZE * metrics.menuScale;
		metrics.clickSize = STICK_CLICK_SIZE * metrics.menuScale;
		metrics.padRadius = nominalPadRadius * scale;
		metrics.faceRadius = nominalFaceRadius * scale;
		metrics.primaryRadius = nominalPrimaryRadius * scale;
		metrics.halfWidth = Math.max(MIN_GAMEPLAY_SHOULDER_THICKNESS / 2, nominalHalfWidth * scale);
		metrics.leftRing = metrics.padRadius + metrics.gap + metrics.halfWidth;
		metrics.rightRing = metrics.faceRadius + metrics.gap + metrics.halfWidth;
		const halfWidth = metrics.halfWidth;
		const halfLane = (width - metrics.margin * 2 - metrics.padRadius - metrics.faceRadius - metrics.gap) / 2;
		const inwardSine = Math.sin(SHOULDER_INWARD_SWEEP);
		metrics.leftInner = Math.asin((Math.min(halfLane, metrics.leftRing * inwardSine + halfWidth) - halfWidth) / metrics.leftRing);
		metrics.rightInner = Math.asin((Math.min(halfLane, metrics.rightRing * inwardSine + halfWidth) - halfWidth) / metrics.rightRing);
		metrics.leftGap = Math.asin((halfWidth + metrics.gap / 2) / metrics.leftRing);
		metrics.rightGap = Math.asin((halfWidth + metrics.gap / 2) / metrics.rightRing);
		// The finite outer caps consume only the available primary edge gutter,
		// including the actual 3px SVG bezel. Shift the seam inward so the
		// outer bumper has a broader usable arc without moving either hand bank.
		metrics.leftOuter = Math.asin((metrics.padRadius + metrics.margin - SHOULDER_PAINT_RADIUS - halfWidth) / metrics.leftRing);
		metrics.rightOuter = Math.asin((metrics.faceRadius + metrics.margin - SHOULDER_PAINT_RADIUS - halfWidth) / metrics.rightRing);
		metrics.leftSplit = (metrics.leftInner - metrics.leftOuter) / 2 + BUMPER_SWEEP_ADVANTAGE;
		metrics.rightSplit = (metrics.rightInner - metrics.rightOuter) / 2 + BUMPER_SWEEP_ADVANTAGE;
		metrics.topReach = Math.max(metrics.leftRing * Math.cos(Math.max(0, metrics.leftGap - Math.abs(metrics.leftSplit))),
			metrics.rightRing * Math.cos(Math.max(0, metrics.rightGap - Math.abs(metrics.rightSplit)))) + halfWidth;
		const pairHalf = nominalPairSpacing * metrics.menuScale / 2;
		const menuRadius = metrics.menuSize / 2;
		const a = this.nominalActions[0];
		metrics.utilityDrop = Math.max(Math.sqrt((metrics.padRadius + menuRadius + metrics.gap) ** 2 - pairHalf ** 2),
			(a.y - face.artworkHeight / 2) * scale + Math.sqrt((a.radius * scale + menuRadius + metrics.gap) ** 2 - pairHalf ** 2));
		metrics.portraitShoulderWidth = Math.min(PORTRAIT_SHOULDER_WIDTH, (width - CONTROL_MARGIN * 2 - CONTROL_GAP * 3) / 4);
		metrics.portraitShoulderHalfAngle = Math.asin((metrics.portraitShoulderWidth / 2 - halfWidth) / PORTRAIT_SHOULDER_RADIUS);
		const stripHeight = halfWidth * 2 + PORTRAIT_SHOULDER_RADIUS * (1 - Math.cos(metrics.portraitShoulderHalfAngle));
		metrics.portraitTopReach = stripHeight + PORTRAIT_SHOULDER_PRIMARY_GAP + metrics.primaryRadius;
		metrics.portraitDeckHeight = metrics.portraitTopReach + metrics.utilityDrop + metrics.menuSize / 2 + metrics.bottom;
		return metrics;
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
