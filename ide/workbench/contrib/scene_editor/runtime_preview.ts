import type { Table } from '../../../../machine/ts/machine/cpu/table';
import type { FrameBitmap } from '../../../../hosts/common/frame_bitmap';
import type { Closure } from '../../../../machine/ts/machine/cpu/closure';
import { valueTag, ValueTag, type Value } from '../../../../machine/ts/machine/cpu/value';
import { sourceRangesEqual, type SourceRange } from '../../../../toolchain/ts/lua/source_range';
import { toLuaModulePath } from '../../../../toolchain/ts/lua/module_path';
import { readRuntimeLuaModuleExport } from '../../../runtime/lua_inspection';
import { SuspendedGuestSession, type SuspendedValueIdentity } from '../../../runtime/suspended_guest';
import { OffscreenExecution } from '../../services/execution/offscreen_execution';
import type { ExecutionMedia } from '../../services/execution/source_media';
import { SceneRegistrationProvenance } from './registration_provenance';
import { ScenePreviewGeometry } from './runtime_geometry';

export type ScenePreviewSubject = { readonly modulePath: string; readonly registration: SourceRange; readonly memberCount: number };
export type ScenePreviewTimeline = { readonly memberIndex: number; readonly key: SuspendedValueIdentity;
	readonly stableKey: string | number | boolean | undefined; readonly label: string; readonly duration: number };

/** A real, private cart boot. The source occurrence selects an instance built by
 * the cart's ordinary initialization, including its caller-owned runtime bindings.
 * Actual component instances own seeking; a registered plan alone is not a launch. */
export class SceneRuntimePreview {
	public readonly execution: OffscreenExecution;
	public readonly guest: SuspendedGuestSession;
	public readonly geometry: ScenePreviewGeometry;
	public readonly frame: FrameBitmap;
	public readonly timelines: ScenePreviewTimeline[] = [];
	public sceneHashId = 0;
	private world!: Table;
	private scene!: Table;
	private disposed = false;
	private readonly memberHashIds: number[] = [];
	public constructor(public readonly media: ExecutionMedia) {
		this.execution = new OffscreenExecution(media);
		this.guest = new SuspendedGuestSession(this.execution.runtime);
		this.geometry = new ScenePreviewGeometry(media, this.guest);
		// Subscribe before any scanout, not after the desired image completed.
		this.frame = this.execution.machine.frameOutput;
	}

