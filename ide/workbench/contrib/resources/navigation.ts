import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { CartEditor } from '../../../cart_editor';
import type { RuntimeResource } from '../../../common/models';
import type { ResourceDomain, ResourceIdentity } from '../../../common/resource';
import {
	activateNavigationEntryContext,
	applyNavigationEntryPosition,
	completeNavigationHistoryJump,
	takeBackwardNavigationEntry,
	takeForwardNavigationEntry,
	withNavigationCaptureSuspended,
	type NavigationHistoryEntry,
} from '../../../navigation/navigation_history';
import { prepareEditorForSourceFocus, releaseResourcePanelFocus } from '../../../navigation/source_focus';
import {
	resolveRuntimeResource,
	resolveRuntimeResourceForContext,
	type RuntimeSourceState,
} from '../../../runtime/sources';
import { openCodeTabForResource } from '../../ui/code_tab/io';
import type { ResourcePanelController } from './panel/controller';
import { openResourceViewerTab } from './view_tabs';

export class EditorNavigationController {
	public constructor(
		private readonly editor: CartEditor,
		private readonly sources: RuntimeSourceState,
		private readonly resourcePanel: ResourcePanelController,
		private readonly storage: KeyValueStorage,
	) {
	}

	public openResource(resource: RuntimeResource): void {
		this.resourcePanel.queuePendingSelection(resource);
		if (this.resourcePanel.isVisible()) {
			this.resourcePanel.applyPendingSelection();
		}
		if (resource.source.type === 'lua' || resource.source.type === 'aem') {
			void openCodeTabForResource(this.storage, this.editor, this.sources, resource);
		} else {
			openResourceViewerTab(this.resourcePanel, this.sources, resource);
		}
		releaseResourcePanelFocus(this.resourcePanel);
	}

	public focusChunkSource(identity: ResourceIdentity): void {
		prepareEditorForSourceFocus();
		if (!identity.path) {
			return;
		}
		const resource = resolveRuntimeResource(this.sources, identity);
		if (!resource) {
			return;
		}
		this.openResource(resource);
	}

	public focusChunkSourceForContext(
		domain: ResourceDomain,
		path: string,
	): ResourceIdentity | null {
		const resource = resolveRuntimeResourceForContext(this.sources, domain, path);
		if (!resource) {
			return null;
		}
		this.focusChunkSource(resource);
		return resource;
	}

	public goBackward(): void {
		const target = takeBackwardNavigationEntry();
		if (!target) {
			return;
		}
		this.openHistoryEntry(target);
	}

	public goForward(): void {
		const target = takeForwardNavigationEntry();
		if (!target) {
			return;
		}
		this.openHistoryEntry(target);
	}

	private openHistoryEntry(target: NavigationHistoryEntry): void {
		withNavigationCaptureSuspended(() => {
			if (!activateNavigationEntryContext(this.resourcePanel, target)) {
				this.focusChunkSource(target);
				activateNavigationEntryContext(this.resourcePanel, target);
			}
			applyNavigationEntryPosition(this.resourcePanel, target);
		});
		completeNavigationHistoryJump(target);
	}
}
