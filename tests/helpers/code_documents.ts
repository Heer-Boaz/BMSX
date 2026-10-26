import type { TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { CodeDocumentProjections } from '../../ide/editor/ui/code/document_projections';

/** Real document/clock lifetimes shared by focused source-layout fixtures. */
export function createTestCodeDocuments(t: TestContext, models = new EditorTextModelService()) {
	const clock = new VirtualHeadlessClock(), builtins = { epoch: 1, ids: [] as string[] };
	const documents = new CodeDocumentProjections(models, {
		clock, maxHighlightCache: 512, semanticDebounceMs: 200, getBuiltinIdentifiers: () => builtins,
	});
	t.after(() => { documents.dispose(); resetSemanticProjects(models); models.clear(); });
	return { models, documents, clock, builtins };
}
