/*
 * binencoder.cpp - Binary encoder/decoder implementation
 */

#include "binencoder.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <limits>
#include <stdexcept>
#include <unordered_set>

namespace bmsx {

/* ============================================================================
 * BinValue implementation
 * ============================================================================ */

static const BinValue NULL_VALUE = BinValue(nullptr);

namespace {

static uint32_t readLittleU32(const u8* data) {
	return static_cast<uint32_t>(data[0])
		| (static_cast<uint32_t>(data[1]) << 8)
		| (static_cast<uint32_t>(data[2]) << 16)
		| (static_cast<uint32_t>(data[3]) << 24);
}

static uint64_t readLittleU64(const u8* data) {
	return static_cast<uint64_t>(data[0])
		| (static_cast<uint64_t>(data[1]) << 8)
		| (static_cast<uint64_t>(data[2]) << 16)
		| (static_cast<uint64_t>(data[3]) << 24)
		| (static_cast<uint64_t>(data[4]) << 32)
		| (static_cast<uint64_t>(data[5]) << 40)
		| (static_cast<uint64_t>(data[6]) << 48)
		| (static_cast<uint64_t>(data[7]) << 56);
}

static void appendLittleU32(std::vector<u8>& out, uint32_t value) {
	out.push_back(static_cast<u8>(value & 0xFFu));
	out.push_back(static_cast<u8>((value >> 8) & 0xFFu));
	out.push_back(static_cast<u8>((value >> 16) & 0xFFu));
	out.push_back(static_cast<u8>((value >> 24) & 0xFFu));
}

static void appendLittleU64(std::vector<u8>& out, uint64_t value) {
	out.push_back(static_cast<u8>(value & 0xFFu));
	out.push_back(static_cast<u8>((value >> 8) & 0xFFu));
	out.push_back(static_cast<u8>((value >> 16) & 0xFFu));
	out.push_back(static_cast<u8>((value >> 24) & 0xFFu));
	out.push_back(static_cast<u8>((value >> 32) & 0xFFu));
	out.push_back(static_cast<u8>((value >> 40) & 0xFFu));
	out.push_back(static_cast<u8>((value >> 48) & 0xFFu));
	out.push_back(static_cast<u8>((value >> 56) & 0xFFu));
}

class BinWriter {
public:
	explicit BinWriter(size_t capacityHint) {
		m_buf.reserve(capacityHint > 0 ? capacityHint : 64 * 1024);
	}

	std::vector<u8> finish() {
		return std::move(m_buf);
	}

	void writeWithPropTable(const BinValue& value, const std::unordered_map<std::string, uint32_t>& propNameToId) {
		if (value.isNull()) {
			u8Value(static_cast<u8>(BinTag::Null));
			return;
		}
		if (value.isBool()) {
			u8Value(value.asBool() ? static_cast<u8>(BinTag::True) : static_cast<u8>(BinTag::False));
			return;
		}
		if (value.isInt()) {
			writeInteger(value.asInt());
			return;
		}
		if (value.isF32()) {
			const f32 number = value.asF32();
			u8Value(static_cast<u8>(BinTag::F32));
			writeF32(number);
			return;
		}
		if (value.isF64()) {
			writeNumber(value.asF64());
			return;
		}
		if (value.isString()) {
			u8Value(static_cast<u8>(BinTag::Str));
			writeString(value.asString());
			return;
		}
		if (value.isArray()) {
			const BinArray& array = value.asArray();
			u8Value(static_cast<u8>(BinTag::Arr));
			writeVarUint(static_cast<uint32_t>(array.size()));
			for (const BinValue& entry : array) {
				writeWithPropTable(entry, propNameToId);
			}
			return;
		}
		if (value.isBinary()) {
			const BinBinary& binary = value.asBinary();
			u8Value(static_cast<u8>(BinTag::Bin));
			writeVarUint(static_cast<uint32_t>(binary.size()));
			m_buf.insert(m_buf.end(), binary.begin(), binary.end());
			return;
		}
		if (value.isObject()) {
			const BinObject& object = value.asObject();
			if (object.size() == 1) {
				auto ref = object.find("r");
				if (ref != object.end()) {
					u8Value(static_cast<u8>(BinTag::Ref));
					writeVarUint(readRefId(ref->second));
					return;
				}
			}
			std::vector<std::pair<uint32_t, const BinValue*>> entries;
			entries.reserve(object.size());
			for (const auto& [key, entryValue] : object) {
				auto prop = propNameToId.find(key);
				if (prop == propNameToId.end()) {
					throw BMSX_RUNTIME_ERROR("BinEncoder: unknown property '" + key + "'.");
				}
				entries.emplace_back(prop->second, &entryValue);
			}
			std::sort(entries.begin(), entries.end(), [](const auto& left, const auto& right) {
				return left.first < right.first;
			});
			u8Value(static_cast<u8>(BinTag::Obj));
			writeVarUint(static_cast<uint32_t>(entries.size()));
			for (const auto& [propId, entryValue] : entries) {
				writeVarUint(propId);
				writeWithPropTable(*entryValue, propNameToId);
			}
			return;
		}
		throw BMSX_RUNTIME_ERROR("BinEncoder: unsupported value.");
	}

