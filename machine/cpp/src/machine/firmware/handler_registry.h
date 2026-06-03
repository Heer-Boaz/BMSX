#pragma once

#include "machine/cpu/cpu.h"
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

namespace bmsx {

struct LuaFunctionRedirectRecord {
	std::string key;
	std::string moduleId;
	std::vector<std::string> path;
	Value current = valueNil();
	Value redirect = valueNil();
};

class Runtime;

class LuaFunctionRedirectCache {
public:
	Value getOrCreate(Runtime& runtime, std::string_view moduleId, const std::vector<std::string>& path, Value fn);
	const LuaFunctionRedirectRecord* find(std::string_view key) const;

private:
	LuaFunctionRedirectRecord& createRecord(Runtime& runtime, std::string_view moduleId, std::string key, const std::vector<std::string>& path, Value fn);
	static std::string buildKey(std::string_view moduleId, const std::vector<std::string>& path);

	std::unordered_map<std::string, LuaFunctionRedirectRecord> m_byKey;
};

} // namespace bmsx
