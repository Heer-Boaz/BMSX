import { buildScenarioCartridge, type BuiltScenarioCartridge } from '../../../../toolchain/ts/rompack/scenario_cartridge';
import type { ScenarioTestSource } from '../../../../toolchain/ts/rompack/scenario_test';
import { LuaInterpreter } from '../../../language/lua/interpreter/interpreter';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { RuntimeSourceState } from '../../../runtime/sources';
import {
	blua32MediaRequiresRebuild,
	buildBlua32Media,
	layoutBlua32MediaInstallation,
	type Blua32MediaInstallation,
} from '../../../runtime/lua_pipeline';

export type PreparedScenarioMedia = {
	readonly interpreter: LuaInterpreter;
	readonly canonical: Blua32MediaInstallation | null;
	readonly scenario: BuiltScenarioCartridge;
};

/** Neither candidate becomes machine media until both builds have succeeded. */
export async function buildScenarioRunMedia(
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	slot: 0 | 1,
	test: ScenarioTestSource,
	ramByteCount: number,
): Promise<PreparedScenarioMedia> {
	const interpreter = new LuaInterpreter(luaTooling.luaJsBridge);
	let canonical: Blua32MediaInstallation | null = null;
	let systemRom = sources.systemRom.bytes;
	let cartridge = sources.cartridgeSlots[slot]!.rom.bytes;
	if (blua32MediaRequiresRebuild(sources)) {
		canonical = layoutBlua32MediaInstallation(sources, buildBlua32Media(
			sources,
			interpreter,
			ramByteCount,
			sources.systemBlua32MediaDirty,
			sources.cartridgeBlua32MediaDirty,
			'boot',
		));
		if (canonical.systemLayer !== null) systemRom = canonical.systemLayer.bytes;
		const layer = canonical.cartridgeLayers[slot];
		if (layer !== null) cartridge = layer.bytes;
	}
	const scenario = await buildScenarioCartridge({
		systemRom,
		cartridge,
		test,
		ramByteCount,
		optLevel: sources.realtimeCompileOptLevel,
	});
	return { interpreter, canonical, scenario };
}
