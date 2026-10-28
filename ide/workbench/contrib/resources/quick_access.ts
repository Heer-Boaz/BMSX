import { KeyModifier } from '../../../../hosts/common/input/text';
import type { CartEditor } from '../../../cart_editor';
import type { RuntimeResource } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import { inputFocus, type InputFocusTarget } from '../../../input/focus';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { EditorGroupView } from '../../services/editor/editor_group';
import { FileQuickPickProvider } from '../../services/quick_input/file_provider';
import type { QuickPickItem } from '../../services/quick_input/provider';

export type ResourceQuickPickItem = QuickPickItem & { readonly resource: RuntimeResource };

/** The source owner already supplies sorted, retained, context-qualified resources. */
export function buildResourceQuickPickItems(resources: readonly RuntimeResource[]): ResourceQuickPickItem[] {
	return resources.map(resource => ({
		resource,
		label: resource.path,
		description: `${resource.source.type.toUpperCase()} / ${resource.contextLabel}`,
		detail: '',
	}));
}

/** File navigation retains the invoking host and the admitted source inventory, not later focus. */
export function showResourceQuickAccess(editor: CartEditor, catalog: WorkspaceSourceCatalog, group: EditorGroupView): void {
	const picker = editor.quickInput, part = editor.editorParts.partForGroup(group);
	let origin: InputFocusTarget | null = null, context: number | undefined;
	const current = (resource: RuntimeResource): boolean => group.openingAdmitted
		&& editor.editorParts.partForGroup(group) === part && origin?.scope.contextGeneration === context
		&& inputFocus.admittedTarget === origin && catalog.resolveResource(resource) === resource;
	picker.pick('GO TO FILE', 'File path; Alt+Enter: open beside', (preparedOrigin, lifetime) => {
		origin = preparedOrigin; context = origin?.scope.contextGeneration;
		const items = buildResourceQuickPickItems(catalog.resources);
		lifetime.add({ dispose: catalog.onDidChange(() => {
			for (const item of items) if (catalog.resolveResource(item.resource) !== item.resource) { picker.hide(); break; }
		}) });
		return new FileQuickPickProvider(items);
	}, (item, modifiers) => {
		if (!current(item.resource)) return;
		const destination = (modifiers & KeyModifier.alt) !== 0 ? editor.editorParts.sideGroup(group)
			: editor.editorParts.editorDestination(group, { resource: item.resource, editorId: editor.resourceEditors.getEditorId(item.resource) });
		if (destination === undefined || !current(item.resource)) return;
		void editor.navigation.openResource(destination, item.resource);
	}, lifetime => {
		lifetime.add({ dispose: group.onWillDispose(() => picker.hide()) });
		lifetime.add({ dispose: editorTextModelService.onWillClear(() => picker.hide(false)) });
	}, { commandTarget: group.focusTarget });
}
