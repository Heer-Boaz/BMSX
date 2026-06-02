#include "machine/firmware/handler_registry.h"

#include "machine/runtime/runtime.h"

namespace bmsx {

Value LuaFunctionRedirectCache::getOrCreate(Runtime& runtime, std::string_view moduleId, const std::vector<std::string>& path, Value fn) {
	const std::string key = buildKey(moduleId, path);
	auto it = m_byKey.find(key);
	if (it == m_byKey.end()) {
		return createRecord(runtime, moduleId, key, path, fn).redirect;
	}
	if (fn == it->second.redirect) {
		return it->second.redirect;
	}
	it->second.current = fn;
	return it->second.redirect;
}

const LuaFunctionRedirectRecord* LuaFunctionRedirectCache::find(std::string_view key) const {
	auto it = m_byKey.find(std::string(key));
	if (it == m_byKey.end()) {
		return nullptr;
	}
	return &it->second;
}

LuaFunctionRedirectRecord& LuaFunctionRedirectCache::createRecord(Runtime& runtime, std::string_view moduleId, std::string key, const std::vector<std::string>& path, Value fn) {
	LuaFunctionRedirectRecord record;
	record.key = key;
	record.moduleId = std::string(moduleId);
	record.path = path;
	record.current = fn;
	LuaFunctionRedirectRecord* target = nullptr;
	auto result = m_byKey.emplace(record.key, std::move(record));
	target = &result.first->second;
	const std::string leaf = path.empty() ? std::string("fn") : path.back();
	target->redirect = runtime.machine.cpu.createNativeFunction("redirect:" + leaf, [&runtime, target](NativeArgsView args, NativeResults& out) {
		if (valueIsNativeFunction(target->current)) {
			asNativeFunction(target->current)->invoke(args, out);
			return;
		}
		runtime.callLuaFunctionInto(asClosure(target->current), args, out);
	});
	return *target;
}

std::string LuaFunctionRedirectCache::buildKey(std::string_view moduleId, const std::vector<std::string>& path) {
	std::string key(moduleId);
	key += "::";
	for (size_t i = 0; i < path.size(); ++i) {
		if (i > 0) {
			key += '.';
		}
		key += path[i];
	}
	return key;
}

} // namespace bmsx
