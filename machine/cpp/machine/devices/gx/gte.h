#pragma once

#include "common/primitives.h"

#include <array>

namespace bmsx {

class Memory;

constexpr size_t GX_GTE_DATA_REGISTER_COUNT = 32;
constexpr size_t GX_GTE_CONTROL_REGISTER_COUNT = 32;

constexpr u32 GX_GTE_FN_RTPS = 0x01u;
constexpr u32 GX_GTE_FN_NCLIP = 0x06u;
constexpr u32 GX_GTE_FN_OP = 0x0cu;
constexpr u32 GX_GTE_FN_MVMVA = 0x12u;
constexpr u32 GX_GTE_FN_SQR = 0x28u;
constexpr u32 GX_GTE_FN_AVSZ3 = 0x2du;
constexpr u32 GX_GTE_FN_AVSZ4 = 0x2eu;
constexpr u32 GX_GTE_FN_RTPT = 0x30u;

constexpr u32 GX_GTE_CYCLES_RTPS = 15u;
constexpr u32 GX_GTE_CYCLES_NCLIP = 8u;
constexpr u32 GX_GTE_CYCLES_OP = 6u;
constexpr u32 GX_GTE_CYCLES_MVMVA = 8u;
constexpr u32 GX_GTE_CYCLES_SQR = 5u;
constexpr u32 GX_GTE_CYCLES_AVSZ3 = 5u;
constexpr u32 GX_GTE_CYCLES_AVSZ4 = 6u;
constexpr u32 GX_GTE_CYCLES_RTPT = 23u;

constexpr u32 GX_GTE_FLAG_ERROR = 0x80000000u;
constexpr u32 GX_GTE_FLAG_MAC1_POS = 0x40000000u;
constexpr u32 GX_GTE_FLAG_MAC2_POS = 0x20000000u;
constexpr u32 GX_GTE_FLAG_MAC3_POS = 0x10000000u;
constexpr u32 GX_GTE_FLAG_MAC1_NEG = 0x08000000u;
constexpr u32 GX_GTE_FLAG_MAC2_NEG = 0x04000000u;
constexpr u32 GX_GTE_FLAG_MAC3_NEG = 0x02000000u;
constexpr u32 GX_GTE_FLAG_IR1_SAT = 0x01000000u;
constexpr u32 GX_GTE_FLAG_IR2_SAT = 0x00800000u;
constexpr u32 GX_GTE_FLAG_IR3_SAT = 0x00400000u;
constexpr u32 GX_GTE_FLAG_SZ_OTZ_SAT = 0x00040000u;
constexpr u32 GX_GTE_FLAG_DIV_OVERFLOW = 0x00020000u;
constexpr u32 GX_GTE_FLAG_MAC0_POS = 0x00010000u;
constexpr u32 GX_GTE_FLAG_MAC0_NEG = 0x00008000u;
constexpr u32 GX_GTE_FLAG_SX2_SAT = 0x00004000u;
constexpr u32 GX_GTE_FLAG_SY2_SAT = 0x00002000u;
constexpr u32 GX_GTE_FLAG_IR0_SAT = 0x00001000u;
constexpr u32 GX_GTE_FLAG_WRITE_MASK = 0x7ffff000u;
constexpr u32 GX_GTE_FLAG_ERROR_MASK = 0x7f87e000u;

struct GxGteState {
	std::array<u32, GX_GTE_DATA_REGISTER_COUNT> dataRegisterWords{};
	std::array<u32, GX_GTE_CONTROL_REGISTER_COUNT> controlRegisterWords{};
	i64 mac0 = 0;
	i64 mac1 = 0;
	i64 mac2 = 0;
	i64 mac3 = 0;
	u32 currentSf = 0;
};

class GxGte {
public:
	explicit GxGte(Memory& memory);
	void reset();
	u32 readDataRegister(u32 index) const;
	void writeDataRegister(u32 index, u32 value);
	u32 readControlRegister(u32 index) const;
	void writeControlRegister(u32 index, u32 value);
	u32 execute(u32 opcode);
	GxGteState captureState() const;
	void restoreState(const GxGteState& state);

private:
	std::array<u32, GX_GTE_DATA_REGISTER_COUNT> m_dataRegisterWords{};
	std::array<u32, GX_GTE_CONTROL_REGISTER_COUNT> m_controlRegisterWords{};
	i64 m_mac0 = 0;
	i64 m_mac1 = 0;
	i64 m_mac2 = 0;
	i64 m_mac3 = 0;
	i64 m_accumValue = 0;
	bool m_accumPositiveOverflow = false;
	bool m_accumNegativeOverflow = false;
	Memory& m_memory;
	u32 m_currentSf = 0;
	u32 m_lastCycles = 0;

	void setFlag(u32 flag);
	static u32 withFlagError(u32 flag);
	void updateFlagError();
	i32 lim(i32 value, i32 max, i32 min, u32 flag);
	i32 mac(u32 index, i64 value, bool positiveOverflow, bool negativeOverflow);
	void accumulateSigned44(i64 initial, i64 add0, i64 add1, i64 add2);
	void writeIrFromMac(u32 index, i32 value, u32 lm);
	void executeOp(u32 sf, u32 lm);
	void executeSqr(u32 sf, u32 lm);
	void executeMvmva(u32 opcode, u32 sf, u32 lm);
	i32 dotRotation(u32 row, u32 vectorIndex);
	void executeRtps(u32 vectorIndex, u32 sf, u32 lm, bool last);
	void executeNclip();
	void executeAvsz3();
	void executeAvsz4();
	void writeMac0(i64 value);
	void writeIr(u32 index, i32 value, u32 lm, u32 flag);
	void writeIr3FromMac3(u32 sf, u32 lm);
	void pushSz(i32 value);
	i32 limitDepth(i32 value);
	u32 divideWithLimit(u32 numerator, u32 denominator);
	u32 divide(u32 numerator, u32 denominator) const;
	i32 limitScreen(i64 value, u32 flag);
	i32 limitIr0(i64 value);
	u32 packRgbFromIr() const;
	static u32 limitRgb5(i32 value);

	i32 vx(u32 index) const;
	i32 vy(u32 index) const;
	i32 vz(u32 index) const;
	i32 vector(u32 vector, u32 component) const;
	i32 mx(u32 matrix, u32 row, u32 column) const;
	i32 cv(u32 vector, u32 row) const;
	i32 rt(u32 row, u32 column) const;
	i32 tr(u32 row) const;
	u32 h() const;
	i32 dqa() const;
	i32 dqb() const;
	i32 ofx() const;
	i32 ofy() const;
	i32 zsf3() const;
	i32 zsf4() const;
	i32 sx(u32 index) const;
	i32 sy(u32 index) const;
	u32 sz(u32 index) const;

	static u64 readDataRegisterThunk(void* context, u32 addr);
	static void writeDataRegisterThunk(void* context, u32 addr, u64 value);
	static u64 readControlRegisterThunk(void* context, u32 addr);
	static void writeControlRegisterThunk(void* context, u32 addr, u64 value);
	static void writeCommandThunk(void* context, u32 addr, u64 value);
	static u64 readCyclesThunk(void* context, u32 addr);
};

} // namespace bmsx