	public async initialize(subject: ScenePreviewSubject): Promise<void> {
		const execution = this.execution, cpu = execution.runtime.machine.cpu, guest = this.guest;
		const provenance = new SceneRegistrationProvenance(cpu, this.media.currentBlua32Media.cartridgeSlots[0]!, 0);
		cpu.setInstructionObserver(provenance);
		let selected: Table | null = null;
		try {
			if (this.media.fixture !== undefined) {
				const context = await execution.initializeFixture();
				selected = guest.readStringMember(context, 'scene') as Table | null;
				if (selected === null) throw new Error('The integration setup must assign its initialized Scene instance to t.scene.');
			}
			await execution.advanceUntil(() => {
				const exported = readRuntimeLuaModuleExport(this.media, guest, 0, 'cartlib/world/world');
				if (exported.kind !== 'value' || exported.value === null) return false;
				this.world = exported.value as Table; return true;
			});
			await execution.runUntil(() => cpu.readExceptionReturnFrameDepth() === -1);
			const [receipt] = await execution.call(0, guest.readStringMember(this.world, 'request_mutation_boundary') as Closure, [this.world]);
			const reached = cpu.stringPool.find('reached')!;
			await execution.runUntil(() => (receipt as Table).getStringKey(reached) === true);
		} finally { cpu.setInstructionObserver(null); }

		const plans = new Set<number>();
		for (const registration of provenance.plans.values()) if (registration.calls.some(range => toLuaModulePath(range.path) === subject.modulePath
			&& sourceRangesEqual({ ...range, path: subject.registration.path }, subject.registration))) plans.add(registration.planHashId);
		let scene: Table | undefined;
		if (selected !== null) {
			if (guest.readStringMember(selected, 'closed') === true || !plans.has((guest.readStringMember(selected, 'definition') as Table).hashId))
				throw new Error('The setup-selected Scene is not a live instance of this authored declaration.');
			scene = selected;
		} else {
			const objects = guest.readStringMember(this.world, '_objects') as Table;
			for (let index = 1; index <= objects.arrayLength; index++) {
				const candidate = guest.readStringMember(objects.getInteger(index), 'scene') as Table | null;
				if (candidate === null || !plans.has((guest.readStringMember(candidate, 'definition') as Table).hashId)) continue;
				if (scene !== undefined && scene.hashId !== candidate.hashId) throw new Error('This plan has multiple initialized instances; choose a setup that assigns the intended instance to t.scene.');
				scene = candidate;
			}
		}
		if (scene === undefined) throw new Error('Cart startup did not initialize this Scene. Choose an integration setup that supplies its runtime bindings and assigns t.scene.');
		this.scene = scene;
		this.sceneHashId = scene.hashId;
		const members = guest.readStringMember(scene, '_members_by_index') as Table;
		for (let index = 1; index <= subject.memberCount; index++) {
			const member = members.getInteger(index) as Table | null;
			if (member === null) continue; // A live scene may have disposed an authored member.
			this.memberHashIds[index] = member.hashId;
			const component = guest.readStringMember(member, 'timelines');
			if (component === null) continue;
			guest.visitTableEntries(guest.readStringMember(component, '_entries_by_id'), (key, entry) => {
				const program = guest.readStringMember(entry, 'program');
				const duration = guest.readStringMember(program, 'duration_ms') as number | null;
				if (duration === null) return;
				const tag = valueTag(key);
				const stableKey = tag === ValueTag.String ? guest.formatValue(key) : tag === ValueTag.Number || tag === ValueTag.True || tag === ValueTag.False
					? key as number | boolean : undefined;
				this.timelines.push({ memberIndex: index, key: guest.identity(key), stableKey,
					label: `${guest.formatValue(guest.readStringMember(member, 'scene_member_id'))}: ${guest.formatValue(key)}`,
					duration });
			});
		}
		await this.render();
	}

	public async seek(timeline: ScenePreviewTimeline, time: number): Promise<void> {
		const guest = this.guest, members = guest.readStringMember(this.scene, '_members_by_index') as Table;
		const member = members.getInteger(timeline.memberIndex) as Table | null;
		if (member === null || member.hashId !== this.memberHashIds[timeline.memberIndex]) throw new Error('The timeline member is no longer admitted to the Scene.');
		const component = guest.readStringMember(member, 'timelines') as Table | null;
		if (component === null) throw new Error('The timeline component was detached.');
		let key: Value = null;
		guest.visitTableEntries(guest.readStringMember(component, '_entries_by_id'), candidate => {
			if (guest.matchesIdentity(candidate, timeline.key)) key = candidate;
		});
		if (key === null) throw new Error('The selected timeline no longer exists.');
		await this.execution.call(0, guest.readStringMember(component, 'seek_time') as Closure, [component, key, time]);
		await this.render();
	}

	private async render(): Promise<void> {
		const machine = this.execution.machine, runtime = machine.runtime, before = runtime.frameScheduler.lastTickSequence;
		await this.execution.call(0, this.guest.readStringMember(this.world, 'render') as Closure, [this.world]);
		// Let a complete scanout interval see the submitted rendering, without
		// resuming the cart update loop (which would undo an explicit seek).
		const wait = this.guest.readStringMember(this.module('cartlib/gx/vblank'), 'wait') as Closure;
		for (let interval = 0; interval < 2; interval++) await this.execution.call(0, wait, []);
		if (this.disposed) return;
		machine.presentation.syncAfterRuntimeUpdate(runtime, before);
		machine.present();
		this.geometry.capture(this.world, this.sceneHashId);
	}
	private module(path: string): Table {
		const exported = readRuntimeLuaModuleExport(this.media, this.guest, 0, path);
		if (exported.kind !== 'value' || valueTag(exported.value) === ValueTag.Nil) throw new Error(`Module '${path}' was not initialized by this cart.`);
		return exported.value as Table;
	}
	public dispose(): Promise<void> {
		this.disposed = true; this.timelines.length = 0; this.geometry.clear();
		return this.execution.dispose();
	}
}
