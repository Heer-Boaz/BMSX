import type { RectBounds } from '../../../machine/ts/common/rect';
import type { PointerInputSnapshot, WheelInputSnapshot } from '../../common/models';
import type { EditorSourceLocationRequest } from '../../editor/navigation/source_location';
import type { EditorFont } from '../../editor/ui/view/font';
import type { InputFocusScope, InputFocusTarget } from '../../input/focus';
import type { WorkbenchStatusSource } from './status_bar';
import { WORKBENCH_ICON_SIZE } from '../ui/icon';
import type { EditorCommandId } from '../../common/commands';
import type { WorkbenchSurface } from '../services/windows/model';

export type MainWorkspaceActivitySizeConstraints = { minimumHeight: number; preferredHeight: number };
export type MainWorkspaceActivityDescriptor = { readonly id: string; readonly command: EditorCommandId };
export type MainWorkspaceActivityContext = {
	readonly surface: WorkbenchSurface;
	readonly scope: InputFocusScope;
	readonly focusReturn: InputFocusTarget;
};

/** Selector, client controls and body share one font-derived header row. */
export function mainWorkspaceActivityHeaderHeight(font: EditorFont): number {
	return Math.max(font.lineHeight + 4, WORKBENCH_ICON_SIZE + 5);
}

/** A retained activity presentation; the container owns placement and native attachment. */
export interface MainWorkspaceActivityClient extends WorkbenchStatusSource {
	readonly scope: InputFocusScope;
	readonly commandTarget: InputFocusTarget;
	readonly attached: boolean;
	readonly canOpenSource?: boolean;
	captureSourceLocation?(): EditorSourceLocationRequest | undefined;
	measure(font: EditorFont, width: number, target: MainWorkspaceActivitySizeConstraints): void;
	attach(bounds: Readonly<RectBounds>, headerBounds: Readonly<RectBounds>): void;
	layout(bounds: Readonly<RectBounds>, headerBounds: Readonly<RectBounds>): void;
	detach(): void;
	dispose(): void;
	update(): void;
	draw(): void;
	focus(): void;
	handlePointer(snapshot: PointerInputSnapshot): void;
	handleWheel(event: WheelInputSnapshot): void;
}
