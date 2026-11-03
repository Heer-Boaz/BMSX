import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { LuaTableConstructorExpression } from '../../../../toolchain/ts/lua/syntax/ast';
import { staticLuaTableFieldName } from '../../../../toolchain/ts/lua/syntax/table_fields';
import type { ResourceDomain } from '../../../common/resource';
import { showEditorMessage } from '../../../common/feedback_state';
import { readLuaSourceRange } from '../../../language/lua/source_edits';
import type { RuntimeInstalledSourceState } from '../../../runtime/sources';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { findRuntimeActor } from '../actor_lab/runtime';
import type { ActorExecutionOperation, ActorExecutionService } from '../actor_lab/execution';
import { SceneAuthoringContext } from './authoring_context';
import type { SceneLiveIdentity, SceneLiveService, SceneLiveSource } from './live';
import type { SceneSourceDocuments } from './source_documents';

/** One retained source occurrence and its last acknowledged local position.
 * This is correspondence, not another editable Scene or a runtime-to-source decoder. */
export class SceneLivePosition {
	public attached = true;
	public linked = true;
	public operation: ActorExecutionOperation | undefined;
	public readonly fields: string;
	public readonly release: () => void;
	public constructor(public readonly member: SceneLiveIdentity, public readonly authoring: SceneAuthoringContext,
		public x: number, public y: number, public readonly parentHashId: number, changed: () => void) {
		this.fields = this.memberFields()!;
		const unbind = authoring.onDidChangeDocument(changed);
		const unbindDispose = authoring.workingCopy.onWillDispose(() => { this.dispose(); changed(); });
		this.release = () => { unbind(); unbindDispose(); };
	}
	/** A rename, reparent, definition/options change or member move ends this
	 * position-only link. Other Lua remains authored code, not live-patched state. */
	public memberFields(): string | undefined {
		const selection = this.authoring.selection;
		if (selection?.kind !== 'member' || selection.entry.kind !== 'object' || selection.index !== this.member.memberIndex - 1) return;
		const fields = (selection.entry.field.value as LuaTableConstructorExpression).fields;
		const locations = this.authoring.document!.analysis.chunk.locations, buffer = this.authoring.workingCopy.buffer;
		return fields.filter(field => staticLuaTableFieldName(field) !== 'position')
			.map(field => readLuaSourceRange(buffer, locations.range(field.span))).join('\n');
	}
	public dispose(): void {
		if (!this.attached) return;
		this.attached = false; this.release(); this.authoring.dispose();
	}
}

/** Source changes (including shared Undo/Redo) queue ordinary World-admitted
 * position writes. Idle frames do not walk the heap or parse source. */
export class SceneLivePositions {
	private readonly bindings = new Set<SceneLivePosition>();
	private readonly pending = new Set<SceneLivePosition>();
	public constructor(private readonly live: SceneLiveService, private readonly documents: SceneSourceDocuments,
		private readonly sources: RuntimeInstalledSourceState, private readonly guest: SuspendedGuestSession,
		private readonly execution: ActorExecutionService) {}
	public find(domain: ResourceDomain, actorHashId: number): SceneLivePosition | undefined {
		for (const binding of this.bindings) if (binding.attached && binding.member.generation === this.live.executionGeneration
			&& binding.member.domain === domain && binding.member.actorHashId === actorHashId) return binding;
	}
	public source(domain: ResourceDomain, actorHashId: number): SceneLiveSource | undefined {
		const binding = this.find(domain, actorHashId);
		if (binding === undefined) return this.live.source(domain, actorHashId, this.documents);
		const context = binding.authoring;
		context.refresh();
		if (context.subject === undefined || binding.memberFields() !== binding.fields || !this.live.isCurrent(binding.member)) return;
		return { member: binding.member, model: context.workingCopy, version: context.workingCopy.version,
			document: context.document!, scene: context.subject };
	}
	public bind(source: SceneLiveSource): SceneLivePosition | undefined {
		const retained = this.find(source.member.domain, source.member.actorHashId);
		if (retained !== undefined) return retained.linked ? retained : undefined;
		if (source.model.version !== source.version || !this.live.isCurrent(source.member)) return;
		const context = new SceneAuthoringContext(source.model, this.documents,
			{ document: source.document, sourceVersion: source.version, scene: source.scene });
		const index = source.member.memberIndex - 1;
		context.select(source.document, source.version, { kind: 'member', scene: source.scene, entry: source.scene.objects[index], index });
		const local = context.selectedLocalTransform;
		const actor = findRuntimeActor(this.sources, this.guest, source.member.domain, source.member.actorHashId) as Table;
		if (local?.family !== '2d' || this.guest.readStringMember(actor, 'ox') !== local.ox || this.guest.readStringMember(actor, 'oy') !== local.oy) {
			context.dispose(); return;
		}
		const parent = this.guest.readStringMember(actor, 'parent') as Table | null;
		const binding = new SceneLivePosition(source.member, context, local.ox, local.oy, parent === null ? 0 : parent.hashId, () => this.pending.add(binding));
		this.bindings.add(binding); return binding;
	}
	public afterHostFrame(): void {
		if (this.pending.size === 0 || !this.execution.canExecute) return;
		for (const binding of this.pending) {
			if (binding.operation !== undefined) continue;
			this.pending.delete(binding);
			if (!binding.attached || binding.member.generation !== this.live.executionGeneration) {
				binding.dispose(); this.bindings.delete(binding); continue;
			}
			if (!binding.linked) continue;
			const context = binding.authoring;
			context.refresh();
			const local = context.selectedLocalTransform;
			if (local?.family !== '2d' || binding.memberFields() !== binding.fields || !this.live.isCurrent(binding.member)) {
				binding.linked = false; continue;
			}
			const x = local.ox, y = local.oy;
			if (binding.x === x && binding.y === y) continue;
			const operation = binding.operation = this.execution.start({ kind: 'position', target: binding.member,
				fromX: binding.x, fromY: binding.y, parentHashId: binding.parentHashId, x, y }, {
				isCurrent: () => binding.attached && binding.member.generation === this.live.executionGeneration,
				canInvoke: () => {
					context.refresh();
					return binding.memberFields() === binding.fields && this.live.isCurrent(binding.member);
				},
			});
			void operation.completion.then(result => {
				binding.operation = undefined;
				if (!binding.attached) return;
				if (result.status === 'completed') { binding.x = x; binding.y = y; }
				else {
					// Keep the canonical source/history reachable after a rejected
					// runtime edit. Never guess a replacement live pose or undo Lua.
					binding.linked = false; this.pending.delete(binding);
					showEditorMessage('Source position retained, but the live position was not updated. The actor may have moved or its controller may own its position.', 'info', 6);
				}
			});
			break;
		}
	}
	public clear(): void {
		for (const binding of this.bindings) binding.dispose();
		this.bindings.clear(); this.pending.clear();
	}
}
