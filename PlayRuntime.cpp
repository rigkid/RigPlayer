#include "PlayRuntime.h"

#include "core/json.h"

#include <spdlog/spdlog.h>

extern "C" {
#include <lauxlib.h>
#include <lua.h>
#include <lualib.h>
}

#include <algorithm>
#include <cctype>
#include <fstream>
#include <utility>

namespace {

bool isIdentStart(char c) {
	return std::isalpha(static_cast<unsigned char>(c)) || c == '_';
}

bool isIdent(char c) {
	return std::isalnum(static_cast<unsigned char>(c)) || c == '_';
}

/**
 * @brief Rewrite common PICO-8 Lua sugar into stock Lua 5.4.
 * @details Handles `!=` and `+=`/`-=`/`*=`/`/=`/`%=` outside quotes/comments.
 * Not a full PICO-8 parser — enough for the fantasy-console example and most showcase code.
 */
std::string picoSugarToLua(const std::string& src) {
	std::string out;
	out.reserve(src.size() + 64);
	enum class Mode { Code, LineComment, BlockComment, String };
	Mode mode = Mode::Code;
	char quote = 0;

	for (size_t i = 0; i < src.size();) {
		const char c = src[i];
		const char n = i + 1 < src.size() ? src[i + 1] : '\0';

		if (mode == Mode::LineComment) {
			out.push_back(c);
			++i;
			if (c == '\n') {
				mode = Mode::Code;
			}
			continue;
		}
		if (mode == Mode::BlockComment) {
			out.push_back(c);
			++i;
			if (c == ']' && n == ']') {
				out.push_back(n);
				i += 1;
				mode = Mode::Code;
			}
			continue;
		}
		if (mode == Mode::String) {
			out.push_back(c);
			++i;
			if (c == '\\' && i < src.size()) {
				out.push_back(src[i++]);
			} else if (c == quote) {
				mode = Mode::Code;
			}
			continue;
		}

		if (c == '-' && n == '-') {
			out.push_back(c);
			out.push_back(n);
			i += 2;
			if (i + 1 < src.size() && src[i] == '[' && src[i + 1] == '[') {
				out += "[[";
				i += 2;
				mode = Mode::BlockComment;
			} else {
				mode = Mode::LineComment;
			}
			continue;
		}
		if (c == '"' || c == '\'') {
			mode = Mode::String;
			quote = c;
			out.push_back(c);
			++i;
			continue;
		}
		if (c == '!' && n == '=') {
			out += "~=";
			i += 2;
			continue;
		}
		if (isIdentStart(c)) {
			const size_t start = i;
			++i;
			while (i < src.size() && isIdent(src[i])) {
				++i;
			}
			const std::string ident = src.substr(start, i - start);
			size_t j = i;
			while (j < src.size() && std::isspace(static_cast<unsigned char>(src[j]))) {
				++j;
			}
			if (j + 1 < src.size()) {
				const char op = src[j];
				if ((op == '+' || op == '-' || op == '*' || op == '/' || op == '%') &&
					src[j + 1] == '=') {
					out += ident;
					out.append(src, i, j - i);
					out.push_back('=');
					out += ident;
					out.push_back(op);
					i = j + 2;
					continue;
				}
			}
			out += ident;
			continue;
		}
		out.push_back(c);
		++i;
	}
	return out;
}

std::array<float, 4> rgbaAt(const nlohmann::json& arr) {
	std::array<float, 4> c{0.f, 0.f, 0.f, 1.f};
	if (!arr.is_array()) {
		return c;
	}
	for (size_t i = 0; i < 4 && i < arr.size(); ++i) {
		c[i] = arr[i].get<float>();
	}
	return c;
}

/**
 * @brief 3×5 glyph, rows packed MSB-left: bits 14..12 = top row, … bits 2..0 = bottom.
 */
constexpr uint16_t glyph(unsigned r0, unsigned r1, unsigned r2, unsigned r3, unsigned r4) {
	return static_cast<uint16_t>(r0 << 12 | r1 << 9 | r2 << 6 | r3 << 3 | r4);
}

constexpr uint16_t kDigits[10] = {
	glyph(0b111, 0b101, 0b101, 0b101, 0b111), // 0
	glyph(0b110, 0b010, 0b010, 0b010, 0b111), // 1
	glyph(0b111, 0b001, 0b111, 0b100, 0b111), // 2
	glyph(0b111, 0b001, 0b011, 0b001, 0b111), // 3
	glyph(0b101, 0b101, 0b111, 0b001, 0b001), // 4
	glyph(0b111, 0b100, 0b111, 0b001, 0b111), // 5
	glyph(0b111, 0b100, 0b111, 0b101, 0b111), // 6
	glyph(0b111, 0b001, 0b001, 0b001, 0b001), // 7
	glyph(0b111, 0b101, 0b111, 0b101, 0b111), // 8
	glyph(0b111, 0b101, 0b111, 0b001, 0b111), // 9
};

constexpr uint16_t kLetters[26] = {
	glyph(0b111, 0b101, 0b111, 0b101, 0b101), // A
	glyph(0b110, 0b101, 0b110, 0b101, 0b110), // B
	glyph(0b011, 0b100, 0b100, 0b100, 0b011), // C
	glyph(0b110, 0b101, 0b101, 0b101, 0b110), // D
	glyph(0b111, 0b100, 0b110, 0b100, 0b111), // E
	glyph(0b111, 0b100, 0b110, 0b100, 0b100), // F
	glyph(0b111, 0b100, 0b101, 0b101, 0b111), // G
	glyph(0b101, 0b101, 0b111, 0b101, 0b101), // H
	glyph(0b111, 0b010, 0b010, 0b010, 0b111), // I
	glyph(0b011, 0b001, 0b001, 0b101, 0b010), // J
	glyph(0b101, 0b101, 0b110, 0b101, 0b101), // K
	glyph(0b100, 0b100, 0b100, 0b100, 0b111), // L
	glyph(0b101, 0b111, 0b111, 0b101, 0b101), // M
	glyph(0b110, 0b101, 0b101, 0b101, 0b101), // N
	glyph(0b111, 0b101, 0b101, 0b101, 0b111), // O
	glyph(0b111, 0b101, 0b111, 0b100, 0b100), // P
	glyph(0b111, 0b101, 0b101, 0b111, 0b001), // Q
	glyph(0b111, 0b101, 0b110, 0b101, 0b101), // R
	glyph(0b011, 0b100, 0b010, 0b001, 0b110), // S
	glyph(0b111, 0b010, 0b010, 0b010, 0b010), // T
	glyph(0b101, 0b101, 0b101, 0b101, 0b111), // U
	glyph(0b101, 0b101, 0b101, 0b101, 0b010), // V
	glyph(0b101, 0b101, 0b111, 0b111, 0b101), // W
	glyph(0b101, 0b101, 0b010, 0b101, 0b101), // X
	glyph(0b101, 0b101, 0b010, 0b010, 0b010), // Y
	glyph(0b111, 0b001, 0b010, 0b100, 0b111), // Z
};

uint16_t glyphFor(char ch) {
	const unsigned char c = static_cast<unsigned char>(ch);
	if (c >= '0' && c <= '9') {
		return kDigits[c - '0'];
	}
	if (c >= 'a' && c <= 'z') {
		return kLetters[c - 'a'];
	}
	if (c >= 'A' && c <= 'Z') {
		return kLetters[c - 'A'];
	}
	switch (c) {
	case ' ': return 0;
	case '!': return glyph(0b010, 0b010, 0b010, 0b000, 0b010);
	case '?': return glyph(0b111, 0b001, 0b011, 0b000, 0b010);
	case '.': return glyph(0b000, 0b000, 0b000, 0b000, 0b010);
	case ',': return glyph(0b000, 0b000, 0b000, 0b010, 0b100);
	case ':': return glyph(0b000, 0b010, 0b000, 0b010, 0b000);
	case ';': return glyph(0b000, 0b010, 0b000, 0b010, 0b100);
	case '-': return glyph(0b000, 0b000, 0b111, 0b000, 0b000);
	case '+': return glyph(0b000, 0b010, 0b111, 0b010, 0b000);
	case '_': return glyph(0b000, 0b000, 0b000, 0b000, 0b111);
	case '/': return glyph(0b001, 0b001, 0b010, 0b100, 0b100);
	case '\\': return glyph(0b100, 0b100, 0b010, 0b001, 0b001);
	case '(': return glyph(0b010, 0b100, 0b100, 0b100, 0b010);
	case ')': return glyph(0b010, 0b001, 0b001, 0b001, 0b010);
	case '[': return glyph(0b110, 0b100, 0b100, 0b100, 0b110);
	case ']': return glyph(0b011, 0b001, 0b001, 0b001, 0b011);
	case '=': return glyph(0b000, 0b111, 0b000, 0b111, 0b000);
	case '<': return glyph(0b001, 0b010, 0b100, 0b010, 0b001);
	case '>': return glyph(0b100, 0b010, 0b001, 0b010, 0b100);
	case '*': return glyph(0b101, 0b010, 0b111, 0b010, 0b101);
	case '%': return glyph(0b101, 0b001, 0b010, 0b100, 0b101);
	case '#': return glyph(0b101, 0b111, 0b101, 0b111, 0b101);
	case '\'': return glyph(0b010, 0b010, 0b000, 0b000, 0b000);
	case '"': return glyph(0b101, 0b101, 0b000, 0b000, 0b000);
	default: return glyph(0b111, 0b101, 0b101, 0b101, 0b111); // unknown → box
	}
}

} // namespace

