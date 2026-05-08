Object.assign(DiagramRenderer.prototype, {
  render(options = {}) {
    if (options.connectedTo) {
      this.renderLinks({
        connectedTo: options.connectedTo,
        dragPreview: options.dragPreview,
        skipRoutingPressure: options.skipRoutingPressure
      });
    } else if (options.forceLinks) {
      this.renderLinks({
        dragPreview: options.dragPreview,
        skipRoutingPressure: options.skipRoutingPressure
      });
    } else if (!options.skipLinks && !this.draggingNode) {
      this.renderLinks();
    }
    this.updateAttachedTextNodes();
    this.nodeSelection.attr("transform", d => `translate(${d.x},${d.y})`);
  },

  renderLinks(options = {}) {
    const updatedLinks = options.connectedTo
      ? new Set(this.store.links.filter(link => link.source === options.connectedTo || link.target === options.connectedTo))
      : options.connectedToLink
        ? new Set([options.connectedToLink])
      : null;
    const occupiedSegments = updatedLinks
      ? this.store.links
        .filter(link => !updatedLinks.has(link))
        .flatMap(link => Geometry.pathToSegments(link.routePoints || [], { link }))
      : [];

    this.linkSelection.each((link, index, elements) => {
      if (updatedLinks && !updatedLinks.has(link)) return;

      const points = this.linkRoutePoints(link, occupiedSegments, options);
      link.routePoints = points;
      d3.select(elements[index])
        .attr("d", SvgPath.line(points))
        .call(selection => this.applyLinkStyle(selection, link));
      if (!options.dragPreview) {
        occupiedSegments.push(...Geometry.pathToSegments(points, { link }));
      }
    });

    if (!options.skipRoutingPressure) this.applyRoutingPressure(occupiedSegments);
  },

  linkRoutePoints(link, occupiedSegments, options = {}) {
    if (options.dragPreview && this.isDragPreviewLink(link, options.connectedTo)) {
      return this.dragPreviewLinkRoutePoints(link);
    }
    if (options.dragPreview && this.dragGroup && this.dragGroup.nodes && this.dragGroup.nodes.size) {
      const hasDraggedEndpoint = this.dragGroup.nodes.has(link.source) || this.dragGroup.nodes.has(link.target);
      if (hasDraggedEndpoint) return this.dragPreviewGroupLinkRoutePoints(link);
    }

    if (this.config.router.routeStyle === "straight" || options.ignoreManualRoutes) {
      return this.straightLinkRoutePoints(link);
    }

    if (!options.ignoreManualRoutes && link.manualPoints && link.manualPoints.length) {
      return this.manualRoutePoints(link);
    }

    return this.router.routeLink(link, this.store.nodes, occupiedSegments);
  },

  straightLinkRoutePoints(link) {
    return [
      this.router.anchorPoint(link.source, link.target),
      this.router.anchorPoint(link.target, link.source)
    ];
  },

  isDragPreviewLink(link, draggedNode) {
    return draggedNode && (link.source === draggedNode || link.target === draggedNode);
  },

  dragPreviewLinkRoutePoints(link) {
    const start = this.router.anchorPoint(link.source, link.target);
    const end = this.router.anchorPoint(link.target, link.source);
    const previewMode = this.config.simulation.dragRouting.previewMode;

    if (previewMode === "orthogonal") {
      return this.simpleOrthogonalPreviewRoute(start, end);
    }

    return [start, end];
  },

  dragPreviewGroupLinkRoutePoints(link) {
    if (!this.dragGroup || !this.dragGroup.baseLinkPoints) return this.straightLinkRoutePoints(link);

    const basePoints = this.dragGroup.baseLinkPoints.get(link.id);
    const start = this.router.anchorPoint(link.source, link.target);
    const end = this.router.anchorPoint(link.target, link.source);
    if (!basePoints || basePoints.length < 2) return [start, end];

    const sourceDragged = this.dragGroup.nodes.has(link.source);
    const targetDragged = this.dragGroup.nodes.has(link.target);
    if (sourceDragged && targetDragged) {
      const delta = this.dragGroup.delta || { x: 0, y: 0 };
      return basePoints.map(point => ({ x: point.x + delta.x, y: point.y + delta.y }));
    }

    const stretched = basePoints.map(point => ({ ...point }));
    stretched[0] = start;
    stretched[stretched.length - 1] = end;
    return Geometry.simplifyPath(stretched);
  },

  simpleOrthogonalPreviewRoute(start, end) {
    if (Math.abs(start.x - end.x) < 0.001 || Math.abs(start.y - end.y) < 0.001) {
      return [start, end];
    }

    const middle = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
      ? { x: end.x, y: start.y }
      : { x: start.x, y: end.y };

    return [start, middle, end];
  },

  applyLinkStyle(selection, link) {
    const color = this.normalizeHexColor(link.color) || this.config.link.defaults.color;
    const width = Number(link.width) || this.config.link.defaults.width;

    selection
      .style("--link-color", color)
      .style("--link-width", width)
      .style("--link-dasharray", link.dashed ? `${width * 3} ${width * 2}` : "none")
      .attr("marker-start", this.linkMarkerUrl(link, "start", color, width))
      .attr("marker-end", this.linkMarkerUrl(link, "end", color, width));
  },

  linkMarkerUrl(link, position, color, width) {
    const markerType = position === "start" ? link.startMarker : link.endMarker;
    if (!markerType || markerType === "none") return null;

    const markerId = this.ensureLinkMarker(markerType, position, color, width);
    return markerId ? `url(#${markerId})` : null;
  },

  ensureLinkMarker(markerType, position, color, width) {
    if (markerType !== "arrow" || !this.defs) return null;

    const markerId = [
      "link-marker",
      markerType,
      position,
      color.replace("#", ""),
      String(width).replace(/\W/g, "")
    ].join("-");
    if (!this.defs.select(`#${markerId}`).empty()) return markerId;

    const marker = this.defs.append("marker")
      .attr("id", markerId)
      .attr("viewBox", "-10 -5 10 10")
      .attr("markerWidth", 7)
      .attr("markerHeight", 7)
      .attr("refX", -1)
      .attr("refY", 0)
      .attr("orient", position === "start" ? "auto-start-reverse" : "auto")
      .attr("markerUnits", "strokeWidth");

    marker.append("path")
      .attr("d", "M-10,-5 L0,0 L-10,5 Z")
      .attr("fill", color);

    return markerId;
  },

  manualRoutePoints(link) {
    if (!link.manualPoints || !link.manualPoints.length) return null;

    const start = this.router.anchorPoint(link.source, link.target);
    const end = this.router.anchorPoint(link.target, link.source);
    const points = [start];

    link.manualPoints.forEach(point => this.appendOrthogonalPoint(points, point));
    this.appendOrthogonalPoint(points, end);

    return Geometry.simplifyPath(points);
  },

  appendOrthogonalPoint(points, point) {
    const previous = points[points.length - 1];

    if (Math.abs(previous.x - point.x) < 0.001 || Math.abs(previous.y - point.y) < 0.001) {
      points.push({ ...point });
      return;
    }

    points.push({ x: point.x, y: previous.y });
    points.push({ ...point });
  },

  applyRoutingPressure(segments) {
    const pressureConfig = this.config.simulation.routingPressure;
    if (!pressureConfig.enabled || !segments.length) return;

    this.store.nodes.forEach(node => {
      if (this.isAnnotationShape(node.shape) || node.locked || node.fx != null || node.fy != null) return;

      const nodeRect = Geometry.nodeRect(node, {
        ...this.config.node,
        obstaclePadding: pressureConfig.padding
      });
      let pushX = 0;
      let pushY = 0;

      segments.forEach(segment => {
        if (segment.link && (segment.link.source === node || segment.link.target === node)) return;

        const collision = Geometry.segmentDistanceToRect(segment, nodeRect);
        if (collision.distance > pressureConfig.padding) return;

        const intensity = (pressureConfig.padding - collision.distance) / pressureConfig.padding;
        pushX += collision.vector.x * intensity * pressureConfig.strength;
        pushY += collision.vector.y * intensity * pressureConfig.strength;
      });

      node.vx = this.clampVelocity((node.vx || 0) + pushX, pressureConfig.maxVelocity);
      node.vy = this.clampVelocity((node.vy || 0) + pushY, pressureConfig.maxVelocity);
    });
  },

  clampVelocity(value, maxVelocity) {
    return Math.max(-maxVelocity, Math.min(maxVelocity, value));
  },

  resetLayout() {
    this.store.nodes.forEach(node => {
      if (node.locked) {
        node.fx = node.x;
        node.fy = node.y;
      } else {
        node.fx = null;
        node.fy = null;
        node.vx = 0;
        node.vy = 0;
      }
    });
    this.store.links.forEach(link => {
      delete link.manualPoints;
    });
    this.reorganizeRelationRoutes();
    this.syncGraph();
    this.simulation.alpha(0.95).restart();
  },

  reorganizeRelationRoutes() {
    if (this.store.links.length < 2) {
      this.renderLinks();
      return;
    }

    const bestRouting = this.bestRelationRouting();

    this.store.links = bestRouting.order;
    this.store.links.forEach(link => {
      delete link.manualPoints;
    });
    this.linkSelection = this.createLinks();
    if (this.simulation) this.simulation.force("link").links(this.store.links);
    this.linkSelection.each((link, index, elements) => {
      const points = bestRouting.routes.get(link);
      if (!points) return;

      link.routePoints = points;
      d3.select(elements[index])
        .attr("d", SvgPath.line(points))
        .call(selection => this.applyLinkStyle(selection, link));
    });
  },

  bestRelationRouting() {
    const links = [...this.store.links];
    const candidates = this.relationRoutingCandidates(links);
    let best = null;

    candidates.forEach(order => {
      const routing = this.routeLinksInOrder(order);
      if (!best || routing.score < best.score) best = routing;
    });

    for (let index = 0; index < 3; index += 1) {
      const penalties = this.linkRoutePenalties(best);
      const refinedOrder = [...links].sort((a, b) => (penalties.get(a) || 0) - (penalties.get(b) || 0));
      const reverseRefinedOrder = [...refinedOrder].reverse();

      [refinedOrder, reverseRefinedOrder].forEach(order => {
        const routing = this.routeLinksInOrder(order);
        if (routing.score < best.score) best = routing;
      });
    }

    return best;
  },

  relationRoutingCandidates(links) {
    const uniqueOrders = [];
    const addOrder = order => {
      const key = order.map(link => link.id).join("|");
      if (uniqueOrders.some(candidate => candidate.key === key)) return;
      uniqueOrders.push({ key, order });
    };
    const distance = link => Math.hypot(link.target.x - link.source.x, link.target.y - link.source.y);
    const degree = node => this.store.links.filter(link => link.source === node || link.target === node).length;
    const linkDegree = link => degree(link.source) + degree(link.target);

    addOrder([...links]);
    addOrder([...links].reverse());
    addOrder([...links].sort((a, b) => distance(a) - distance(b)));
    addOrder([...links].sort((a, b) => distance(b) - distance(a)));
    addOrder([...links].sort((a, b) => linkDegree(a) - linkDegree(b)));
    addOrder([...links].sort((a, b) => linkDegree(b) - linkDegree(a)));

    return uniqueOrders.map(candidate => candidate.order);
  },

  routeLinksInOrder(order) {
    const occupiedSegments = [];
    const routes = new Map();

    order.forEach(link => {
      const points = this.router.routeLink(link, this.store.nodes, occupiedSegments);
      routes.set(link, points);
      occupiedSegments.push(...Geometry.pathToSegments(points, { link }));
    });

    return {
      order,
      routes,
      segments: occupiedSegments,
      score: this.relationRoutingScore(routes, occupiedSegments)
    };
  },

  relationRoutingScore(routes, segments) {
    let score = 0;
    const nodeRects = this.store.nodes
      .filter(node => !this.isAnnotationShape(node.shape))
      .map(node => ({ node, rect: Geometry.nodeRect(node, { ...this.config.node, obstaclePadding: 0 }) }));

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      score += segment.length * 0.012;

      for (let otherIndex = index + 1; otherIndex < segments.length; otherIndex += 1) {
        const otherSegment = segments[otherIndex];
        if (segment.link === otherSegment.link) continue;

        score += Geometry.segmentCollisionPenalty(segment, otherSegment, this.config.router);
      }

      nodeRects.forEach(({ node, rect }) => {
        if (segment.link.source === node || segment.link.target === node) return;
        if (Geometry.segmentIntersectsRect(segment, rect)) score += this.config.router.costs.nodeCollision * 1.8;
      });
    }

    routes.forEach(points => {
      score += Math.max(0, points.length - 2) * this.config.router.costs.turn;
    });

    return score;
  },

  linkRoutePenalties(routing) {
    const penalties = new Map(routing.order.map(link => [link, 0]));
    const nodeRects = this.store.nodes
      .filter(node => !this.isAnnotationShape(node.shape))
      .map(node => ({ node, rect: Geometry.nodeRect(node, { ...this.config.node, obstaclePadding: 0 }) }));

    routing.segments.forEach((segment, index) => {
      for (let otherIndex = index + 1; otherIndex < routing.segments.length; otherIndex += 1) {
        const otherSegment = routing.segments[otherIndex];
        if (segment.link === otherSegment.link) continue;

        const penalty = Geometry.segmentCollisionPenalty(segment, otherSegment, this.config.router);
        if (!penalty) continue;

        penalties.set(segment.link, (penalties.get(segment.link) || 0) + penalty);
        penalties.set(otherSegment.link, (penalties.get(otherSegment.link) || 0) + penalty);
      }

      nodeRects.forEach(({ node, rect }) => {
        if (segment.link.source === node || segment.link.target === node) return;
        if (!Geometry.segmentIntersectsRect(segment, rect)) return;

        penalties.set(
          segment.link,
          (penalties.get(segment.link) || 0) + this.config.router.costs.nodeCollision
        );
      });
    });

    return penalties;
  },

  fitViewSoon() {
    window.setTimeout(() => this.fitView(), 250);
  },

  fitView() {
    const canvasWidth = this.svg.node().clientWidth || window.innerWidth;
    const canvasHeight = this.svg.node().clientHeight || window.innerHeight;
    if (!this.store.nodes.length) {
      this.svg.transition()
        .duration(this.config.zoom.fitDuration)
        .call(this.zoom.transform, d3.zoomIdentity.translate(canvasWidth / 2, canvasHeight / 2).scale(1));
      return;
    }

    const bounds = Geometry.nodeBounds(this.store.nodes, this.config.node);
    const graphWidth = bounds.right - bounds.left;
    const graphHeight = bounds.bottom - bounds.top;
    const rawScale = this.config.zoom.fitPaddingRatio /
      Math.max(graphWidth / canvasWidth, graphHeight / canvasHeight);
    const safeScale = Number.isFinite(rawScale) && rawScale > 0 ? rawScale : 1;
    const scale = Math.min(
      this.config.zoom.fitMaxScale,
      safeScale
    );
    const translateX = canvasWidth / 2 - scale * (bounds.left + graphWidth / 2);
    const translateY = canvasHeight / 2 - scale * (bounds.top + graphHeight / 2);

    this.svg.transition()
      .duration(this.config.zoom.fitDuration)
      .call(this.zoom.transform, d3.zoomIdentity.translate(translateX, translateY).scale(scale));
  },

  pointerToWorld(event) {
    const transform = d3.zoomTransform(this.svg.node());
    const rect = this.svg.node().getBoundingClientRect();
    return transform.invert([event.clientX - rect.left, event.clientY - rect.top])
      .reduce((point, value, index) => {
        point[index === 0 ? "x" : "y"] = value;
        return point;
      }, {});
  },

  viewportCenter() {
    const transform = d3.zoomTransform(this.svg.node());
    const width = this.svg.node().clientWidth || window.innerWidth;
    const height = this.svg.node().clientHeight || window.innerHeight;
    const [x, y] = transform.invert([width / 2, height / 2]);
    return { x, y };
  },

  findNodeAt(point, excludedNode = null) {
    return [...this.store.nodes].reverse().find(node => {
      if (node === excludedNode || node.shape === "text") return false;

      const rect = Geometry.nodeRect(node, {
        ...this.config.node,
        obstaclePadding: 0
      });

      return point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom;
    }) || null;
  },

  findLinkAt(point) {
    const hitTolerance = 14;

    return [...this.store.links].reverse().find(link => {
      const points = link.routePoints || [];

      for (let i = 0; i < points.length - 1; i += 1) {
        const distance = this.distanceToSegment(point, points[i], points[i + 1]);
        if (distance <= hitTolerance) return true;
      }

      return false;
    }) || null;
  },

  distanceToSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);

    const ratio = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    const projection = {
      x: a.x + ratio * dx,
      y: a.y + ratio * dy
    };

    return Math.hypot(point.x - projection.x, point.y - projection.y);
  },

  attachAnnotationNode(node, targetNode, targetLink) {
    if (targetNode) {
      node.attachment = {
        type: "node",
        target: targetNode,
        dx: node.x - targetNode.x,
        dy: node.y - targetNode.y
      };
      this.selectNode(node);
      this.simulation.alpha(0.3).restart();
      return;
    }

    if (targetLink && node.shape === "text") {
      const midpoint = this.linkMidpoint(targetLink);
      node.attachment = {
        type: "link",
        target: targetLink,
        dx: node.x - midpoint.x,
        dy: node.y - midpoint.y
      };
      this.selectNode(node);
      this.simulation.alpha(0.3).restart();
      return;
    }

    node.attachment = null;
    this.selectNode(node);
    this.simulation.alpha(0.2).restart();
  },

  updateAttachedTextNodes() {
    this.store.nodes.forEach(node => {
      if (!this.isAnnotationShape(node.shape) || !node.attachment || node.fx != null || node.fy != null) return;

      if (node.attachment.type === "node") {
        node.x = node.attachment.target.x + node.attachment.dx;
        node.y = node.attachment.target.y + node.attachment.dy;
      }

      if (node.attachment.type === "link") {
        const midpoint = this.linkMidpoint(node.attachment.target);
        node.x = midpoint.x + node.attachment.dx;
        node.y = midpoint.y + node.attachment.dy;
      }
    });
  },

  linkMidpoint(link) {
    const points = link.routePoints || [];
    if (!points.length) {
      return {
        x: (link.source.x + link.target.x) / 2,
        y: (link.source.y + link.target.y) / 2
      };
    }

    const segments = [];
    let totalLength = 0;

    for (let i = 0; i < points.length - 1; i += 1) {
      const length = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
      segments.push({ a: points[i], b: points[i + 1], length });
      totalLength += length;
    }

    let walked = 0;
    const targetLength = totalLength / 2;

    for (const segment of segments) {
      if (walked + segment.length >= targetLength) {
        const ratio = segment.length === 0 ? 0 : (targetLength - walked) / segment.length;
        return {
          x: segment.a.x + (segment.b.x - segment.a.x) * ratio,
          y: segment.a.y + (segment.b.y - segment.a.y) * ratio
        };
      }
      walked += segment.length;
    }

    return points[Math.floor(points.length / 2)];
  },

  nextToNodePosition(targetNode, shapeType) {
    const shapeConfig = this.config.node.shapeTypes[shapeType] || this.config.node.shapeTypes.team;
    const spacing = 70;

    return {
      x: targetNode.x + this.nodeWidth(targetNode) / 2 + shapeConfig.width / 2 + spacing,
      y: targetNode.y
    };
  }
});
