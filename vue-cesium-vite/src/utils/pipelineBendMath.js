export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function multiplyByScalar(vector, scalar) {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function magnitude(vector) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

export function normalize(vector, fallback = [1, 0, 0]) {
  const length = magnitude(vector);
  return length > 0 ? multiplyByScalar(vector, 1 / length) : fallback;
}

export function distance(a, b) {
  return magnitude(subtract(a, b));
}

export function rotateAroundAxis(vector, axis, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const axisDot = dot(axis, vector);
  const crossPart = cross(axis, vector);

  return add(
    add(multiplyByScalar(vector, cos), multiplyByScalar(crossPart, sin)),
    multiplyByScalar(axis, axisDot * (1 - cos)),
  );
}
