cmake_minimum_required(VERSION 3.14)
project(glob LANGUAGES CXX)
file(GLOB_RECURSE GLOB_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp)
add_executable(globbed ${GLOB_SOURCES})
