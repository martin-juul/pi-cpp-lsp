#include "shared.h"

const char *Shape::name() const { return "shape"; }

Circle::Circle(double radius) : radius_(radius) {}
double Circle::area() const { return 3.14159 * radius_ * radius_; }
double Circle::radius() const { return radius_; }
