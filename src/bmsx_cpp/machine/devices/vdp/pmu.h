#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/contracts.h"
#include <array>

namespace bmsx {

enum class VdpPmuRegister : u8 {
	X,
	Y,
	ScaleX,
	ScaleY,
	Control,
};

struct VdpPmuRegisterWindow {
	u32 bank = 0;
	u32 x = 0;
	u32 y = 0;
	u32 scaleX = 0;
	u32 scaleY = 0;
	u32 control = 0;
};

struct VdpResolvedBlitPmu {
	f32 dstX = 0.0f;
	f32 dstY = 0.0f;
	f32 scaleX = 1.0f;
	f32 scaleY = 1.0f;
};

class VdpPmuUnit {
public:
	void reset();
	u32 selectedBank() const { return m_selectedBank; }
	void selectBank(u32 bank);
	void writeSelectedBankRegister(VdpPmuRegister reg, u32 value);
	VdpPmuRegisterWindow registerWindow() const;
	using BankWords = std::array<u32, VDP_PMU_BANK_WORD_COUNT>;
	BankWords captureBankWords() const;
	void restoreBankWords(u32 selectedBank, const BankWords& words);
	VdpResolvedBlitPmu resolveBlit(f32 dstX, f32 dstY, f32 scaleX, f32 scaleY, u32 pmuBank, f32 parallaxWeight) const;

private:
	std::array<VdpPmuBank, VDP_PMU_BANK_COUNT> m_banks{};
	u32 m_selectedBank = 0;
};

} // namespace bmsx