PlayRuntime::PlayRuntime() {
	m_palette = {{
		{{0.f, 0.f, 0.f, 1.f}},
		{{0.114f, 0.169f, 0.325f, 1.f}},
		{{0.494f, 0.145f, 0.325f, 1.f}},
		{{0.f, 0.529f, 0.318f, 1.f}},
		{{0.671f, 0.322f, 0.212f, 1.f}},
		{{0.373f, 0.341f, 0.310f, 1.f}},
		{{0.761f, 0.765f, 0.780f, 1.f}},
		{{1.f, 0.945f, 0.910f, 1.f}},
		{{1.f, 0.f, 0.302f, 1.f}},
		{{1.f, 0.639f, 0.f, 1.f}},
		{{1.f, 0.925f, 0.153f, 1.f}},
		{{0.f, 0.894f, 0.212f, 1.f}},
		{{0.161f, 0.678f, 1.f, 1.f}},
		{{0.514f, 0.463f, 0.612f, 1.f}},
		{{1.f, 0.467f, 0.659f, 1.f}},
		{{1.f, 0.800f, 0.667f, 1.f}},
	}};
	m_screen.fill(0);
	m_sprites.fill(0);
	m_map.fill(0);
	m_btn.fill(false);
}

PlayRuntime::~PlayRuntime() {
	if (m_L) {
		lua_close(m_L);
		m_L = nullptr;
	}
}

