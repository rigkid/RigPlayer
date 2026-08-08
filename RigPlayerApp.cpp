#include "RigPlayerApp.h"

#include "DocKind.h"

#include "core/RigKitEngine.h"
#include "core/pack/MPack.h"
#include "core/util/AppPaths.h"
#include "core/util/CommandLineArgs.h"
#include "packs/rigComponent/src/rigComponent.h"
#include "packs/rigDocumentShell/src/rigDocumentShell.h"
#include "packs/rigImGui/src/rigImGui.h"
#include "packs/rigSystems/src/rigSystems.h"
#include "rendering/U_gladGlfw.h"

#include <cstdlib>
#include <fstream>
#include <nlohmann/json.hpp>
#include <spdlog/spdlog.h>
#include <sstream>

#if defined(_WIN32)
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <shellapi.h>
#endif

namespace {

#if defined(RIGKIT_GLES)
constexpr const char* kVs = R"(#version 100
attribute vec2 aPos;
attribute vec2 aUv;
varying vec2 vUv;
void main() {
	vUv = aUv;
	gl_Position = vec4(aPos, 0.0, 1.0);
}
)";
constexpr const char* kFs = R"(#version 100
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
void main() {
	gl_FragColor = texture2D(uTex, vUv);
}
)";
#else
constexpr const char* kVs = R"(#version 330 core
layout (location = 0) in vec2 aPos;
layout (location = 1) in vec2 aUv;
out vec2 vUv;
void main() {
	vUv = aUv;
	gl_Position = vec4(aPos, 0.0, 1.0);
}
)";
constexpr const char* kFs = R"(#version 330 core
in vec2 vUv;
out vec4 FragColor;
uniform sampler2D uTex;
void main() {
	FragColor = texture(uTex, vUv);
}
)";
#endif

unsigned int compileShader(unsigned int type, const char* src) {
	const unsigned int sh = glCreateShader(type);
	glShaderSource(sh, 1, &src, nullptr);
	glCompileShader(sh);
	int ok = 0;
	glGetShaderiv(sh, GL_COMPILE_STATUS, &ok);
	if (!ok) {
		char log[512];
		glGetShaderInfoLog(sh, 512, nullptr, log);
		spdlog::error("shader: {}", log);
	}
	return sh;
}

} // namespace

RigPlayerApp::RigPlayerApp() {
	window().width = 640;
	window().height = 640;
	window().title = "RigPlayer";
	m_rgba.assign(PlayRuntime::kSize * PlayRuntime::kSize * 4, 0);
}

void RigPlayerApp::parseCommandLineArgs(const rigkit::CommandLineArgs& args) {
	IApp::parseCommandLineArgs(args);
	const auto& pos = args.getPositionalArgs();
	if (!pos.empty()) {
		m_pendingPath = pos[0];
	}
}

void RigPlayerApp::setup() {
	m_engine->setClearColor(0.04f, 0.05f, 0.06f, 1.0f);
	auto* packs = m_engine->getPackManager();
	if (!packs) {
		return;
	}
	packs->registerPack<rigkit::rigComponent>();
	packs->registerPack<rigkit::rigSystems>();
	packs->registerPack<rigkit::rigImGui>();
	packs->registerPack<rigkit::rigDocumentShell>();
	packs->initAll();
	packs->setupAll();
	m_packsReady = true;

	if (auto shellPack = packs->getPack<rigkit::rigDocumentShell>()) {
		auto& shell = shellPack->shell();
		shell.setOpenFilters({".rig", ".json"});
		shell.setOnOpenPath([this](const std::string& path) { m_pendingPath = path; });
		if (auto* ui = m_engine->getUiManager()) {
			// Player: File → Open + dock passthrough; no Edit Mode / scene panels.
			shell.attachChrome(*ui, false, true);
		}
	}

	if (m_pendingPath.empty()) {
		m_pendingPath = AppPaths::getDataDir() + "/play/jailbreak.rig";
	}
	loadDocument(m_pendingPath);
	m_pendingPath.clear();
	spdlog::info("RigPlayer ready — full RigWorks host. File → Open a .rig / .json document.");
}

