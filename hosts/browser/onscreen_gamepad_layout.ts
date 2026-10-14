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
		private readonly topButtonY: number,
		private readonly topButtonRadius: number,
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

	/** Aligned phone hands, upper utilities and lower shoulder fans below the picture. */
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
		this.measureHandClearances(this.faceHeight / 2 - this.topButtonY, this.topButtonRadius);
		this.measureShoulderRings();
		// Neo-Retropad's portrait places thumb-operated shoulders below the
		// primary banks. BMSX retains its own finite arcs and contact ownership:
		// https://github.com/libretro/common-overlays/blob/42c21b99889468a8e77fd7f002229ec16e2f9fa2/gamepads/neo-retropad/neo-retropad.cfg#L576-L609
		this.portraitTopReach = this.utilityReach + this.menuSize / 2;
		this.portraitDeckHeight = this.portraitTopReach + this.shoulderReach + this.bottom;
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
		this.menuSize = MENU_SIZE * this.scale;
		this.clickSize = STICK_CLICK_SIZE * this.scale;
		this.gap = CONTROL_GAP * this.scale;
		this.halfWidth = Math.max(MIN_SHOULDER_THICKNESS / 2, halfWidth * this.scale);
		this.bottom = 16 * this.scale;
		this.measureHandClearances(this.bottomButtonY - this.faceHeight / 2, this.bottomButtonRadius);
		this.measureShoulderRings();
		this.portraitTopReach = this.shoulderReach + PAINT_CLEARANCE;
		this.portraitDeckHeight = this.portraitTopReach + this.utilityReach + this.menuSize / 2 + this.bottom;
	}

	/** Both rim orientations share the same true arc, cap and hand-lane budgets. */
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

	/** Circle-to-circle utility clearance uses each authored bank's actual size. */
	private measureHandClearances(buttonOffset: number, buttonRadius: number): void {
		this.padRadius = this.padSize / 2;
		this.faceRadius = this.faceWidth * this.faceScale / 2;
		this.primaryRadius = Math.max(this.padRadius, this.faceHeight * this.faceScale / 2);
		const pairHalf = (this.clickSize / 2 + this.menuSize / 2 + this.gap) / 2;
		const menuRadius = this.menuSize / 2;
		this.utilityReach = Math.max(Math.sqrt((this.padRadius + menuRadius + this.gap) ** 2 - pairHalf ** 2),
			buttonOffset * this.faceScale + Math.sqrt((buttonRadius * this.faceScale + menuRadius + this.gap) ** 2 - pairHalf ** 2));
	}
}
