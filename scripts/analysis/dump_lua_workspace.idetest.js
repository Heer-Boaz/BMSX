// BMSX_LUA_WORKSPACE_DUMP=/tmp/pietious-workspace.json npm run ide:test -- \
//   pietious scripts/analysis/dump_lua_workspace.idetest.js
await t.waitForCart();
const state = t.sourceState();
const files = new Map();
for (const registry of [
	state.cartridgeSlots[state.activeCartridgeSlot].luaSources,
	state.systemLuaSources,
]) {
	for (const record of registry.records) {
		if (!files.has(record.source_path)) {
			files.set(record.source_path, { path: record.source_path, source: record.src });
		}
	}
}
globalThis.process.getBuiltinModule('fs').writeFileSync(
	globalThis.process.env.BMSX_LUA_WORKSPACE_DUMP,
	JSON.stringify(Array.from(files.values())),
);
