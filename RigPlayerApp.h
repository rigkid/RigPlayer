#pragma once

#include "PlayRuntime.h"

#include "core/U_core.h"

#include <memory>
#include <string>
#include <vector>

class RigPlayerApp : public rigkit::IApp {
  public:
	RigPlayerApp();
	void parseCommandLineArgs(const rigkit::CommandLineArgs& args) override;
	void setup() override;
	void update(float dt) override;
	void draw() override;
	void exit() override;

  private:
	void loadDocument(const std::string& path);
	void loadPresentDocument(const std::string& path);
	void ensurePresent();
	void destroyPresent();
	void uploadScreen();
	void presentScreen();
	void pollButtons();

	std::string m_docPath;
	std::string m_pendingPath;
	std::unique_ptr<PlayRuntime> m_play;
	bool m_presentMode = false;
	unsigned int m_tex = 0;
	unsigned int m_prog = 0;
	unsigned int m_vao = 0;
	unsigned int m_vbo = 0;
	std::vector<uint8_t> m_rgba;
	float m_tickAccum = 0.f;
	bool m_presentReady = false;
	bool m_packsReady = false;
};
