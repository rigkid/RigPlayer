#include "ZipIo.h"

#include <filesystem>
#include <fstream>
#include <iterator>
#include <sstream>

namespace fs = std::filesystem;

namespace {

uint16_t u16(const std::vector<uint8_t>& b, size_t o) {
	if (o + 1 >= b.size()) {
		return 0;
	}
	return static_cast<uint16_t>(b[o] | (b[o + 1] << 8));
}

uint32_t u32(const std::vector<uint8_t>& b, size_t o) {
	if (o + 3 >= b.size()) {
		return 0;
	}
	return static_cast<uint32_t>(b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24));
}

int findEocd(const std::vector<uint8_t>& b) {
	const int start = static_cast<int>(b.size() >= 22 ? b.size() - 22 : 0);
	const int min = start > 65535 ? start - 65535 : 0;
	for (int i = start; i >= min; --i) {
		if (u32(b, static_cast<size_t>(i)) != 0x06054b50u) {
			continue;
		}
		const uint16_t comment = u16(b, static_cast<size_t>(i + 20));
		if (static_cast<size_t>(i) + 22 + comment == b.size()) {
			return i;
		}
	}
	return -1;
}

bool endsWithCi(const std::string& s, const char* ext) {
	const size_t n = std::char_traits<char>::length(ext);
	if (s.size() < n) {
		return false;
	}
	for (size_t i = 0; i < n; ++i) {
		char a = s[s.size() - n + i];
		char b = ext[i];
		if (a >= 'A' && a <= 'Z') {
			a = static_cast<char>(a - 'A' + 'a');
		}
		if (b >= 'A' && b <= 'Z') {
			b = static_cast<char>(b - 'A' + 'a');
		}
		if (a != b) {
			return false;
		}
	}
	return true;
}

} // namespace

bool readZipStore(const std::vector<uint8_t>& buf,
				  std::unordered_map<std::string, std::vector<uint8_t>>& files, std::string& err) {
	const int eocd = findEocd(buf);
	if (eocd < 0) {
		err = "not a ZIP archive";
		return false;
	}
	const uint16_t count = u16(buf, static_cast<size_t>(eocd + 10));
	const uint32_t cdOff = u32(buf, static_cast<size_t>(eocd + 16));
	size_t p = cdOff;
	for (uint16_t i = 0; i < count; ++i) {
		if (p + 46 > buf.size() || u32(buf, p) != 0x02014b50u) {
			err = "ZIP central directory is corrupt";
			return false;
		}
		const uint16_t method = u16(buf, p + 10);
		const uint32_t compSize = u32(buf, p + 20);
		const uint16_t nameLen = u16(buf, p + 28);
		const uint16_t extraLen = u16(buf, p + 30);
		const uint16_t commentLen = u16(buf, p + 32);
		const uint32_t localOff = u32(buf, p + 42);
		if (p + 46 + nameLen > buf.size()) {
			err = "ZIP name is truncated";
			return false;
		}
		const std::string name(reinterpret_cast<const char*>(buf.data() + p + 46), nameLen);
		p += 46 + nameLen + extraLen + commentLen;
		if (name.empty() || name.back() == '/') {
			continue;
		}
		if (method != 0) {
			continue;
		}
		if (localOff + 30 > buf.size() || u32(buf, localOff) != 0x04034b50u) {
			err = "ZIP local header is corrupt";
			return false;
		}
		const uint16_t locName = u16(buf, localOff + 26);
		const uint16_t locExtra = u16(buf, localOff + 28);
		const size_t dataOff = static_cast<size_t>(localOff) + 30 + locName + locExtra;
		if (dataOff + compSize > buf.size()) {
			err = "ZIP entry is truncated";
			return false;
		}
		files[name] = std::vector<uint8_t>(buf.begin() + static_cast<std::ptrdiff_t>(dataOff),
										  buf.begin() + static_cast<std::ptrdiff_t>(dataOff + compSize));
	}
	return true;
}

std::string base64Encode(const uint8_t* data, size_t len) {
	static const char* k = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	std::string out;
	out.reserve(((len + 2) / 3) * 4);
	for (size_t i = 0; i < len; i += 3) {
		const uint32_t n = (static_cast<uint32_t>(data[i]) << 16) |
						   (i + 1 < len ? static_cast<uint32_t>(data[i + 1]) << 8 : 0) |
						   (i + 2 < len ? static_cast<uint32_t>(data[i + 2]) : 0);
		out.push_back(k[(n >> 18) & 63]);
		out.push_back(k[(n >> 12) & 63]);
		out.push_back(i + 1 < len ? k[(n >> 6) & 63] : '=');
		out.push_back(i + 2 < len ? k[n & 63] : '=');
	}
	return out;
}

std::string guessImageDataUrl(const std::string& name, const std::vector<uint8_t>& bytes) {
	const char* mime = "application/octet-stream";
	if (endsWithCi(name, ".png")) {
		mime = "image/png";
	} else if (endsWithCi(name, ".jpg") || endsWithCi(name, ".jpeg")) {
		mime = "image/jpeg";
	} else if (endsWithCi(name, ".webp")) {
		mime = "image/webp";
	}
	return std::string("data:") + mime + ";base64," + base64Encode(bytes.data(), bytes.size());
}

void collectSidecarFiles(const std::string& docPath,
						 std::unordered_map<std::string, std::string>& imageDataUrls, std::string& atlasText) {
	std::error_code ec;
	const fs::path file = fs::u8path(docPath);
	const fs::path dir = file.parent_path();
	if (dir.empty() || !fs::exists(dir, ec)) {
		return;
	}
	auto consider = [&](const fs::path& p, const std::string& key) {
		if (endsWithCi(key, ".atlas")) {
			std::ifstream in(p, std::ios::binary);
			if (!in) {
				return;
			}
			std::ostringstream ss;
			ss << in.rdbuf();
			atlasText = ss.str();
			return;
		}
		if (!endsWithCi(key, ".png") && !endsWithCi(key, ".jpg") && !endsWithCi(key, ".jpeg") &&
			!endsWithCi(key, ".webp")) {
			return;
		}
		std::ifstream in(p, std::ios::binary);
		if (!in) {
			return;
		}
		std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());
		imageDataUrls[key] = guessImageDataUrl(key, bytes);
		const std::string base = fs::path(key).filename().generic_string();
		if (base != key) {
			imageDataUrls[base] = imageDataUrls[key];
		}
	};
	for (const auto& ent : fs::directory_iterator(dir, ec)) {
		if (!ent.is_regular_file()) {
			continue;
		}
		consider(ent.path(), ent.path().filename().generic_string());
	}
	const fs::path dataDir = dir / "data";
	if (fs::exists(dataDir, ec) && fs::is_directory(dataDir, ec)) {
		for (const auto& ent : fs::recursive_directory_iterator(dataDir, ec)) {
			if (!ent.is_regular_file()) {
				continue;
			}
			const std::string rel = fs::relative(ent.path(), dataDir, ec).generic_string();
			consider(ent.path(), rel);
		}
	}
}
