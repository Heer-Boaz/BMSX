#pragma once

namespace bmsx {

class GameView;
class Memory;
class SoundMaster;
class TextureManager;

void flushHostRuntimeAssetEdits(Memory& memory, TextureManager& texmanager, SoundMaster& soundMaster, const GameView& view);

} // namespace bmsx
