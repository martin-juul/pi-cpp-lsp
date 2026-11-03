#pragma once

int shared_total(int value);

int alpha_run();
int beta_run();
int gamma_run();

class Shape {
public:
  virtual ~Shape() = default;
  virtual double area() const = 0;
  virtual const char *name() const;
};

class Circle : public Shape {
public:
  explicit Circle(double radius);
  double area() const override;
  double radius() const;

private:
  double radius_;
};
