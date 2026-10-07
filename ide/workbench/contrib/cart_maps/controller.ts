import { showEditorWarningBanner } from '../../../common/feedback_state';
import type { RuntimeResource } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { TextEditorInput } from '../../common/editor_input';
import type { EditorPanes } from '../../services/editor/editor_panes';
import type { QuickInputController } from '../../services/quick_input/controller';
import { FileQuickPickProvider } from '../../services/quick_input/file_provider';
import { resolveTextFileModel } from '../../services/working_copy/text_file_model';
import { resolveTextCodeEditorInput } from '../../ui/code_tab/io';
import { editorTabGroup } from '../../ui/tab/group_model';
import { getActiveTab, openEditorTab } from '../../ui/tabs';
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

export async function resolveCartMapInput(sources: RuntimeSourceState, resource: RuntimeResource, kind: CartMapKind): Promise<CartMapInput> {
	return new CartMapInput(await resolveTextFileModel(editorTextModelService, sources, resource), kind);
}

export class CartMapController {
	public constructor(private readonly sources: RuntimeSourceState, private readonly panes: EditorPanes,
		private readonly quickInput: QuickInputController) {}
	public open(): void {
		const active = getActiveTab();
		if (active instanceof TextEditorInput) {
			const kind = cartMapKind(active.workingCopy.resource);
			if (kind !== undefined) { this.openResource(active.workingCopy.resource, kind); return; }
		}
		this.quickInput.pick('MAP EDITOR', 'Authored room objects / stage markers', () => new FileQuickPickProvider(
			buildResourceQuickPickItems(this.sources.resources.filter(resource => cartMapKind(resource) !== undefined))),
			item => this.openResource(item.resource, cartMapKind(item.resource)!));
	}
	public openResource(resource: RuntimeResource, kind: CartMapKind): void {
		const generation = this.panes.beginOpen();
		void resolveCartMapInput(this.sources, resource, kind).then(input => {
			if (this.panes.openGeneration === generation) openEditorTab(this.panes, input);
			else input.dispose();
		}, error => showEditorWarningBanner(`Cannot open map source: ${String(error)}`));
	}
	public openSource(input: CartMapInput): void {
		projectCartMap(input);
		const position = { row: 0, column: 0 };
		input.workingCopy.buffer.positionAt(input.selectionRange.start, position);
		const generation = this.panes.beginOpen();
		void resolveTextCodeEditorInput(this.sources, input.workingCopy.resource).then(code => {
			if (this.panes.openGeneration === generation) openEditorTab(this.panes, code,
				{ selection: { row: position.row, startColumn: position.column, endColumn: position.column } });
			else if (editorTabGroup.findById(code.id) !== code) code.dispose();
		}, error => showEditorWarningBanner(`Cannot open map source: ${String(error)}`));
	}
}
