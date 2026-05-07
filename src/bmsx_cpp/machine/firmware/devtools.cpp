#include "machine/firmware/devtools.h"

#include "machine/runtime/runtime.h"
#include "rompack/loader.h"

#include <unordered_set>
#include <vector>

namespace bmsx {
namespace {

template<typename Fn>
void forEachLuaSource(const RuntimeRomPackage& romPackage, Fn&& fn) {
	for (const auto& entry : romPackage.lua) {
		fn(entry.second);
	}
}

const LuaSourceAsset* resolveLuaSourceByPath(const RuntimeRomPackage& romPackage, const std::string& path) {
	const LuaSourceAsset* direct = romPackage.getLua(path);
	if (direct) {
		return direct;
	}
	forEachLuaSource(romPackage, [&](const LuaSourceAsset& asset) {
		if (direct || asset.path != path) {
			return;
		}
		direct = &asset;
	});
	return direct;
}

void appendUniqueLuaPaths(const RuntimeRomPackage& romPackage, std::unordered_set<std::string>& seen, std::vector<std::string>& out, size_t limit) {
	forEachLuaSource(romPackage, [&](const LuaSourceAsset& asset) {
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
	appendUniqueLuaPaths(runtime.activeRom(), seen, values, limit);
	if (&runtime.systemRom() != &runtime.activeRom()) {
		appendUniqueLuaPaths(runtime.systemRom(), seen, values, limit);
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
	if (const LuaSourceAsset* active = resolveLuaSourceByPath(runtime.activeRom(), path)) {
		return active;
	}
	if (&runtime.systemRom() != &runtime.activeRom()) {
		return resolveLuaSourceByPath(runtime.systemRom(), path);
	}
	return nullptr;
}

std::string getRuntimeLuaEntryPath(Runtime& runtime) {
	const RuntimeRomPackage& romPackage = runtime.activeRom();
	const std::string& entryPath = romPackage.entryPoint;
	if (entryPath.empty()) {
		throw BMSX_RUNTIME_ERROR("[devtools.get_lua_entry_path] Lua entry path is empty.");
	}
	const LuaSourceAsset* source = resolveLuaSourceByPath(romPackage, entryPath);
	return source ? source->path : entryPath;
}

std::string getRuntimeLuaResourceSource(Runtime& runtime, const std::string& path) {
	const LuaSourceAsset* source = resolveRuntimeLuaSource(runtime, path);
	if (!source) {
		throw BMSX_RUNTIME_ERROR("[devtools.get_lua_resource_source] Missing Lua resource for path '" + path + "'. Available: " + summarizeLuaPaths(runtime, 16));
	}
	return source->source;
}

} // namespace

void registerRuntimeDevtoolsTable(Runtime& runtime) {
	CPU& cpu = runtime.machine.cpu;
	auto key = [&runtime](std::string_view name) {
		return runtime.internString(name);
	};
	auto str = [&cpu](const std::string& value) {
		return valueString(cpu.stringPool().intern(value));
	};

	Table* devtools = cpu.createTable(0, 3);
	devtools->set(key("list_lua_resources"), cpu.createNativeFunction("devtools.list_lua_resources", [&runtime, &cpu, key, str](NativeArgsView args, NativeResults& out) {
		(void)args;
		std::unordered_set<std::string> seen;
		std::vector<const LuaSourceAsset*> entries;
		entries.reserve(runtime.activeRom().lua.size() + runtime.systemRom().lua.size());
		auto appendRomPackage = [&](const RuntimeRomPackage& romPackage) {
			forEachLuaSource(romPackage, [&](const LuaSourceAsset& asset) {
				if (!seen.insert(asset.path).second) {
					return;
				}
				entries.push_back(&asset);
			});
		};
		appendRomPackage(runtime.activeRom());
		if (&runtime.systemRom() != &runtime.activeRom()) {
			appendRomPackage(runtime.systemRom());
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
		out.push_back(valueString(runtime.machine.cpu.stringPool().intern(getRuntimeLuaEntryPath(runtime))));
	}));
	devtools->set(key("get_lua_resource_source"), cpu.createNativeFunction("devtools.get_lua_resource_source", [&runtime](NativeArgsView args, NativeResults& out) {
		const std::string& path = runtime.machine.cpu.stringPool().toString(asStringId(args.at(0)));
		out.push_back(valueString(runtime.machine.cpu.stringPool().intern(getRuntimeLuaResourceSource(runtime, path))));
	}));
	runtime.setGlobal("devtools", valueTable(devtools));
}

} // namespace bmsx