	void writeVersioned(const BinValue& value, const std::vector<std::string>& propNames) {
		u8Value(BINENC_VERSION);
		writeVarUint(static_cast<uint32_t>(propNames.size()));
		for (const std::string& propName : propNames) {
			writeString(propName);
		}
		std::unordered_map<std::string, uint32_t> propNameToId;
		propNameToId.reserve(propNames.size());
		for (size_t index = 0; index < propNames.size(); ++index) {
			propNameToId.emplace(propNames[index], static_cast<uint32_t>(index));
		}
		writeWithPropTable(value, propNameToId);
	}

private:
	std::vector<u8> m_buf;

	void u8Value(u8 value) {
		m_buf.push_back(value);
	}

	void writeF32(f32 value) {
		uint32_t raw = 0;
		std::memcpy(&raw, &value, sizeof(raw));
		appendLittleU32(m_buf, raw);
	}

	void writeF64(f64 value) {
		uint64_t raw = 0;
		std::memcpy(&raw, &value, sizeof(raw));
		appendLittleU64(m_buf, raw);
	}

	void writeVarUint(uint32_t value) {
		while (value >= 0x80u) {
			u8Value(static_cast<u8>((value & 0x7Fu) | 0x80u));
			value >>= 7;
		}
		u8Value(static_cast<u8>(value));
	}

	void writeVarInt(i64 value) {
		uint64_t zigzag = (static_cast<uint64_t>(value) << 1) ^ static_cast<uint64_t>(value >> 63);
		while (zigzag >= 0x80u) {
			u8Value(static_cast<u8>((zigzag & 0x7Fu) | 0x80u));
			zigzag >>= 7;
		}
		u8Value(static_cast<u8>(zigzag));
	}

	void writeString(const std::string& value) {
		writeVarUint(static_cast<uint32_t>(value.size()));
		m_buf.insert(m_buf.end(), value.begin(), value.end());
	}

	void writeInteger(i64 value) {
		if (value >= static_cast<i64>(std::numeric_limits<int32_t>::min())
			&& value <= static_cast<i64>(std::numeric_limits<int32_t>::max())) {
			u8Value(static_cast<u8>(BinTag::Int));
			writeVarInt(value);
			return;
		}
		u8Value(static_cast<u8>(BinTag::F64));
		writeF64(static_cast<f64>(value));
	}

