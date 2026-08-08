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
#include <cmath>
#include <cstdlib>
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
 * @details Handles `!=` and `+=`/`-=`/`*=`/`/=`/`%=` on bare names and
 * `a.b` / `a[i]` chains outside quotes/comments. Not a full PICO-8 parser.
 */
std::string picoSugarToLua(const std::string& src) {
	std::string out;
	out.reserve(src.size() + 64);
	enum class Mode { Code, LineComment, BlockComment, String };
	Mode mode = Mode::Code;
	char quote = 0;

	auto parseLhs = [&](size_t i) -> size_t {
		if (i >= src.size() || !isIdentStart(src[i])) {
			return i;
		}
		++i;
		while (i < src.size() && isIdent(src[i])) {
			++i;
		}
		for (;;) {
			if (i < src.size() && src[i] == '.') {
				++i;
				if (i >= src.size() || !isIdentStart(src[i])) {
					return i;
				}
				++i;
				while (i < src.size() && isIdent(src[i])) {
					++i;
				}
				continue;
			}
			if (i < src.size() && src[i] == '[') {
				int depth = 1;
				++i;
				while (i < src.size() && depth > 0) {
					if (src[i] == '[') {
						++depth;
					} else if (src[i] == ']') {
						--depth;
					}
					++i;
				}
				continue;
			}
			break;
		}
		return i;
	};

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
		// PICO-8 binary literals (0b…) → decimal; stock Lua 5.4 has no 0b.
		if (c == '0' && (n == 'b' || n == 'B')) {
			size_t j = i + 2;
			unsigned value = 0;
			bool any = false;
			while (j < src.size() && (src[j] == '0' || src[j] == '1')) {
				value = (value << 1) | static_cast<unsigned>(src[j] - '0');
				any = true;
				++j;
			}
			if (any) {
				out += std::to_string(value);
				i = j;
				continue;
			}
		}
		if (isIdentStart(c)) {
			const size_t start = i;
			const size_t end = parseLhs(i);
			const std::string lhs = src.substr(start, end - start);
			size_t j = end;
			while (j < src.size() && std::isspace(static_cast<unsigned char>(src[j]))) {
				++j;
			}
			if (j + 1 < src.size()) {
				const char op = src[j];
				if ((op == '+' || op == '-' || op == '*' || op == '/' || op == '%') &&
					src[j + 1] == '=') {
					out += lhs;
					out.append(src, end, j - end);
					out.push_back('=');
					out += lhs;
					out.push_back(op);
					i = j + 2;
					continue;
				}
			}
			out += lhs;
			i = end;
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
	m_btnPrev.fill(false);
	m_btnp.fill(false);
	m_cdata.fill(0.0);
	m_paletteBase = m_palette;
	resetDrawState();
}

void PlayRuntime::resetDrawState() {
	m_color = 6;
	m_fillp = 0;
	m_fillpOn = false;
	for (int i = 0; i < 16; ++i) {
		m_drawPal[static_cast<size_t>(i)] = static_cast<uint8_t>(i);
	}
	m_palette = m_paletteBase;
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
			m_paletteBase = m_palette;
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
	resetDrawState();
	m_btnPrev.fill(false);
	m_btnp.fill(false);
	std::srand(1);
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
	for (size_t i = 0; i < m_btn.size(); ++i) {
		m_btnp[i] = m_btn[i] && !m_btnPrev[i];
	}
	callHook("_update");
	callHook("_draw");
	m_btnPrev = m_btn;
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

int PlayRuntime::mapColor(int c) const {
	return m_drawPal[static_cast<size_t>(c & 15)] & 15;
}

bool PlayRuntime::fillpMask(int x, int y) const {
	if (!m_fillpOn || m_fillp == 0) {
		return true;
	}
	const int bit = (x & 3) + 4 * (y & 3);
	return ((m_fillp >> (15 - bit)) & 1) != 0;
}

void PlayRuntime::pset(int x, int y, int c) {
	if (x < 0 || y < 0 || x >= kSize || y >= kSize) {
		return;
	}
	if (!fillpMask(x, y)) {
		return;
	}
	m_screen[static_cast<size_t>(y * kSize + x)] = static_cast<uint8_t>(mapColor(c));
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
	drawSspr(sx0, sy0, w * 8, h * 8, x, y, w * 8, h * 8);
}

void PlayRuntime::drawSspr(int sx, int sy, int sw, int sh, int dx, int dy, int dw, int dh) {
	if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) {
		return;
	}
	for (int y = 0; y < dh; ++y) {
		for (int x = 0; x < dw; ++x) {
			const int srcX = sx + x * sw / dw;
			const int srcY = sy + y * sh / dh;
			if (srcX < 0 || srcY < 0 || srcX >= kSize || srcY >= kSize) {
				continue;
			}
			const int c = m_sprites[static_cast<size_t>(srcY * kSize + srcX)] & 15;
			if (c != 0) {
				pset(dx + x, dy + y, c);
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

void PlayRuntime::drawCirc(int cx, int cy, int rad, int c, bool fill) {
	if (rad < 0) {
		return;
	}
	if (rad == 0) {
		pset(cx, cy, c);
		return;
	}
	const int r2 = rad * rad;
	const int rOuter = (rad + 1) * (rad + 1);
	for (int y = -rad; y <= rad; ++y) {
		for (int x = -rad; x <= rad; ++x) {
			const int d = x * x + y * y;
			if (fill) {
				if (d <= r2) {
					pset(cx + x, cy + y, c);
				}
			} else if (d <= rOuter && d >= r2 - rad) {
				// thin ring approximate
				const int d2 = (std::abs(x) + 1) * (std::abs(x) + 1) + y * y;
				const int d3 = x * x + (std::abs(y) + 1) * (std::abs(y) + 1);
				if (d2 > r2 || d3 > r2) {
					pset(cx + x, cy + y, c);
				}
			}
		}
	}
}

void PlayRuntime::registerApi() {
	lua_register(m_L, "cls", l_cls);
	lua_register(m_L, "btn", l_btn);
	lua_register(m_L, "btnp", l_btnp);
	lua_register(m_L, "spr", l_spr);
	lua_register(m_L, "sspr", l_sspr);
	lua_register(m_L, "map", l_map);
	lua_register(m_L, "print", l_print);
	lua_register(m_L, "pset", l_pset);
	lua_register(m_L, "pget", l_pget);
	lua_register(m_L, "mget", l_mget);
	lua_register(m_L, "mset", l_mset);
	lua_register(m_L, "rect", l_rect);
	lua_register(m_L, "rectfill", l_rectfill);
	lua_register(m_L, "circ", l_circ);
	lua_register(m_L, "circfill", l_circfill);
	lua_register(m_L, "color", l_color);
	lua_register(m_L, "pal", l_pal);
	lua_register(m_L, "fillp", l_fillp);
	lua_register(m_L, "sfx", l_sfx);
	lua_register(m_L, "music", l_music);
	lua_register(m_L, "cartdata", l_cartdata);
	lua_register(m_L, "dget", l_dget);
	lua_register(m_L, "dset", l_dset);
	lua_register(m_L, "flr", l_flr);
	lua_register(m_L, "mid", l_mid);
	lua_register(m_L, "abs", l_abs);
	lua_register(m_L, "min", l_min);
	lua_register(m_L, "max", l_max);
	lua_register(m_L, "rnd", l_rnd);
	lua_register(m_L, "sin", l_sin);
	lua_register(m_L, "cos", l_cos);
	lua_register(m_L, "sqrt", l_sqrt);
	lua_register(m_L, "add", l_add);
	lua_register(m_L, "del", l_del);
	lua_register(m_L, "count", l_count);
	lua_register(m_L, "all", l_all);
	lua_register(m_L, "split", l_split);
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

int PlayRuntime::l_btnp(lua_State* L) {
	auto* r = self(L);
	const int i = static_cast<int>(luaL_optinteger(L, 1, 0));
	const bool pressed =
		i >= 0 && i < static_cast<int>(r->m_btnp.size()) && r->m_btnp[static_cast<size_t>(i)];
	lua_pushboolean(L, pressed);
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

int PlayRuntime::l_sspr(lua_State* L) {
	auto* r = self(L);
	const int sx = static_cast<int>(luaL_checkinteger(L, 1));
	const int sy = static_cast<int>(luaL_checkinteger(L, 2));
	const int sw = static_cast<int>(luaL_checkinteger(L, 3));
	const int sh = static_cast<int>(luaL_checkinteger(L, 4));
	const int dx = static_cast<int>(luaL_checkinteger(L, 5));
	const int dy = static_cast<int>(luaL_checkinteger(L, 6));
	const int dw = static_cast<int>(luaL_optinteger(L, 7, sw));
	const int dh = static_cast<int>(luaL_optinteger(L, 8, sh));
	r->drawSspr(sx, sy, sw, sh, dx, dy, dw, dh);
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

int PlayRuntime::l_mset(lua_State* L) {
	auto* r = self(L);
	const int x = static_cast<int>(luaL_checkinteger(L, 1));
	const int y = static_cast<int>(luaL_checkinteger(L, 2));
	const int v = static_cast<int>(luaL_optinteger(L, 3, 0));
	if (x >= 0 && y >= 0 && x < kMapW && y < kMapH) {
		r->m_map[static_cast<size_t>(y * kMapW + x)] = static_cast<uint8_t>(v & 255);
	}
	return 0;
}

int PlayRuntime::l_rect(lua_State* L) {
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
	for (int x = x0; x <= x1; ++x) {
		r->pset(x, y0, c);
		r->pset(x, y1, c);
	}
	for (int y = y0; y <= y1; ++y) {
		r->pset(x0, y, c);
		r->pset(x1, y, c);
	}
	return 0;
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

int PlayRuntime::l_circ(lua_State* L) {
	auto* r = self(L);
	r->drawCirc(static_cast<int>(luaL_checkinteger(L, 1)),
				static_cast<int>(luaL_checkinteger(L, 2)),
				static_cast<int>(luaL_checkinteger(L, 3)),
				static_cast<int>(luaL_optinteger(L, 4, r->m_color)), false);
	return 0;
}

int PlayRuntime::l_circfill(lua_State* L) {
	auto* r = self(L);
	r->drawCirc(static_cast<int>(luaL_checkinteger(L, 1)),
				static_cast<int>(luaL_checkinteger(L, 2)),
				static_cast<int>(luaL_checkinteger(L, 3)),
				static_cast<int>(luaL_optinteger(L, 4, r->m_color)), true);
	return 0;
}

int PlayRuntime::l_color(lua_State* L) {
	auto* r = self(L);
	if (lua_gettop(L) >= 1 && !lua_isnil(L, 1)) {
		r->m_color = static_cast<int>(luaL_checkinteger(L, 1)) & 15;
	}
	lua_pushinteger(L, r->m_color);
	return 1;
}

int PlayRuntime::l_pal(lua_State* L) {
	auto* r = self(L);
	const int n = lua_gettop(L);
	if (n == 0 || (n == 1 && lua_isnil(L, 1))) {
		for (int i = 0; i < 16; ++i) {
			r->m_drawPal[static_cast<size_t>(i)] = static_cast<uint8_t>(i);
		}
		r->m_palette = r->m_paletteBase;
		return 0;
	}
	const int c0 = static_cast<int>(luaL_checkinteger(L, 1)) & 15;
	const int c1 = static_cast<int>(luaL_optinteger(L, 2, 0)) & 15;
	const int p = static_cast<int>(luaL_optinteger(L, 3, 0));
	if (p == 1) {
		r->m_palette[static_cast<size_t>(c0)] = r->m_paletteBase[static_cast<size_t>(c1)];
	} else {
		r->m_drawPal[static_cast<size_t>(c0)] = static_cast<uint8_t>(c1);
	}
	return 0;
}

int PlayRuntime::l_fillp(lua_State* L) {
	auto* r = self(L);
	if (lua_gettop(L) < 1 || lua_isnil(L, 1)) {
		r->m_fillp = 0;
		r->m_fillpOn = false;
		return 0;
	}
	r->m_fillp = static_cast<uint16_t>(luaL_checkinteger(L, 1) & 0xffff);
	r->m_fillpOn = r->m_fillp != 0;
	return 0;
}

int PlayRuntime::l_sfx(lua_State* /*L*/) {
	return 0;
}

int PlayRuntime::l_music(lua_State* /*L*/) {
	return 0;
}

int PlayRuntime::l_cartdata(lua_State* L) {
	auto* r = self(L);
	(void)luaL_optstring(L, 1, "");
	r->m_cdata.fill(0.0);
	return 0;
}

int PlayRuntime::l_dget(lua_State* L) {
	auto* r = self(L);
	const int i = static_cast<int>(luaL_checkinteger(L, 1));
	double v = 0.0;
	if (i >= 0 && i < static_cast<int>(r->m_cdata.size())) {
		v = r->m_cdata[static_cast<size_t>(i)];
	}
	lua_pushnumber(L, v);
	return 1;
}

int PlayRuntime::l_dset(lua_State* L) {
	auto* r = self(L);
	const int i = static_cast<int>(luaL_checkinteger(L, 1));
	const double v = luaL_checknumber(L, 2);
	if (i >= 0 && i < static_cast<int>(r->m_cdata.size())) {
		r->m_cdata[static_cast<size_t>(i)] = v;
	}
	return 0;
}

int PlayRuntime::l_flr(lua_State* L) {
	lua_pushnumber(L, std::floor(luaL_checknumber(L, 1)));
	return 1;
}

int PlayRuntime::l_mid(lua_State* L) {
	// PICO-8 mid returns the median of three values.
	const double a = luaL_checknumber(L, 1);
	const double b = luaL_checknumber(L, 2);
	const double c = luaL_checknumber(L, 3);
	const double lo = std::min(a, std::min(b, c));
	const double hi = std::max(a, std::max(b, c));
	lua_pushnumber(L, a + b + c - lo - hi);
	return 1;
}

int PlayRuntime::l_abs(lua_State* L) {
	lua_pushnumber(L, std::fabs(luaL_checknumber(L, 1)));
	return 1;
}

int PlayRuntime::l_min(lua_State* L) {
	lua_pushnumber(L, std::min(luaL_checknumber(L, 1), luaL_checknumber(L, 2)));
	return 1;
}

int PlayRuntime::l_max(lua_State* L) {
	lua_pushnumber(L, std::max(luaL_checknumber(L, 1), luaL_checknumber(L, 2)));
	return 1;
}

int PlayRuntime::l_rnd(lua_State* L) {
	if (lua_istable(L, 1)) {
		const lua_Integer n = luaL_len(L, 1);
		if (n <= 0) {
			lua_pushnil(L);
			return 1;
		}
		const lua_Integer i = 1 + static_cast<lua_Integer>(std::rand() % static_cast<int>(n));
		lua_rawgeti(L, 1, i);
		return 1;
	}
	const double x = lua_gettop(L) >= 1 && !lua_isnil(L, 1) ? luaL_checknumber(L, 1) : 1.0;
	const double u = static_cast<double>(std::rand()) / static_cast<double>(RAND_MAX);
	lua_pushnumber(L, u * x);
	return 1;
}

int PlayRuntime::l_sin(lua_State* L) {
	// PICO-8 turns: 1.0 = full circle; sign is inverted vs math.sin.
	const double t = luaL_checknumber(L, 1);
	lua_pushnumber(L, -std::sin(t * 6.283185307179586));
	return 1;
}

int PlayRuntime::l_cos(lua_State* L) {
	const double t = luaL_checknumber(L, 1);
	lua_pushnumber(L, std::cos(t * 6.283185307179586));
	return 1;
}

int PlayRuntime::l_sqrt(lua_State* L) {
	lua_pushnumber(L, std::sqrt(std::max(0.0, luaL_checknumber(L, 1))));
	return 1;
}

int PlayRuntime::l_add(lua_State* L) {
	luaL_checktype(L, 1, LUA_TTABLE);
	lua_settop(L, 2);
	const lua_Integer n = luaL_len(L, 1) + 1;
	lua_pushvalue(L, 2);
	lua_rawseti(L, 1, n);
	lua_pushvalue(L, 2);
	return 1;
}

int PlayRuntime::l_del(lua_State* L) {
	luaL_checktype(L, 1, LUA_TTABLE);
	const lua_Integer n = luaL_len(L, 1);
	for (lua_Integer i = 1; i <= n; ++i) {
		lua_rawgeti(L, 1, i);
		if (lua_rawequal(L, -1, 2)) {
			for (lua_Integer j = i; j < n; ++j) {
				lua_rawgeti(L, 1, j + 1);
				lua_rawseti(L, 1, j);
			}
			lua_pushnil(L);
			lua_rawseti(L, 1, n);
			return 1; // matched value still on stack
		}
		lua_pop(L, 1);
	}
	lua_pushnil(L);
	return 1;
}

int PlayRuntime::l_count(lua_State* L) {
	luaL_checktype(L, 1, LUA_TTABLE);
	if (lua_gettop(L) < 2 || lua_isnil(L, 2)) {
		lua_pushinteger(L, luaL_len(L, 1));
		return 1;
	}
	lua_Integer n = 0;
	const lua_Integer len = luaL_len(L, 1);
	for (lua_Integer i = 1; i <= len; ++i) {
		lua_rawgeti(L, 1, i);
		if (lua_rawequal(L, -1, 2)) {
			++n;
		}
		lua_pop(L, 1);
	}
	lua_pushinteger(L, n);
	return 1;
}

int PlayRuntime::l_all_next(lua_State* L) {
	const int i = static_cast<int>(lua_tointeger(L, lua_upvalueindex(2))) + 1;
	lua_pushinteger(L, i);
	lua_replace(L, lua_upvalueindex(2));
	lua_rawgeti(L, lua_upvalueindex(1), i);
	return 1;
}

int PlayRuntime::l_all(lua_State* L) {
	luaL_checktype(L, 1, LUA_TTABLE);
	lua_pushvalue(L, 1);
	lua_pushinteger(L, 0);
	lua_pushcclosure(L, l_all_next, 2);
	return 1;
}

int PlayRuntime::l_split(lua_State* L) {
	// PICO-8 split(str, [sep], [convert]) — default sep ",", convert numbers.
	const char* s = luaL_checkstring(L, 1);
	std::string sep = ",";
	if (lua_gettop(L) >= 2 && !lua_isnil(L, 2)) {
		if (lua_isnumber(L, 2)) {
			// separator as char code
			sep.assign(1, static_cast<char>(lua_tointeger(L, 2) & 255));
		} else {
			sep = luaL_checkstring(L, 2);
			if (sep.empty()) {
				sep = ",";
			}
		}
	}
	bool convert = true;
	if (lua_gettop(L) >= 3 && !lua_isnil(L, 3)) {
		convert = lua_toboolean(L, 3) != 0;
	}
	lua_newtable(L);
	lua_Integer n = 0;
	const std::string str(s);
	size_t start = 0;
	while (start <= str.size()) {
		size_t end = sep.empty() ? start + 1 : str.find(sep, start);
		if (sep.empty()) {
			end = start + 1;
		}
		if (end == std::string::npos) {
			end = str.size();
		}
		const std::string part = str.substr(start, end - start);
		++n;
		if (convert) {
			char* endp = nullptr;
			const double v = std::strtod(part.c_str(), &endp);
			if (endp && endp != part.c_str() && *endp == '\0') {
				lua_pushnumber(L, v);
			} else {
				lua_pushlstring(L, part.data(), part.size());
			}
		} else {
			lua_pushlstring(L, part.data(), part.size());
		}
		lua_rawseti(L, -2, n);
		if (end >= str.size()) {
			break;
		}
		start = end + sep.size();
		if (start == str.size()) {
			// trailing separator → empty final field
			++n;
			if (convert) {
				lua_pushnumber(L, 0);
			} else {
				lua_pushlstring(L, "", 0);
			}
			lua_rawseti(L, -2, n);
			break;
		}
	}
	return 1;
}