std::string PlayRuntime::load(const std::string& path) {
	std::ifstream in(path);
	if (!in) {
		return "cannot open " + path;
	}
	nlohmann::json doc;
	try {
		in >> doc;
	} catch (const std::exception& e) {
		return std::string("json: ") + e.what();
	}

	if (doc.contains("document") && doc["document"].contains("title")) {
		m_title = doc["document"]["title"].get<std::string>();
	}

	std::string luaSrc;
	if (!doc.contains("entities") || !doc["entities"].is_array()) {
		return "missing entities";
	}

	static const char* kKnown[] = {
		"rig.pixel.palette", "rig.pixel.tile_set", "rig.pixel.tile_map", "rig.pixel.canvas",
		"rig.media.code",	 "rig.input.buttons",  "rig.meta.named",
	};
	m_skipped.clear();

	for (const auto& ent : doc["entities"]) {
		if (!ent.contains("components")) {
			continue;
		}
		const auto& c = ent["components"];
		for (auto it = c.begin(); it != c.end(); ++it) {
			const std::string& key = it.key();
			if (key.rfind("rig.", 0) != 0) {
				continue; // vendor x.* keys pass silently
			}
			bool known = false;
			for (const char* k : kKnown) {
				if (key == k) {
					known = true;
					break;
				}
			}
			if (!known &&
				std::find(m_skipped.begin(), m_skipped.end(), key) == m_skipped.end()) {
				m_skipped.push_back(key);
			}
		}
		if (c.contains("rig.pixel.palette") && c["rig.pixel.palette"].contains("colors")) {
			const auto& colors = c["rig.pixel.palette"]["colors"];
			for (size_t i = 0; i < 16 && i < colors.size(); ++i) {
				m_palette[i] = rgbaAt(colors[i]);
			}
		}
		if (c.contains("rig.pixel.tile_set") && c["rig.pixel.tile_set"].contains("indices")) {
			const auto& idx = c["rig.pixel.tile_set"]["indices"];
			const int tw = c["rig.pixel.tile_set"].value("tileWidth", 8);
			const int th = c["rig.pixel.tile_set"].value("tileHeight", 8);
			const int across = c["rig.pixel.tile_set"].value("tilesAcross", 16);
			const int rows = c["rig.pixel.tile_set"].value("tileRows", 16);
			m_sprites.fill(0);
			size_t cursor = 0;
			for (int ty = 0; ty < rows; ++ty) {
				for (int tx = 0; tx < across; ++tx) {
					for (int py = 0; py < th; ++py) {
						for (int px = 0; px < tw; ++px) {
							if (cursor >= idx.size()) {
								break;
							}
							const int x = tx * tw + px;
							const int y = ty * th + py;
							if (x < kSize && y < kSize) {
								m_sprites[static_cast<size_t>(y * kSize + x)] =
									static_cast<uint8_t>(idx[cursor].get<int>() & 15);
							}
							++cursor;
						}
					}
				}
			}
		}
		if (c.contains("rig.pixel.tile_map") && c["rig.pixel.tile_map"].contains("tiles")) {
			const auto& tiles = c["rig.pixel.tile_map"]["tiles"];
			const int w = c["rig.pixel.tile_map"].value("width", kMapW);
			const int h = c["rig.pixel.tile_map"].value("height", kMapH);
			m_map.fill(0);
			size_t n = 0;
			for (int y = 0; y < h && y < kMapH; ++y) {
				for (int x = 0; x < w && x < kMapW; ++x) {
					if (n >= tiles.size()) {
						break;
					}
					m_map[static_cast<size_t>(y * kMapW + x)] =
						static_cast<uint8_t>(tiles[n].get<int>() & 255);
					++n;
				}
			}
		}
		if (c.contains("rig.media.code") && c["rig.media.code"].contains("text")) {
			luaSrc = c["rig.media.code"]["text"].get<std::string>();
		}
	}

	if (luaSrc.empty()) {
		return "no rig.media.code in document";
	}

	if (m_L) {
		lua_close(m_L);
		m_L = nullptr;
	}
	m_L = luaL_newstate();
	if (!m_L) {
		return "luaL_newstate failed";
	}
	// Sandboxed stdlib: no io / os / package / debug for untrusted documents.
	static const luaL_Reg kLibs[] = {
		{LUA_GNAME, luaopen_base},		   {LUA_TABLIBNAME, luaopen_table},
		{LUA_STRLIBNAME, luaopen_string},  {LUA_MATHLIBNAME, luaopen_math},
		{LUA_COLIBNAME, luaopen_coroutine},
	};
	for (const auto& lib : kLibs) {
		luaL_requiref(m_L, lib.name, lib.func, 1);
		lua_pop(m_L, 1);
	}
	lua_pushnil(m_L);
	lua_setglobal(m_L, "dofile");
	lua_pushnil(m_L);
	lua_setglobal(m_L, "loadfile");
	lua_pushlightuserdata(m_L, this);
	lua_setfield(m_L, LUA_REGISTRYINDEX, "playruntime");
	registerApi();

	const std::string cooked = picoSugarToLua(luaSrc);
	if (luaL_loadbuffer(m_L, cooked.data(), cooked.size(), m_title.c_str()) != LUA_OK) {
		std::string err = lua_tostring(m_L, -1);
		lua_pop(m_L, 1);
		return "load: " + err;
	}
	if (lua_pcall(m_L, 0, 0, 0) != LUA_OK) {
		std::string err = lua_tostring(m_L, -1);
		lua_pop(m_L, 1);
		return "run: " + err;
	}
	callHook("_init");
	return {};
}