	void writeNumber(f64 value) {
		if (std::isnan(value)) {
			u8Value(static_cast<u8>(BinTag::F32));
			writeF32(static_cast<f32>(value));
			return;
		}
		if (std::signbit(value) && value == 0.0) {
			u8Value(static_cast<u8>(BinTag::F32));
			writeF32(static_cast<f32>(value));
			return;
		}
		const auto integer = static_cast<i64>(value);
		if (static_cast<f64>(integer) == value
			&& integer >= static_cast<i64>(std::numeric_limits<int32_t>::min())
			&& integer <= static_cast<i64>(std::numeric_limits<int32_t>::max())) {
			u8Value(static_cast<u8>(BinTag::Int));
			writeVarInt(integer);
			return;
		}
		const f32 f32Value = static_cast<f32>(value);
		if (static_cast<f64>(f32Value) == value) {
			u8Value(static_cast<u8>(BinTag::F32));
			writeF32(f32Value);
			return;
		}
		u8Value(static_cast<u8>(BinTag::F64));
		writeF64(value);
	}

	static uint32_t readRefId(const BinValue& value) {
		if (value.isInt()) {
			const i64 refId = value.asInt();
			if (refId < 0 || refId > static_cast<i64>(UINT32_MAX)) {
				throw BMSX_RUNTIME_ERROR("BinEncoder: ref id out of range.");
			}
			return static_cast<uint32_t>(refId);
		}
		if (value.isF32()) {
			const f32 refId = value.asF32();
			if (refId < 0.0f || std::floor(refId) != refId) {
				throw BMSX_RUNTIME_ERROR("BinEncoder: invalid ref id.");
			}
			return static_cast<uint32_t>(refId);
		}
		if (value.isF64()) {
			const f64 refId = value.asF64();
			if (refId < 0.0 || std::floor(refId) != refId || refId > static_cast<f64>(UINT32_MAX)) {
				throw BMSX_RUNTIME_ERROR("BinEncoder: invalid ref id.");
			}
			return static_cast<uint32_t>(refId);
		}
		throw BMSX_RUNTIME_ERROR("BinEncoder: ref id must be numeric.");
	}
};

void collectPropNames(
	const BinValue& value,
	std::unordered_map<std::string, uint32_t>& propNameToId,
	std::vector<std::string>& propNames,
	std::unordered_set<const BinObject*>& seenObjects
) {
	if (value.isArray()) {
		for (const BinValue& entry : value.asArray()) {
			collectPropNames(entry, propNameToId, propNames, seenObjects);
		}
		return;
	}
	if (!value.isObject()) {
		return;
	}
	const BinObject& object = value.asObject();
	if (!seenObjects.insert(&object).second) {
		return;
	}
	if (object.size() == 1 && object.find("r") != object.end()) {
		return;
	}
	for (const auto& [key, entryValue] : object) {
		if (propNameToId.find(key) == propNameToId.end()) {
			propNameToId.emplace(key, static_cast<uint32_t>(propNames.size()));
			propNames.push_back(key);
		}
		collectPropNames(entryValue, propNameToId, propNames, seenObjects);
	}
}

} // namespace

f64 BinValue::toNumber() const {
	if (isInt()) return static_cast<f64>(asInt());
	if (isF32()) return static_cast<f64>(asF32());
	if (isF64()) return asF64();
	return 0.0;
}

i32 BinValue::toI32() const {
	if (isInt()) return static_cast<i32>(asInt());
	if (isF32()) return static_cast<i32>(asF32());
	if (isF64()) return static_cast<i32>(asF64());
	return 0;
}

const BinValue& BinValue::operator[](const std::string& key) const {
	if (!isObject()) return NULL_VALUE;
	const auto& obj = asObject();
	auto it = obj.find(key);
	return it != obj.end() ? it->second : NULL_VALUE;
}

const BinValue& BinValue::operator[](size_t index) const {
	if (!isArray()) return NULL_VALUE;
	const auto& arr = asArray();
	return index < arr.size() ? arr[index] : NULL_VALUE;
}

bool BinValue::has(const std::string& key) const {
	if (!isObject()) return false;
	const auto& obj = asObject();
	return obj.find(key) != obj.end();
}

const BinValue& BinValue::require(const std::string& key) const {
	if (!isObject()) {
		throw BMSX_RUNTIME_ERROR("BinDecoder: required object field '" + key + "' on non-object value.");
	}
	const auto& obj = asObject();
	auto it = obj.find(key);
	if (it == obj.end()) {
		throw BMSX_RUNTIME_ERROR("BinDecoder: required field missing: '" + key + "'.");
	}
	return it->second;
}

/* ============================================================================
 * BinDecoder implementation
 * ============================================================================ */

BinDecoder::BinDecoder(const u8* data, size_t size)
	: m_data(data), m_size(size), m_pos(0) {
}

u8 BinDecoder::readU8() {
	if (m_pos >= m_size) throw BMSX_RUNTIME_ERROR("BinDecoder: unexpected end of data");
	return m_data[m_pos++];
}

u32 BinDecoder::readVarUint() {
	u32 result = 0;
	u32 shift = 0;
	while (true) {
		u8 b = readU8();
		result |= (b & 0x7F) << shift;
		if ((b & 0x80) == 0) break;
		shift += 7;
		if (shift > 28) throw BMSX_RUNTIME_ERROR("BinDecoder: varuint too large");
	}
	return result;
}

i64 BinDecoder::readVarInt() {
	u64 raw = 0;
	u32 shift = 0;
	while (true) {
		u8 b = readU8();
		raw |= static_cast<u64>(b & 0x7F) << shift;
		if ((b & 0x80) == 0) break;
		shift += 7;
		if (shift > 63) throw BMSX_RUNTIME_ERROR("BinDecoder: varint too large");
	}
	// ZigZag decode: (raw >> 1) ^ -(raw & 1)
	return static_cast<i64>((raw >> 1) ^ (~(raw & 1) + 1));
}

f32 BinDecoder::readF32() {
	if (m_pos + sizeof(uint32_t) > m_size) {
		throw BMSX_RUNTIME_ERROR("BinDecoder: not enough data for f32");
	}
	const uint32_t raw = readLittleU32(m_data + m_pos);
	m_pos += sizeof(uint32_t);
	f32 result = 0.0f;
	std::memcpy(&result, &raw, sizeof(result));
	return result;
}

f64 BinDecoder::readF64() {
	if (m_pos + sizeof(uint64_t) > m_size) {
		throw BMSX_RUNTIME_ERROR("BinDecoder: not enough data for f64");
	}
	const uint64_t raw = readLittleU64(m_data + m_pos);
	m_pos += sizeof(uint64_t);
	f64 result = 0.0;
	std::memcpy(&result, &raw, sizeof(result));
	return result;
}

std::string BinDecoder::readString() {
	u32 len = readVarUint();
	if (m_pos + len > m_size) throw BMSX_RUNTIME_ERROR("BinDecoder: not enough data for string");
	std::string result(reinterpret_cast<const char*>(m_data + m_pos), len);
	m_pos += len;
	return result;
}

BinValue BinDecoder::readValue() {
	BinTag tag = static_cast<BinTag>(readU8());

	switch (tag) {
		case BinTag::Null:
			return BinValue(nullptr);

		case BinTag::True:
			return BinValue(true);

		case BinTag::False:
			return BinValue(false);

		case BinTag::F64:
			return BinValue(readF64());

		case BinTag::F32:
			return BinValue(readF32());

		case BinTag::Int:
			return BinValue(readVarInt());

		case BinTag::Str:
			return BinValue(readString());

		case BinTag::Arr: {
			u32 len = readVarUint();
			BinArray arr;
			arr.reserve(len);
			for (u32 i = 0; i < len; ++i) {
				arr.push_back(readValue());
			}
			return BinValue(std::move(arr));
		}

		case BinTag::Set: {
			// Sets are decoded as arrays
			u32 len = readVarUint();
			BinArray arr;
			arr.reserve(len);
			for (u32 i = 0; i < len; ++i) {
				arr.push_back(readValue());
			}
			return BinValue(std::move(arr));
		}

		case BinTag::Obj: {
			u32 propCount = readVarUint();
			BinObject obj;
			for (u32 i = 0; i < propCount; ++i) {
				u32 propId = readVarUint();
				if (propId >= m_propNames->size()) {
					throw BMSX_RUNTIME_ERROR("BinDecoder: invalid property ID");
				}
				const std::string& key = (*m_propNames)[propId];
				obj[key] = readValue();
			}
			return BinValue(std::move(obj));
		}

		case BinTag::Ref: {
			// References are stored as objects with 'r' property
			i64 refId = static_cast<i64>(readVarUint());
			BinObject obj;
			obj["r"] = BinValue(refId);
			return BinValue(std::move(obj));
		}

		case BinTag::Bin: {
			u32 len = readVarUint();
			if (m_pos + len > m_size) throw BMSX_RUNTIME_ERROR("BinDecoder: not enough data for binary");
			BinBinary bin(m_data + m_pos, m_data + m_pos + len);
			m_pos += len;
			return BinValue(std::move(bin));
		}

		default:
			throw BMSX_RUNTIME_ERROR("BinDecoder: unknown tag");
	}
}

BinValue BinDecoder::decode() {
	// Read version
	u8 version = readU8();
	if (version != BINENC_VERSION) {
		throw BMSX_RUNTIME_ERROR("BinDecoder: unsupported version");
	}

	// Read property name table
	u32 propCount = readVarUint();
	m_ownedPropNames.clear();
	m_ownedPropNames.reserve(propCount);
	for (u32 i = 0; i < propCount; ++i) {
		m_ownedPropNames.push_back(readString());
	}
	m_propNames = &m_ownedPropNames;

	// Read root value
	return readValue();
}

BinValue BinDecoder::decodePayload(const std::vector<std::string>& propNames) {
	m_propNames = &propNames;
	return readValue();
}

/* ============================================================================
 * Convenience functions
 * ============================================================================ */

BinValue decodeBinary(const u8* data, size_t size) {
	BinDecoder decoder(data, size);
	return decoder.decode();
}

BinValue decodeBinary(const std::vector<u8>& data) {
	return decodeBinary(data.data(), data.size());
}

BinValue decodeBinaryWithPropTable(const u8* data, size_t size, const std::vector<std::string>& propNames) {
	BinDecoder decoder(data, size);
	BinValue value = decoder.decodePayload(propNames);
	if (decoder.position() != size) {
		throw BMSX_RUNTIME_ERROR("BinDecoder: trailing bytes after payload decode");
	}
	return value;
}

BinValue decodeBinaryWithPropTable(const std::vector<u8>& data, const std::vector<std::string>& propNames) {
	return decodeBinaryWithPropTable(data.data(), data.size(), propNames);
}

std::vector<std::string> buildBinaryPropTable(const std::vector<BinValue>& values, bool sortProps) {
	std::unordered_map<std::string, uint32_t> propNameToId;
	std::vector<std::string> propNames;
	std::unordered_set<const BinObject*> seenObjects;
	for (const BinValue& value : values) {
		collectPropNames(value, propNameToId, propNames, seenObjects);
	}
	if (sortProps && propNames.size() > 1) {
		std::sort(propNames.begin(), propNames.end());
	}
	return propNames;
}

std::vector<u8> encodeBinaryWithPropTable(const BinValue& value, const std::vector<std::string>& propNames, size_t capacityHint) {
	std::unordered_map<std::string, uint32_t> propNameToId;
	propNameToId.reserve(propNames.size());
	for (size_t index = 0; index < propNames.size(); ++index) {
		propNameToId.emplace(propNames[index], static_cast<uint32_t>(index));
	}
	BinWriter writer(capacityHint);
	writer.writeWithPropTable(value, propNameToId);
	return writer.finish();
}

std::vector<u8> encodeBinary(const BinValue& value, const BinEncodeOptions& options) {
	const std::vector<std::string> propNames = buildBinaryPropTable({value}, options.sortProps);
	BinWriter writer(options.capacityHint);
	writer.writeVersioned(value, propNames);
	return writer.finish();
}

} // namespace bmsx
