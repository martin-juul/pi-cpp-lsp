#include <contracts>
#include <cstdlib>

#include "describe.hpp"

int area(const Widget& widget)
  pre(widget.width >= 0 && widget.height >= 0)
{
  contract_assert(widget.width * widget.height >= 0);
  return widget.width * widget.height;
}

// GCC calls this for a violated contract; without it the program does not link.
void handle_contract_violation(const std::contracts::contract_violation&) {
  std::abort();
}

int main() {
  static_assert(type_name<Widget>() == "Widget");
  static_assert(member_count<Widget>() == 2);
  return area(Widget{2, 3}) == 6 ? 0 : 1;
}
