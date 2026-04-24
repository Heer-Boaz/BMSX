#include "machine/firmware/devtools.h"

#include "machine/runtime/runtime.h"
#include "machine/runtime/runtime_fault.h"
#include "rompack/assets.h"

#include <unordered_set>
#include <vector>

namespace bmsx {
namespace {

bool matchesLuaPathAlias(const std::string& path, const std::string& alias) {
	if (path == alias) {
		return true;
	}
	if (path.size() <= alias.size()) {
		return false;
	}
	const size_t offset = path.size() - alias.size();
	return path.compare(offset, alias.size(), alias) == 0 && path[offset - 1] == '/';
}

template<typename Fn>
void forEachLuaSource(const RuntimeAssets& assets, Fn&& fn) {
	for (const auto& entry : assets.lua) {
		fn(entry.second);
	}
}

const LuaSourceAsset* resolveLuaSourceByPath(const RuntimeAssets& assets, const std::string& path) {
	const LuaSourceAsset* direct = assets.getLua(path);
	if (direct) {
		return direct;
	}
	const LuaSourceAsset* resolved = nullptr;
	forEachLuaSource(assets, [&](const LuaSourceAsset& asset) {
		if (!matchesLuaPathAlias(asset.path, path)) {
			return;
		}
		if (resolved && resolved->path != asset.path) {
			throw runtimeFault("Ambiguous lua path '" + path + "'.");
		}
		resolved = &asset;
	});
	return resolved;
}

void appendUniqueLuaPaths(const RuntimeAssets& assets, std::unordered_set<std::string>& seen, std::vector<std::string>& out, size_t limit) {
	forEachLuaSource(assets, [&](const LuaSourceAsset& asset) {
		if (out.size() >= limit) {
			return;
		}
		if (!seen.insert(asset.path).second) {
			return;
		}
		out.push_back(asset.path);
	});
}

std::string summarizeLuaPaths(Runtime& runtime, size_t limit) {
	std::unordered_set<std::string> seen;
	std::vector<std::string> values;
	values.reserve(limit);
	appendUniqueLuaPaths(runtime.activeAssets(), seen, values, limit);
	if (&runtime.systemAssets() != &runtime.activeAssets()) {
		appendUniqueLuaPaths(runtime.systemAssets(), seen, values, limit);
	}
	std::string out;
	for (size_t i = 0; i < values.size(); ++i) {
		if (i > 0) {
			out += ", ";
		}
		out += values[i];
	}
	return out;
}

const LuaSourceAsset* resolveRuntimeLuaSource(Runtime& runtime, const std::string& path) {
	if (const LuaSourceAsset* active = resolveLuaSourceByPath(runtime.activeAssets(), path)) {
		return active;
	}
	if (&runtime.systemAssets() != &runtime.activeAssets()) {
		return resolveLuaSourceByPath(runtime.systemAssets(), path);
	}
	return nullptr;
}

std::string getRuntimeLuaEntryPath(Runtime& runtime) {
	const RuntimeAssets& assets = runtime.activeAssets();
	const std::string& entryPath = assets.entryPoint;
	if (entryPath.empty()) {
		throw runtimeFault("[devtools.get_lua_entry_path] Lua entry path is empty.");
	}
	const LuaSourceAsset* source = resolveLuaSourceByPath(assets, entryPath);
	return source ? source->path : entryPath;
}

std::string getRuntimeLuaResourceSource(Runtime& runtime, const std::string& path) {
	const LuaSourceAsset* source = resolveRuntimeLuaSource(runtime, path);
	if (!source) {
		throw runtimeFault("[devtools.get_lua_resource_source] Missing Lua resource for path '" + path + "'. Available: " + summarizeLuaPaths(runtime, 16));
	}
	return source->source;
}

} // namespace

void registerRuntimeDevtoolsTable(Runtime& runtime) {
	CPU& cpu = runtime.machine().cpu();
	auto key = [&runtime](std::string_view name) {
		return runtime.luaKey(name);
	};
	auto str = [&cpu](const std::string& value) {
		return valueString(cpu.internString(value));
	};

	Table* devtools = cpu.createTable(0, 3);
	devtools->set(key("list_lua_resources"), cpu.createNativeFunction("devtools.list_lua_resources", [&runtime, &cpu, key, str](NativeArgsView args, NativeResults& out) {
		(void)args;
		std::unordered_set<std::string> seen;
		std::vector<const LuaSourceAsset*> entries;
		entries.reserve(runtime.activeAssets().lua.size() + runtime.systemAssets().lua.size());
		auto appendAssets = [&](const RuntimeAssets& assets) {
			forEachLuaSource(assets, [&](const LuaSourceAsset& asset) {
				if (!seen.insert(asset.path).second) {
					return;
				}
				entries.push_back(&asset);
			});
		};
		appendAssets(runtime.activeAssets());
		if (&runtime.systemAssets() != &runtime.activeAssets()) {
			appendAssets(runtime.systemAssets());
		}
		Table* table = cpu.createTable(0, static_cast<int>(entries.size()));
		for (size_t index = 0; index < entries.size(); ++index) {
			const LuaSourceAsset& asset = *entries[index];
			Table* descriptor = cpu.createTable(0, 3);
			descriptor->set(key("path"), str(asset.path));
			descriptor->set(key("type"), str("lua"));
			descriptor->set(key("asset_id"), str(asset.id));
			table->set(valueNumber(static_cast<double>(index + 1)), valueTable(descriptor));
		}
		out.push_back(valueTable(table));
	}));
	devtools->set(key("get_lua_entry_path"), cpu.createNativeFunction("devtools.get_lua_entry_path", [&runtime](NativeArgsView args, NativeResults& out) {
		(void)args;
		out.push_back(valueString(runtime.machine().cpu().internString(getRuntimeLuaEntryPath(runtime))));
	}));
	devtools->set(key("get_lua_resource_source"), cpu.createNativeFunction("devtools.get_lua_resource_source", [&runtime](NativeArgsView args, NativeResults& out) {
		const std::string& path = runtime.machine().cpu().stringPool().toString(asStringId(args.at(0)));
		out.push_back(valueString(runtime.machine().cpu().internString(getRuntimeLuaResourceSource(runtime, path))));
	}));
	runtime.setGlobal("devtools", valueTable(devtools));
}

} // namespace bmsx
