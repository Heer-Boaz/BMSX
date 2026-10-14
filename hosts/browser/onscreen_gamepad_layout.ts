export type OnscreenGamepadLayoutProfile = 'phone-portrait' | 'wide-portrait' | 'landscape' | 'compact-overlay';

export const CONTROL_GAP = 12;
export const PAD_SIZE = 180;
export const MENU_SIZE = 52;
export const STICK_CLICK_SIZE = 44;
export const PAINT_CLEARANCE = 4;
const WIDE_PORTRAIT_WIDTH = 600;
const SHOULDER_THICKNESS = 56;
const MIN_SHOULDER_THICKNESS = 44;
const SHOULDER_INWARD_SWEEP = Math.PI / 3;
const BUMPER_SWEEP_ADVANTAGE = 2 * Math.PI / 180;
const SHOULDER_PAINT_RADIUS = 1.5;
const CONTROL_MARGIN = 4;
const PHONE_MENU_SIZE = 48;
// Six footer targets (44/44/48 per hand), two 4px edges and five 4px gaps.
const MIN_PHONE_WIDTH = 300;
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
	public margin = CONTROL_MARGIN;
	public bottom = 0;
	public gap = 0;
	public menuSize = 0;
	public clickSize = 0;
	public hostSize = 0;
	public utilityGap = 0;
	public leftHostX = 0;
	public leftClickX = 0;
	public selectX = 0;
	public startX = 0;
	public rightClickX = 0;
	public rightHostX = 0;
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
	public utilityReach = 0;
	public leftGap = 0;
	public rightGap = 0;
	public shoulderReach = 0;
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
		this.profile = width >= height ? 'landscape' : width < MIN_PHONE_WIDTH ? 'compact-overlay'
			: width < WIDE_PORTRAIT_WIDTH ? 'phone-portrait' : 'wide-portrait';
		// Lemuroid's complete PSX controller keeps the same upper radial shoulder
		// pairs in separately composed portrait and landscape hand banks:
		// https://github.com/Swordfish90/Lemuroid/blob/93e321d08f3dc0776bb0545da975d2cd7cd1f78f/lemuroid-touchinput/src/main/java/com/swordfish/touchinput/radial/layouts/shared/Controls.kt#L25-L63
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

	/** Aligned phone hands with upper shoulder pairs and a single utility footer. */
	private measurePhone(): void {
		const width = this.width;
		// A thumb-sized D-pad gets its own width budget; the equal face keys
		// share the remaining lane. Neither grows with the height of a phone.
		this.padSize = Math.min(PAD_SIZE, (width - 32) / 2);
		this.faceScale = Math.min(1, (width - this.padSize - CONTROL_MARGIN * 2 - CONTROL_GAP) / this.faceWidth);
		this.scale = this.faceScale;
		this.menuSize = PHONE_MENU_SIZE;
		this.clickSize = STICK_CLICK_SIZE;
		this.gap = CONTROL_GAP;
		this.halfWidth = MIN_SHOULDER_THICKNESS / 2;
		this.bottom = 16;
		this.measureHandClearances();
		this.measureShoulderRings();
		this.portraitTopReach = this.shoulderReach + PAINT_CLEARANCE;
		this.portraitDeckHeight = this.portraitTopReach + this.utilityReach + this.menuSize / 2 + this.bottom;
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
		const fullWidth = 32 + padRadius + faceRadius + leftRing + rightRing + halfWidth * 2 + CONTROL_GAP;
		const menuRadius = MENU_SIZE / 2;
		const utilityReach = Math.max(padRadius + menuRadius + CONTROL_GAP,
			this.bottomButtonY - this.faceHeight / 2 + this.bottomButtonRadius + menuRadius + CONTROL_GAP);
		// PadKit measures the complete primary/secondary footprint before choosing
		// its scale; BMSX additionally retains a fixed minimum shoulder thickness:
		// https://github.com/Swordfish90/PadKit/blob/99b5753818d7c8bf2398b7791bfa00b8909908b1/lib/src/commonMain/kotlin/gg/padkit/layouts/radial/LayoutRadial.kt#L75-L109
		// Budget the complete upper ring and footer before arranging either hand.
		// The vertical envelope is linear except for the shoulder's 44px minimum:
		// available >= scale * verticalReach + max(44, scale * 56).
		const verticalReach = Math.max(padRadius, faceRadius) + CONTROL_GAP + utilityReach + menuRadius;
		const availableHeight = height - PAINT_CLEARANCE * 2;
		this.scale = Math.min(1.1, width / fullWidth,
			availableHeight / (verticalReach + SHOULDER_THICKNESS),
			(availableHeight - MIN_SHOULDER_THICKNESS) / verticalReach);
		this.padSize = PAD_SIZE * this.scale;
		this.faceScale = this.scale;
		this.menuSize = MENU_SIZE * this.scale;
		this.clickSize = STICK_CLICK_SIZE * this.scale;
		this.gap = CONTROL_GAP * this.scale;
		this.halfWidth = Math.max(MIN_SHOULDER_THICKNESS / 2, halfWidth * this.scale);
		this.bottom = 16 * this.scale;
		this.measureHandClearances();
		this.measureShoulderRings();
		this.portraitTopReach = this.shoulderReach + PAINT_CLEARANCE;
		this.portraitDeckHeight = this.portraitTopReach + this.utilityReach + this.menuSize / 2 + this.bottom;
	}

	/** Both hand banks share the same true arc, cap and hand-lane budgets. */
	private measureShoulderRings(): void {
		this.leftRing = this.padRadius + this.gap + this.halfWidth;
		this.rightRing = this.faceRadius + this.gap + this.halfWidth;
		const halfLane = (this.width - this.margin * 2 - this.padRadius - this.faceRadius - this.gap) / 2;
		const inwardSine = Math.sin(SHOULDER_INWARD_SWEEP);
		this.leftInner = Math.asin((Math.min(halfLane, this.leftRing * inwardSine + this.halfWidth) - this.halfWidth) / this.leftRing);
		this.rightInner = Math.asin((Math.min(halfLane, this.rightRing * inwardSine + this.halfWidth) - this.halfWidth) / this.rightRing);
		this.leftGap = Math.asin((this.halfWidth + this.gap / 2) / this.leftRing);
		this.rightGap = Math.asin((this.halfWidth + this.gap / 2) / this.rightRing);
		this.leftOuter = Math.asin((this.padRadius + this.margin - SHOULDER_PAINT_RADIUS - this.halfWidth) / this.leftRing);
		this.rightOuter = Math.asin((this.faceRadius + this.margin - SHOULDER_PAINT_RADIUS - this.halfWidth) / this.rightRing);
		this.leftSplit = (this.leftInner - this.leftOuter) / 2 + BUMPER_SWEEP_ADVANTAGE;
		this.rightSplit = (this.rightInner - this.rightOuter) / 2 + BUMPER_SWEEP_ADVANTAGE;
		this.shoulderReach = Math.max(this.leftRing * Math.cos(Math.max(0, this.leftGap - Math.abs(this.leftSplit))),
			this.rightRing * Math.cos(Math.max(0, this.rightGap - Math.abs(this.rightSplit)))) + this.halfWidth;
	}

	/** One footer per hand: host action, stick click and menu key, all with true circle clearance. */
	private measureHandClearances(): void {
		this.padRadius = this.padSize / 2;
		this.faceRadius = this.faceWidth * this.faceScale / 2;
		this.primaryRadius = Math.max(this.padRadius, this.faceHeight * this.faceScale / 2);
		this.hostSize = this.clickSize;
		this.utilityGap = Math.min(this.gap,
			(this.width - this.margin * 2 - 2 * (this.hostSize + this.clickSize + this.menuSize)) / 5);
		const hostRadius = this.hostSize / 2;
		const clickRadius = this.clickSize / 2;
		const menuRadius = this.menuSize / 2;
		this.leftHostX = this.margin + hostRadius;
		this.leftClickX = this.leftHostX + hostRadius + this.utilityGap + clickRadius;
		this.selectX = this.leftClickX + clickRadius + this.utilityGap + menuRadius;
		this.rightHostX = this.width - this.leftHostX;
		this.rightClickX = this.width - this.leftClickX;
		this.startX = this.width - this.selectX;
		const padX = this.margin + this.padRadius;
		const faceX = this.width - this.margin - this.faceRadius;
		const buttonOffset = (this.bottomButtonY - this.faceHeight / 2) * this.faceScale;
		const buttonRadius = this.bottomButtonRadius * this.faceScale;
		this.utilityReach = 0;
		for (let index = 0; index < 3; index += 1) {
			const radius = index === 0 ? hostRadius : index === 1 ? clickRadius : menuRadius;
			const leftX = index === 0 ? this.leftHostX : index === 1 ? this.leftClickX : this.selectX;
			const rightX = this.width - leftX;
			this.utilityReach = Math.max(this.utilityReach,
				Math.sqrt(Math.max(0, (this.padRadius + radius + this.gap) ** 2 - (leftX - padX) ** 2)),
				buttonOffset + Math.sqrt(Math.max(0, (buttonRadius + radius + this.gap) ** 2 - (rightX - faceX) ** 2)));
		}
	}
}
