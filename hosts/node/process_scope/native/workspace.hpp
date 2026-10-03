#pragma once

#include <filesystem>

// Scratch mutation and the ownership lock must live in the same process. An
// asynchronous Node rm() could otherwise keep deleting after controller death
// and race the next owner. Paths come only from the Node profile composition.
class Workspace {
	std::filesystem::path root;
public:
	template<class Character>
	Workspace(int argc, Character** argv) : root(argc > 2 ? argv[2] : std::filesystem::path()) {
		if (root.empty()) return;
		std::filesystem::remove_all(root);
		std::filesystem::create_directory(root);
		for (int i = 3; i < argc; ++i) std::filesystem::create_directory(root / argv[i]);
	}
	void remove() {
		if (!root.empty()) std::filesystem::remove_all(root);
	}
};
