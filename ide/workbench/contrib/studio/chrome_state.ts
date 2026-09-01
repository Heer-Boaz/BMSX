import {
	createStudioChromeLayout,
	type StudioChromeLayout,
} from './chrome_layout';

export const enum StudioChromeTargetKind {
	None,
	Chrome,
	Play,
	Edit,
	Object,
	Component,
	PositionMinus,
	PositionPlus,
	Visible,
	ComponentEnabled,
}

export class StudioChromeTarget {
	public kind = StudioChromeTargetKind.None;
	public objectHandle = 0;
	public componentHandle = 0;
	public axis = 0;

	public clear(): void {
		this.kind = StudioChromeTargetKind.None;
		this.objectHandle = 0;
		this.componentHandle = 0;
		this.axis = 0;
	}

	public copyFrom(source: StudioChromeTarget): void {
		this.kind = source.kind;
		this.objectHandle = source.objectHandle;
		this.componentHandle = source.componentHandle;
		this.axis = source.axis;
	}

	public equals(other: StudioChromeTarget): boolean {
		return this.kind === other.kind
			&& this.objectHandle === other.objectHandle
			&& this.componentHandle === other.componentHandle
			&& this.axis === other.axis;
	}
}

export class StudioDetailsText {
	public kind = 0;
	public objectHandle = 0;
	public componentHandle = 0;
	public definitionTokenLo = 0;
	public definitionTokenHi = 0;
	public spaceTokenLo = 0;
	public spaceTokenHi = 0;
	public ownerHandle = 0;
	public classWord = 0;
	public localIdKind = 0;
	public localIdLo = 0;
	public localIdHi = 0;
	public xWord = 0;
	public yWord = 0;
	public zWord = 0;
	public flags = 0;
	public title = 'NO SELECTION';
	public line1 = '';
	public line2 = '';
	public line3 = '';
	public x = '';
	public y = '';
	public z = '';
	public toggle = '';
}

export class StudioChromeState {
	public readonly layout: StudioChromeLayout = createStudioChromeLayout();
	public readonly pointerPosition = { x: 0, y: 0 };
	public readonly hoverTarget = new StudioChromeTarget();
	public readonly capturedTarget = new StudioChromeTarget();
	public readonly details = new StudioDetailsText();
	public outlinerScroll = 0;
	public selectedObjectHandle = 0;
	public selectedComponentHandle = 0;
}
