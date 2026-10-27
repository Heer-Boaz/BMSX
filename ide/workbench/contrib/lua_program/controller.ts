import { staticLuaTableFieldName } from '../../../../toolchain/ts/lua/syntax/table_fields';
import type { LuaSemanticWorkspaceSnapshot } from '../../../../toolchain/ts/lua/semantic/model';
import { CARTRIDGE_RESOURCE_DOMAINS, SYSTEM_RESOURCE_DOMAIN, type ResourceDomain, type RuntimeResource } from '../../../common/resource';
import { editorTextModelService } from '../../../editor/model/model_service';
import { getOrCreateSemanticProject } from '../../../editor/contrib/intellisense/semantic/workspace/state';
import { LuaSourceReader } from '../../../language/lua/source_reader';
import { luaSourceRangeToTextRange, createLuaTableFieldRemovalEdits } from '../../../language/lua/source_edits';
import { createLuaTableFieldsInsertionEdits, formatLuaTableFieldSource, validateLuaTableFieldExpression } from '../../../language/lua/table_field_insertion';
import type { Blua32SourceImage, RuntimeSourceState } from '../../../runtime/sources';
import { resolveLuaTextFileModel } from '../../services/working_copy/text_file_model';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import type { EditorNavigationController } from '../resources/navigation';
import type { EditorGroupView } from '../../services/editor/editor_group';
import type { QuickInputController } from '../../services/quick_input/controller';
import { TextQuickPickProvider } from '../../services/quick_input/text_provider';
import { collectLuaPrograms, projectLuaProgram, type LuaProgramKind, type LuaProgramOccurrence } from './source';
import { LuaProgramInput } from './editor_input';
import { LuaProgramRuntimeProjection, readProgramInstances, type ProgramInstanceChoice } from './runtime';
import { programFieldTemplates, programEntryTemplate } from './schema';
import type { HostRewind } from '../../../../hosts/common/rewind';

