import { ScratchBuffer } from '../../../../machine/ts/common/scratchbuffer';
import type { CPU, InstructionObserverBinding } from '../../../../machine/ts/machine/cpu/cpu';
import { ValueTag } from '../../../../machine/ts/machine/cpu/value';
import type { ValueSlots } from '../../../../machine/ts/machine/cpu/value_slots';
import { INSTRUCTION_BYTES } from '../../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../../machine/ts/spec/blua32/opcode';
import type { ResourceDomain } from '../../../common/resource';
import type { Blua32ToolingImage } from '../../../../toolchain/ts/rompack/blua32_media';
import { blua32InlineCallSitesAtPc } from '../../../../toolchain/ts/rompack/blua32_symbols';
import type { DecodedInstruction } from '../../../../toolchain/ts/rompack/disassembler';
import { toLuaModulePath } from '../../../../toolchain/ts/lua/module_path';
import { bindFunctionInstructions } from '../../../runtime/instruction_probe';
import type { SuspendedGuestSession } from '../../../runtime/suspended_guest';
import { ActorRenderGeometry, type ActorVisualKind } from './render_geometry';

const CALLS = new Set([OpCode.CALL]);
const STORES = new Set([OpCode.SETFIELD]);
const VISUALS = [
	['cartlib/component/surface_component', 'surface_component.draw_visual', 'surface'],
	['cartlib/component/surface_component', 'surface_component.draw_image_visual', 'surface'],
	['cartlib/component/model_renderer_component', 'renderer.draw_models', 'models'],
	['cartlib/component/sprite_component', 'sprite_component.draw_visual', 'sprite'],
	['cartlib/component/sprite_component', 'sprite_component.draw_region_visual', 'region'],
	['cartlib/component/rectangle_component', 'rectangle_component.draw_rectangle', 'rectangle'],
	['cartlib/text/text_component', 'text_component.draw_visual', 'text'],
] as const;

type RenderPage = { x: number; y: number; order: number; ready: boolean; geometry: ActorRenderGeometry };
type Store = { instruction: DecodedInstruction; kind: 'begin' | 'submit'; inBuild: boolean };

/** Real CALL/return and command-list publication boundaries, not function-entry
 * guesses. All instruction/inline ownership is resolved once for this image. */
export class ActorRenderObservation implements InstructionObserverBinding {
	public readonly points = [new Set<number>(), new Set<number>(), new Set<number>()] as const;
	public readonly pages: RenderPage[] = [];
	private readonly calls: ReadonlyMap<number, DecodedInstruction>;
	private readonly stores = new Map<number, Store>();
	private readonly buildCallSites = new Set<number>();
	private readonly visualKinds = new Map<number, ActorVisualKind>();
	private readonly returns = new ScratchBuffer(() => ({ pc: 0, thread: 0, register: 0, kind: undefined as ActorVisualKind | undefined }));
	private drawHashId = 0;
	private page: RenderPage | undefined;
	public constructor(private readonly cpu: CPU, image: Blua32ToolingImage, private readonly domain: ResourceDomain,
		private readonly guest: SuspendedGuestSession, private readonly order: { value: number }) {
		this.calls = bindFunctionInstructions(image, 'cartlib/world/world', 'world_class._build_render_commands', CALLS) ?? new Map();
		if (this.calls.size === 0) return;
		const symbols = image.symbols!, metadata = symbols.metadata;
		for (const [pc, instruction] of this.calls) {
			this.points[domain + 1].add(pc); this.points[domain + 1].add(instruction.pc + INSTRUCTION_BYTES);
			this.buildCallSites.add(pc); this.buildCallSites.add(instruction.pc);
		}
		let buildId!: string;
		for (let i = 0; i < metadata.functionDefinitions.length; i++) {
			const definition = metadata.functionDefinitions[i];
			if (definition === null) continue;
			const path = toLuaModulePath(definition.path), name = metadata.functionDisplayNames[i];
			if (path === 'cartlib/world/world' && name === 'world_class._build_render_commands') buildId = metadata.functionIds[i];
			for (const [module, draw, kind] of VISUALS) if (path === module && name === draw) this.visualKinds.set(symbols.functionAddresses[i], kind);
		}
		for (const kind of ['begin', 'submit'] as const) {
			const stores = bindFunctionInstructions(image, 'cartlib/gx/command_list', `command_list.${kind}`, STORES);
			if (stores === undefined) continue;
			for (const [pc, instruction] of stores) {
				if (image.layout.constants[instruction.b] !== (kind === 'begin' ? 'drawing_offset' : 'word_count')) continue;
				const chain = blua32InlineCallSitesAtPc(symbols, image.layout.header.textAddress, instruction.pc);
				this.stores.set(pc, { instruction, kind, inBuild: chain.some(site => site.calleeFunctionId === buildId) });
				this.points[domain + 1].add(pc);
			}
		}
	}
	public reset(): void {
		this.page = undefined; this.drawHashId = 0;
		for (const page of this.pages) { page.ready = false; page.order = 0; page.geometry.world.invalidate(); page.geometry.clear(); }
		for (let i = 0; i < this.returns.length; i++) this.returns.peek(i).kind = undefined;
	}
	private insideBuild(inlined: boolean): boolean {
		if (inlined) return true;
		for (let frame = this.cpu.getFrameDepth() - 1; frame > 0; frame--) {
			if (this.cpu.readFrameExecutionDomain(frame - 1) !== this.domain) break;
			if (this.buildCallSites.has(this.cpu.readFrameCallSitePc(frame))) return true;
		}
		return false;
	}
	public observe(_domain: ResourceDomain, pc: number, registers: ValueSlots): void {
		const pending = this.returns.get(this.cpu.getFrameDepth());
		if (pending.kind !== undefined && pending.pc === pc && pending.thread === this.cpu.activeThread.hashId) {
			this.page!.geometry.capture(registers.getTable(pending.register), pending.kind, this.domain, this.guest);
			pending.kind = undefined;
		}
		const call = this.calls.get(pc);
		if (call !== undefined) {
			if (this.page === undefined || registers.getTag(call.a) !== ValueTag.Closure) return;
			pending.kind = this.visualKinds.get(registers.getClosure(call.a).functionAddress);
			pending.pc = call.pc + INSTRUCTION_BYTES; pending.thread = this.cpu.activeThread.hashId; pending.register = call.a + 1;
			return;
		}
		const store = this.stores.get(pc);
		if (store === undefined) return;
		const draw = registers.getTable(store.instruction.a);
		if (store.kind === 'begin') {
			if (!this.insideBuild(store.inBuild)) return;
			const x = this.guest.readStringMember(draw, 'target_x') as number, y = this.guest.readStringMember(draw, 'target_y') as number;
			let page: RenderPage | undefined;
			for (let i = 0; i < this.pages.length; i++) if (this.pages[i].x === x && this.pages[i].y === y) { page = this.pages[i]; break; }
			if (page === undefined) { page = { x, y, order: 0, ready: false, geometry: new ActorRenderGeometry() }; this.pages.push(page); }
			page.order = ++this.order.value; page.ready = false; page.geometry.clear(); this.page = page; this.drawHashId = draw.hashId;
		} else if (draw.hashId === this.drawHashId && !this.insideBuild(store.inBuild)) {
			// DMA submission completed; GPU completion is checked at the device latch.
			this.page!.ready = true;
		}
	}
}
