import { inputFocus } from '../../../input/focus';
import type { RuntimeResource } from '../../../common/models';
import type { ResourceIdentity } from '../../../common/resource';
import {
	createNavigationEntry,
	selectNavigationHistoryEntry,
	withNavigationCaptureSuspended,
	type NavigationHistorySelection,
} from '../../../navigation/navigation_history';
import {
	type WorkspaceSourceCatalog,
} from '../../../workspace/source_catalog';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import type { ResourcePanelController } from './panel/controller';
import type { ResourceEditorResolver } from '../../services/editor/resource_editor_resolver';
import type { EditorGroupView } from '../../services/editor/editor_group';
import { WORKBENCH_TEXT_EDITOR_ID } from '../code_editor/editor_input';

export type ResourceNavigationOptions = {
	readonly selection?: EditorTextSelection;
	readonly preserveFocus?: boolean;
	readonly editorId?: string;
};

export class EditorNavigationController {
	public constructor(
		private readonly catalog: WorkspaceSourceCatalog,
		private readonly resourcePanel: ResourcePanelController,
		private readonly editorResolver: ResourceEditorResolver,
	) {
	}

	/** The attached generation, or undefined when another opening superseded this request. */
	public async openResource(group: EditorGroupView, resource: RuntimeResource, options?: ResourceNavigationOptions): Promise<number | undefined> {
		const result = await group.openResolvedEditor(() => this.editorResolver.resolveEditorInput(resource, options?.editorId),
			{ selection: options?.selection, preserveFocus: options?.preserveFocus });
		if (result === undefined) return undefined;
		if (!result.activated) return result.generation;
		this.resourcePanel.queuePendingSelection(resource);
		if (this.resourcePanel.isVisible()) {
			this.resourcePanel.applyPendingSelection();
		}
		this.resourcePanel.focusTarget.release();
		return result.generation;
	}

	public focusChunkSource(group: EditorGroupView, identity: ResourceIdentity, selection?: EditorTextSelection): Promise<number | undefined> {
		return this.openResource(group, this.catalog.resolveResource(identity)!, { editorId: WORKBENCH_TEXT_EDITOR_ID, selection });
	}

	public focusChunkSourceForContext(
		group: EditorGroupView,
		contextId: string,
		path: string,
		selection?: EditorTextSelection,
	): void {
		const resource = this.catalog.resolveResource({ contextId, path })!;
		void this.openResource(group, resource, { editorId: WORKBENCH_TEXT_EDITOR_ID, selection });
	}

	public async goBackward(): Promise<void> {
		const edit = inputFocus.target?.edit;
		if (edit?.pending === true && !edit.commit()) return;
		const target = selectNavigationHistoryEntry('back', createNavigationEntry());
		if (!target) {
			return;
		}
		await this.openHistoryEntry(target);
	}

	public async goForward(): Promise<void> {
		const edit = inputFocus.target?.edit;
		if (edit?.pending === true && !edit.commit()) return;
		const target = selectNavigationHistoryEntry('forward', createNavigationEntry());
		if (!target) {
			return;
		}
		await this.openHistoryEntry(target);
	}

	private async openHistoryEntry(pending: NavigationHistorySelection): Promise<void> {
		const target = pending.target;
		const group = target.owner;
		const generation = group.panes.beginOpen();
		const activation = inputFocus.revision;
		let preserveFocus = false;
		try {
			const destination = target.target;
			if (destination.kind === 'input') {
				// This live destination already belongs to the group. History does
				// not turn a surviving preview into an explicit Keep Open request.
				if (!withNavigationCaptureSuspended(() => group.activate(destination.input.id, undefined, target.selection))) return;
			} else {
				const input = await this.editorResolver.resolveEditorInput(this.catalog.resolveResource(destination.resource)!, destination.editorId);
				if (generation !== group.panes.openGeneration || !pending.isCurrent) {
					input.dispose();
					return;
				}
				preserveFocus = activation !== inputFocus.revision;
				if (!withNavigationCaptureSuspended(() => group.openEditor(input, {
					pinned: false, navigationSelection: target.selection, preserveFocus,
				}))) return;
			}
			if (!pending.accept()) return;
			if (!preserveFocus) this.resourcePanel.focusTarget.release();
		} finally {
			pending.dispose();
		}
	}
}
