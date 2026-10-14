export type OnscreenGamepadLayoutProfile = 'phone-portrait' | 'wide-portrait' | 'landscape' | 'compact-overlay';

export const CONTROL_GAP = 12;
export const PAD_SIZE = 180;
export const MENU_SIZE = 52;
export const STICK_CLICK_SIZE = 44;
export const PAINT_CLEARANCE = 4;
export const PORTRAIT_SHOULDER_RADIUS = 100;
const WIDE_PORTRAIT_WIDTH = 600;
const SHOULDER_THICKNESS = 56;
const MIN_SHOULDER_THICKNESS = 44;
const SHOULDER_INWARD_SWEEP = Math.PI / 3;
const BUMPER_SWEEP_ADVANTAGE = 2 * Math.PI / 180;
const SHOULDER_PAINT_RADIUS = 1.5;
const CONTROL_MARGIN = 4;
const PHONE_FACE_RISE = 24;
const PHONE_MENU_SIZE = 48;
const PHONE_SHOULDER_PRIMARY_GAP = 24;
// A reserved deck must leave at least a half-width 4:3 picture. Near-square
// embedded players instead use the same full-frame overlay as landscape.
const MIN_PORTRAIT_PICTURE_HEIGHT_PER_WIDTH = 3 / 8;

/** Retained numerical measure shared by video composition and controller artwork. */
export class OnscreenGamepadLayout {
	public width = -1;
	public height = -1;
	public profile: OnscreenGamepadLayoutProfile = 'landscape';
	public scale = 1;
	public padSize = 0;
	public faceScale = 1;
	public faceRise = 0;
	public margin = CONTROL_MARGIN;
	public bottom = 0;
	public gap = 0;
	public menuSize = 0;
	public clickSize = 0;
	public padRadius = 0;
	public faceRadius = 0;
	public primaryRadius = 0;
	public halfWidth = 0;
	public leftRing = 0;
	public rightRing = 0;
	public leftOuter = 0;
	public rightOuter = 0;
	public leftInner = 0;
	public rightInner = 0;
	public leftSplit = 0;
	public rightSplit = 0;
	public utilityDrop = 0;
	public leftGap = 0;
	public rightGap = 0;
	public topReach = 0;
	public leftShoulderWidth = 0;
	public rightShoulderWidth = 0;
	public leftShoulderHalfAngle = 0;
	public rightShoulderHalfAngle = 0;
	public portraitTopReach = 0;
	public portraitDeckHeight = 0;

	public constructor(
		private readonly faceWidth: number,
		private readonly faceHeight: number,
		private readonly bottomButtonY: number,
		private readonly bottomButtonRadius: number,
	) {}

	public measure(width: number, height: number): this {
		if (this.width === width && this.height === height) return this;
		this.width = width;
		this.height = height;
		this.profile = width >= height ? 'landscape' : width < WIDE_PORTRAIT_WIDTH ? 'phone-portrait' : 'wide-portrait';
		// PPSSPP and Delta author orientation/device-family layouts, rather than
		// fitting a landscape controller into a phone with one global scale:
		// https://github.com/hrydgard/ppsspp/blob/61e60ee6ff650e6fa2ff9b0019bc9fbb652d7fcb/UI/GamepadEmu.cpp#L842-L965
		// https://github.com/rileytestut/SNESDeltaCore/blob/ed3a432616bfabaa376c554f7d352958e5bfb13b/SNESDeltaCore/Controller%20Skin/info.json#L343-L673
		if (this.profile === 'phone-portrait') this.measurePhone();
		else this.measureRing();
		if (this.profile !== 'landscape'
			&& height < this.portraitDeckHeight + width * MIN_PORTRAIT_PICTURE_HEIGHT_PER_WIDTH + CONTROL_GAP) {
			if (this.profile === 'phone-portrait') this.measureRing();
			this.profile = 'compact-overlay';
		}
		if (this.profile === 'landscape' || this.profile === 'compact-overlay') this.portraitDeckHeight = 0;
		return this;
	}

	/** Fixed phone targets and staggered thumb banks, composed below the picture. */
	private measurePhone(): void {
		const width = this.width;
		// A thumb-sized D-pad gets its own width budget; the equal face keys
		// share the remaining lane. Neither grows with the height of a phone.
		this.padSize = Math.min(PAD_SIZE, (width - 32) / 2);
		this.faceScale = Math.min(1, (width - this.padSize - CONTROL_MARGIN * 2 - CONTROL_GAP) / this.faceWidth);
		this.scale = this.faceScale;
		this.faceRise = PHONE_FACE_RISE;
		this.menuSize = PHONE_MENU_SIZE;
		this.clickSize = STICK_CLICK_SIZE;
		this.gap = CONTROL_GAP;
		this.halfWidth = MIN_SHOULDER_THICKNESS / 2;
		this.bottom = 16;
		this.measureHandClearances();
		// Each shoulder pair belongs to its hand lane. The right hand sits a
		// little higher, so these are not an artificial four-button toolbar.
		this.leftShoulderWidth = (this.padSize - CONTROL_GAP) / 2;
		this.rightShoulderWidth = (this.faceWidth * this.faceScale - CONTROL_GAP) / 2;
		this.leftShoulderHalfAngle = Math.asin((this.leftShoulderWidth / 2 - this.halfWidth) / PORTRAIT_SHOULDER_RADIUS);
		this.rightShoulderHalfAngle = Math.asin((this.rightShoulderWidth / 2 - this.halfWidth) / PORTRAIT_SHOULDER_RADIUS);
		const stripHeight = this.halfWidth * 2 + PORTRAIT_SHOULDER_RADIUS * (1 - Math.cos(this.rightShoulderHalfAngle));
		this.portraitTopReach = this.faceRise + stripHeight + PHONE_SHOULDER_PRIMARY_GAP + this.faceHeight * this.faceScale / 2;
		this.portraitDeckHeight = this.portraitTopReach + this.utilityDrop + this.menuSize / 2 + this.bottom;
	}

