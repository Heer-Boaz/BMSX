import { inputFocus } from '../../../input/focus';
import type { RuntimeResource } from '../../../common/models';
import type { ResourceDomain, ResourceIdentity } from '../../../common/resource';
import {
	createNavigationEntry,
	takeBackwardNavigationEntry,
	takeForwardNavigationEntry,
	withNavigationCaptureSuspended,
	type NavigationHistoryEntry,
} from '../../../navigation/navigation_history';
import {
	resolveRuntimeResource,
	resolveRuntimeResourceForContext,
	type RuntimeSourceState,
} from '../../../runtime/sources';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { ResourcePanelController } from './panel/controller';
import type { ResourceEditorResolver } from '../../services/editor/resource_editor_resolver';
import type { EditorGroupView } from '../../services/editor/editor_group';

export class EditorNavigationController {
	public constructor(
		private readonly sources: RuntimeSourceState,
		private readonly resourcePanel: ResourcePanelController,
		private readonly editorResolver: ResourceEditorResolver,
		private readonly group: EditorGroupView,
	) {
	}

	/** The attached generation, or undefined when another opening superseded this request. */
	public async openResource(resource: RuntimeResource, selection?: EditorTextSelection): Promise<number | undefined> {
		const result = await this.group.openResolvedEditor(this.editorResolver.resolveEditorInput(resource), { selection });
		if (result === undefined) return undefined;
		if (!result.activated) return result.generation;
		this.resourcePanel.queuePendingSelection(resource);
		if (this.resourcePanel.isVisible()) {
			this.resourcePanel.applyPendingSelection();
		}
		this.resourcePanel.focusTarget.release();
		return result.generation;
	}

	public focusChunkSource(identity: ResourceIdentity, selection?: EditorTextSelection): Promise<number | undefined> {
		return this.openResource(resolveRuntimeResource(this.sources, identity)!, selection);
	}

	public focusChunkSourceForContext(
		domain: ResourceDomain,
		path: string,
		selection?: EditorTextSelection,
	): void {
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
		const group = target.owner;
		const generation = group.panes.beginOpen();
		const activation = inputFocus.revision;
		let preserveFocus = false;
		try {
			const destination = target.target;
			if (destination.kind === 'input') {
				withNavigationCaptureSuspended(() => {
					// This live destination already belongs to the group. History does
					// not turn a surviving preview into an explicit Keep Open request.
					group.activate(destination.input.id, undefined, target.selection);
				});
			} else {
				const input = await this.editorResolver.resolveEditorInput(resolveRuntimeResource(this.sources, destination.resource)!, destination.editorId);
				if (generation !== group.panes.openGeneration || target.isDisposed) {
					input.dispose();
					return;
				}
				preserveFocus = activation !== inputFocus.revision;
				withNavigationCaptureSuspended(() => {
					group.openEditor(input, { pinned: false, navigationSelection: target.selection,
					preserveFocus });
				});
			}
			if (!preserveFocus) this.resourcePanel.focusTarget.release();
		} finally {
			target.dispose();
		}
	}
}
