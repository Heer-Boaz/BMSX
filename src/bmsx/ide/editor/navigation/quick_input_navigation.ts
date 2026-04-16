import { clamp } from '../../../common/clamp';

export function advanceQuickInputSelection(currentIndex: number, itemCount: number, delta: number): number {
	if (itemCount <= 0) {
		return -1;
	}
	if (currentIndex === -1) {
		return delta > 0 ? 0 : itemCount - 1;
	}
	return clamp(currentIndex + delta, 0, itemCount - 1);
}

export function clampQuickInputDisplayOffset(selectionIndex: number, displayOffset: number, itemCount: number, windowSize: number): number {
	if (selectionIndex < 0) {
		return 0;
	}
	let nextOffset = displayOffset;
	if (selectionIndex < nextOffset) {
		nextOffset = selectionIndex;
	}
	if (selectionIndex >= nextOffset + windowSize) {
		nextOffset = selectionIndex - windowSize + 1;
	}
	if (nextOffset < 0) {
		nextOffset = 0;
	}
	const maxOffset = Math.max(0, itemCount - windowSize);
	if (nextOffset > maxOffset) {
		nextOffset = maxOffset;
	}
	return nextOffset;
}
