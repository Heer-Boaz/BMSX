import { inputFocus } from '../../../input/focus';
import { editorTextModelService } from '../../../editor/model/model_service';
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
import type { ResourceEditorResolver } from '../../services/editor/resource_editor_resolver';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { EditorParts } from '../../services/editor/editor_parts';
import type { EditorSourceLocation } from '../../../editor/navigation/source_location';
import { WORKBENCH_TEXT_EDITOR_ID } from '../code_editor/editor_input';

export type ResourceNavigationOptions = {
	readonly selection?: EditorTextSelection;
	readonly preserveFocus?: boolean;
	readonly editorId?: string;
	readonly isCurrent?: () => boolean;
};

export class EditorNavigationController {
	public constructor(
		private readonly catalog: WorkspaceSourceCatalog,
		private readonly editorResolver: ResourceEditorResolver,
		private readonly parts: EditorParts,
	) {
	}

	/** Settle the sender before its contribution selects one canonical source generation. */
	public openSource(reference: EditorGroupView, readLocation: () => EditorSourceLocation | undefined | Promise<EditorSourceLocation | undefined>,
		placement: 'default' | 'side' = 'default'): Promise<number | undefined> | undefined {
		const part = this.parts.partForGroup(reference), pane = reference.panes.activePane;
		if (part === undefined || part.retired || part.surface.retired || !reference.openingAdmitted || part.operation !== 'none' || pane === null) return;
		const input = pane.input;
		let generation = reference.panes.openGeneration;
		const sourceScope = pane.commandTarget.scope, sourceContext = sourceScope.contextGeneration;
		const origin = inputFocus.admittedTarget, originScope = origin?.scope, originContext = originScope?.contextGeneration;
		// A source-owned draft may close itself and return to its containing client.
		const scope = originScope !== undefined && sourceScope.contains(originScope) ? sourceScope : originScope;
		const current = (): boolean => {
			const focused = inputFocus.admittedTarget;
			return this.parts.partForGroup(reference) === part && !part.retired && !part.surface.retired && part.operation === 'none'
				&& reference.openingAdmitted && reference.panes.openGeneration === generation && reference.panes.activePane === pane && pane.input === input
				&& sourceScope.contextGeneration === sourceContext && originScope?.contextGeneration === originContext
				&& (focused === null || scope !== undefined && scope.contains(focused.scope));
		};
		if (!reference.commitPendingEdit() || !current()) return;
		const focusRevision = inputFocus.revision;
		const admitLocation = (location: EditorSourceLocation | undefined): Promise<number | undefined> | undefined => {
			if (location === undefined || !current() || inputFocus.revision !== focusRevision && inputFocus.target !== null) return;
			const { model, modelVersion, selection } = location;
			if (model.version !== modelVersion || editorTextModelService.get(model.resource) !== model || this.catalog.resolveResource(model.resource) !== model.resource) return;
			const destination = placement === 'side' ? this.parts.sideGroup(reference)
				: this.parts.editorDestination(reference, { resource: model.resource, editorId: WORKBENCH_TEXT_EDITOR_ID });
			if (destination === undefined || !current() || inputFocus.revision !== focusRevision && inputFocus.target !== null
				|| model.version !== modelVersion || editorTextModelService.get(model.resource) !== model || this.catalog.resolveResource(model.resource) !== model.resource) return;
			// The receiver owns its opening generation; the sender attachment and source generation remain live until admission.
			return this.openResource(destination, model.resource, { editorId: WORKBENCH_TEXT_EDITOR_ID,
				selection: selection === undefined ? undefined : { ...selection, generation: location },
				isCurrent: () => this.parts.partForGroup(reference) === part && !part.retired && part.operation === 'none'
					&& reference.openingAdmitted && reference.panes.activePane === pane && pane.input === input
					&& (destination === reference || reference.panes.openGeneration === generation)
					&& sourceScope.contextGeneration === sourceContext && originScope?.contextGeneration === originContext
					&& model.version === modelVersion && editorTextModelService.get(model.resource) === model
					&& this.catalog.resolveResource(model.resource) === model.resource });
		};
		const location = readLocation();
		if (!(location instanceof Promise)) return admitLocation(location);
		if (!current() || inputFocus.revision !== focusRevision && inputFocus.target !== null) return location.then(() => undefined);
		// Location IO has a real sender opening receipt, without creating a destination or detaching its control.
		generation = reference.panes.beginOpen();
		if (!current()) return location.then(() => undefined);
		return location.then(admitLocation);
	}

	/** The attached generation, or undefined when another opening superseded this request. */
	public async openResource(group: EditorGroupView, resource: RuntimeResource, options?: ResourceNavigationOptions): Promise<number | undefined> {
		const result = await group.openResolvedEditor(() => this.editorResolver.resolveEditorInput(resource, options?.editorId),
			{ selection: options?.selection, preserveFocus: options?.preserveFocus, isCurrent: options?.isCurrent });
		return result?.generation;
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
		const destination = target.target;
		if (destination.kind === 'primary') {
			try {
				if (await destination.location.restore({ isCurrent: () => pending.isCurrent, preserveFocus: false })) pending.accept();
			} finally { pending.dispose(); }
			return;
		}
		const group = target.owner!;
		const generation = group.panes.beginOpen();
		const activation = inputFocus.revision;
		let preserveFocus = false;
		try {
			if (generation !== group.panes.openGeneration || !pending.isCurrent) return;
			if (destination.kind === 'input') {
				// This live destination already belongs to the group. History does
				// not turn a surviving preview into an explicit Keep Open request.
				if (!withNavigationCaptureSuspended(() => group.activate(destination.input.id, {
					navigationSelection: target.selection, isCurrent: () => pending.isCurrent,
				}))) return;
			} else {
				const input = await this.editorResolver.resolveEditorInput(this.catalog.resolveResource(destination.resource)!, destination.editorId);
				if (generation !== group.panes.openGeneration || !pending.isCurrent) {
					input.dispose();
					return;
				}
				preserveFocus = activation !== inputFocus.revision;
				if (!withNavigationCaptureSuspended(() => group.openEditor(input, {
					pinned: false, navigationSelection: target.selection, preserveFocus, isCurrent: () => pending.isCurrent,
				}))) return;
			}
			if (!pending.accept()) return;
		} finally {
			pending.dispose();
		}
	}
}
