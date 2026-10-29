import type { RectBounds } from '../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../common/models';
import type { EditorSourceLocationRequest } from '../../editor/navigation/source_location';
import type { EditorFont } from '../../editor/ui/view/font';
import type { InputFocusScope, InputFocusTarget } from '../../input/focus';

export type MainWorkspaceActivitySizeConstraints = { minimumHeight: number; preferredHeight: number };

/** A retained activity presentation; the container owns placement and native attachment. */
export interface MainWorkspaceActivityClient {
	readonly scope: InputFocusScope;
	readonly commandTarget: InputFocusTarget;
	readonly attached: boolean;
	readonly canOpenSource?: boolean;
	captureSourceLocation?(): EditorSourceLocationRequest | undefined;
	measure(font: EditorFont, width: number, target: MainWorkspaceActivitySizeConstraints): void;
	attach(bounds: Readonly<RectBounds>): void;
	layout(bounds: Readonly<RectBounds>): void;
	detach(): void;
	update(): void;
	draw(): void;
	drawStatusBar(bounds: Readonly<RectBounds>, color: number): void;
	focus(): void;
	handlePointer(snapshot: PointerInputSnapshot): void;
	handleWheel(event: WheelInputSnapshot): void;
}