void RigPlayerApp::loadPresentDocument(const std::string& path) {
	m_presentMode = true;
	m_play.reset();
	m_docPath = path;
	window().title = "RigPlayer — present (web host)";

	const std::string shellPath = AppPaths::getDataDir() + "/web/rigplayer.html";
	std::ifstream shellIn(shellPath);
	if (!shellIn) {
		spdlog::error("RigPlayer — missing {} (build web bundle / deploy data/web)", shellPath);
		window().title = "RigPlayer — present host missing";
		return;
	}
	std::ostringstream shellSs;
	shellSs << shellIn.rdbuf();
	std::string html = shellSs.str();

	std::ifstream docIn(path);
	if (!docIn) {
		spdlog::error("RigPlayer — cannot read {}", path);
		return;
	}
	std::ostringstream docSs;
	docSs << docIn.rdbuf();
	const nlohmann::json asJsString = docSs.str();
	const std::string inject =
		"<script>globalThis.__RIGPLAYER_INLINE_DOC__=" + asJsString.dump() + ";</script>\n";

	const std::string marker = "<script type=\"module\">";
	const auto at = html.find(marker);
	if (at == std::string::npos) {
		spdlog::error("RigPlayer — rigplayer.html missing module boot marker");
		return;
	}
	html.insert(at, inject);

	const std::string outPath = AppPaths::getDataDir() + "/web/open-present.html";
	{
		std::ofstream out(outPath, std::ios::binary);
		out << html;
	}

#if defined(_WIN32)
	const auto rc = reinterpret_cast<INT_PTR>(ShellExecuteA(nullptr, "open", outPath.c_str(), nullptr, nullptr, SW_SHOWNORMAL));
	if (rc <= 32) {
		spdlog::error("RigPlayer — ShellExecute failed ({}) for {}", static_cast<long long>(rc), outPath);
	} else {
		spdlog::info("RigPlayer — opened present document in web host: {}", path);
	}
#else
	const std::string cmd = "xdg-open \"" + outPath + "\" || open \"" + outPath + "\"";
	if (std::system(cmd.c_str()) != 0) {
		spdlog::error("RigPlayer — could not open web host for {}", outPath);
	} else {
		spdlog::info("RigPlayer — opened present document in web host: {}", path);
	}
#endif

	if (auto* packs = m_engine->getPackManager()) {
		if (auto shellPack = packs->getPack<rigkit::rigDocumentShell>()) {
			shellPack->shell().setDocumentTitle("Present (web host)");
			shellPack->shell().setSkippedKeys({});
		}
	}
}

void RigPlayerApp::loadDocument(const std::string& path) {
	m_docPath = path;
	const DocKind kind = classifyRigDocumentFile(path);
	if (kind == DocKind::Present) {
		loadPresentDocument(path);
		return;
	}

	m_presentMode = false;
	m_play = std::make_unique<PlayRuntime>();
	const std::string err = m_play->load(m_docPath);
	if (!err.empty()) {
		spdlog::error("RigPlayer — {}", err);
		m_play.reset();
		window().title = "RigPlayer — load failed";
		return;
	}
	window().title = "RigPlayer — " + m_play->title();
	if (auto* packs = m_engine->getPackManager()) {
		if (auto shellPack = packs->getPack<rigkit::rigDocumentShell>()) {
			shellPack->shell().setDocumentTitle(m_play->title());
			shellPack->shell().setSkippedKeys(m_play->skippedKeys());
			if (!m_play->skippedKeys().empty()) {
				if (auto* ui = m_engine->getUiManager()) {
					if (auto* wm = ui->getWindowManager()) {
						wm->showWindow("Skipped keys");
					}
				}
			}
		}
	}
	m_tickAccum = 0.f;
	spdlog::info("RigPlayer — loaded {}", m_docPath);
	ensurePresent();
}

void RigPlayerApp::update(float dt) {
	if (!m_pendingPath.empty() && m_packsReady) {
		loadDocument(m_pendingPath);
		m_pendingPath.clear();
	}
	if (!m_play || m_presentMode) {
		return;
	}
	// Pixel runtime: fixed 30 Hz steps, capped so a stall cannot spiral.
	constexpr float kStep = 1.f / 30.f;
	constexpr int kMaxSteps = 4;
	m_tickAccum += dt;
	int steps = 0;
	while (m_tickAccum >= kStep && steps < kMaxSteps) {
		pollButtons();
		m_play->tick();
		m_tickAccum -= kStep;
		++steps;
	}
	if (m_tickAccum > kStep * kMaxSteps) {
		m_tickAccum = 0.f;
	}
}

void RigPlayerApp::draw() {
	if (!m_play || !m_presentReady) {
		return;
	}
	uploadScreen();
	presentScreen();
}

void RigPlayerApp::exit() {
	destroyPresent();
	m_play.reset();
}