void PlayRuntime::setButton(int index, bool down) {
	if (index >= 0 && index < static_cast<int>(m_btn.size())) {
		m_btn[static_cast<size_t>(index)] = down;
	}
}

void PlayRuntime::tick() {
	if (!m_L) {
		return;
	}
	callHook("_update");
	callHook("_draw");
}

void PlayRuntime::callHook(const char* name) {
	lua_getglobal(m_L, name);
	if (!lua_isfunction(m_L, -1)) {
		lua_pop(m_L, 1);
		return;
	}
	if (lua_pcall(m_L, 0, 0, 0) != LUA_OK) {
		spdlog::error("play {} : {}", name, lua_tostring(m_L, -1));
		lua_pop(m_L, 1);
	}
}

PlayRuntime* PlayRuntime::self(lua_State* L) {
	lua_getfield(L, LUA_REGISTRYINDEX, "playruntime");
	auto* r = static_cast<PlayRuntime*>(lua_touserdata(L, -1));
	lua_pop(L, 1);
	return r;
}

void PlayRuntime::pset(int x, int y, int c) {
	if (x < 0 || y < 0 || x >= kSize || y >= kSize) {
		return;
	}
	m_screen[static_cast<size_t>(y * kSize + x)] = static_cast<uint8_t>(c & 15);
}

