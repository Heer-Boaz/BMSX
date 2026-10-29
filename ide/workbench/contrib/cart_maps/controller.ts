import { showEditorWarningBanner } from '../../../common/feedback_state';
import { DisposableStore } from '../../../common/lifecycle';
import type { RuntimeResource } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { EditorGroupView, EditorTabOpenOptions } from '../../services/editor/editor_group';
import type { QuickInputController } from '../../services/quick_input/controller';
import { FileQuickPickProvider } from '../../services/quick_input/file_provider';
import { resolveTextFileModel } from '../../services/working_copy/text_file_model';
import type { EditorSourceLocation } from '../../../editor/navigation/source_location';
import { buildResourceQuickPickItems } from '../resources/quick_access';
import { CartMapInput, type CartMapKind } from './editor_input';
import { projectCartMap } from './source_projection';
import type { SourceViewOpening } from '../source_views/quick_access';

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
	public constructor(private readonly catalog: WorkspaceSourceCatalog) {}
	public open(group: EditorGroupView, quickInput: QuickInputController, source?: SourceViewOpening): void {
		if (source !== undefined) {
			const kind = cartMapKind(source.model.resource);
			if (kind !== undefined) { this.openResource(group, source.model.resource, kind, source.options); return; }
		}
		quickInput.pick('MAP EDITOR', 'Authored room objects / stage markers', (_origin, lifetime) => {
			const retire = () => quickInput.hide();
			lifetime.add({ dispose: editorTextModelService.onWillClear(retire) });
			lifetime.add({ dispose: this.catalog.onDidChange(retire) });
			return new FileQuickPickProvider(buildResourceQuickPickItems(this.catalog.resources.filter(resource => cartMapKind(resource) !== undefined)));
		},
			(item, _modifiers, preserveFocus) => this.openResource(group, item.resource, cartMapKind(item.resource)!, { preserveFocus }),
			lifetime => lifetime.add({ dispose: group.onWillDispose(() => quickInput.hide()) }));
	}
	public openResource(group: EditorGroupView, resource: RuntimeResource, kind: CartMapKind, options: EditorTabOpenOptions = {}): void {
		const lifetime = new DisposableStore();
		let current = true;
		const retire = () => { current = false; };
		lifetime.add({ dispose: editorTextModelService.onWillClear(retire) });
		lifetime.add({ dispose: this.catalog.onDidChange(retire) });
		const isCurrent = () => current && options.isCurrent?.() !== false;
		void group.openResolvedEditor(() => resolveCartMapInput(this.catalog, resource, kind), { ...options, isCurrent })
			.catch(error => { if (isCurrent()) showEditorWarningBanner(`Cannot open map source: ${String(error)}`); })
			.finally(() => lifetime.dispose());
	}
	public getSourceLocation(input: CartMapInput): EditorSourceLocation {
		projectCartMap(input);
		const model = input.workingCopy, position = { row: 0, column: 0 };
		model.buffer.positionAt(input.selectionRange.start, position);
		return { model, modelVersion: input.version,
			selection: { row: position.row, startColumn: position.column, endColumn: position.column } };
	}
}
