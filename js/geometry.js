const Geometry = {
  nodeRect(node, nodeConfig) {
    const width = node.width || nodeConfig.width;
    const height = node.height || nodeConfig.height;

    return {
      left: node.x - width / 2 - nodeConfig.obstaclePadding,
      right: node.x + width / 2 + nodeConfig.obstaclePadding,
      top: node.y - height / 2 - nodeConfig.obstaclePadding,
      bottom: node.y + height / 2 + nodeConfig.obstaclePadding
    };
  },

  nodeBounds(nodes, nodeConfig) {
    return {
      left: d3.min(nodes, d => d.x - (d.width || nodeConfig.width)),
      right: d3.max(nodes, d => d.x + (d.width || nodeConfig.width)),
      top: d3.min(nodes, d => d.y - (d.height || nodeConfig.height)),
      bottom: d3.max(nodes, d => d.y + (d.height || nodeConfig.height))
    };
  },

  simplifyPath(points) {
    if (points.length <= 2) return points;

    const simplified = [points[0]];
    for (let i = 1; i < points.length - 1; i += 1) {
      const previous = simplified[simplified.length - 1];
      const current = points[i];
      const next = points[i + 1];
      const sameVertical = previous.x === current.x && current.x === next.x;
      const sameHorizontal = previous.y === current.y && current.y === next.y;

      if (!sameVertical && !sameHorizontal) simplified.push(current);
    }
    simplified.push(points[points.length - 1]);

    return simplified;
  },

  pathToSegments(points, metadata = {}) {
    const segments = [];
    for (let i = 0; i < points.length - 1; i += 1) {
      const segment = this.normalizeSegment({ a: points[i], b: points[i + 1] });
      if (segment.length > 0) segments.push({ ...segment, ...metadata });
    }
    return segments;
  },

  normalizeSegment(segment) {
    const horizontal = Math.abs(segment.a.y - segment.b.y) < 0.001;
    const vertical = Math.abs(segment.a.x - segment.b.x) < 0.001;
    const a = { ...segment.a };
    const b = { ...segment.b };

    if (horizontal && a.x > b.x) {
      return { a: b, b: a, horizontal, vertical, length: a.x - b.x };
    }

    if (vertical && a.y > b.y) {
      return { a: b, b: a, horizontal, vertical, length: a.y - b.y };
    }

    return {
      a,
      b,
      horizontal,
      vertical,
      length: horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y)
    };
  },

  segmentCollisionPenalty(segment, occupiedSegment, routerConfig) {
    const current = this.normalizeSegment(segment);
    if (!current.horizontal && !current.vertical) return 0;

    if (this.segmentsOverlap(current, occupiedSegment)) return routerConfig.costs.overlap;
    if (this.segmentsCross(current, occupiedSegment)) return routerConfig.costs.crossing;
    if (this.segmentsAreTooClose(current, occupiedSegment, routerConfig.linkCollisionGap)) {
      return routerConfig.costs.proximity;
    }

    return 0;
  },

  segmentsOverlap(a, b) {
    if (a.horizontal && b.horizontal && Math.abs(a.a.y - b.a.y) < 0.001) {
      return this.rangesOverlap(a.a.x, a.b.x, b.a.x, b.b.x);
    }

    if (a.vertical && b.vertical && Math.abs(a.a.x - b.a.x) < 0.001) {
      return this.rangesOverlap(a.a.y, a.b.y, b.a.y, b.b.y);
    }

    return false;
  },

  segmentsCross(a, b) {
    const horizontal = a.horizontal ? a : b.horizontal ? b : null;
    const vertical = a.vertical ? a : b.vertical ? b : null;

    if (!horizontal || !vertical) return false;

    return vertical.a.x > Math.min(horizontal.a.x, horizontal.b.x) &&
      vertical.a.x < Math.max(horizontal.a.x, horizontal.b.x) &&
      horizontal.a.y > Math.min(vertical.a.y, vertical.b.y) &&
      horizontal.a.y < Math.max(vertical.a.y, vertical.b.y);
  },

  segmentsAreTooClose(a, b, gap) {
    if (a.horizontal && b.horizontal && Math.abs(a.a.y - b.a.y) <= gap) {
      return this.rangesOverlap(a.a.x, a.b.x, b.a.x, b.b.x);
    }

    if (a.vertical && b.vertical && Math.abs(a.a.x - b.a.x) <= gap) {
      return this.rangesOverlap(a.a.y, a.b.y, b.a.y, b.b.y);
    }

    return false;
  },

  rangesOverlap(aStart, aEnd, bStart, bEnd) {
    return Math.max(Math.min(aStart, aEnd), Math.min(bStart, bEnd)) <
      Math.min(Math.max(aStart, aEnd), Math.max(bStart, bEnd));
  },

  segmentIntersectsRect(segment, rect) {
    const minX = Math.min(segment.a.x, segment.b.x);
    const maxX = Math.max(segment.a.x, segment.b.x);
    const minY = Math.min(segment.a.y, segment.b.y);
    const maxY = Math.max(segment.a.y, segment.b.y);

    if (segment.a.y === segment.b.y) {
      return segment.a.y >= rect.top &&
        segment.a.y <= rect.bottom &&
        maxX >= rect.left &&
        minX <= rect.right;
    }

    return segment.a.x >= rect.left &&
      segment.a.x <= rect.right &&
      maxY >= rect.top &&
      minY <= rect.bottom;
  },

  segmentDistanceToRect(segment, rect) {
    const inflatedSegment = this.normalizeSegment(segment);

    if (inflatedSegment.horizontal) {
      const y = inflatedSegment.a.y;
      const x1 = Math.min(inflatedSegment.a.x, inflatedSegment.b.x);
      const x2 = Math.max(inflatedSegment.a.x, inflatedSegment.b.x);
      const clampedX = Math.max(rect.left, Math.min((x1 + x2) / 2, rect.right));
      const overlapsX = x2 >= rect.left && x1 <= rect.right;
      const dx = overlapsX ? 0 : Math.min(Math.abs(rect.left - x2), Math.abs(x1 - rect.right));
      const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;

      return {
        distance: Math.hypot(dx, dy),
        vector: { x: 0, y: y < (rect.top + rect.bottom) / 2 ? 1 : -1 },
        closest: { x: clampedX, y }
      };
    }

    if (inflatedSegment.vertical) {
      const x = inflatedSegment.a.x;
      const y1 = Math.min(inflatedSegment.a.y, inflatedSegment.b.y);
      const y2 = Math.max(inflatedSegment.a.y, inflatedSegment.b.y);
      const clampedY = Math.max(rect.top, Math.min((y1 + y2) / 2, rect.bottom));
      const overlapsY = y2 >= rect.top && y1 <= rect.bottom;
      const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
      const dy = overlapsY ? 0 : Math.min(Math.abs(rect.top - y2), Math.abs(y1 - rect.bottom));

      return {
        distance: Math.hypot(dx, dy),
        vector: { x: x < (rect.left + rect.right) / 2 ? 1 : -1, y: 0 },
        closest: { x, y: clampedY }
      };
    }

    return {
      distance: Infinity,
      vector: { x: 0, y: 0 },
      closest: null
    };
  }
};