int PlayRuntime::pget(int x, int y) const {
	if (x < 0 || y < 0 || x >= kSize || y >= kSize) {
		return 0;
	}
	return m_screen[static_cast<size_t>(y * kSize + x)];
}

void PlayRuntime::drawSprite(int n, int x, int y, int w, int h) {
	const int sx0 = (n % 16) * 8;
	const int sy0 = (n / 16) * 8;
	for (int ty = 0; ty < h * 8; ++ty) {
		for (int tx = 0; tx < w * 8; ++tx) {
			const int gx = sx0 + tx;
			const int gy = sy0 + ty;
			if (gx < 0 || gy < 0 || gx >= kSize || gy >= kSize) {
				continue;
			}
			const int c = m_sprites[static_cast<size_t>(gy * kSize + gx)] & 15;
			if (c != 0) {
				pset(x + tx, y + ty, c);
			}
		}
	}
}

void PlayRuntime::drawMap(int celX, int celY, int sx, int sy, int celW, int celH) {
	for (int cy = 0; cy < celH; ++cy) {
		for (int cx = 0; cx < celW; ++cx) {
			const int mx = celX + cx;
			const int my = celY + cy;
			if (mx < 0 || my < 0 || mx >= kMapW || my >= kMapH) {
				continue;
			}
			const int spr = m_map[static_cast<size_t>(my * kMapW + mx)];
			if (spr != 0) {
				drawSprite(spr, sx + cx * 8, sy + cy * 8);
			}
		}
	}
}

void PlayRuntime::registerApi() {
	lua_register(m_L, "cls", l_cls);
	lua_register(m_L, "btn", l_btn);
	lua_register(m_L, "spr", l_spr);
	lua_register(m_L, "map", l_map);
	lua_register(m_L, "print", l_print);
	lua_register(m_L, "pset", l_pset);
	lua_register(m_L, "pget", l_pget);
	lua_register(m_L, "mget", l_mget);
	lua_register(m_L, "rectfill", l_rectfill);
	lua_register(m_L, "circfill", l_circfill);
}

int PlayRuntime::l_cls(lua_State* L) {
	auto* r = self(L);
	const int c = lua_gettop(L) >= 1 ? static_cast<int>(luaL_optinteger(L, 1, 0)) : 0;
	r->m_screen.fill(static_cast<uint8_t>(c & 15));
	return 0;
}

int PlayRuntime::l_btn(lua_State* L) {
	auto* r = self(L);
	const int i = static_cast<int>(luaL_optinteger(L, 1, 0));
	const bool down =
		i >= 0 && i < static_cast<int>(r->m_btn.size()) && r->m_btn[static_cast<size_t>(i)];
	lua_pushboolean(L, down);
	return 1;
}

int PlayRuntime::l_spr(lua_State* L) {
	auto* r = self(L);
	const int n = static_cast<int>(luaL_checkinteger(L, 1));
	const int x = static_cast<int>(luaL_checkinteger(L, 2));
	const int y = static_cast<int>(luaL_checkinteger(L, 3));
	const int w = static_cast<int>(luaL_optinteger(L, 4, 1));
	const int h = static_cast<int>(luaL_optinteger(L, 5, 1));
	r->drawSprite(n, x, y, w, h);
	return 0;
}

