import type { CartEditor } from '../../../../cart_editor';
import type { DisposableStore } from '../../../../common/lifecycle';
import { editorTextModelService } from '../../../../editor/model/model_service';
import type { WorkspaceSourceCatalog } from '../../../../workspace/source_catalog';
import type { WorkbenchTreeNode } from '../../../ui/tree_view';
import { WORKBENCH_MENUS } from '../../../ui/menu/registry';
import { WORKBENCH_TEXT_EDITOR_ID } from '../../code_editor/editor_input';
import type { ResourcePanelController } from './controller';
import type { ProjectContentIndex } from '../content_index';
import type { FileElement } from './files_model';
import { editProjectContentInMain, openProjectContent, openProjectContentSource, resolveProjectContentDestination } from './open_actions';

/** Files owns its captured tree subject; shared popup code owns the interaction. */
export class ResourcePanelContextMenu {
	private session: DisposableStore | undefined;
	public constructor(private readonly editor: CartEditor, private readonly catalog: WorkspaceSourceCatalog,
		private readonly content: ProjectContentIndex, private readonly panel: ResourcePanelController) {}

	public close(): void { if (this.session !== undefined) this.editor.contextMenu.hide(); }

	public open(node: WorkbenchTreeNode<FileElement>, x: number, y: number, keyboard: boolean): void {
		const { editor, catalog, content, panel } = this;
		const element = node.element, origin = panel.focusTarget;
		const revision = panel.files.revision, context = origin.scope.contextGeneration;
		const catalogRevision = catalog.revision;
		const resource = element.kind === 'file' ? element.resource : element.kind === 'definition' ? element.content.ownerResource : undefined;
		const editorId = element.kind === 'file' ? editor.resourceEditors.getEditorId(resource!) : undefined;
		const invoking = editor.editorParts.activeGroup;
		const invokingPart = editor.editorParts.partForGroup(invoking);
		const destination = element.kind === 'file' ? editor.editorParts.editorDestination(invoking, { resource: resource!, editorId: editorId! })
			: element.kind === 'definition' ? resolveProjectContentDestination(editor, element.content, invoking) : undefined;
		const hasSource = resource !== undefined && editorId !== WORKBENCH_TEXT_EDITOR_ID
			&& editor.resourceEditors.hasEditor(resource, WORKBENCH_TEXT_EDITOR_ID);
		const sourceDestination = hasSource ? editor.editorParts.editorDestination(invoking, { resource: resource!, editorId: WORKBENCH_TEXT_EDITOR_ID }) : undefined;
		const sideCurrent = (): boolean => invoking.openingAdmitted && editor.editorParts.partForGroup(invoking) === invokingPart;
		const createSource = panel.captureSourceCreation('empty', node), createFolder = panel.captureNewFolder(node), refresh = panel.captureRefresh(node);
		const current = (): boolean => panel.isVisible()
			&& panel.files.revision === revision && origin.scope.contextGeneration === context
			&& (element.kind === 'definition' ? content.isCurrent(element.content)
				: resource !== undefined ? catalog.resolveResource(resource) === resource : catalog.contexts.has(element.contextId));
		const base = element.kind === 'physicalFile' || element.kind === 'status' || resource === undefined && !node.expandable ? []
			: WORKBENCH_MENUS[resource === undefined ? 'resources.disclosure.context' : hasSource ? 'resources.open.context' : 'resources.resource.context'];
		const opening = element.kind === 'definition' && element.content.kind === 'scene'
			? [...base, { type: 'command' as const, command: 'resources.editInMain' as const }] : base;
		const disclosure = resource !== undefined && node.expandable ? [...opening, ...WORKBENCH_MENUS['resources.disclosure.context']] : opening;
		const items = createFolder === undefined ? disclosure
			: [...WORKBENCH_MENUS['resources.directory.context'], ...(disclosure.length === 0 ? [] : [{ type: 'separator' as const }, ...disclosure])];
		editor.contextMenu.show(x, y, items, {
			isEnabled: command => current() && (command === 'createResource' ? createSource?.isEnabled() === true
				: command === 'resources.newFolder' ? createFolder?.isEnabled() === true : command === 'resources.refresh' ? refresh?.isEnabled() === true
				: command === 'resources.open' ? resource !== undefined
				: command === 'resources.editInMain' ? element.kind === 'definition' && element.content.kind === 'scene'
				: command === 'resources.openToSide' ? resource !== undefined && sideCurrent()
				: command === 'resources.source' ? hasSource : command === 'resources.sourceToSide' ? hasSource && sideCurrent()
				: command === 'resources.disclosure' && node.expandable),
			isActive: command => command === 'resources.disclosure' && !node.collapsed,
			execute: command => {
				// A newer foreground interaction wins; it never supplies this action's destination.
				if (!origin.hasFocus || !current()) return;
				switch (command) {
					case 'createResource': createSource?.run(); break;
					case 'resources.newFolder': createFolder?.run(); break;
					case 'resources.refresh': refresh?.run(); break;
					case 'resources.editInMain': {
						if (element.kind === 'definition' && element.content.kind === 'scene') void editProjectContentInMain(editor, content, element.content, origin);
						break;
					}
					case 'resources.open': case 'resources.openToSide': {
						const target = command === 'resources.open' ? destination : sideCurrent() ? editor.editorParts.sideGroup(invoking) : undefined;
						if (target === undefined || !origin.hasFocus || !current()) return;
						if (element.kind === 'definition') openProjectContent(editor, content, element.content, target, origin);
						else void editor.navigation.openResource(target, resource!, { editorId });
						break;
					}
					case 'resources.source': case 'resources.sourceToSide': {
						const target = command === 'resources.source' ? sourceDestination : sideCurrent() ? editor.editorParts.sideGroup(invoking) : undefined;
						if (target === undefined || !origin.hasFocus || !current()) return;
						if (element.kind === 'definition') openProjectContentSource(editor, content, element.content, target, origin);
						else void editor.navigation.focusChunkSource(target, resource!);
						break;
					}
					case 'resources.disclosure': panel.toggleFileDisclosure(node); break;
				}
			},
		}, { invocationOrigin: origin, commandTarget: origin, returnFocus: origin, selectFirst: keyboard,
			onWillShow: lifetime => {
				this.session = lifetime;
				lifetime.add({ dispose: () => { if (this.session === lifetime) this.session = undefined; } });
				lifetime.add({ dispose: panel.files.onDidChange(() => { if (panel.files.revision !== revision) this.close(); }) });
				lifetime.add({ dispose: editorTextModelService.onWillClear(() => this.close()) });
				if (destination !== undefined) lifetime.add({ dispose: destination.onWillDispose(() => this.close()) });
				if (sourceDestination !== undefined && sourceDestination !== destination)
					lifetime.add({ dispose: sourceDestination.onWillDispose(() => this.close()) });
				if (resource !== undefined && invoking !== destination && invoking !== sourceDestination)
					lifetime.add({ dispose: invoking.onWillDispose(() => this.close()) });
				lifetime.add({ dispose: catalog.onDidChange(changedContext => {
					if (element.kind === 'definition' ? !content.isCurrent(element.content)
						: resource !== undefined ? catalog.resolveResource(resource) !== resource
							: changedContext === element.contextId && catalog.revision !== catalogRevision) this.close();
				}) });
				if (element.kind === 'definition') lifetime.add({ dispose: content.onDidChange(() => {
					if (!content.isCurrent(element.content)) this.close();
				}) });
				if (!current()) this.close();
			} });
	}
}
