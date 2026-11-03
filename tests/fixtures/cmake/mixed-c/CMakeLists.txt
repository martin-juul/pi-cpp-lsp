cmake_minimum_required(VERSION 3.14)
project(mixed LANGUAGES C CXX)
add_executable(app main.cpp legacy.c)
set_target_properties(app PROPERTIES C_STANDARD 11 CXX_STANDARD 17)