int PlayRuntime::l_map(lua_State* L) {
	auto* r = self(L);
	const int celX = static_cast<int>(luaL_optinteger(L, 1, 0));
	const int celY = static_cast<int>(luaL_optinteger(L, 2, 0));
	const int sx = static_cast<int>(luaL_optinteger(L, 3, 0));
	const int sy = static_cast<int>(luaL_optinteger(L, 4, 0));
	const int celW = static_cast<int>(luaL_optinteger(L, 5, 16));
	const int celH = static_cast<int>(luaL_optinteger(L, 6, 16));
	r->drawMap(celX, celY, sx, sy, celW, celH);
	return 0;
}

int PlayRuntime::l_print(lua_State* L) {
	auto* r = self(L);
	const char* text = luaL_optstring(L, 1, "");
	const int x = static_cast<int>(luaL_optinteger(L, 2, 0));
	int y = static_cast<int>(luaL_optinteger(L, 3, 0));
	const int col = static_cast<int>(luaL_optinteger(L, 4, r->m_color));
	int cx = x;
	for (const char* p = text; *p; ++p) {
		if (*p == '\n') {
			cx = x;
			y += 6;
			continue;
		}
		const uint16_t g = glyphFor(*p);
		for (int gy = 0; gy < 5; ++gy) {
			for (int gx = 0; gx < 3; ++gx) {
				if (g >> ((4 - gy) * 3 + (2 - gx)) & 1) {
					r->pset(cx + gx, y + gy, col);
				}
			}
		}
		cx += 4;
	}
	return 0;
}

int PlayRuntime::l_pset(lua_State* L) {
	auto* r = self(L);
	r->pset(static_cast<int>(luaL_checkinteger(L, 1)), static_cast<int>(luaL_checkinteger(L, 2)),
			static_cast<int>(luaL_optinteger(L, 3, r->m_color)));
	return 0;
}

int PlayRuntime::l_pget(lua_State* L) {
	auto* r = self(L);
	lua_pushinteger(L, r->pget(static_cast<int>(luaL_checkinteger(L, 1)),
							   static_cast<int>(luaL_checkinteger(L, 2))));
	return 1;
}

int PlayRuntime::l_mget(lua_State* L) {
	auto* r = self(L);
	const int x = static_cast<int>(luaL_checkinteger(L, 1));
	const int y = static_cast<int>(luaL_checkinteger(L, 2));
	int v = 0;
	if (x >= 0 && y >= 0 && x < kMapW && y < kMapH) {
		v = r->m_map[static_cast<size_t>(y * kMapW + x)];
	}
	lua_pushinteger(L, v);
	return 1;
}

int PlayRuntime::l_rectfill(lua_State* L) {
	auto* r = self(L);
	int x0 = static_cast<int>(luaL_checkinteger(L, 1));
	int y0 = static_cast<int>(luaL_checkinteger(L, 2));
	int x1 = static_cast<int>(luaL_checkinteger(L, 3));
	int y1 = static_cast<int>(luaL_checkinteger(L, 4));
	const int c = static_cast<int>(luaL_optinteger(L, 5, r->m_color));
	if (x1 < x0) {
		std::swap(x0, x1);
	}
	if (y1 < y0) {
		std::swap(y0, y1);
	}
	for (int y = y0; y <= y1; ++y) {
		for (int x = x0; x <= x1; ++x) {
			r->pset(x, y, c);
		}
	}
	return 0;
}

int PlayRuntime::l_circfill(lua_State* L) {
	auto* r = self(L);
	const int cx = static_cast<int>(luaL_checkinteger(L, 1));
	const int cy = static_cast<int>(luaL_checkinteger(L, 2));
	const int rad = static_cast<int>(luaL_checkinteger(L, 3));
	const int c = static_cast<int>(luaL_optinteger(L, 4, r->m_color));
	const int r2 = rad * rad;
	for (int y = -rad; y <= rad; ++y) {
		for (int x = -rad; x <= rad; ++x) {
			if (x * x + y * y <= r2) {
				r->pset(cx + x, cy + y, c);
			}
		}
	}
	return 0;
}
