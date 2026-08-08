cmake_minimum_required(VERSION 3.19)

project(RigPlayer VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

if(NOT RIGKIT_DIR)
	if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/rigkit/CMakeLists.txt")
		set(RIGKIT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/rigkit")
	elseif(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/../RigKit/CMakeLists.txt")
		set(RIGKIT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../RigKit")
	endif()
endif()
set(RIGKIT_DIR "${RIGKIT_DIR}" CACHE PATH "Path to RigKit checkout")

if(NOT EXISTS "${RIGKIT_DIR}/CMakeLists.txt")
	message(FATAL_ERROR
		"RigKit not found at RIGKIT_DIR=${RIGKIT_DIR}.\n"
		"  cmake -S . -B build -DRIGKIT_DIR=/path/to/RigKit")
endif()

# Prefer sibling pack checkouts (rigDocumentShell) when present.
list(APPEND CMAKE_PREFIX_PATH "${CMAKE_CURRENT_SOURCE_DIR}/../rigDocumentShell")

include("${RIGKIT_DIR}/cmake/CPM.cmake")
add_subdirectory("${RIGKIT_DIR}" "${CMAKE_BINARY_DIR}/rigkit")
add_rigkit_application(SOURCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}")

include(FetchContent)
if(POLICY CMP0135)
	cmake_policy(SET CMP0135 NEW)
endif()
if(POLICY CMP0169)
	cmake_policy(SET CMP0169 OLD)
endif()
FetchContent_Declare(
	lua_src
	URL https://www.lua.org/ftp/lua-5.4.7.tar.gz
	URL_HASH SHA256=9fbf5e28ef86c69858f6d3d34eccc32e911c1a28b4120ff3e84aaa70cfbf1e30
)
FetchContent_GetProperties(lua_src)
if(NOT lua_src_POPULATED)
	FetchContent_Populate(lua_src)
endif()

set(_LUA_SRC_DIR "${lua_src_SOURCE_DIR}/src")
set(_LUA_CORE
	${_LUA_SRC_DIR}/lapi.c ${_LUA_SRC_DIR}/lcode.c ${_LUA_SRC_DIR}/lctype.c
	${_LUA_SRC_DIR}/ldebug.c ${_LUA_SRC_DIR}/ldo.c ${_LUA_SRC_DIR}/ldump.c
	${_LUA_SRC_DIR}/lfunc.c ${_LUA_SRC_DIR}/lgc.c ${_LUA_SRC_DIR}/llex.c
	${_LUA_SRC_DIR}/lmem.c ${_LUA_SRC_DIR}/lobject.c ${_LUA_SRC_DIR}/lopcodes.c
	${_LUA_SRC_DIR}/lparser.c ${_LUA_SRC_DIR}/lstate.c ${_LUA_SRC_DIR}/lstring.c
	${_LUA_SRC_DIR}/ltable.c ${_LUA_SRC_DIR}/ltm.c ${_LUA_SRC_DIR}/lundump.c
	${_LUA_SRC_DIR}/lvm.c ${_LUA_SRC_DIR}/lzio.c ${_LUA_SRC_DIR}/lauxlib.c
	${_LUA_SRC_DIR}/lbaselib.c ${_LUA_SRC_DIR}/lcorolib.c ${_LUA_SRC_DIR}/ldblib.c
	${_LUA_SRC_DIR}/liolib.c ${_LUA_SRC_DIR}/lmathlib.c ${_LUA_SRC_DIR}/loadlib.c
	${_LUA_SRC_DIR}/loslib.c ${_LUA_SRC_DIR}/lstrlib.c ${_LUA_SRC_DIR}/ltablib.c
	${_LUA_SRC_DIR}/lutf8lib.c ${_LUA_SRC_DIR}/linit.c
)
add_library(lua_static STATIC ${_LUA_CORE})
target_include_directories(lua_static PUBLIC ${_LUA_SRC_DIR})
if(NOT WIN32)
	target_link_libraries(lua_static PUBLIC m)
endif()
if(MSVC)
	target_compile_definitions(lua_static PRIVATE _CRT_SECURE_NO_WARNINGS)
endif()

if(TARGET RigPlayer)
	target_link_libraries(RigPlayer PRIVATE lua_static)
	target_include_directories(RigPlayer PRIVATE ${CMAKE_CURRENT_SOURCE_DIR})
	add_custom_command(TARGET RigPlayer POST_BUILD
		COMMAND ${CMAKE_COMMAND} -E make_directory
				"$<TARGET_FILE_DIR:RigPlayer>/data/play"
		COMMAND ${CMAKE_COMMAND} -E make_directory
				"$<TARGET_FILE_DIR:RigPlayer>/data/web"
		COMMAND ${CMAKE_COMMAND} -E copy_if_different
				"${CMAKE_CURRENT_SOURCE_DIR}/examples/jailbreak.rig"
				"$<TARGET_FILE_DIR:RigPlayer>/data/play/jailbreak.rig"
		COMMAND ${CMAKE_COMMAND} -E copy_if_different
				"${CMAKE_CURRENT_SOURCE_DIR}/examples/demo-3d.json"
				"$<TARGET_FILE_DIR:RigPlayer>/data/play/demo-3d.json"
		COMMAND ${CMAKE_COMMAND} -E copy_if_different
				"${CMAKE_CURRENT_SOURCE_DIR}/examples/demo-gleditor.json"
				"$<TARGET_FILE_DIR:RigPlayer>/data/play/demo-gleditor.json"
		COMMAND ${CMAKE_COMMAND} -E copy_if_different
				"${CMAKE_CURRENT_SOURCE_DIR}/dist/rigplayer.html"
				"$<TARGET_FILE_DIR:RigPlayer>/data/web/rigplayer.html"
		COMMENT "Deploy Rig documents + web present host next to RigPlayer"
	)
endif()