void RigPlayerApp::pollButtons() {
	GLFWwindow* win = m_engine->getWindow();
	if (!win || !m_play) {
		return;
	}
	m_play->setButton(0, glfwGetKey(win, GLFW_KEY_LEFT) == GLFW_PRESS);
	m_play->setButton(1, glfwGetKey(win, GLFW_KEY_RIGHT) == GLFW_PRESS);
	m_play->setButton(2, glfwGetKey(win, GLFW_KEY_UP) == GLFW_PRESS);
	m_play->setButton(3, glfwGetKey(win, GLFW_KEY_DOWN) == GLFW_PRESS);
	m_play->setButton(4, glfwGetKey(win, GLFW_KEY_Z) == GLFW_PRESS ||
							 glfwGetKey(win, GLFW_KEY_C) == GLFW_PRESS);
	m_play->setButton(5, glfwGetKey(win, GLFW_KEY_X) == GLFW_PRESS ||
							 glfwGetKey(win, GLFW_KEY_V) == GLFW_PRESS);
}

void RigPlayerApp::ensurePresent() {
	if (m_presentReady) {
		return;
	}
	const unsigned int vs = compileShader(GL_VERTEX_SHADER, kVs);
	const unsigned int fs = compileShader(GL_FRAGMENT_SHADER, kFs);
	m_prog = glCreateProgram();
	glAttachShader(m_prog, vs);
	glAttachShader(m_prog, fs);
#if defined(RIGKIT_GLES)
	glBindAttribLocation(m_prog, 0, "aPos");
	glBindAttribLocation(m_prog, 1, "aUv");
#endif
	glLinkProgram(m_prog);
	glDeleteShader(vs);
	glDeleteShader(fs);

	const float quad[] = {
		-1.f, -1.f, 0.f, 1.f, 1.f, -1.f, 1.f, 1.f, -1.f, 1.f, 0.f, 0.f, 1.f, 1.f, 1.f, 0.f,
	};
	glGenVertexArrays(1, &m_vao);
	glGenBuffers(1, &m_vbo);
	glBindVertexArray(m_vao);
	glBindBuffer(GL_ARRAY_BUFFER, m_vbo);
	glBufferData(GL_ARRAY_BUFFER, sizeof(quad), quad, GL_STATIC_DRAW);
	glEnableVertexAttribArray(0);
	glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(float), nullptr);
	glEnableVertexAttribArray(1);
	glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(float),
						  reinterpret_cast<void*>(2 * sizeof(float)));
	glBindVertexArray(0);

	glGenTextures(1, &m_tex);
	glBindTexture(GL_TEXTURE_2D, m_tex);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
	glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
	glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, PlayRuntime::kSize, PlayRuntime::kSize, 0, GL_RGBA,
				 GL_UNSIGNED_BYTE, nullptr);
	glBindTexture(GL_TEXTURE_2D, 0);
	m_presentReady = true;
}

void RigPlayerApp::destroyPresent() {
	if (m_tex) {
		glDeleteTextures(1, &m_tex);
		m_tex = 0;
	}
	if (m_vbo) {
		glDeleteBuffers(1, &m_vbo);
		m_vbo = 0;
	}
	if (m_vao) {
		glDeleteVertexArrays(1, &m_vao);
		m_vao = 0;
	}
	if (m_prog) {
		glDeleteProgram(m_prog);
		m_prog = 0;
	}
	m_presentReady = false;
}

void RigPlayerApp::uploadScreen() {
	const auto& screen = m_play->screen();
	const auto& pal = m_play->palette();
	for (int i = 0; i < PlayRuntime::kSize * PlayRuntime::kSize; ++i) {
		const auto& c = pal[screen[static_cast<size_t>(i)] & 15];
		m_rgba[static_cast<size_t>(i) * 4 + 0] = static_cast<uint8_t>(c[0] * 255.f);
		m_rgba[static_cast<size_t>(i) * 4 + 1] = static_cast<uint8_t>(c[1] * 255.f);
		m_rgba[static_cast<size_t>(i) * 4 + 2] = static_cast<uint8_t>(c[2] * 255.f);
		m_rgba[static_cast<size_t>(i) * 4 + 3] = 255;
	}
	glBindTexture(GL_TEXTURE_2D, m_tex);
	glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, PlayRuntime::kSize, PlayRuntime::kSize, GL_RGBA,
					GL_UNSIGNED_BYTE, m_rgba.data());
	glBindTexture(GL_TEXTURE_2D, 0);
}

void RigPlayerApp::presentScreen() {
	glDisable(GL_DEPTH_TEST);
	glUseProgram(m_prog);
	glActiveTexture(GL_TEXTURE0);
	glBindTexture(GL_TEXTURE_2D, m_tex);
	const int loc = glGetUniformLocation(m_prog, "uTex");
	if (loc >= 0) {
		glUniform1i(loc, 0);
	}
	glBindVertexArray(m_vao);
	glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
	glBindVertexArray(0);
	glBindTexture(GL_TEXTURE_2D, 0);
	glUseProgram(0);
}
