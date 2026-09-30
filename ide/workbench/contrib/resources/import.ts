import type { CartEditor } from '../../../cart_editor';
import { CARTRIDGE_RESOURCE_DOMAINS } from '../../../common/resource';
import { COLOR_STATUS_SUCCESS } from '../../../common/constants';
import { showEditorMessage } from '../../../common/feedback_state';
import type { RuntimeSourceState } from '../../../runtime/sources';
import { joinWorkspacePaths, normalizeRelativeWorkspacePath } from '../../../workspace/path';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';

export function importCartridgeFiles(editor: CartEditor, sources: RuntimeSourceState): void {
	const projects = CARTRIDGE_RESOURCE_DOMAINS.filter(domain => sources.cartridgeSlots[domain] !== null)
		.map(domain => ({ label: sources.cartridgeSlots[domain]!.projectRootPath, description: `CART ${domain}`, detail: '' }));
	editor.quickInput.pick('IMPORT FILES', 'Choose the destination cartridge', () => new TextQuickPickProvider(projects), project => {
		const lifetime = new AbortController();
		const disposables = editor.quickInput.input(`IMPORT FILES - ${project.label}`, 'Destination folder; then choose files. Existing files are not replaced.', 'res',
			async directory => editor.importFiles!(joinWorkspacePaths(project.label, normalizeRelativeWorkspacePath(directory, 'directory')), lifetime.signal),
			paths => {
				if (paths.length !== 0) showEditorMessage(`Imported ${paths.length} file(s). Build the cartridge and open its published result to use new assets.`, COLOR_STATUS_SUCCESS, 12);
			});
		disposables.add({ dispose: () => lifetime.abort() });
	});
}
