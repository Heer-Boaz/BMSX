import { clamp } from '../../../../../machine/ts/common/clamp';

export function resourcePanelIndexAtRelativeY(scroll: number, relativeY: number, lineHeight: number, itemCount: number): number {
	const index = (scroll | 0) + ((relativeY / lineHeight) | 0);
	return index >= 0 && index < itemCount ? index : -1;
}

export function clampResourcePanelSelectionIndex(index: number, itemCount: number): number {
	return clamp(index, -1, itemCount - 1);
}

export function ensureResourcePanelSelectionScroll(selectionIndex: number, scroll: number, capacity: number, itemCount: number): number {
	const scrollLimit = itemCount - capacity;
	const maxScroll = scrollLimit > 0 ? scrollLimit : 0;
	const currentScroll = clamp(scroll, 0, maxScroll);
	if (selectionIndex < 0) {
		return currentScroll;
	}
	if (selectionIndex < (currentScroll | 0)) {
		return selectionIndex;
	}
	const overflow = selectionIndex - ((currentScroll | 0) + capacity - 1);
	if (overflow <= 0) {
		return currentScroll;
	}
	const requestedScroll = currentScroll + overflow;
	return requestedScroll < maxScroll ? requestedScroll : maxScroll;
}