/** Source ownership and runtime readback meet in a retained input, never in a second program database. */
export class LuaProgramController {
	private readonly projections = new WeakMap<LuaProgramInput, LuaProgramRuntimeProjection>();
	public constructor(private readonly sources: RuntimeSourceState, public readonly guest: SuspendedGuestSession,
		private readonly navigation: EditorNavigationController, public readonly quickInput: QuickInputController,
		private readonly rewind: HostRewind) {}
	public open(group: EditorGroupView, kind: LuaProgramKind): void {
		this.quickInput.pick(kind === 'progression' ? 'PROGRESSION PROGRAMS' : 'INPUT BINDINGS', 'Choose a producer call',
			() => {
				const choices: { label: string; description: string; detail: string; occurrence: LuaProgramOccurrence }[] = [];
				const snapshots = new Map<string, LuaSemanticWorkspaceSnapshot>();
				for (const resource of this.sources.catalog.luaResources) {
					let snapshot = snapshots.get(resource.contextId);
					if (snapshot === undefined) {
						const project = getOrCreateSemanticProject(editorTextModelService, resource.contextId);
						project.synchronizeSources(this.sources.catalog);
						snapshot = project.getSnapshot(); snapshots.set(resource.contextId, snapshot);
					}
					for (const occurrence of collectLuaPrograms(resource, snapshot)) {
						if (occurrence.kind !== kind) continue;
						choices.push({ label: `${resource.path}:${occurrence.file.chunk.locations.range(occurrence.call.expression.span).start.line}`,
							description: kind, detail: 'Canonical Lua / unsaved working copies included', occurrence });
					}
				}
				return new TextQuickPickProvider(choices);
			}, item => this.openOccurrence(group, item.occurrence), lifetime => {
				lifetime.add({ dispose: group.onWillDispose(() => this.quickInput.hide()) });
			});
	}
	public openResource(group: EditorGroupView, resource: RuntimeResource, kind: LuaProgramKind): void {
		const project = getOrCreateSemanticProject(editorTextModelService, resource.contextId);
		project.synchronizeSources(this.sources.catalog);
		const occurrence = collectLuaPrograms(resource, project.getSnapshot()).find(item => item.kind === kind)!;
		this.openOccurrence(group, occurrence);
	}
	public openOccurrence(group: EditorGroupView, occurrence: LuaProgramOccurrence): LuaProgramInput {
		const resource = this.sources.catalog.resolveResource(occurrence.resource)!;
		const model = resolveLuaTextFileModel(editorTextModelService, this.sources.catalog, resource);
		const span = luaSourceRangeToTextRange(model.buffer, occurrence.file.chunk.locations.range(occurrence.call.expression.span));
		let input = group.model.tabs.find((input): input is LuaProgramInput => input.kind === 'lua_program'
			&& input.workingCopy === model && input.programKind === occurrence.kind && input.occurrenceRange.start === span.start && input.occurrenceRange.end === span.end);
		if (input === undefined) {
			input = new LuaProgramInput(model, occurrence.kind, span, this.guest);
			this.refresh(input);
		}
		group.openEditor(input);
		return input;
	}
	public refreshRuntime(input: LuaProgramInput): void {
		// Reconcile at the requested position, not an intermediate replay checkpoint.
		if (this.rewind.seeking) return;
		let projection = this.projections.get(input);
		if (projection === undefined) {
			const retained = new LuaProgramRuntimeProjection(this.sources, this.guest);
			this.projections.set(input, retained);
			input.onWillDispose(this.guest.onWillEndHistoryReview(() => retained.refresh(input, true)));
			projection = retained;
		}
		projection.refresh(input);
	}
	public resolveRuntime(input: LuaProgramInput): void { this.projections.get(input)!.resolve(input); }
	public refresh(input: LuaProgramInput): void {
		const project = getOrCreateSemanticProject(editorTextModelService, input.workingCopy.resource.contextId);
		project.synchronizeSources(this.sources.catalog);
		const snapshot = project.getSnapshot();
		if (input.sourceRevision === snapshot.revision) return;
		input.sourceRevision = snapshot.revision;
		input.invalidateProjection();
		const occurrences = collectLuaPrograms(input.workingCopy.resource, snapshot);
		input.occurrence = occurrences.find(item => item.kind === input.programKind && (() => {
			const range = luaSourceRangeToTextRange(input.workingCopy.buffer, item.file.chunk.locations.range(item.call.expression.span));
			return range.start === input.occurrenceRange.start && range.end === input.occurrenceRange.end;
		})());
		if (input.occurrence === undefined) {
			input.tree.roots.length = 0; input.tree.rows.length = 0; input.tree.selectionIndex = -1;
			input.status = 'Producer call removed or incomplete; source and Undo remain available.';
			return;
		}
		const reader = new LuaSourceReader(snapshot);
		projectLuaProgram(input.tree, input.occurrence, reader, file => {
			let model = input.sourceModels.get(file.file);
			if (model === undefined) {
				const resource = this.sources.catalog.resolveResource(project.getResourceIdentity(file.file))!;
				model = resolveLuaTextFileModel(editorTextModelService, this.sources.catalog, resource);
				input.sourceModels.set(file.file, model);
			}
			return model;
		});
		// Previously presented documents retain this view's Save / Undo ownership
		// when an import is removed, including edits waiting to be saved or redone.
		input.publishModels();
		input.status = reader.syntaxComplete ? 'Authored Lua / Save and Hot Resume apply changes' : 'Incomplete syntax / source editing required';
	}
	public openSource(group: EditorGroupView, input: LuaProgramInput): void {
		const row = input.liveVisible ? undefined : input.tree.rows[input.tree.selectionIndex]?.element;
		const file = row?.file ?? input.occurrence?.file;
		const range = file === undefined ? undefined : file.chunk.locations.range((row?.expression ?? input.occurrence!.call.expression).span);
		this.navigation.focusChunkSource(group, file === undefined ? input.workingCopy.resource : input.sourceModels.get(file.file)!.resource,
			range === undefined ? null : { row: range.start.line - 1, startColumn: range.start.column - 1, endColumn: range.start.column - 1 });
	}
	public chooseInstance(input: LuaProgramInput): void {
		input.running = false;
		const choices: Array<ProgramInstanceChoice & { domain: ResourceDomain; image: Blua32SourceImage }> = [];
		for (const domain of [SYSTEM_RESOURCE_DOMAIN, ...CARTRIDGE_RESOURCE_DOMAINS] as const) {
			const image = domain === SYSTEM_RESOURCE_DOMAIN ? this.sources.currentBlua32Media.system : this.sources.currentBlua32Media.cartridgeSlots[domain];
			if (image === null || image.sourceContextId !== input.workingCopy.resource.contextId) continue;
			for (const item of readProgramInstances(this.sources, this.guest, domain, input.programKind)) {
				choices.push({ ...item, domain, image, detail: `Physical ${domain} / ${item.detail}` });
			}
		}
		this.quickInput.pick('LIVE PROGRAM INSTANCE', 'Actual mounted contexts / components; no source-ID guess', (_origin, lifetime) => {
			lifetime.add({ dispose: this.guest.onDidInvalidate(() => this.quickInput.hide()) });
			return new TextQuickPickProvider(choices);
		}, item => {
			input.instance = item.identity; input.instanceLabel = item.label; input.runtimeDomain = item.domain; input.runtimeImage = item.image;
			input.programHashId = 0; input.stateHashId = 0; input.stateRevision = -1;
			input.liveVisible = true; input.liveDirty = true;
		});
	}
	public add(input: LuaProgramInput): void {
		const property = input.tree.rows[input.tree.selectionIndex]?.element ?? input.tree.roots[0]?.element;
		const target = property?.table;
		if (target === undefined || !target.structural) return;
		const model = input.sourceModels.get(target.file.file)!;
		const entry = programEntryTemplate(input.programKind, property);
		if (entry !== undefined) {
			this.quickInput.input('ADD ENTRY', 'Authored Lua table', entry,
				async text => validateLuaTableFieldExpression(text), value => model.pushEditOperations(
					createLuaTableFieldsInsertionEdits(model.buffer, target.file.chunk, target.table, target.table.fields.length, [value])), lifetime => {
					lifetime.add({ dispose: input.onDidInvalidateProjection(() => this.quickInput.hide()) });
				});
			return;
		}
		const existing = new Set(target.table.fields.map(staticLuaTableFieldName));
		const choices = programFieldTemplates(input.programKind, property).filter(item => !existing.has(item.name))
			.map(item => ({ ...item, label: item.name, description: '', detail: item.value }));
		choices.push({ name: '', value: '', label: 'Custom field', description: 'Lua table field', detail: 'Handlers, event matchers, custom commands and authored extensions' });
		this.quickInput.pick('ADD PROPERTY', 'Canonical Lua table field', (_origin, lifetime) => {
			lifetime.add({ dispose: input.onDidInvalidateProjection(() => this.quickInput.hide()) });
			return new TextQuickPickProvider(choices);
		}, item => {
			this.quickInput.input(item.label, item.name === '' ? 'Complete Lua field: name = expression or [key] = expression' : 'Lua expression', item.value,
				async text => {
					if (item.name !== '') return formatLuaTableFieldSource(item.name, validateLuaTableFieldExpression(text));
					// Admit a complete authored table field through the same Lua grammar as source insertion.
					validateLuaTableFieldExpression(`{ ${text} }`);
					return text;
				}, value => model.pushEditOperations(
					createLuaTableFieldsInsertionEdits(model.buffer, target.file.chunk, target.table, target.table.fields.length, [value])), lifetime => {
					lifetime.add({ dispose: input.onDidInvalidateProjection(() => this.quickInput.hide()) });
				});
		});
	}
	public remove(input: LuaProgramInput): void {
		const property = input.tree.rows[input.tree.selectionIndex].element;
		input.tree.selectionIndex = -1;
		input.sourceModels.get(property.file.file)!.pushEditOperations(createLuaTableFieldRemovalEdits(
			input.sourceModels.get(property.file.file)!.buffer, property.file.chunk.locations, property.file.chunk.tokens, property.field!));
	}
}
