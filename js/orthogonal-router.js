class OrthogonalRouter {
  constructor(nodeConfig, routerConfig) {
    this.nodeConfig = nodeConfig;
    this.config = routerConfig;
  }

  routeLink(link, nodes, occupiedSegments) {
    const start = this.anchorPoint(link.source, link.target);
    const end = this.anchorPoint(link.target, link.source);
    const obstacles = nodes
      .filter(node => node !== link.source && node !== link.target && node.shape !== "text")
      .map(node => Geometry.nodeRect(node, this.nodeConfig));
    const profile = this.routingProfile(start, end, nodes, obstacles, occupiedSegments);
    const points = this.findPath(start, end, obstacles, occupiedSegments, profile);

    return Geometry.simplifyPath(points);
  }

  routingProfile(start, end, nodes, obstacles, occupiedSegments) {
    const adaptiveConfig = this.config.adaptiveRouting || {};
    const baseProfile = {
      congestion: 0,
      boundsMargin: this.config.boundsMargin,
      maxIterations: this.config.maxIterations,
      exteriorPadding: adaptiveConfig.exteriorPadding || 0
    };

    if (!adaptiveConfig.enabled) return baseProfile;

    const graphRect = this.graphRect(nodes);
    const graphArea = Math.max(1, (graphRect.right - graphRect.left) * (graphRect.bottom - graphRect.top));
    const obstacleArea = obstacles.reduce((total, rect) =>
      total + Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top),
      0
    );
    const obstaclePressure = this.clamp(obstacleArea / graphArea, 0, 1);
    const relationPressure = this.clamp(occupiedSegments.length / Math.max(1, nodes.length * 3), 0, 1);
    const directPressure = this.directRoutePressure(start, end, obstacles, occupiedSegments);
    const congestion = this.clamp(
      obstaclePressure * 0.38 + relationPressure * 0.28 + directPressure * 0.34,
      0,
      1
    );
    const maxExtraBoundsMargin = adaptiveConfig.maxExtraBoundsMargin || 0;
    const maxIterationMultiplier = adaptiveConfig.maxIterationMultiplier || 1;

    return {
      congestion,
      graphRect,
      boundsMargin: this.config.boundsMargin + maxExtraBoundsMargin * congestion,
      maxIterations: Math.round(this.config.maxIterations * (1 + (maxIterationMultiplier - 1) * congestion)),
      exteriorPadding: adaptiveConfig.exteriorPadding || 0
    };
  }

  graphRect(nodes) {
    const rects = nodes
      .filter(node => node.shape !== "text")
      .map(node => Geometry.nodeRect(node, this.nodeConfig));

    if (!rects.length) {
      return { left: 0, right: 0, top: 0, bottom: 0 };
    }

    return {
      left: Math.min(...rects.map(rect => rect.left)),
      right: Math.max(...rects.map(rect => rect.right)),
      top: Math.min(...rects.map(rect => rect.top)),
      bottom: Math.max(...rects.map(rect => rect.bottom))
    };
  }

  directRoutePressure(start, end, obstacles, occupiedSegments) {
    const middleX = (start.x + end.x) / 2;
    const middleY = (start.y + end.y) / 2;
    const candidates = [
      [
        start,
        { x: middleX, y: start.y },
        { x: middleX, y: end.y },
        end
      ],
      [
        start,
        { x: start.x, y: middleY },
        { x: end.x, y: middleY },
        end
      ]
    ];
    const score = Math.min(...candidates.map(points => this.routeScore(points, obstacles, occupiedSegments)));

    return this.clamp((score - 4) / 2600, 0, 1);
  }

  anchorPoint(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;

    if (Math.abs(dx) > Math.abs(dy)) {
      return {
        x: from.x + Math.sign(dx || 1) * (from.width || this.nodeConfig.width) / 2,
        y: from.y
      };
    }

    return {
      x: from.x,
      y: from.y + Math.sign(dy || 1) * (from.height || this.nodeConfig.height) / 2
    };
  }

  findPath(start, end, obstacles, occupiedSegments, profile) {
    const startCell = this.toCell(start);
    const endCell = this.toCell(end);
    const bounds = this.routingBounds(start, end, obstacles, profile);
    const open = [{
      cell: startCell,
      cost: 0,
      score: this.heuristic(startCell, endCell)
    }];
    const cameFrom = new Map();
    const bestCost = new Map([[this.cellKey(startCell), 0]]);
    let iterations = 0;

    while (open.length && iterations < profile.maxIterations) {
      iterations += 1;
      open.sort((a, b) => a.score - b.score);
      const current = open.shift();

      if (current.cell.x === endCell.x && current.cell.y === endCell.y) {
        return this.reconstructPath(cameFrom, current.cell)
          .map(this.toPointWithEndpoints(start, end));
      }

      for (const next of this.neighbors(current.cell)) {
        if (!this.insideBounds(next, bounds) || this.blocked(next, obstacles)) continue;

        const nextCost = current.cost +
          this.config.costs.step +
          this.turnPenalty(cameFrom, current.cell, next) +
          this.relationPenalty(current.cell, next, occupiedSegments);
        const key = this.cellKey(next);

        if (nextCost < (bestCost.get(key) ?? Infinity)) {
          bestCost.set(key, nextCost);
          cameFrom.set(key, current.cell);
          open.push({
            cell: next,
            cost: nextCost,
            score: nextCost + this.heuristic(next, endCell)
          });
        }
      }
    }

    return this.fallbackRoute(start, end, obstacles, occupiedSegments, profile);
  }

  toCell(point) {
    return {
      x: Math.round(point.x / this.config.gridSize),
      y: Math.round(point.y / this.config.gridSize)
    };
  }

  toPointWithEndpoints(start, end) {
    return (cell, index, cells) => {
      if (index === 0) return start;
      if (index === cells.length - 1) return end;
      return {
        x: cell.x * this.config.gridSize,
        y: cell.y * this.config.gridSize
      };
    };
  }

  neighbors(cell) {
    return [
      { x: cell.x + 1, y: cell.y },
      { x: cell.x - 1, y: cell.y },
      { x: cell.x, y: cell.y + 1 },
      { x: cell.x, y: cell.y - 1 }
    ];
  }

  cellKey(cell) {
    return `${cell.x},${cell.y}`;
  }

  heuristic(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  turnPenalty(cameFrom, current, next) {
    const previous = cameFrom.get(this.cellKey(current));
    if (!previous) return 0;

    const dx1 = current.x - previous.x;
    const dy1 = current.y - previous.y;
    const dx2 = next.x - current.x;
    const dy2 = next.y - current.y;

    return dx1 === dx2 && dy1 === dy2 ? 0 : this.config.costs.turn;
  }

  relationPenalty(fromCell, toCell, occupiedSegments) {
    if (!occupiedSegments.length) return 0;

    const segment = {
      a: {
        x: fromCell.x * this.config.gridSize,
        y: fromCell.y * this.config.gridSize
      },
      b: {
        x: toCell.x * this.config.gridSize,
        y: toCell.y * this.config.gridSize
      }
    };

    return occupiedSegments.reduce(
      (total, occupied) => total + Geometry.segmentCollisionPenalty(segment, occupied, this.config),
      0
    );
  }

  blocked(cell, obstacles) {
    const point = {
      x: cell.x * this.config.gridSize,
      y: cell.y * this.config.gridSize
    };

    return obstacles.some(rect =>
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
    );
  }

  routingBounds(start, end, obstacles, profile) {
    const xs = [start.x, end.x];
    const ys = [start.y, end.y];

    obstacles.forEach(rect => {
      xs.push(rect.left, rect.right);
      ys.push(rect.top, rect.bottom);
    });

    if (profile.graphRect) {
      xs.push(profile.graphRect.left, profile.graphRect.right);
      ys.push(profile.graphRect.top, profile.graphRect.bottom);
    }

    const margin = profile.boundsMargin;

    return {
      left: Math.floor((Math.min(...xs) - margin) / this.config.gridSize),
      right: Math.ceil((Math.max(...xs) + margin) / this.config.gridSize),
      top: Math.floor((Math.min(...ys) - margin) / this.config.gridSize),
      bottom: Math.ceil((Math.max(...ys) + margin) / this.config.gridSize)
    };
  }

  insideBounds(cell, bounds) {
    return cell.x >= bounds.left &&
      cell.x <= bounds.right &&
      cell.y >= bounds.top &&
      cell.y <= bounds.bottom;
  }

  reconstructPath(cameFrom, endCell) {
    const cells = [endCell];
    let current = endCell;

    while (cameFrom.has(this.cellKey(current))) {
      current = cameFrom.get(this.cellKey(current));
      cells.push(current);
    }

    return cells.reverse();
  }

  fallbackRoute(start, end, obstacles, occupiedSegments, profile = {}) {
    const middleX = (start.x + end.x) / 2;
    const middleY = (start.y + end.y) / 2;
    const candidates = [
      [
        start,
        { x: middleX, y: start.y },
        { x: middleX, y: end.y },
        end
      ],
      [
        start,
        { x: start.x, y: middleY },
        { x: end.x, y: middleY },
        end
      ]
    ];

    if (profile.graphRect) {
      const padding = (profile.boundsMargin || this.config.boundsMargin) + (profile.exteriorPadding || 0);
      const left = profile.graphRect.left - padding;
      const right = profile.graphRect.right + padding;
      const top = profile.graphRect.top - padding;
      const bottom = profile.graphRect.bottom + padding;

      candidates.push(
        [start, { x: left, y: start.y }, { x: left, y: end.y }, end],
        [start, { x: right, y: start.y }, { x: right, y: end.y }, end],
        [start, { x: start.x, y: top }, { x: end.x, y: top }, end],
        [start, { x: start.x, y: bottom }, { x: end.x, y: bottom }, end]
      );
    }

    return candidates
      .map(points => ({ points, score: this.routeScore(points, obstacles, occupiedSegments) }))
      .sort((a, b) => a.score - b.score)[0].points;
  }

  routeScore(points, obstacles, occupiedSegments) {
    let score = points.length;

    for (let i = 0; i < points.length - 1; i += 1) {
      const segment = { a: points[i], b: points[i + 1] };
      score += obstacles.filter(rect => Geometry.segmentIntersectsRect(segment, rect)).length *
        this.config.costs.nodeCollision;
      score += occupiedSegments.reduce(
        (total, occupied) => total + Geometry.segmentCollisionPenalty(segment, occupied, this.config),
        0
      );
    }

    return score;
  }

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
}
