#pragma once

#include <string>

/** Which RigPlayer host path a Rig document should take. */
enum class DocKind {
	Play,	  // pixel / Lua runtime (PlayRuntime)
	Present, // scene / GLSL — open via bundled web host
	Unknown,
};

/** Classify a .rig / .json file from its RigWorks shape (not file extension). */
DocKind classifyRigDocumentFile(const std::string& path);
