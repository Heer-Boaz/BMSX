/*
 * binencoder.cpp - Binary encoder/decoder implementation
 */

#include "binencoder.h"
#include <stdexcept>
#include <cstring>

namespace bmsx {

/* ============================================================================
 * BinValue implementation
 * ============================================================================ */

static const BinValue NULL_VALUE = BinValue(nullptr);

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
	if (m_pos + 4 > m_size) throw BMSX_RUNTIME_ERROR("BinDecoder: not enough data for f32");
	f32 result;
	std::memcpy(&result, m_data + m_pos, sizeof(f32));
	m_pos += sizeof(f32);
	return result;
}

f64 BinDecoder::readF64() {
	if (m_pos + 8 > m_size) throw BMSX_RUNTIME_ERROR("BinDecoder: not enough data for f64");
	f64 result;
	std::memcpy(&result, m_data + m_pos, sizeof(f64));
	m_pos += sizeof(f64);
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
			i64 refId = readVarInt();
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

} // namespace bmsx
