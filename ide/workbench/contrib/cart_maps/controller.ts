import { showEditorWarningBanner } from '../../../common/feedback_state';
import type { RuntimeResource } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { TextEditorInput } from '../../common/editor_input';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { QuickInputController } from '../../services/quick_input/controller';
import { FileQuickPickProvider } from '../../services/quick_input/file_provider';
import { resolveTextFileModel } from '../../services/working_copy/text_file_model';
import { resolveTextCodeEditorInput } from '../../ui/code_tab/io';
import { buildResourceQuickPickItems } from '../resources/quick_access';
import { CartMapInput, type CartMapKind } from './editor_input';
import { projectCartMap } from './source_projection';

/** Explicit authored-resource associations, not a schema guessed from a cooked asset. */
export const CART_MAP_SOURCES: readonly { suffix: string; kind: CartMapKind }[] = [
	{ suffix: '/castle_map.yaml', kind: 'pietious' }, { suffix: '/castle_map.yml', kind: 'pietious' },
	{ suffix: '/nemesis_s_stage.yaml', kind: 'nemesis' }, { suffix: '/nemesis_s_stage.yml', kind: 'nemesis' },
];

export function cartMapKind(resource: RuntimeResource): CartMapKind | undefined {
	if (resource.source.type !== 'data') return;
	return CART_MAP_SOURCES.find(source => resource.path.endsWith(source.suffix))?.kind;
}

export async function resolveCartMapInput(catalog: WorkspaceSourceCatalog, resource: RuntimeResource, kind: CartMapKind): Promise<CartMapInput> {
	return new CartMapInput(await resolveTextFileModel(editorTextModelService, catalog, resource), kind);
}

export class CartMapController {
	public constructor(private readonly catalog: WorkspaceSourceCatalog, private readonly group: EditorGroupView,
		private readonly quickInput: QuickInputController) {}
	public open(): void {
		const active = this.group.model.activeTab;
		if (active instanceof TextEditorInput) {
			const kind = cartMapKind(active.workingCopy.resource);
			if (kind !== undefined) { this.openResource(active.workingCopy.resource, kind); return; }
		}
		this.quickInput.pick('MAP EDITOR', 'Authored room objects / stage markers', () => new FileQuickPickProvider(
			buildResourceQuickPickItems(this.catalog.resources.filter(resource => cartMapKind(resource) !== undefined))),
			item => this.openResource(item.resource, cartMapKind(item.resource)!));
	}
	public openResource(resource: RuntimeResource, kind: CartMapKind): void {
		void this.group.openResolvedEditor(resolveCartMapInput(this.catalog, resource, kind))
			.catch(error => showEditorWarningBanner(`Cannot open map source: ${String(error)}`));
	}
	public openSource(input: CartMapInput): void {
		projectCartMap(input);
		const position = { row: 0, column: 0 };
		input.workingCopy.buffer.positionAt(input.selectionRange.start, position);
		void this.group.openResolvedEditor(resolveTextCodeEditorInput(this.catalog, input.workingCopy.resource),
			{ selection: { row: position.row, startColumn: position.column, endColumn: position.column } })
			.catch(error => showEditorWarningBanner(`Cannot open map source: ${String(error)}`));
	}
}
