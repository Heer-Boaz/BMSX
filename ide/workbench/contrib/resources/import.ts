import type { CartEditor } from '../../../cart_editor';
import { showEditorMessage } from '../../../common/feedback_state';
import type { WorkspaceSourceCatalog } from '../../../workspace/source_catalog';
import { joinWorkspacePaths, normalizeRelativeWorkspacePath } from '../../../workspace/path';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';

export function importCartridgeFiles(editor: CartEditor, catalog: WorkspaceSourceCatalog): void {
	const projects = [...catalog.contexts.values()].filter(context => context.programDomain === 'cart')
		.map(context => ({ label: context.projectRootPath, description: '', detail: '' }));
	editor.quickInput.pick('IMPORT FILES', 'Choose the destination cartridge', () => new TextQuickPickProvider(projects), project => {
		const lifetime = new AbortController();
		editor.quickInput.input(`IMPORT FILES - ${project.label}`, 'Destination folder; then choose files. Existing files are not replaced.', 'res',
			async directory => editor.importFiles!(joinWorkspacePaths(project.label, normalizeRelativeWorkspacePath(directory, 'directory')), lifetime.signal),
			paths => {
				if (paths.length !== 0) showEditorMessage(`Imported ${paths.length} file(s). Build the cartridge and open its published result to use new assets.`, 'success', 12);
			}, disposables => {
				disposables.add({ dispose: () => lifetime.abort() });
			});
	});
}
