-- analysis_cache.lua

local parse = require("parse")
local source_text = require("source_text")

local analysis_cache = {}

local max_analysis_cache_entries = 24
local analysis_cache = {}
local analysis_cache_size = 0
local access_tick = 0

local function next_access_tick()
	access_tick = access_tick + 1
	return access_tick
end

local function evict_if_needed()
	if analysis_cache_size <= max_analysis_cache_entries then
		return
	end
	local oldest_key = nil
	local oldest_access = math.huge
	for key, entry in pairs(analysis_cache) do
		if entry.last_access_ms < oldest_access then
			oldest_key = key
			oldest_access = entry.last_access_ms
		end
	end
	if oldest_key ~= nil then
		analysis_cache[oldest_key] = nil
		analysis_cache_size = analysis_cache_size - 1
	end
end

function analysis_cache.get_cached_parse(options)
	local cache_key = options.path
	local version = options.version
	local cached = analysis_cache[cache_key]
	if cached then
		local version_matches = version ~= nil and cached.version == version
		if version_matches or cached.source == options.source then
			cached.last_access_ms = next_access_tick()
			return cached
		end
	end
	local resolved_lines = options.lines or source_text.split_text(options.source)
	local parsed = options.parsed or parse.parse_lua_chunk_with_recovery(options.source, options.path, resolved_lines)
	local entry = {
		path = options.path,
		source = options.source,
		version = version,
		lines = resolved_lines,
		parsed = parsed,
		syntax_error = parsed.syntax_error,
		last_access_ms = next_access_tick(),
	}
	if not cached then
		analysis_cache_size = analysis_cache_size + 1
	end
	analysis_cache[cache_key] = entry
	evict_if_needed()
	return entry
end

function analysis_cache.invalidate_lua_analysis(path)
	if analysis_cache[path] ~= nil then
		analysis_cache[path] = nil
		analysis_cache_size = analysis_cache_size - 1
	end
end

return analysis_cache
