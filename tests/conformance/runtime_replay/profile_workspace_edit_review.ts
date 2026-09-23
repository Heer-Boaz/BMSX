import { performance } from 'node:perf_hooks';
import { EditorTextModelService } from '../../../ide/editor/model/model_service';
import { EditorFont } from '../../../ide/editor/ui/view/font';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { measureTextRange } from '../../../ide/editor/common/text/layout';
import { WorkspaceEditProposal } from '../../../ide/workbench/services/working_copy/workspace_edit';
import { WorkspaceSourceContext } from '../../../ide/workbench/services/working_copy/source_context';
import { WorkspaceEditReviewInput } from '../../../ide/workbench/contrib/edit_review/editor_input';
import { layoutEditReviewRows } from '../../../ide/workbench/contrib/edit_review/projection';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../../helpers/scenario_sources';

// Explicit proposal preparation/reflow, not frame timing or a before/after benchmark.
editorViewState.font = new EditorFont('tiny');
editorViewState.spaceAdvance = editorViewState.font.advance(' ');
for (const count of [16, 256, 4096]) {
	const models = new EditorTextModelService();
	const source = createScenarioTestSourceRecord('review.lua', 1, 'return old\n'.repeat(count));
	const sources = createScenarioTestSourceState([source]);
	const model = models.retain({ domain: 0, path: 'review.lua', source }, 'lua', source.src);
	const edit = { version: model.version, edits: Array.from({ length: count }, (_, index) => ({ offset: index * 11 + 7, deleteLength: 3, text: 'new_name' })) };
	const edits = new Map([[model, edit]]);
	const preparation: number[] = [], projection: number[] = [];
	let rows = 0;
	for (let sample = 0; sample < 30; sample++) {
		const start = performance.now();
		const proposal = new WorkspaceEditProposal('Rename old to new_name', new WorkspaceSourceContext(models, sources), edits);
		const prepared = performance.now();
		const input = new WorkspaceEditReviewInput(proposal);
		layoutEditReviewRows(input, 376, measureTextRange);
		const projected = performance.now();
		rows = input.rows.length;
		if (sample >= 10) { preparation.push(prepared - start); projection.push(projected - prepared); }
		input.dispose();
	}
	preparation.sort((a, b) => a - b); projection.sort((a, b) => a - b);
	console.log(JSON.stringify({ edits: count, rows, prepareMedianMs: preparation[10], projectMedianMs: projection[10] }));
	models.clear();
}
