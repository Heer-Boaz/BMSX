import { mapDisplayPointToViewport, DisplayPointMappingResult } from '../../../machine/ts/render/video_output';
import type { PointerInputEvent, WheelInputEvent } from '../../../hosts/common/input/pointer_event';
import { editorViewState } from '../../editor/ui/view/state';
import type { PointerInputSnapshot, WheelInputSnapshot, PointerPosition, PointerSnapshot } from '../../common/models';
import type { EditorDisplay } from '../../common/viewport';

const mapped = { x: 0, y: 0 };

/** Project native client coordinates into the retained editor's logical viewport. */
export function projectEditorPointerEvent(display: EditorDisplay, event: PointerInputEvent, snapshot: PointerInputSnapshot): void {
	projectEditorPointerPosition(display, event.x, event.y, snapshot);
	snapshot.pressedButtons = event.buttons;
	snapshot.justPressedButtons = event.pressedButtons;
	snapshot.justReleasedButtons = event.releasedButtons;
	snapshot.modifiers = event.modifiers;
	snapshot.spaceDown = event.spaceDown;
}

export function projectEditorWheelEvent(display: EditorDisplay, event: WheelInputEvent, snapshot: WheelInputSnapshot): void {
	projectEditorPointerPosition(display, event.x, event.y, snapshot);
	snapshot.deltaX = event.deltaX;
	snapshot.deltaY = event.deltaY;
	snapshot.modifiers = event.modifiers;
}

function projectEditorPointerPosition(display: EditorDisplay, x: number, y: number, snapshot: PointerPosition): void {
	const result = mapDisplayPointToViewport(display.measureDisplay(), editorViewState.viewportWidth, editorViewState.viewportHeight, x, y, mapped);
	snapshot.viewportX = mapped.x;
	snapshot.viewportY = mapped.y;
	snapshot.insideViewport = result === DisplayPointMappingResult.Inside;
	snapshot.valid = result !== DisplayPointMappingResult.Invalid;
}

/** Copy the event producer's mutable record into a retained gesture latch. */
export function copyPointerSnapshot(target: PointerSnapshot, source: PointerSnapshot): void {
	target.viewportX = source.viewportX;
	target.viewportY = source.viewportY;
	target.insideViewport = source.insideViewport;
	target.valid = source.valid;
	target.pressedButtons = source.pressedButtons;
	target.justPressedButtons = source.justPressedButtons;
	target.justReleasedButtons = source.justReleasedButtons;
}

/** Retain event-time editing modifiers alongside the physical pointer occurrence. */
export function copyPointerInputSnapshot(target: PointerInputSnapshot, source: PointerInputSnapshot): void {
	copyPointerSnapshot(target, source);
	target.modifiers = source.modifiers;
	target.spaceDown = source.spaceDown;
}
