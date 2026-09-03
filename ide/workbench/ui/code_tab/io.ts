import type { RuntimeSourceState } from '../../../runtime/sources';
import type { CodeTabContext } from './model';
import type { RuntimeResource } from '../../../common/resource';
import { loadWorkspaceSourceFile } from '../../../workspace/files';
import { resolveWorkspacePath } from '../../../workspace/path';
import { computeResourceTabTitle } from '../tab/titles';
import { setActiveTab } from '../tabs';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import {
	buildCodeTabId,
	createAemCodeTabContext,
	getCodeTabContextById,
	registerCodeTabContext,
	retainLuaCodeTabContext,
	upsertCodeEditorTab,
} from './contexts';
import { runtimeSourceProjectRootPath } from '../../../runtime/sources';
import type { EditorPanes } from '../../services/editor/editor_panes';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import type { CodeEditorInput } from '../tab/model';

function applyCodeTabResource(context: CodeTabContext, resource: RuntimeResource): void {
	context.model.refreshResource(resource);
	context.title = computeResourceTabTitle(resource);
}

export function retainLuaCodeEditorInput(
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): CodeEditorInput {
	const context = retainLuaCodeTabContext(sources, resource);
	return upsertCodeEditorTab(context);
}

export async function retainAemCodeEditorInput(
	storage: KeyValueStorage,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
): Promise<CodeEditorInput> {
	const tabId = buildCodeTabId(resource);
	let context = getCodeTabContextById(tabId);
	if (!context) {
		const projectRootPath = runtimeSourceProjectRootPath(sources, resource.domain);
		const workspacePath = resolveWorkspacePath(resource.path, projectRootPath);
		const source = await loadWorkspaceSourceFile(
			storage,
			workspacePath,
			projectRootPath,
		);
		if (source === null) {
			throw new Error(`AEM resource '${resource.path}' is unavailable.`);
		}
		context = createAemCodeTabContext(resource, source);
		registerCodeTabContext(context);
	}
	applyCodeTabResource(context, resource);
	return upsertCodeEditorTab(context);
}

export function openLuaCodeTab(
	editorPanes: EditorPanes,
	sources: RuntimeSourceState,
	resource: RuntimeResource,
	selection?: EditorTextSelection,
): void {
	const input = retainLuaCodeEditorInput(sources, resource);
	setActiveTab(editorPanes, input.id, selection);
}
