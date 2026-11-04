#pragma once

#include <cstddef>
#include <meta>
#include <string_view>

struct Widget {
  int width;
  int height;
};

// The name of a type, read through static reflection.
template <typename T>
consteval std::string_view type_name() {
  return std::meta::identifier_of(^^T);
}

// The number of non-static data members of a type.
template <typename T>
consteval std::size_t member_count() {
  return std::meta::nonstatic_data_members_of(^^T, std::meta::access_context::unchecked()).size();
}
