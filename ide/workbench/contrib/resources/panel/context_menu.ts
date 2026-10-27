import type { CartEditor } from '../../../../cart_editor';
import type { DisposableStore } from '../../../../common/lifecycle';
import { editorTextModelService } from '../../../../editor/model/model_service';
import type { WorkspaceSourceCatalog } from '../../../../workspace/source_catalog';
import type { WorkbenchTreeNode } from '../../../ui/tree_view';
import { WORKBENCH_MENUS } from '../../../ui/menu/registry';
import { WORKBENCH_TEXT_EDITOR_ID } from '../../code_editor/editor_input';
import type { ResourcePanelController } from './controller';
import type { ProjectContentIndex } from './content_index';
import type { FileElement } from './files_model';
import { openProjectContent, openProjectContentSource, resolveProjectContentDestination } from './open_actions';

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
		const destination = element.kind === 'file' ? editor.editorParts.editorDestination(invoking, { resource: resource!, editorId: editorId! })
			: element.kind === 'definition' ? resolveProjectContentDestination(editor, element.content, invoking) : undefined;
		const hasSource = resource !== undefined && editor.resourceEditors.hasEditor(resource, WORKBENCH_TEXT_EDITOR_ID);
		const sourceDestination = hasSource ? editor.editorParts.editorDestination(invoking, { resource: resource!, editorId: WORKBENCH_TEXT_EDITOR_ID }) : undefined;
		const current = (): boolean => panel.isVisible() && panel.getMode() === 'resources'
			&& panel.files.revision === revision && origin.scope.contextGeneration === context
			&& (element.kind === 'definition' ? content.isCurrent(element.content)
				: resource !== undefined ? catalog.resolveResource(resource) === resource : catalog.contexts.has(element.contextId));
		const base = WORKBENCH_MENUS[resource === undefined ? 'resources.disclosure.context' : hasSource ? 'resources.open.context' : 'resources.resource.context'];
		const items = resource !== undefined && node.expandable ? [...base, ...WORKBENCH_MENUS['resources.disclosure.context']] : base;
		editor.contextMenu.show(x, y, items, {
			isEnabled: command => current() && (command === 'resources.open' ? resource !== undefined
				: command === 'resources.source' ? hasSource : command === 'resources.disclosure' && node.expandable),
			isActive: command => command === 'resources.disclosure' && !node.collapsed,
			execute: command => {
				// A newer foreground interaction wins; it never supplies this action's destination.
				if (!origin.hasFocus || !current()) return;
				switch (command) {
					case 'resources.open':
						if (element.kind === 'definition') openProjectContent(editor, content, element.content, destination!, origin);
						else void editor.navigation.openResource(destination!, resource!, { editorId });
						break;
					case 'resources.source':
						if (element.kind === 'definition') openProjectContentSource(editor, content, element.content, sourceDestination!, origin);
						else void editor.navigation.focusChunkSource(sourceDestination!, resource!);
						break;
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
