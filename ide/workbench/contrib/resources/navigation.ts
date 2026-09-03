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
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { ResourcePanelController } from './panel/controller';
import type { ResourceEditorResolver } from '../../services/editor/resource_editor_resolver';
import { setActiveTab } from '../../ui/tabs';

export class EditorNavigationController {
	public constructor(
		private readonly sources: RuntimeSourceState,
		private readonly resourcePanel: ResourcePanelController,
		private readonly editorResolver: ResourceEditorResolver,
	) {
	}

	public async openResource(resource: RuntimeResource, selection?: EditorTextSelection): Promise<void> {
		this.resourcePanel.queuePendingSelection(resource);
		if (this.resourcePanel.isVisible()) {
			this.resourcePanel.applyPendingSelection();
		}
		const input = await this.editorResolver.resolveEditorInput(resource);
		setActiveTab(this.resourcePanel, input.id, selection);
		releaseResourcePanelFocus(this.resourcePanel);
	}

	public focusChunkSource(identity: ResourceIdentity, selection?: EditorTextSelection): void {
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
		selection?: EditorTextSelection,
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
