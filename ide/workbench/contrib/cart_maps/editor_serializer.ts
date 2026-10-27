import { editorTextModelService } from '../../../editor/model/model_service';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import type { EditorInputSerializer } from '../../services/editor/editor_serialization';
import { captureTextFileModel, resolveTextFileModelSnapshot, type TextFileModelSnapshot } from '../../services/working_copy/text_file_model';
import { CartMapInput, type CartMapKind } from './editor_input';
import { captureCartMapView, restoreCartMapView, type CartMapViewSnapshot } from './view_snapshot';

type CartMapSnapshot = { readonly source: TextFileModelSnapshot; readonly kind: CartMapKind; readonly view: CartMapViewSnapshot };
export class CartMapInputSerializer implements EditorInputSerializer<CartMapInput> {
	public constructor(private readonly catalog: WorkspaceSourceCatalog) {}
	public serialize(input: CartMapInput): string {
		const state: CartMapSnapshot = { source: captureTextFileModel(input.workingCopy), kind: input.mapKind, view: captureCartMapView(input) };
		return JSON.stringify(state);
	}
	public async deserialize(value: string): Promise<CartMapInput> {
		const state: CartMapSnapshot = JSON.parse(value);
		const { model, sameSource } = await resolveTextFileModelSnapshot(editorTextModelService, this.catalog, state.source);
		const input = new CartMapInput(model, state.kind);
		if (sameSource) restoreCartMapView(input, state.view);
		return input;
	}
}
