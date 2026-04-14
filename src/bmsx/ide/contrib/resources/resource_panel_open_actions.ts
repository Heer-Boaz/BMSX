import type { ResourceBrowserItem } from '../../core/types';
import * as constants from '../../core/constants';
import { focusEditorFromResourcePanel, openResourceDescriptor, focusChunkSource } from '../../ui/editor_tabs';
import { applyDefinitionSelection } from '../intellisense/intellisense';

export function tryOpenResourcePanelDescriptorItem(item: ResourceBrowserItem): boolean {
	if (!item?.descriptor) {
		return false;
	}
	if (item.descriptor.type === 'atlas') {
		return false;
	}
	openResourceDescriptor(item.descriptor);
	focusEditorFromResourcePanel();
	return true;
}

export function openResourcePanelCallHierarchyLocation(item: ResourceBrowserItem): void {
	if (!item?.location) {
		return;
	}
	focusChunkSource(item.location.path);
	applyDefinitionSelection(item.location.range);
	focusEditorFromResourcePanel();
}

export function getResourcePanelAtlasWarningMessage(): { text: string; color: number; duration: number } {
	return {
		text: 'Atlas resources cannot be previewed in the IDE.',
		color: constants.COLOR_STATUS_WARNING,
		duration: 3.2,
	};
}