	/** Wrapping shoulders with aligned hands for wide decks and overlay players. */
	private measureRing(): void {
		const width = this.width;
		const height = this.height;
		const padRadius = PAD_SIZE / 2;
		const faceRadius = this.faceWidth / 2;
		const halfWidth = SHOULDER_THICKNESS / 2;
		const leftRing = padRadius + CONTROL_GAP + halfWidth;
		const rightRing = faceRadius + CONTROL_GAP + halfWidth;
		const topReach = Math.sqrt(rightRing ** 2 - (halfWidth + CONTROL_GAP / 2) ** 2) + halfWidth;
		const fullWidth = 32 + padRadius + faceRadius + leftRing + rightRing + halfWidth * 2 + CONTROL_GAP;
		const fullHeight = 32 + topReach + Math.max(PAD_SIZE, this.faceHeight) / 2;
		this.scale = Math.min(1.1, width / fullWidth, height / fullHeight);
		this.padSize = PAD_SIZE * this.scale;
		this.faceScale = this.scale;
		this.faceRise = 0;
		this.menuSize = MENU_SIZE * this.scale;
		this.clickSize = STICK_CLICK_SIZE * this.scale;
		this.gap = CONTROL_GAP * this.scale;
		this.halfWidth = Math.max(MIN_SHOULDER_THICKNESS / 2, halfWidth * this.scale);
		this.bottom = 16 * this.scale;
		this.measureHandClearances();
		this.leftRing = this.padRadius + this.gap + this.halfWidth;
		this.rightRing = this.faceRadius + this.gap + this.halfWidth;
		const halfLane = (width - this.margin * 2 - this.padRadius - this.faceRadius - this.gap) / 2;
		const inwardSine = Math.sin(SHOULDER_INWARD_SWEEP);
		this.leftInner = Math.asin((Math.min(halfLane, this.leftRing * inwardSine + this.halfWidth) - this.halfWidth) / this.leftRing);
		this.rightInner = Math.asin((Math.min(halfLane, this.rightRing * inwardSine + this.halfWidth) - this.halfWidth) / this.rightRing);
		this.leftGap = Math.asin((this.halfWidth + this.gap / 2) / this.leftRing);
		this.rightGap = Math.asin((this.halfWidth + this.gap / 2) / this.rightRing);
		this.leftOuter = Math.asin((this.padRadius + this.margin - SHOULDER_PAINT_RADIUS - this.halfWidth) / this.leftRing);
		this.rightOuter = Math.asin((this.faceRadius + this.margin - SHOULDER_PAINT_RADIUS - this.halfWidth) / this.rightRing);
		this.leftSplit = (this.leftInner - this.leftOuter) / 2 + BUMPER_SWEEP_ADVANTAGE;
		this.rightSplit = (this.rightInner - this.rightOuter) / 2 + BUMPER_SWEEP_ADVANTAGE;
		this.topReach = Math.max(this.leftRing * Math.cos(Math.max(0, this.leftGap - Math.abs(this.leftSplit))),
			this.rightRing * Math.cos(Math.max(0, this.rightGap - Math.abs(this.rightSplit)))) + this.halfWidth;
		this.portraitTopReach = this.topReach + PAINT_CLEARANCE;
		this.portraitDeckHeight = this.portraitTopReach + this.utilityDrop + this.menuSize / 2 + this.bottom;
	}

	/** Circle-to-circle utility clearance uses each authored bank's actual size. */
	private measureHandClearances(): void {
		this.padRadius = this.padSize / 2;
		this.faceRadius = this.faceWidth * this.faceScale / 2;
		this.primaryRadius = Math.max(this.padRadius, this.faceHeight * this.faceScale / 2);
		const pairHalf = (this.clickSize / 2 + this.menuSize / 2 + this.gap) / 2;
		const menuRadius = this.menuSize / 2;
		this.utilityDrop = Math.max(Math.sqrt((this.padRadius + menuRadius + this.gap) ** 2 - pairHalf ** 2),
			(this.bottomButtonY - this.faceHeight / 2) * this.faceScale - this.faceRise
				+ Math.sqrt((this.bottomButtonRadius * this.faceScale + menuRadius + this.gap) ** 2 - pairHalf ** 2));
	}
}
