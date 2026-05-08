const SvgPath = {
  line(points) {
    return d3.line()
      .x(d => d.x)
      .y(d => d.y)
      .curve(d3.curveLinear)(points);
  }
};
