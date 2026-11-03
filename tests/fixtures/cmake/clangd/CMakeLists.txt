cmake_minimum_required(VERSION 3.14)
project(clangd_managed LANGUAGES CXX)
add_executable(app main.cpp widget.cpp)
target_compile_definitions(app PRIVATE MANAGED_VALUE_TYPE=double)
