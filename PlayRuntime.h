#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <vector>

struct lua_State;

/**
 * @brief Load a Rig document (`.rig`) and run its Lua SUDE loop (RigPlayer).
 * @details Speaks palette / tile_set / tile_map / media.code / input.buttons.
 * PICO-8 sugar is rewritten to stock Lua before load. Graphics and helpers cover
 * the fantasy-console subset plus enough surface for the Jailbreak showcase
 * (btnp / mset / pal / sspr / fillp / table + math helpers). Audio is a no-op.
 */
class PlayRuntime {
  public:
	static constexpr int kSize = 128;
	static constexpr int kMapW = 128;
	static constexpr int kMapH = 32;

	PlayRuntime();
	~PlayRuntime();

	PlayRuntime(const PlayRuntime&) = delete;
	PlayRuntime& operator=(const PlayRuntime&) = delete;

	/** @return empty on success, else error text. */
	std::string load(const std::string& path);

	void setButton(int index, bool down);
	void tick();

	/** @brief `rig.*` component keys in the document this runtime does not speak. */
	const std::vector<std::string>& skippedKeys() const { return m_skipped; }

	const std::string& title() const { return m_title; }
	const std::array<uint8_t, kSize * kSize>& screen() const { return m_screen; }
	const std::array<std::array<float, 4>, 16>& palette() const { return m_palette; }

	bool ok() const { return m_L != nullptr; }

  private:
	void registerApi();
	void callHook(const char* name);
	void resetDrawState();

	static PlayRuntime* self(lua_State* L);
	static int l_cls(lua_State* L);
	static int l_btn(lua_State* L);
	static int l_btnp(lua_State* L);
	static int l_spr(lua_State* L);
	static int l_sspr(lua_State* L);
	static int l_map(lua_State* L);
	static int l_print(lua_State* L);
	static int l_pset(lua_State* L);
	static int l_pget(lua_State* L);
	static int l_mget(lua_State* L);
	static int l_mset(lua_State* L);
	static int l_rect(lua_State* L);
	static int l_rectfill(lua_State* L);
	static int l_circ(lua_State* L);
	static int l_circfill(lua_State* L);
	static int l_color(lua_State* L);
	static int l_pal(lua_State* L);
	static int l_fillp(lua_State* L);
	static int l_sfx(lua_State* L);
	static int l_music(lua_State* L);
	static int l_cartdata(lua_State* L);
	static int l_dget(lua_State* L);
	static int l_dset(lua_State* L);
	static int l_flr(lua_State* L);
	static int l_mid(lua_State* L);
	static int l_abs(lua_State* L);
	static int l_min(lua_State* L);
	static int l_max(lua_State* L);
	static int l_rnd(lua_State* L);
	static int l_sin(lua_State* L);
	static int l_cos(lua_State* L);
	static int l_sqrt(lua_State* L);
	static int l_add(lua_State* L);
	static int l_del(lua_State* L);
	static int l_count(lua_State* L);
	static int l_all(lua_State* L);
	static int l_all_next(lua_State* L);
	static int l_split(lua_State* L);

	void pset(int x, int y, int c);
	int pget(int x, int y) const;
	int mapColor(int c) const;
	bool fillpMask(int x, int y) const;
	void drawSprite(int n, int x, int y, int w = 1, int h = 1);
	void drawSspr(int sx, int sy, int sw, int sh, int dx, int dy, int dw, int dh);
	void drawMap(int celX, int celY, int sx, int sy, int celW, int celH);
	void drawCirc(int cx, int cy, int rad, int c, bool fill);

	lua_State* m_L = nullptr;
	std::string m_title = "untitled";
	std::vector<std::string> m_skipped;
	std::array<std::array<float, 4>, 16> m_palette{};
	std::array<std::array<float, 4>, 16> m_paletteBase{};
	std::array<uint8_t, kSize * kSize> m_sprites{};
	std::array<uint8_t, kMapW * kMapH> m_map{};
	std::array<uint8_t, kSize * kSize> m_screen{};
	std::array<bool, 6> m_btn{};
	std::array<bool, 6> m_btnPrev{};
	std::array<bool, 6> m_btnp{};
	std::array<uint8_t, 16> m_drawPal{};
	int m_color = 6;
	uint16_t m_fillp = 0;
	bool m_fillpOn = false;
	std::array<double, 64> m_cdata{};
};
