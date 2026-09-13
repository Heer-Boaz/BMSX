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
import { openEditorTab, setActiveTab } from '../../ui/tabs';
import type { EditorPanes } from '../../services/editor/editor_panes';
import { editorTabGroup } from '../../ui/tab/group_model';

export class EditorNavigationController {
	public constructor(
		private readonly sources: RuntimeSourceState,
		private readonly resourcePanel: ResourcePanelController,
		private readonly editorResolver: ResourceEditorResolver,
		private readonly editorPanes: EditorPanes,
	) {
	}

	/** The attached generation, or undefined when another opening superseded this request. */
	public async openResource(resource: RuntimeResource, selection?: EditorTextSelection): Promise<number | undefined> {
		const generation = this.editorPanes.beginOpen();
		const input = await this.editorResolver.resolveEditorInput(resource);
		if (generation !== this.editorPanes.openGeneration) {
			if (editorTabGroup.findById(input.id) !== input) input.dispose();
			return undefined;
		}
		this.resourcePanel.queuePendingSelection(resource);
		if (this.resourcePanel.isVisible()) {
			this.resourcePanel.applyPendingSelection();
		}
		openEditorTab(this.editorPanes, input, { selection });
		releaseResourcePanelFocus(this.resourcePanel);
		return this.editorPanes.openGeneration;
	}

	public focusChunkSource(identity: ResourceIdentity, selection?: EditorTextSelection): Promise<number | undefined> {
		prepareEditorForSourceFocus();
		return this.openResource(resolveRuntimeResource(this.sources, identity)!, selection);
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
		const generation = this.editorPanes.beginOpen();
		try {
			const destination = target.target;
			if (destination.kind === 'input') {
				withNavigationCaptureSuspended(() => {
					// This live destination already belongs to the group. History does
					// not turn a surviving preview into an explicit Keep Open request.
					setActiveTab(this.editorPanes, destination.input.id, undefined, target.selection);
				});
			} else {
				const input = await this.editorResolver.resolveEditorInput(resolveRuntimeResource(this.sources, destination.resource)!, destination.editorId);
				if (generation !== this.editorPanes.openGeneration) {
					if (editorTabGroup.findById(input.id) !== input) input.dispose();
					return;
				}
				withNavigationCaptureSuspended(() => {
					openEditorTab(this.editorPanes, input, { pinned: false, navigationSelection: target.selection });
				});
			}
			releaseResourcePanelFocus(this.resourcePanel);
		} finally {
			target.dispose();
		}
	}
}
