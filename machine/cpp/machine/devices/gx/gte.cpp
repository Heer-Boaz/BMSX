#include "machine/devices/gx/gte.h"

#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/memory.h"

#include <bit>

namespace bmsx {
namespace {

constexpr i64 int44Max = 0x7ffffffffffll;
constexpr i64 int44Min = -0x80000000000ll;
constexpr i64 int44Range = 0x100000000000ll;

constexpr std::array<u8, 257> gteDivideTable{{
	0xff, 0xfd, 0xfb, 0xf9, 0xf7, 0xf5, 0xf3, 0xf1, 0xef, 0xee, 0xec, 0xea, 0xe8, 0xe6, 0xe4, 0xe3,
	0xe1, 0xdf, 0xdd, 0xdc, 0xda, 0xd8, 0xd6, 0xd5, 0xd3, 0xd1, 0xd0, 0xce, 0xcd, 0xcb, 0xc9, 0xc8,
	0xc6, 0xc5, 0xc3, 0xc1, 0xc0, 0xbe, 0xbd, 0xbb, 0xba, 0xb8, 0xb7, 0xb5, 0xb4, 0xb2, 0xb1, 0xb0,
	0xae, 0xad, 0xab, 0xaa, 0xa9, 0xa7, 0xa6, 0xa4, 0xa3, 0xa2, 0xa0, 0x9f, 0x9e, 0x9c, 0x9b, 0x9a,
	0x99, 0x97, 0x96, 0x95, 0x94, 0x92, 0x91, 0x90, 0x8f, 0x8d, 0x8c, 0x8b, 0x8a, 0x89, 0x87, 0x86,
	0x85, 0x84, 0x83, 0x82, 0x81, 0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x7a, 0x79, 0x78, 0x77, 0x75, 0x74,
	0x73, 0x72, 0x71, 0x70, 0x6f, 0x6e, 0x6d, 0x6c, 0x6b, 0x6a, 0x69, 0x68, 0x67, 0x66, 0x65, 0x64,
	0x63, 0x62, 0x61, 0x60, 0x5f, 0x5e, 0x5d, 0x5d, 0x5c, 0x5b, 0x5a, 0x59, 0x58, 0x57, 0x56, 0x55,
	0x54, 0x53, 0x53, 0x52, 0x51, 0x50, 0x4f, 0x4e, 0x4d, 0x4d, 0x4c, 0x4b, 0x4a, 0x49, 0x48, 0x48,
	0x47, 0x46, 0x45, 0x44, 0x43, 0x43, 0x42, 0x41, 0x40, 0x3f, 0x3f, 0x3e, 0x3d, 0x3c, 0x3c, 0x3b,
	0x3a, 0x39, 0x39, 0x38, 0x37, 0x36, 0x36, 0x35, 0x34, 0x33, 0x33, 0x32, 0x31, 0x31, 0x30, 0x2f,
	0x2e, 0x2e, 0x2d, 0x2c, 0x2c, 0x2b, 0x2a, 0x2a, 0x29, 0x28, 0x28, 0x27, 0x26, 0x26, 0x25, 0x24,
	0x24, 0x23, 0x22, 0x22, 0x21, 0x20, 0x20, 0x1f, 0x1e, 0x1e, 0x1d, 0x1d, 0x1c, 0x1b, 0x1b, 0x1a,
	0x19, 0x19, 0x18, 0x18, 0x17, 0x16, 0x16, 0x15, 0x15, 0x14, 0x14, 0x13, 0x12, 0x12, 0x11, 0x11,
	0x10, 0x0f, 0x0f, 0x0e, 0x0e, 0x0d, 0x0d, 0x0c, 0x0c, 0x0b, 0x0a, 0x0a, 0x09, 0x09, 0x08, 0x08,
	0x07, 0x07, 0x06, 0x06, 0x05, 0x05, 0x04, 0x04, 0x03, 0x03, 0x02, 0x02, 0x01, 0x01, 0x00, 0x00,
	0x00,
}};

inline i32 sign16(u32 value) {
	return static_cast<i16>(value & 0xffffu);
}

inline i32 highSign16(u32 value) {
	return static_cast<i16>((value >> 16u) & 0xffffu);
}

inline i64 signExtend44(i64 value) {
	if (value > int44Max) {
		return value - int44Range;
	}
	if (value < int44Min) {
		return value + int44Range;
	}
	return value;
}

inline i64 shiftRightSigned(i64 value, u32 bits) {
	return value >> bits;
}

inline i64 shiftGte(i64 value, u32 sf) {
	if (sf > 0u) {
		return shiftRightSigned(value, 12u);
	}
	return value;
}

inline i32 toSigned32(i64 value) {
	return static_cast<i32>(value);
}

u32 countLeadingBits(u32 word) {
	if ((word & 0x80000000u) == 0u) {
		return static_cast<u32>(std::countl_zero(word));
	}
	return static_cast<u32>(std::countl_zero(~word));
}

} // namespace

GxGte::GxGte(Memory& memory)
	: m_memory(memory) {
	for (u32 index = 0u; index < static_cast<u32>(IO_GX_GTE_DATA_REGISTER_COUNT); index += 1u) {
		m_memory.mapIoRead(IO_GX_GTE_DATA0 + index * IO_WORD_SIZE, this, &GxGte::readDataRegisterThunk);
		m_memory.mapIoWrite(IO_GX_GTE_DATA0 + index * IO_WORD_SIZE, this, &GxGte::writeDataRegisterThunk);
	}
	for (u32 index = 0u; index < static_cast<u32>(IO_GX_GTE_CONTROL_REGISTER_COUNT); index += 1u) {
		m_memory.mapIoRead(IO_GX_GTE_CONTROL0 + index * IO_WORD_SIZE, this, &GxGte::readControlRegisterThunk);
		m_memory.mapIoWrite(IO_GX_GTE_CONTROL0 + index * IO_WORD_SIZE, this, &GxGte::writeControlRegisterThunk);
	}
	m_memory.mapIoWrite(IO_GX_GTE_COMMAND, this, &GxGte::writeCommandThunk);
	m_memory.mapIoRead(IO_GX_GTE_CYCLES, this, &GxGte::readCyclesThunk);
}

void GxGte::reset() {
	m_dataRegisterWords.fill(0u);
	m_controlRegisterWords.fill(0u);
	m_mac0 = 0;
	m_mac1 = 0;
	m_mac2 = 0;
	m_mac3 = 0;
	m_accumValue = 0;
	m_accumPositiveOverflow = false;
	m_accumNegativeOverflow = false;
	m_lastCycles = 0u;
	m_memory.writeIoValue(IO_GX_GTE_COMMAND, valueNumber(0.0));
	m_memory.writeIoValue(IO_GX_GTE_CYCLES, valueNumber(0.0));
	m_currentSf = 0u;
}

GxGteState GxGte::captureState() const {
	GxGteState state;
	state.dataRegisterWords = m_dataRegisterWords;
	state.controlRegisterWords = m_controlRegisterWords;
	state.mac0 = m_mac0;
	state.mac1 = m_mac1;
	state.mac2 = m_mac2;
	state.mac3 = m_mac3;
	state.currentSf = m_currentSf;
	state.lastCycles = m_lastCycles;
	return state;
}

void GxGte::restoreState(const GxGteState& state) {
	m_dataRegisterWords = state.dataRegisterWords;
	m_controlRegisterWords = state.controlRegisterWords;
	m_mac0 = state.mac0;
	m_mac1 = state.mac1;
	m_mac2 = state.mac2;
	m_mac3 = state.mac3;
	m_currentSf = state.currentSf;
	m_lastCycles = state.lastCycles;
}


u64 GxGte::readDataRegisterThunk(void* context, u32 addr) {
	GxGte& gte = *static_cast<GxGte*>(context);
	return valueNumber(static_cast<double>(gte.readDataRegister((addr - IO_GX_GTE_DATA0) / IO_WORD_SIZE)));
}

void GxGte::writeDataRegisterThunk(void* context, u32 addr, u64 value) {
	GxGte& gte = *static_cast<GxGte*>(context);
	gte.writeDataRegister((addr - IO_GX_GTE_DATA0) / IO_WORD_SIZE, toU32(value));
}

u64 GxGte::readControlRegisterThunk(void* context, u32 addr) {
	GxGte& gte = *static_cast<GxGte*>(context);
	return valueNumber(static_cast<double>(gte.readControlRegister((addr - IO_GX_GTE_CONTROL0) / IO_WORD_SIZE)));
}

void GxGte::writeControlRegisterThunk(void* context, u32 addr, u64 value) {
	GxGte& gte = *static_cast<GxGte*>(context);
	gte.writeControlRegister((addr - IO_GX_GTE_CONTROL0) / IO_WORD_SIZE, toU32(value));
}

void GxGte::writeCommandThunk(void* context, u32 addr, u64 value) {
	(void)addr;
	GxGte& gte = *static_cast<GxGte*>(context);
	gte.m_lastCycles = gte.execute(toU32(value));
	gte.m_memory.writeIoValue(IO_GX_GTE_CYCLES, valueNumber(static_cast<double>(gte.m_lastCycles)));
}

u64 GxGte::readCyclesThunk(void* context, u32 addr) {
	(void)addr;
	GxGte& gte = *static_cast<GxGte*>(context);
	return valueNumber(static_cast<double>(gte.m_lastCycles));
}

u32 GxGte::readDataRegister(u32 index) const {
	switch (index) {
	case 1:
	case 3:
	case 5:
	case 8:
	case 9:
	case 10:
	case 11:
		return static_cast<u32>(sign16(m_dataRegisterWords[index]));
	case 7:
	case 16:
	case 17:
	case 18:
	case 19:
		return m_dataRegisterWords[index] & 0xffffu;
	case 15:
		return m_dataRegisterWords[14];
	case 28:
	case 29:
		return packRgbFromIr();
	default:
		return m_dataRegisterWords[index];
	}
}

void GxGte::writeDataRegister(u32 index, u32 value) {
	switch (index) {
	case 1:
	case 3:
	case 5:
	case 8:
	case 9:
	case 10:
	case 11:
		m_dataRegisterWords[index] = static_cast<u32>(sign16(value));
		break;
	case 7:
	case 16:
	case 17:
	case 18:
	case 19:
		m_dataRegisterWords[index] = value & 0xffffu;
		break;
	case 15:
		m_dataRegisterWords[12] = m_dataRegisterWords[13];
		m_dataRegisterWords[13] = m_dataRegisterWords[14];
		m_dataRegisterWords[14] = value;
		break;
	case 28:
		m_dataRegisterWords[9] = static_cast<u32>(sign16((value & 0x1fu) << 7u));
		m_dataRegisterWords[10] = static_cast<u32>(sign16((value & 0x3e0u) << 2u));
		m_dataRegisterWords[11] = static_cast<u32>(sign16((value & 0x7c00u) >> 3u));
		m_dataRegisterWords[28] = value & 0x7fffu;
		break;
	case 29:
	case 31:
		break;
	case 30:
		m_dataRegisterWords[30] = value;
		m_dataRegisterWords[31] = countLeadingBits(value);
		break;
	default:
		m_dataRegisterWords[index] = value;
		break;
	}
}

u32 GxGte::readControlRegister(u32 index) const {
	return m_controlRegisterWords[index];
}

void GxGte::writeControlRegister(u32 index, u32 value) {
	switch (index) {
	case 4:
	case 12:
	case 20:
	case 26:
	case 27:
	case 29:
	case 30:
		m_controlRegisterWords[index] = static_cast<u32>(sign16(value));
		break;
	case 31:
		m_controlRegisterWords[31] = withFlagError(value & GX_GTE_FLAG_WRITE_MASK);
		break;
	default:
		m_controlRegisterWords[index] = value;
		break;
	}
}

u32 GxGte::execute(u32 opcode) {
	const u32 sf = (opcode >> 19u) & 1u;
	const u32 lm = (opcode >> 10u) & 1u;
	switch (opcode & 0x3fu) {
	case GX_GTE_FN_RTPS:
		m_controlRegisterWords[31] = 0u;
		executeRtps(0u, sf, lm, true);
		updateFlagError();
		return GX_GTE_CYCLES_RTPS;
	case GX_GTE_FN_NCLIP:
		m_controlRegisterWords[31] = 0u;
		executeNclip();
		updateFlagError();
		return GX_GTE_CYCLES_NCLIP;
	case GX_GTE_FN_OP:
		m_controlRegisterWords[31] = 0u;
		executeOp(sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_OP;
	case GX_GTE_FN_DPCS:
		m_controlRegisterWords[31] = 0u;
		executeDpcs(sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_DPCS;
	case GX_GTE_FN_INTPL:
		m_controlRegisterWords[31] = 0u;
		executeIntpl(sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_INTPL;
	case GX_GTE_FN_MVMVA:
		m_controlRegisterWords[31] = 0u;
		executeMvmva(opcode, sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_MVMVA;
	case GX_GTE_FN_NCDS:
		m_controlRegisterWords[31] = 0u;
		executeNcdsForVector(0u, sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_NCDS;
	case GX_GTE_FN_CDP:
		m_controlRegisterWords[31] = 0u;
		executeCdp(sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_CDP;
	case GX_GTE_FN_NCDT:
		m_controlRegisterWords[31] = 0u;
		executeNcdsForVector(0u, sf, lm);
		executeNcdsForVector(1u, sf, lm);
		executeNcdsForVector(2u, sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_NCDT;
	case GX_GTE_FN_NCCS:
		m_controlRegisterWords[31] = 0u;
		executeNccsForVector(0u, sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_NCCS;
	case GX_GTE_FN_CC:
		m_controlRegisterWords[31] = 0u;
		executeCc(sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_CC;
	case GX_GTE_FN_NCS:
		m_controlRegisterWords[31] = 0u;
		executeNcsForVector(0u, sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_NCS;
	case GX_GTE_FN_NCT:
		m_controlRegisterWords[31] = 0u;
		executeNcsForVector(0u, sf, lm);
		executeNcsForVector(1u, sf, lm);
		executeNcsForVector(2u, sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_NCT;
	case GX_GTE_FN_SQR:
		m_controlRegisterWords[31] = 0u;
		executeSqr(sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_SQR;
	case GX_GTE_FN_DCPL:
		m_controlRegisterWords[31] = 0u;
		executeDcpl(sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_DCPL;
	case GX_GTE_FN_DPCT:
		m_controlRegisterWords[31] = 0u;
		executeDpct(sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_DPCT;
	case GX_GTE_FN_AVSZ3:
		m_controlRegisterWords[31] = 0u;
		executeAvsz3();
		updateFlagError();
		return GX_GTE_CYCLES_AVSZ3;
	case GX_GTE_FN_AVSZ4:
		m_controlRegisterWords[31] = 0u;
		executeAvsz4();
		updateFlagError();
		return GX_GTE_CYCLES_AVSZ4;
	case GX_GTE_FN_RTPT:
		m_controlRegisterWords[31] = 0u;
		executeRtps(0u, sf, lm, false);
		executeRtps(1u, sf, lm, false);
		executeRtps(2u, sf, lm, true);
		updateFlagError();
		return GX_GTE_CYCLES_RTPT;
	case GX_GTE_FN_GPF:
		m_controlRegisterWords[31] = 0u;
		executeGpf(sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_GPF;
	case GX_GTE_FN_GPL:
		m_controlRegisterWords[31] = 0u;
		executeGpl(sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_GPL;
	case GX_GTE_FN_NCCT:
		m_controlRegisterWords[31] = 0u;
		executeNccsForVector(0u, sf, lm);
		executeNccsForVector(1u, sf, lm);
		executeNccsForVector(2u, sf, lm);
		updateFlagError();
		return GX_GTE_CYCLES_NCCT;
	default:
		return 0u;
	}
}

void GxGte::setFlag(u32 flag) {
	m_controlRegisterWords[31] |= flag;
}

u32 GxGte::withFlagError(u32 flag) {
	u32 word = flag;
	if ((word & GX_GTE_FLAG_ERROR_MASK) != 0u) {
		word |= GX_GTE_FLAG_ERROR;
	}
	return word;
}

void GxGte::updateFlagError() {
	m_controlRegisterWords[31] = withFlagError(m_controlRegisterWords[31]);
}

i32 GxGte::lim(i32 value, i32 max, i32 min, u32 flag) {
	if (value > max) {
		setFlag(flag);
		return max;
	}
	if (value < min) {
		setFlag(flag);
		return min;
	}
	return value;
}

i32 GxGte::mac(u32 index, i64 value, bool positiveOverflow, bool negativeOverflow) {
	const i32 shifted = toSigned32(shiftGte(value, m_currentSf));
	switch (index) {
	case 1:
		if (positiveOverflow) {
			setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_MAC1_POS);
		}
		if (negativeOverflow) {
			setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_MAC1_NEG);
		}
		m_mac1 = value;
		m_dataRegisterWords[25] = static_cast<u32>(shifted);
		break;
	case 2:
		if (positiveOverflow) {
			setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_MAC2_POS);
		}
		if (negativeOverflow) {
			setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_MAC2_NEG);
		}
		m_mac2 = value;
		m_dataRegisterWords[26] = static_cast<u32>(shifted);
		break;
	case 3:
		if (positiveOverflow) {
			setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_MAC3_POS);
		}
		if (negativeOverflow) {
			setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_MAC3_NEG);
		}
		m_mac3 = value;
		m_dataRegisterWords[27] = static_cast<u32>(shifted);
		break;
	}
	return shifted;
}

i32 GxGte::macSigned44(u32 index, i64 value) {
	return mac(index, signExtend44(value), value > int44Max, value < int44Min);
}

void GxGte::accumulateSigned44(i64 initial, i64 add0, i64 add1, i64 add2) {
	i64 value = signExtend44(initial);
	bool positiveOverflow = initial > int44Max;
	bool negativeOverflow = initial < int44Min;
	i64 next = value + add0;
	i64 wrapped = signExtend44(next);
	positiveOverflow = positiveOverflow || (wrapped < 0 && value >= 0 && add0 >= 0);
	negativeOverflow = negativeOverflow || (wrapped >= 0 && value < 0 && add0 < 0);
	value = wrapped;
	next = value + add1;
	wrapped = signExtend44(next);
	positiveOverflow = positiveOverflow || (wrapped < 0 && value >= 0 && add1 >= 0);
	negativeOverflow = negativeOverflow || (wrapped >= 0 && value < 0 && add1 < 0);
	value = wrapped;
	next = value + add2;
	wrapped = signExtend44(next);
	positiveOverflow = positiveOverflow || (wrapped < 0 && value >= 0 && add2 >= 0);
	negativeOverflow = negativeOverflow || (wrapped >= 0 && value < 0 && add2 < 0);
	m_accumValue = wrapped;
	m_accumPositiveOverflow = positiveOverflow;
	m_accumNegativeOverflow = negativeOverflow;
}


i32 GxGte::limitIr(u32 index, i32 value, u32 lm) {
	const i32 min = lm == 0u ? -0x8000 : 0;
	switch (index) {
	case 1u:
		return lim(value, 0x7fff, min, GX_GTE_FLAG_IR1_SAT);
	case 2u:
		return lim(value, 0x7fff, min, GX_GTE_FLAG_IR2_SAT);
	default:
		return lim(value, 0x7fff, min, GX_GTE_FLAG_IR3_SAT);
	}
}

void GxGte::writeIrFromMac(u32 index, i32 value, u32 lm) {
	m_dataRegisterWords[8u + index] = static_cast<u32>(limitIr(index, value, lm));
}

void GxGte::executeOp(u32 sf, u32 lm) {
	m_currentSf = sf;
	const i32 ir1 = sign16(m_dataRegisterWords[9]);
	const i32 ir2 = sign16(m_dataRegisterWords[10]);
	const i32 ir3 = sign16(m_dataRegisterWords[11]);
	writeIrFromMac(1u, mac(1u, static_cast<i64>(rt(1u, 1u)) * ir3 - static_cast<i64>(rt(2u, 2u)) * ir2, false, false), lm);
	writeIrFromMac(2u, mac(2u, static_cast<i64>(rt(2u, 2u)) * ir1 - static_cast<i64>(rt(0u, 0u)) * ir3, false, false), lm);
	writeIrFromMac(3u, mac(3u, static_cast<i64>(rt(0u, 0u)) * ir2 - static_cast<i64>(rt(1u, 1u)) * ir1, false, false), lm);
}

void GxGte::executeDpcs(u32 sf, u32 lm) {
	depthCue(static_cast<i64>(rgbR()) << 16u, static_cast<i64>(rgbG()) << 16u, static_cast<i64>(rgbB()) << 16u, sf, lm);
	pushRgbFromMac();
}

void GxGte::executeIntpl(u32 sf, u32 lm) {
	depthCue(static_cast<i64>(sign16(m_dataRegisterWords[9])) * 4096ll, static_cast<i64>(sign16(m_dataRegisterWords[10])) * 4096ll, static_cast<i64>(sign16(m_dataRegisterWords[11])) * 4096ll, sf, lm);
	pushRgbFromMac();
}

void GxGte::matrixVectorMultiply(u32 matrix, u32 vectorIndex, u32 controlVector, u32 sf, u32 lm) {
	m_currentSf = sf;
	const i32 x = vector(vectorIndex, 0u);
	const i32 y = vector(vectorIndex, 1u);
	const i32 z = vector(vectorIndex, 2u);
	accumulateSigned44(
		static_cast<i64>(cv(controlVector, 0u)) * 4096ll,
		static_cast<i64>(mx(matrix, 0u, 0u)) * x,
		static_cast<i64>(mx(matrix, 0u, 1u)) * y,
		static_cast<i64>(mx(matrix, 0u, 2u)) * z
	);
	const i64 mac1 = m_accumValue;
	const bool mac1PositiveOverflow = m_accumPositiveOverflow;
	const bool mac1NegativeOverflow = m_accumNegativeOverflow;
	accumulateSigned44(
		static_cast<i64>(cv(controlVector, 1u)) * 4096ll,
		static_cast<i64>(mx(matrix, 1u, 0u)) * x,
		static_cast<i64>(mx(matrix, 1u, 1u)) * y,
		static_cast<i64>(mx(matrix, 1u, 2u)) * z
	);
	const i64 mac2 = m_accumValue;
	const bool mac2PositiveOverflow = m_accumPositiveOverflow;
	const bool mac2NegativeOverflow = m_accumNegativeOverflow;
	accumulateSigned44(
		static_cast<i64>(cv(controlVector, 2u)) * 4096ll,
		static_cast<i64>(mx(matrix, 2u, 0u)) * x,
		static_cast<i64>(mx(matrix, 2u, 1u)) * y,
		static_cast<i64>(mx(matrix, 2u, 2u)) * z
	);
	const i64 mac3 = m_accumValue;
	const bool mac3PositiveOverflow = m_accumPositiveOverflow;
	const bool mac3NegativeOverflow = m_accumNegativeOverflow;
	writeIrFromMac(1u, mac(1u, mac1, mac1PositiveOverflow, mac1NegativeOverflow), lm);
	writeIrFromMac(2u, mac(2u, mac2, mac2PositiveOverflow, mac2NegativeOverflow), lm);
	writeIrFromMac(3u, mac(3u, mac3, mac3PositiveOverflow, mac3NegativeOverflow), lm);
}

void GxGte::lightTransform(u32 vectorIndex, u32 sf, u32 lm) {
	matrixVectorMultiply(1u, vectorIndex, 3u, sf, lm);
}

void GxGte::colorMatrix(u32 sf, u32 lm) {
	matrixVectorMultiply(2u, 3u, 1u, sf, lm);
}

void GxGte::colorApply(u32 sf, u32 lm) {
	m_currentSf = sf;
	writeIrFromMac(1u, macSigned44(1u, static_cast<i64>(rgbR() << 4u) * sign16(m_dataRegisterWords[9])), lm);
	writeIrFromMac(2u, macSigned44(2u, static_cast<i64>(rgbG() << 4u) * sign16(m_dataRegisterWords[10])), lm);
	writeIrFromMac(3u, macSigned44(3u, static_cast<i64>(rgbB() << 4u) * sign16(m_dataRegisterWords[11])), lm);
}

void GxGte::depthCueColor(u32 sf, u32 lm) {
	depthCue(static_cast<i64>(rgbR() << 4u) * sign16(m_dataRegisterWords[9]), static_cast<i64>(rgbG() << 4u) * sign16(m_dataRegisterWords[10]), static_cast<i64>(rgbB() << 4u) * sign16(m_dataRegisterWords[11]), sf, lm);
}

void GxGte::executeNcsForVector(u32 vectorIndex, u32 sf, u32 lm) {
	lightTransform(vectorIndex, sf, lm);
	colorMatrix(sf, lm);
	pushRgbFromMac();
}

void GxGte::executeNccsForVector(u32 vectorIndex, u32 sf, u32 lm) {
	lightTransform(vectorIndex, sf, lm);
	colorMatrix(sf, lm);
	colorApply(sf, lm);
	pushRgbFromMac();
}

void GxGte::executeNcdsForVector(u32 vectorIndex, u32 sf, u32 lm) {
	lightTransform(vectorIndex, sf, lm);
	colorMatrix(sf, lm);
	depthCueColor(sf, lm);
	pushRgbFromMac();
}

void GxGte::executeCc(u32 sf, u32 lm) {
	colorMatrix(sf, lm);
	colorApply(sf, lm);
	pushRgbFromMac();
}

void GxGte::executeCdp(u32 sf, u32 lm) {
	colorMatrix(sf, lm);
	depthCueColor(sf, lm);
	pushRgbFromMac();
}

void GxGte::executeSqr(u32 sf, u32 lm) {
	m_currentSf = sf;
	const i32 ir1 = sign16(m_dataRegisterWords[9]);
	const i32 ir2 = sign16(m_dataRegisterWords[10]);
	const i32 ir3 = sign16(m_dataRegisterWords[11]);
	writeIrFromMac(1u, mac(1u, static_cast<i64>(ir1) * ir1, false, false), lm);
	writeIrFromMac(2u, mac(2u, static_cast<i64>(ir2) * ir2, false, false), lm);
	writeIrFromMac(3u, mac(3u, static_cast<i64>(ir3) * ir3, false, false), lm);
}

void GxGte::executeDcpl(u32 sf, u32 lm) {
	depthCueColor(sf, lm);
	pushRgbFromMac();
}

void GxGte::executeDpct(u32 sf, u32 lm) {
	for (u32 index = 0u; index < 3u; index += 1u) {
		const u32 rgb = rgb0();
		depthCue(static_cast<i64>(rgb & 0xffu) << 16u, static_cast<i64>((rgb >> 8u) & 0xffu) << 16u, static_cast<i64>((rgb >> 16u) & 0xffu) << 16u, sf, lm);
		pushRgbFromMac();
	}
}

void GxGte::executeGpf(u32 sf, u32 lm) {
	m_currentSf = sf;
	const i32 ir0 = sign16(m_dataRegisterWords[8]);
	writeIrFromMac(1u, macSigned44(1u, static_cast<i64>(ir0) * sign16(m_dataRegisterWords[9])), lm);
	writeIrFromMac(2u, macSigned44(2u, static_cast<i64>(ir0) * sign16(m_dataRegisterWords[10])), lm);
	writeIrFromMac(3u, macSigned44(3u, static_cast<i64>(ir0) * sign16(m_dataRegisterWords[11])), lm);
	pushRgbFromMac();
}

void GxGte::executeGpl(u32 sf, u32 lm) {
	m_currentSf = sf;
	const i32 ir0 = sign16(m_dataRegisterWords[8]);
	const u32 macShift = sf == 0u ? 0u : 12u;
	const i64 macScale = 1ll << macShift;
	writeIrFromMac(1u, macSigned44(1u, static_cast<i64>(sign16(m_dataRegisterWords[9])) * ir0 + static_cast<i64>(static_cast<i32>(m_dataRegisterWords[25])) * macScale), lm);
	writeIrFromMac(2u, macSigned44(2u, static_cast<i64>(sign16(m_dataRegisterWords[10])) * ir0 + static_cast<i64>(static_cast<i32>(m_dataRegisterWords[26])) * macScale), lm);
	writeIrFromMac(3u, macSigned44(3u, static_cast<i64>(sign16(m_dataRegisterWords[11])) * ir0 + static_cast<i64>(static_cast<i32>(m_dataRegisterWords[27])) * macScale), lm);
	pushRgbFromMac();
}

void GxGte::executeMvmva(u32 opcode, u32 sf, u32 lm) {
	m_currentSf = sf;
	const u32 matrix = (opcode >> 17u) & 3u;
	const u32 vectorIndex = (opcode >> 15u) & 3u;
	const u32 controlVector = (opcode >> 13u) & 3u;
	i32 x = vector(vectorIndex, 0u);
	i32 y = vector(vectorIndex, 1u);
	i32 z = vector(vectorIndex, 2u);
	for (u32 row = 0u; row < 3u; row += 1u) {
		if (controlVector == 2u) {
			accumulateSigned44(
				static_cast<i64>(cv(controlVector, row)) * 4096ll,
				static_cast<i64>(mx(matrix, row, 0u)) * x,
				0,
				0
			);
			writeIrFromMac(row + 1u, mac(row + 1u, m_accumValue, m_accumPositiveOverflow, m_accumNegativeOverflow), 0u);
			accumulateSigned44(
				0,
				static_cast<i64>(mx(matrix, row, 1u)) * y,
				static_cast<i64>(mx(matrix, row, 2u)) * z,
				0
			);
			writeIrFromMac(row + 1u, mac(row + 1u, m_accumValue, m_accumPositiveOverflow, m_accumNegativeOverflow), lm);
		} else {
			accumulateSigned44(
				static_cast<i64>(cv(controlVector, row)) * 4096ll,
				static_cast<i64>(mx(matrix, row, 0u)) * x,
				static_cast<i64>(mx(matrix, row, 1u)) * y,
				static_cast<i64>(mx(matrix, row, 2u)) * z
			);
			writeIrFromMac(row + 1u, mac(row + 1u, m_accumValue, m_accumPositiveOverflow, m_accumNegativeOverflow), lm);
		}
	}
}

void GxGte::depthCue(i64 inR, i64 inG, i64 inB, u32 sf, u32 lm) {
	m_currentSf = sf;
	const i32 ir0 = sign16(m_dataRegisterWords[8]);
	const i32 r = limitIr(1u, macSigned44(1u, static_cast<i64>(rfc()) * 4096ll - inR), 0u);
	const i32 g = limitIr(2u, macSigned44(2u, static_cast<i64>(gfc()) * 4096ll - inG), 0u);
	const i32 b = limitIr(3u, macSigned44(3u, static_cast<i64>(bfc()) * 4096ll - inB), 0u);
	writeIrFromMac(1u, macSigned44(1u, inR + static_cast<i64>(ir0) * r), lm);
	writeIrFromMac(2u, macSigned44(2u, inG + static_cast<i64>(ir0) * g), lm);
	writeIrFromMac(3u, macSigned44(3u, inB + static_cast<i64>(ir0) * b), lm);
}

i32 GxGte::dotRotation(u32 row, u32 vectorIndex) {
	i64 value = signExtend44(static_cast<i64>(tr(row)) * 4096ll);
	bool positiveOverflow = static_cast<i64>(tr(row)) * 4096ll > int44Max;
	bool negativeOverflow = static_cast<i64>(tr(row)) * 4096ll < int44Min;
	i64 add = static_cast<i64>(rt(row, 0u)) * vx(vectorIndex);
	i64 next = value + add;
	i64 wrapped = signExtend44(next);
	positiveOverflow = positiveOverflow || (wrapped < 0 && value >= 0 && add >= 0);
	negativeOverflow = negativeOverflow || (wrapped >= 0 && value < 0 && add < 0);
	value = wrapped;
	add = static_cast<i64>(rt(row, 1u)) * vy(vectorIndex);
	next = value + add;
	wrapped = signExtend44(next);
	positiveOverflow = positiveOverflow || (wrapped < 0 && value >= 0 && add >= 0);
	negativeOverflow = negativeOverflow || (wrapped >= 0 && value < 0 && add < 0);
	value = wrapped;
	add = static_cast<i64>(rt(row, 2u)) * vz(vectorIndex);
	next = value + add;
	wrapped = signExtend44(next);
	positiveOverflow = positiveOverflow || (wrapped < 0 && value >= 0 && add >= 0);
	negativeOverflow = negativeOverflow || (wrapped >= 0 && value < 0 && add < 0);
	value = wrapped;
	return mac(row + 1u, value, positiveOverflow, negativeOverflow);
}

void GxGte::executeRtps(u32 vectorIndex, u32 sf, u32 lm, bool last) {
	m_currentSf = sf;
	const i32 ir1 = dotRotation(0u, vectorIndex);
	const i32 ir2 = dotRotation(1u, vectorIndex);
	dotRotation(2u, vectorIndex);
	writeIr(1u, ir1, lm);
	writeIr(2u, ir2, lm);
	writeIr3FromMac3(lm);
	pushSz(static_cast<i32>(shiftGte(m_mac3, 1u)));
	const u32 hOverSz3 = divideWithLimit(h(), sz(3u));
	m_dataRegisterWords[12] = m_dataRegisterWords[13];
	m_dataRegisterWords[13] = m_dataRegisterWords[14];
	writeMac0(static_cast<i64>(ofx()) + static_cast<i64>(sign16(m_dataRegisterWords[9])) * hOverSz3);
	const i32 sx2 = limitScreen(shiftRightSigned(m_mac0, 16u), GX_GTE_FLAG_ERROR | GX_GTE_FLAG_SX2_SAT);
	writeMac0(static_cast<i64>(ofy()) + static_cast<i64>(sign16(m_dataRegisterWords[10])) * hOverSz3);
	const i32 sy2 = limitScreen(shiftRightSigned(m_mac0, 16u), GX_GTE_FLAG_ERROR | GX_GTE_FLAG_SY2_SAT);
	m_dataRegisterWords[14] = (static_cast<u32>(sx2) & 0xffffu) | (static_cast<u32>(sy2) << 16u);
	if (last) {
		writeMac0(static_cast<i64>(dqb()) + static_cast<i64>(dqa()) * hOverSz3);
		m_dataRegisterWords[8] = static_cast<u32>(limitIr0(shiftGte(m_mac0, 1u)));
	}
}

void GxGte::executeNclip() {
	writeMac0(
		static_cast<i64>(sx(0u)) * sy(1u)
		+ static_cast<i64>(sx(1u)) * sy(2u)
		+ static_cast<i64>(sx(2u)) * sy(0u)
		- static_cast<i64>(sx(0u)) * sy(2u)
		- static_cast<i64>(sx(1u)) * sy(0u)
		- static_cast<i64>(sx(2u)) * sy(1u)
	);
}

void GxGte::executeAvsz3() {
	const i64 value = static_cast<i64>(zsf3()) * static_cast<i32>(sz(1u) + sz(2u) + sz(3u));
	writeMac0(value);
	m_dataRegisterWords[7] = static_cast<u32>(limitDepth(static_cast<i32>(value >> 12u)));
}

void GxGte::executeAvsz4() {
	const i64 value = static_cast<i64>(zsf4()) * static_cast<i32>(sz(0u) + sz(1u) + sz(2u) + sz(3u));
	writeMac0(value);
	m_dataRegisterWords[7] = static_cast<u32>(limitDepth(static_cast<i32>(value >> 12u)));
}

void GxGte::writeMac0(i64 value) {
	m_mac0 = value;
	if (value > 0x7fffffffll) {
		setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_MAC0_POS);
	}
	if (value < -0x80000000ll) {
		setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_MAC0_NEG);
	}
	m_dataRegisterWords[24] = static_cast<u32>(static_cast<i32>(value));
}

void GxGte::writeIr(u32 index, i32 value, u32 lm) {
	m_dataRegisterWords[8u + index] = static_cast<u32>(limitIr(index, value, lm));
}

void GxGte::writeIr3FromMac3(u32 lm) {
	const i32 valueSf = static_cast<i32>(m_dataRegisterWords[27]);
	const i64 value12 = shiftGte(m_mac3, 1u);
	const i32 min = lm == 0u ? -0x8000 : 0;
	if (value12 < -0x8000 || value12 > 0x7fff) {
		setFlag(GX_GTE_FLAG_IR3_SAT);
	}
	if (valueSf > 0x7fff) {
		m_dataRegisterWords[11] = 0x7fffu;
	} else if (valueSf < min) {
		m_dataRegisterWords[11] = static_cast<u32>(min);
	} else {
		m_dataRegisterWords[11] = static_cast<u32>(static_cast<i32>(valueSf));
	}
}

void GxGte::pushSz(i32 value) {
	m_dataRegisterWords[16] = m_dataRegisterWords[17];
	m_dataRegisterWords[17] = m_dataRegisterWords[18];
	m_dataRegisterWords[18] = m_dataRegisterWords[19];
	m_dataRegisterWords[19] = static_cast<u32>(limitDepth(value));
}

i32 GxGte::limitDepth(i32 value) {
	if (value > 0xffff) {
		setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_SZ_OTZ_SAT);
		return 0xffff;
	}
	if (value < 0) {
		setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_SZ_OTZ_SAT);
		return 0;
	}
	return value;
}

u32 GxGte::divideWithLimit(u32 numerator, u32 denominator) {
	const u32 result = divide(numerator, denominator);
	if (result == 0xffffffffu) {
		setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_DIV_OVERFLOW);
		return 0x1ffffu;
	}
	if (result > 0x1ffffu) {
		return 0x1ffffu;
	}
	return result;
}

u32 GxGte::divide(u32 numerator, u32 denominator) const {
	if (numerator < denominator * 2u) {
		const u32 shift = static_cast<u32>(std::countl_zero(static_cast<u16>(denominator)));
		const u32 r1 = (denominator << shift) & 0x7fffu;
		const u32 r2 = static_cast<u32>(gteDivideTable[(r1 + 0x40u) >> 7u]) + 0x101u;
		const u32 r3 = ((0x80u - (r2 * (r1 + 0x8000u))) >> 8u) & 0x1ffffu;
		const u32 reciprocal = ((r2 * r3) + 0x80u) >> 8u;
		return static_cast<u32>((static_cast<u64>(reciprocal) * (numerator << shift) + 0x8000u) >> 16u);
	}
	return 0xffffffffu;
}

i32 GxGte::limitScreen(i64 value, u32 flag) {
	if (value > 0x3ff) {
		setFlag(flag);
		return 0x3ff;
	}
	if (value < -0x400) {
		setFlag(flag);
		return -0x400;
	}
	return static_cast<i32>(value);
}

i32 GxGte::limitIr0(i64 value) {
	if (value < 0 || value > 0x1000) {
		setFlag(GX_GTE_FLAG_IR0_SAT);
	}
	if (value > 0x1000) {
		return 0x1000;
	}
	if (value < 0) {
		return 0;
	}
	return static_cast<i32>(value);
}

i32 GxGte::limitColor(i32 value, u32 flag) {
	if (value > 0xff) {
		setFlag(flag);
		return 0xff;
	}
	if (value < 0) {
		setFlag(flag);
		return 0;
	}
	return value;
}

void GxGte::pushRgbFromMac() {
	const i32 r = limitColor(static_cast<i32>(m_dataRegisterWords[25]) >> 4u, GX_GTE_FLAG_COLOR_R_SAT);
	const i32 g = limitColor(static_cast<i32>(m_dataRegisterWords[26]) >> 4u, GX_GTE_FLAG_COLOR_G_SAT);
	const i32 b = limitColor(static_cast<i32>(m_dataRegisterWords[27]) >> 4u, GX_GTE_FLAG_COLOR_B_SAT);
	const u32 code = rgbCode();
	m_dataRegisterWords[20] = m_dataRegisterWords[21];
	m_dataRegisterWords[21] = m_dataRegisterWords[22];
	m_dataRegisterWords[22] = static_cast<u32>(r) | (static_cast<u32>(g) << 8u) | (static_cast<u32>(b) << 16u) | (code << 24u);
}

u32 GxGte::packRgbFromIr() const {
	const u32 r = limitRgb5(sign16(m_dataRegisterWords[9]) >> 7u);
	const u32 g = limitRgb5(sign16(m_dataRegisterWords[10]) >> 7u);
	const u32 b = limitRgb5(sign16(m_dataRegisterWords[11]) >> 7u);
	return r | (g << 5u) | (b << 10u);
}

u32 GxGte::limitRgb5(i32 value) {
	if (value > 0x1f) {
		return 0x1fu;
	}
	if (value < 0) {
		return 0u;
	}
	return static_cast<u32>(value);
}

i32 GxGte::vx(u32 index) const {
	return sign16(m_dataRegisterWords[index * 2u]);
}

i32 GxGte::vy(u32 index) const {
	return highSign16(m_dataRegisterWords[index * 2u]);
}

i32 GxGte::vz(u32 index) const {
	return sign16(m_dataRegisterWords[index * 2u + 1u]);
}

i32 GxGte::vector(u32 vectorIndex, u32 component) const {
	if (vectorIndex == 3u) {
		return sign16(m_dataRegisterWords[9u + component]);
	}
	switch (component) {
	case 0u: return vx(vectorIndex);
	case 1u: return vy(vectorIndex);
	default: return vz(vectorIndex);
	}
}

i32 GxGte::mx(u32 matrix, u32 row, u32 column) const {
	if (matrix == 3u) {
		switch (row * 3u + column) {
		case 0u: return -static_cast<i32>(m_dataRegisterWords[6] & 0xffu) * 16;
		case 1u: return static_cast<i32>(m_dataRegisterWords[6] & 0xffu) * 16;
		case 2u: return sign16(m_dataRegisterWords[8]);
		case 3u:
		case 4u:
		case 5u: return sign16(m_controlRegisterWords[1]);
		default: return sign16(m_controlRegisterWords[2]);
		}
	}
	const u32 base = matrix * 8u;
	switch (row * 3u + column) {
	case 0u: return sign16(m_controlRegisterWords[base]);
	case 1u: return highSign16(m_controlRegisterWords[base]);
	case 2u: return sign16(m_controlRegisterWords[base + 1u]);
	case 3u: return highSign16(m_controlRegisterWords[base + 1u]);
	case 4u: return sign16(m_controlRegisterWords[base + 2u]);
	case 5u: return highSign16(m_controlRegisterWords[base + 2u]);
	case 6u: return sign16(m_controlRegisterWords[base + 3u]);
	case 7u: return highSign16(m_controlRegisterWords[base + 3u]);
	default: return sign16(m_controlRegisterWords[base + 4u]);
	}
}

i32 GxGte::cv(u32 vectorIndex, u32 row) const {
	if (vectorIndex == 3u) {
		return 0;
	}
	return static_cast<i32>(m_controlRegisterWords[vectorIndex * 8u + 5u + row]);
}

i32 GxGte::rt(u32 row, u32 column) const {
	switch (row * 3u + column) {
	case 0: return sign16(m_controlRegisterWords[0]);
	case 1: return highSign16(m_controlRegisterWords[0]);
	case 2: return sign16(m_controlRegisterWords[1]);
	case 3: return highSign16(m_controlRegisterWords[1]);
	case 4: return sign16(m_controlRegisterWords[2]);
	case 5: return highSign16(m_controlRegisterWords[2]);
	case 6: return sign16(m_controlRegisterWords[3]);
	case 7: return highSign16(m_controlRegisterWords[3]);
	default: return sign16(m_controlRegisterWords[4]);
	}
}

i32 GxGte::tr(u32 row) const {
	return static_cast<i32>(m_controlRegisterWords[5u + row]);
}

u32 GxGte::h() const {
	return m_controlRegisterWords[26] & 0xffffu;
}

i32 GxGte::dqa() const {
	return sign16(m_controlRegisterWords[27]);
}

i32 GxGte::dqb() const {
	return static_cast<i32>(m_controlRegisterWords[28]);
}

i32 GxGte::ofx() const {
	return static_cast<i32>(m_controlRegisterWords[24]);
}

i32 GxGte::ofy() const {
	return static_cast<i32>(m_controlRegisterWords[25]);
}

i32 GxGte::zsf3() const {
	return sign16(m_controlRegisterWords[29]);
}

i32 GxGte::zsf4() const {
	return sign16(m_controlRegisterWords[30]);
}

u32 GxGte::rgbc() const {
	return m_dataRegisterWords[6];
}

u32 GxGte::rgb0() const {
	return m_dataRegisterWords[20];
}

i32 GxGte::rgbR() const {
	return static_cast<i32>(rgbc() & 0xffu);
}

i32 GxGte::rgbG() const {
	return static_cast<i32>((rgbc() >> 8u) & 0xffu);
}

i32 GxGte::rgbB() const {
	return static_cast<i32>((rgbc() >> 16u) & 0xffu);
}

u32 GxGte::rgbCode() const {
	return (rgbc() >> 24u) & 0xffu;
}

i32 GxGte::rfc() const {
	return static_cast<i32>(m_controlRegisterWords[21]);
}

i32 GxGte::gfc() const {
	return static_cast<i32>(m_controlRegisterWords[22]);
}

i32 GxGte::bfc() const {
	return static_cast<i32>(m_controlRegisterWords[23]);
}

i32 GxGte::sx(u32 index) const {
	return sign16(m_dataRegisterWords[12u + index]);
}

i32 GxGte::sy(u32 index) const {
	return highSign16(m_dataRegisterWords[12u + index]);
}

u32 GxGte::sz(u32 index) const {
	return m_dataRegisterWords[16u + index] & 0xffffu;
}

} // namespace bmsx
