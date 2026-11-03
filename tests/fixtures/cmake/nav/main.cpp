#include "shared.h"

int main() {
  Circle circle(2.0);
  return alpha_run() + beta_run() + gamma_run() + static_cast<int>(circle.area());
}
