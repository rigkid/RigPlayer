#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

/** Store-method ZIP entries (and names). Deflated entries are skipped. */
bool readZipStore(const std::vector<uint8_t>& buf,
				  std::unordered_map<std::string, std::vector<uint8_t>>& files, std::string& err);

std::string base64Encode(const uint8_t* data, size_t len);
std::string guessImageDataUrl(const std::string& name, const std::vector<uint8_t>& bytes);

void collectSidecarFiles(const std::string& docPath,
						 std::unordered_map<std::string, std::string>& imageDataUrls, std::string& atlasText);
