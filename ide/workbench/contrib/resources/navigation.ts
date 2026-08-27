import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { CartEditor } from '../../../cart_editor';
import type { RuntimeResource } from '../../../common/models';
import type { ResourceDomain, ResourceIdentity } from '../../../common/resource';
import {
	createNavigationEntry,
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
import type { CodeTabSelection } from '../../ui/code_tab/activation';
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

	public async openResource(resource: RuntimeResource, selection?: CodeTabSelection): Promise<void> {
		this.resourcePanel.queuePendingSelection(resource);
		if (this.resourcePanel.isVisible()) {
			this.resourcePanel.applyPendingSelection();
		}
		if (resource.source.type === 'lua' || resource.source.type === 'aem') {
			const opened = openCodeTabForResource(
				this.storage,
				this.editor,
				this.sources,
				resource,
				selection,
			);
			releaseResourcePanelFocus(this.resourcePanel);
			await opened;
			return;
		}
		openResourceViewerTab(this.resourcePanel, this.sources, resource);
		releaseResourcePanelFocus(this.resourcePanel);
	}

	public focusChunkSource(identity: ResourceIdentity, selection?: CodeTabSelection): void {
		prepareEditorForSourceFocus();
		if (!identity.path) {
			return;
		}
		const resource = resolveRuntimeResource(this.sources, identity);
		if (!resource) {
			return;
		}
		void this.openResource(resource, selection);
	}

	public focusChunkSourceForContext(
		domain: ResourceDomain,
		path: string,
		selection?: CodeTabSelection,
	): void {
		prepareEditorForSourceFocus();
		const resource = resolveRuntimeResourceForContext(this.sources, domain, path)!;
		void this.openResource(resource, selection);
	}

	public async goBackward(): Promise<void> {
		const target = takeBackwardNavigationEntry(createNavigationEntry());
		if (!target) {
			return;
		}
		await this.openHistoryEntry(target);
	}

	public async goForward(): Promise<void> {
		const target = takeForwardNavigationEntry(createNavigationEntry());
		if (!target) {
			return;
		}
		await this.openHistoryEntry(target);
	}

	private async openHistoryEntry(target: NavigationHistoryEntry): Promise<void> {
		await withNavigationCaptureSuspended(async () => {
			const resource = resolveRuntimeResource(this.sources, target)!;
			await this.openResource(resource, {
				row: target.row,
				startColumn: target.column,
				endColumn: target.column,
			});
		});
	}
}
