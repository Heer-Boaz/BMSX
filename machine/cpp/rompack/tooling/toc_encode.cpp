#include "rompack/tooling/toc_encode.h"

#include "common/endian.h"
#include "spec/bmsx/rom_toc.h"

#include <algorithm>
#include <unordered_map>

namespace bmsx {
namespace {

struct TocStringSlice {
	u32 offset = ROM_TOC_INVALID_U32;
	u32 length = 0;
};

auto tocFieldValue(const std::optional<u32>& value) -> u32 {
	return value.has_value() ? *value : ROM_TOC_INVALID_U32;
}

auto tocUpdateLo(const std::optional<f64>& value) -> u32 {
	return value.has_value()
		? static_cast<u32>(static_cast<u64>(*value) & 0xffffffffu)
		: 0u;
}

auto tocUpdateHi(const std::optional<f64>& value) -> u32 {
	return value.has_value()
		? static_cast<u32>(static_cast<u64>(*value) >> 32u)
		: 0u;
}

void writeTocString(
	std::vector<u8>& table,
	std::unordered_map<std::string, TocStringSlice>& index,
	const std::string& text,
	TocStringSlice& out
) {
	if (text.empty()) {
		out = {};
		return;
	}
	const auto found = index.find(text);
	if (found != index.end()) {
		out = found->second;
		return;
	}
	out.offset = static_cast<u32>(table.size());
	out.length = static_cast<u32>(text.size());
	table.insert(table.end(), text.begin(), text.end());
	index.emplace(text, out);
}

auto internTocString(
	std::vector<u8>& table,
	std::unordered_map<std::string, TocStringSlice>& index,
	const std::optional<std::string>& text
) -> TocStringSlice {
	TocStringSlice ref;
	if (text.has_value()) {
		writeTocString(table, index, *text, ref);
	}
	return ref;
}

auto internTocString(
	std::vector<u8>& table,
	std::unordered_map<std::string, TocStringSlice>& index,
	const std::string& text
) -> TocStringSlice {
	TocStringSlice ref;
	writeTocString(table, index, text, ref);
	return ref;
}

} // namespace

auto encodeRomToc(const RomTocPayload& payload) -> std::vector<u8> {
	std::vector<RomTocEntry> entries = payload.entries;
	std::sort(entries.begin(), entries.end(), [](const RomTocEntry& lhs, const RomTocEntry& rhs) {
		return lhs.id_token_hi != rhs.id_token_hi
			? lhs.id_token_hi < rhs.id_token_hi
			: lhs.id_token_lo < rhs.id_token_lo;
	});

	std::vector<u8> stringTable;
	std::unordered_map<std::string, TocStringSlice> stringIndex;
	const TocStringSlice projectRoot = internTocString(
		stringTable,
		stringIndex,
		payload.projectRootPath
	);

	std::vector<u8> out(
		ROM_TOC_HEADER_SIZE + (entries.size() * ROM_TOC_ENTRY_SIZE)
	);
	writeLE32(out.data() + ROM_TOC_HEADER_MAGIC_OFFSET, ROM_TOC_MAGIC);
	writeLE32(out.data() + ROM_TOC_HEADER_SIZE_OFFSET, ROM_TOC_HEADER_SIZE);
	writeLE32(out.data() + ROM_TOC_HEADER_ENTRY_SIZE_OFFSET, ROM_TOC_ENTRY_SIZE);
	writeLE32(
		out.data() + ROM_TOC_HEADER_ENTRY_COUNT_OFFSET,
		static_cast<u32>(entries.size())
	);
	writeLE32(
		out.data() + ROM_TOC_HEADER_ENTRY_TABLE_OFFSET,
		ROM_TOC_HEADER_SIZE
	);
	writeLE32(
		out.data() + ROM_TOC_HEADER_STRING_TABLE_OFFSET,
		ROM_TOC_HEADER_SIZE
			+ static_cast<u32>(entries.size() * ROM_TOC_ENTRY_SIZE)
	);
	writeLE32(out.data() + ROM_TOC_HEADER_STRING_TABLE_LENGTH_OFFSET, 0u);
	writeLE32(
		out.data() + ROM_TOC_HEADER_PROJECT_ROOT_OFFSET,
		projectRoot.offset
	);
	writeLE32(
		out.data() + ROM_TOC_HEADER_PROJECT_ROOT_LENGTH_OFFSET,
		projectRoot.length
	);
	writeLE32(out.data() + ROM_TOC_HEADER_RESERVED_0_OFFSET, 0u);
	writeLE32(out.data() + ROM_TOC_HEADER_RESERVED_1_OFFSET, 0u);
	writeLE32(out.data() + ROM_TOC_HEADER_RESERVED_2_OFFSET, 0u);

	for (size_t index = 0; index < entries.size(); index += 1) {
		const RomTocEntry& source = entries[index];
		const TocStringSlice resid = internTocString(
			stringTable,
			stringIndex,
			source.resid
		);
		const TocStringSlice sourcePath = internTocString(
			stringTable,
			stringIndex,
			source.source_path
		);
		const TocStringSlice normalizedSourcePath = internTocString(
			stringTable,
			stringIndex,
			source.normalized_source_path
		);
		const u32 opId = source.op.has_value()
			? static_cast<u32>(*source.op)
			: ROM_TOC_OP_NONE;
		u8* entry = out.data()
			+ ROM_TOC_HEADER_SIZE
			+ (index * ROM_TOC_ENTRY_SIZE);
		writeLE32(entry + ROM_TOC_ENTRY_TOKEN_LO_OFFSET, source.id_token_lo);
		writeLE32(entry + ROM_TOC_ENTRY_TOKEN_HI_OFFSET, source.id_token_hi);
		writeLE32(
			entry + ROM_TOC_ENTRY_ASSET_TYPE_OFFSET,
			assetTypeToId(source.type)
		);
		writeLE32(entry + ROM_TOC_ENTRY_OPERATION_OFFSET, opId);
		writeLE32(entry + ROM_TOC_ENTRY_RESID_OFFSET, resid.offset);
		writeLE32(entry + ROM_TOC_ENTRY_RESID_LENGTH_OFFSET, resid.length);
		writeLE32(
			entry + ROM_TOC_ENTRY_SOURCE_PATH_OFFSET,
			sourcePath.offset
		);
		writeLE32(
			entry + ROM_TOC_ENTRY_SOURCE_PATH_LENGTH_OFFSET,
			sourcePath.length
		);
		writeLE32(
			entry + ROM_TOC_ENTRY_NORMALIZED_SOURCE_PATH_OFFSET,
			normalizedSourcePath.offset
		);
		writeLE32(
			entry + ROM_TOC_ENTRY_NORMALIZED_SOURCE_PATH_LENGTH_OFFSET,
			normalizedSourcePath.length
		);
		writeLE32(
			entry + ROM_TOC_ENTRY_DATA_START_OFFSET,
			tocFieldValue(source.start)
		);
		writeLE32(
			entry + ROM_TOC_ENTRY_DATA_END_OFFSET,
			tocFieldValue(source.end)
		);
		writeLE32(
			entry + ROM_TOC_ENTRY_COMPILED_START_OFFSET,
			tocFieldValue(source.compiled_start)
		);
		writeLE32(
			entry + ROM_TOC_ENTRY_COMPILED_END_OFFSET,
			tocFieldValue(source.compiled_end)
		);
		writeLE32(
			entry + ROM_TOC_ENTRY_METADATA_START_OFFSET,
			tocFieldValue(source.metabuffer_start)
		);
		writeLE32(
			entry + ROM_TOC_ENTRY_METADATA_END_OFFSET,
			tocFieldValue(source.metabuffer_end)
		);
		writeLE32(
			entry + ROM_TOC_ENTRY_MODEL_TEXTURE_START_OFFSET,
			tocFieldValue(source.model_texture_start)
		);
		writeLE32(
			entry + ROM_TOC_ENTRY_MODEL_TEXTURE_END_OFFSET,
			tocFieldValue(source.model_texture_end)
		);
		writeLE32(
			entry + ROM_TOC_ENTRY_COLLISION_BIN_START_OFFSET,
			tocFieldValue(source.collision_bin_start)
		);
		writeLE32(
			entry + ROM_TOC_ENTRY_COLLISION_BIN_END_OFFSET,
			tocFieldValue(source.collision_bin_end)
		);
		writeLE32(
			entry + ROM_TOC_ENTRY_UPDATE_TIMESTAMP_LO_OFFSET,
			tocUpdateLo(source.update_timestamp)
		);
		writeLE32(
			entry + ROM_TOC_ENTRY_UPDATE_TIMESTAMP_HI_OFFSET,
			tocUpdateHi(source.update_timestamp)
		);
	}

	writeLE32(
		out.data() + ROM_TOC_HEADER_STRING_TABLE_LENGTH_OFFSET,
		static_cast<u32>(stringTable.size())
	);
	out.insert(out.end(), stringTable.begin(), stringTable.end());
	return out;
}

} // namespace bmsx
