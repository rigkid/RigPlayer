#include "DocKind.h"

#include <fstream>
#include <nlohmann/json.hpp>
#include <sstream>

DocKind classifyRigDocumentFile(const std::string& path) {
	std::ifstream in(path);
	if (!in) {
		return DocKind::Unknown;
	}
	std::ostringstream ss;
	ss << in.rdbuf();
	nlohmann::json doc;
	try {
		doc = nlohmann::json::parse(ss.str());
	} catch (...) {
		return DocKind::Unknown;
	}
	if (!doc.contains("entities") || !doc["entities"].is_array()) {
		return DocKind::Unknown;
	}

	bool hasLua = false;
	bool hasGlsl = false;
	int presentKeys = 0;
	int playKeys = 0;

	for (const auto& ent : doc["entities"]) {
		if (!ent.contains("components") || !ent["components"].is_object()) {
			continue;
		}
		for (auto it = ent["components"].begin(); it != ent["components"].end(); ++it) {
			const std::string& key = it.key();
			if (key == "rig.media.code") {
				std::string lang;
				if (it.value().contains("language") && it.value()["language"].is_string()) {
					lang = it.value()["language"].get<std::string>();
					for (char& c : lang) {
						if (c >= 'A' && c <= 'Z') {
							c = static_cast<char>(c - 'A' + 'a');
						}
					}
				}
				if (lang.empty() || lang == "lua" || lang == "pico8") {
					hasLua = true;
				} else if (lang == "glsl") {
					hasGlsl = true;
				}
			}
			if (key.rfind("rig.pixel.", 0) == 0 || key.rfind("rig.music.", 0) == 0 ||
				key == "rig.input.buttons") {
				++playKeys;
			}
			if (key.rfind("rig.spatial.", 0) == 0 || key.rfind("rig.geometry.", 0) == 0 ||
				key.rfind("rig.render.", 0) == 0 || key.rfind("rig.paint.", 0) == 0 ||
				key.rfind("rig.mod.", 0) == 0 || key.rfind("rig.ui.", 0) == 0 ||
				key.rfind("rig.interact.", 0) == 0) {
				++presentKeys;
			}
		}
	}

	if (hasLua) {
		return DocKind::Play;
	}
	if (hasGlsl || presentKeys > 0) {
		return DocKind::Present;
	}
	if (playKeys > 0) {
		return DocKind::Play;
	}
	return DocKind::Unknown;
}
