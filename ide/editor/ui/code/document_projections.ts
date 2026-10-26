import { onDidChangeIdeTheme } from '../../../common/constants';
import type { EditorTextModelService } from '../../model/model_service';
import type { EditorTextModel } from '../../model/text_model';
import { CodeDocumentProjection, type CodeDocumentProjectionOptions } from './document_projection';

/** Shared source projections have working-copy lifetime, not pane or font lifetime. */
export class CodeDocumentProjections {
	private readonly documents = new Map<EditorTextModel, CodeDocumentProjection>();
	private readonly unbindTheme: () => void;

	public constructor(private readonly models: EditorTextModelService, private readonly options: CodeDocumentProjectionOptions) {
		this.unbindTheme = onDidChangeIdeTheme(() => {
			for (const document of this.documents.values()) document.invalidateTokenColors();
		});
	}

	public get(model: EditorTextModel): CodeDocumentProjection {
		let document = this.documents.get(model);
		if (document === undefined) {
			document = new CodeDocumentProjection(this.models, model, this.options);
			this.documents.set(model, document);
			document.onWillDispose(() => this.documents.delete(model));
		}
		return document;
	}

	public dispose(): void {
		this.unbindTheme();
		for (const document of this.documents.values()) document.dispose();
		this.documents.clear();
	}
}
