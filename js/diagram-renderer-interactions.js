Object.assign(DiagramRenderer.prototype, {
  isMultiSelectModifier(event) {
    return Boolean(event && (event.ctrlKey || event.metaKey));
  },

  canNodeCreateRelation(node) {
    if (!node) return false;
    return !this.isAnnotationShape(node.shape);
  },

  onCanvasClick(event) {
    if (event.button !== 0) return;
    if (this.suppressCanvasClick) return;
    if (event.defaultPrevented || event.target.closest(".node") || event.target.closest(".link")) return;
    this.clearSelection();
    this.pendingLinkSource = null;
  },

  onNodeClick(event, node) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    if (this.pendingLinkSource && this.pendingLinkSource !== node) {
      this.addLink(this.pendingLinkSource, node);
      this.pendingLinkSource = null;
    }

    if (event.shiftKey || this.isMultiSelectModifier(event)) {
      this.toggleNodeSelection(node);
      return;
    }

    this.selectNode(node);
  },

  onLinkClick(event, link) {
    if (event.button !== 0) return;
    if (this.suppressLinkClick) {
      event.preventDefault();
      event.stopPropagation();
      this.suppressLinkClick = false;
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.pendingLinkSource = null;

    if (event.shiftKey || this.isMultiSelectModifier(event)) {
      this.toggleLinkSelection(link);
      return;
    }

    this.selectLink(link);
  },

  onLinkDragStart(event, link, element) {
    event.sourceEvent.preventDefault();
    event.sourceEvent.stopPropagation();

    const pointer = this.pointerToWorld(event.sourceEvent);
    const points = link.routePoints && link.routePoints.length
      ? link.routePoints
      : this.manualRoutePoints(link) || this.router.routeLink(link, this.store.nodes, []);
    const manualPoints = this.initialManualLinkPoints(link, points);

    link.manualPoints = manualPoints.map(point => ({ ...point }));
    this.draggingLink = {
      link,
      start: pointer,
      manualPoints: link.manualPoints.map(point => ({ ...point })),
      moved: false
    };
    this.selectLink(link);
    d3.select(element).classed("dragging", true);
  },

  onLinkDrag(event, link) {
    if (!this.draggingLink || this.draggingLink.link !== link) return;

    const pointer = this.pointerToWorld(event.sourceEvent);
    const dx = pointer.x - this.draggingLink.start.x;
    const dy = pointer.y - this.draggingLink.start.y;
    this.draggingLink.moved = Math.abs(dx) > 2 || Math.abs(dy) > 2;
    link.manualPoints = this.draggingLink.manualPoints.map(point => ({
      x: point.x + dx,
      y: point.y + dy
    }));
    this.renderLinks({ connectedToLink: link, skipRoutingPressure: true });
  },

  onLinkDragEnd(event, link, element) {
    if (!this.draggingLink || this.draggingLink.link !== link) return;

    event.sourceEvent.preventDefault();
    event.sourceEvent.stopPropagation();
    d3.select(element).classed("dragging", false);
    this.suppressLinkClick = this.draggingLink.moved;
    this.draggingLink = null;
    this.renderLinks({ skipRoutingPressure: true });
  },

  initialManualLinkPoints(link, points) {
    const interior = points.slice(1, -1);
    if (interior.length) return interior;

    const start = points[0] || this.router.anchorPoint(link.source, link.target);
    const end = points[points.length - 1] || this.router.anchorPoint(link.target, link.source);
    const middleX = (start.x + end.x) / 2;

    return [
      { x: middleX, y: start.y },
      { x: middleX, y: end.y }
    ];
  },

  onDragStart(event, node, element) {
    if (!event.active) this.simulation.alphaTarget(0.25).restart();

    const sourceEvent = event.sourceEvent || {};
    const appendSelection = Boolean(sourceEvent.shiftKey || this.isMultiSelectModifier(sourceEvent));
    if (!this.selectedNodes.has(node)) {
      if (appendSelection) {
        this.setSelection([node], [], { append: true });
      } else {
        this.selectNode(node);
      }
    }
    const draggedNodes = this.selectedNodes.size > 1
      ? [...this.selectedNodes].filter(selectedNode => selectedNode.shape !== "text")
      : [node];
    if (this.isAnnotationShape(node.shape)) node.attachment = null;
    draggedNodes.forEach(draggedNode => {
      this.clearManualRoutesForNode(draggedNode);
      draggedNode.fx = draggedNode.x;
      draggedNode.fy = draggedNode.y;
    });
    this.dragGroup = {
      nodes: new Set(draggedNodes),
      primaryNode: node,
      baseNodePositions: new Map(draggedNodes.map(draggedNode => [draggedNode.id, { x: draggedNode.x, y: draggedNode.y }])),
      baseLinkPoints: new Map(this.store.links.map(link => [
        link.id,
        (link.routePoints && link.routePoints.length ? link.routePoints : this.straightLinkRoutePoints(link))
          .map(point => ({ x: point.x, y: point.y }))
      ])),
      delta: { x: 0, y: 0 }
    };
    this.draggingNode = node;
    this.draggingNodeIntent = { x: node.x, y: node.y };
    this.dragCollisionTarget = null;
    d3.select(element).classed("dragging", true);
  },

  onDrag(event, node) {
    const dragState = this.dragGroup;
    if (!dragState) return;

    this.draggingNodeIntent = { x: event.x, y: event.y };
    const position = this.dragCollisionPosition(node, this.draggingNodeIntent);
    const primaryBase = dragState.baseNodePositions.get(node.id) || { x: node.x, y: node.y };
    const delta = {
      x: position.x - primaryBase.x,
      y: position.y - primaryBase.y
    };
    dragState.delta = delta;

    dragState.nodes.forEach(draggedNode => {
      const base = dragState.baseNodePositions.get(draggedNode.id);
      if (!base) return;

      draggedNode.fx = base.x + delta.x;
      draggedNode.fy = base.y + delta.y;
      draggedNode.x = draggedNode.fx;
      draggedNode.y = draggedNode.fy;
    });
    this.scheduleDragRender();
  },

  onDragEnd(event, node, element) {
    if (!event.active) this.simulation.alphaTarget(0);
    const dragState = this.dragGroup;
    const moved = dragState && dragState.delta &&
      (Math.abs(dragState.delta.x) > 0.5 || Math.abs(dragState.delta.y) > 0.5);
    if (moved && this.pageController && this.pageController.checkpoint) this.pageController.checkpoint();
    const draggedNodes = dragState ? [...dragState.nodes] : [node];
    draggedNodes.forEach(draggedNode => {
      draggedNode.x = draggedNode.fx;
      draggedNode.y = draggedNode.fy;
    });
    this.flushDragRender();
    this.draggingNode = null;
    this.draggingNodeIntent = null;
    this.dragGroup = null;
    const targetNode = this.dragCollisionTarget || this.findNodeAt({ x: node.x, y: node.y }, node);
    const targetLink = this.findLinkAt({ x: node.x, y: node.y });
    this.dragCollisionTarget = null;

    draggedNodes.forEach(draggedNode => {
      if (!draggedNode.locked) {
        draggedNode.fx = null;
        draggedNode.fy = null;
      }
    });
    d3.select(element).classed("dragging", false);

    if (this.isAnnotationShape(node.shape)) {
      this.attachAnnotationNode(node, targetNode, targetLink);
      this.render();
      return;
    }

    if (targetNode) this.addLink(node, targetNode);
    this.render();
  },

  dragCollisionPosition(node, target) {
    const collisionConfig = this.config.simulation.dragCollision;
    if (!collisionConfig || !collisionConfig.enabled || this.isAnnotationShape(node.shape)) return target;

    const draggedNodes = this.dragGroup && this.dragGroup.nodes ? this.dragGroup.nodes : new Set([node]);
    const others = this.store.nodes.filter(other => !draggedNodes.has(other) && other.shape !== "text");
    let position = { ...target };
    this.dragCollisionTarget = null;

    for (let iteration = 0; iteration < collisionConfig.iterations; iteration += 1) {
      let moved = false;

      others.forEach(other => {
        const correction = this.dragCollisionCorrection(node, other, position, collisionConfig.padding);
        if (!correction) return;

        position = {
          x: position.x + correction.x,
          y: position.y + correction.y
        };
        this.dragCollisionTarget = other;
        moved = true;
      });

      if (!moved) break;
    }

    return position;
  },

  dragCollisionCorrection(node, other, position, padding) {
    const nodeWidth = this.nodeWidth(node);
    const nodeHeight = this.nodeHeight(node);
    const otherWidth = this.nodeWidth(other);
    const otherHeight = this.nodeHeight(other);
    const minDx = nodeWidth / 2 + otherWidth / 2 + padding;
    const minDy = nodeHeight / 2 + otherHeight / 2 + padding;
    const dx = position.x - other.x;
    const dy = position.y - other.y;
    const overlapX = minDx - Math.abs(dx);
    const overlapY = minDy - Math.abs(dy);

    if (overlapX <= 0 || overlapY <= 0) return null;

    const directionX = dx === 0 ? (this.draggingNodeIntent.x >= other.x ? 1 : -1) : Math.sign(dx);
    const directionY = dy === 0 ? (this.draggingNodeIntent.y >= other.y ? 1 : -1) : Math.sign(dy);

    if (overlapX < overlapY) {
      return { x: directionX * overlapX, y: 0 };
    }

    return { x: 0, y: directionY * overlapY };
  },

  clearManualRoutesForNode(node) {
    this.store.links.forEach(link => {
      if (link.source === node || link.target === node) delete link.manualPoints;
    });
  },

  scheduleDragRender() {
    if (this.dragRenderFrame) return;

    this.dragRenderFrame = window.requestAnimationFrame(() => {
      this.dragRenderFrame = null;
      this.renderDragFrame();
    });
  },

  flushDragRender() {
    if (!this.dragRenderFrame) return;

    window.cancelAnimationFrame(this.dragRenderFrame);
    this.dragRenderFrame = null;
    this.renderDragFrame();
  },

  renderDragFrame() {
    const dragRouting = this.config.simulation.dragRouting;

    if (dragRouting && dragRouting.connectedOnly && this.draggingNode) {
      this.render({
        connectedTo: this.draggingNode,
        dragPreview: true,
        skipRoutingPressure: true
      });
      return;
    }

    this.render({ forceLinks: true, dragPreview: true, skipRoutingPressure: true });
  },

  toggleLock(event, node) {
    event.preventDefault();
    event.stopPropagation();
    this.setLocked(node, !node.locked);
    this.selectNode(node);
  },

  setLocked(node, locked) {
    this.applyNodeLock(node, locked);
    this.refreshNodeClasses();
    this.refreshInspector();
    this.simulation.alpha(0.7).restart();
  },

  toggleSelectedNodesLock() {
    const nodes = [...this.selectedNodes];
    if (!nodes.length) return;

    const shouldLock = nodes.some(node => !node.locked);
    nodes.forEach(node => this.applyNodeLock(node, shouldLock));
    this.refreshNodeClasses();
    this.refreshInspector();
    this.simulation.alpha(0.7).restart();
  },

  applyNodeLock(node, locked) {
    node.locked = locked;

    if (node.locked) {
      node.fx = node.x;
      node.fy = node.y;
    } else {
      node.fx = null;
      node.fy = null;
    }
  },

  startRelationFromSelected() {
    if (!this.selectedNode || !this.canNodeCreateRelation(this.selectedNode)) return;
    this.pendingLinkSource = this.selectedNode;
    this.refreshNodeClasses();
    this.refreshInspector();
  },

  openOrCreateSelectedSubschema() {
    if (!this.pageController || !this.selectedNode) return;
    this.pageController.openOrCreateForNode(this.selectedNode);
  },

  selectNode(node) {
    if (node && !this.canNodeCreateRelation(node)) this.pendingLinkSource = null;
    this.selectedNode = node;
    this.selectedLink = null;
    this.selectedNodes.clear();
    this.selectedLinks.clear();
    if (node) this.selectedNodes.add(node);
    this.syncSingleSelection();
    this.refreshNodeClasses();
    this.refreshLinkClasses();
    this.refreshInspector();
  },

  selectLink(link) {
    this.selectedLink = link;
    this.selectedNode = null;
    this.selectedNodes.clear();
    this.selectedLinks.clear();
    if (link) this.selectedLinks.add(link);
    this.syncSingleSelection();
    this.refreshNodeClasses();
    this.refreshLinkClasses();
    this.refreshInspector();
  },

  setSelection(nodes, links = [], options = {}) {
    if (!options.append) {
      this.selectedNodes.clear();
      this.selectedLinks.clear();
    }

    nodes.forEach(node => this.selectedNodes.add(node));
    links.forEach(link => this.selectedLinks.add(link));
    this.syncSingleSelection();
    this.refreshNodeClasses();
    this.refreshLinkClasses();
    this.refreshInspector();
  },

  toggleNodeSelection(node) {
    if (this.selectedNodes.has(node)) {
      this.selectedNodes.delete(node);
    } else {
      this.selectedNodes.add(node);
    }
    this.syncSingleSelection();
    this.refreshNodeClasses();
    this.refreshLinkClasses();
    this.refreshInspector();
  },

  toggleLinkSelection(link) {
    if (this.selectedLinks.has(link)) {
      this.selectedLinks.delete(link);
    } else {
      this.selectedLinks.add(link);
    }
    this.syncSingleSelection();
    this.refreshNodeClasses();
    this.refreshLinkClasses();
    this.refreshInspector();
  },

  clearSelection() {
    this.selectedNodes.clear();
    this.selectedLinks.clear();
    this.syncSingleSelection();
    this.refreshNodeClasses();
    this.refreshLinkClasses();
    this.refreshInspector();
  },

  syncSingleSelection() {
    this.selectedNode = this.selectedNodes.size === 1 ? [...this.selectedNodes][0] : null;
    this.selectedLink = this.selectedLinks.size === 1 ? [...this.selectedLinks][0] : null;
  },

  updateSelectedNode(property, value) {
    const nodes = this.selectedNodes.size ? [...this.selectedNodes] : this.selectedNode ? [this.selectedNode] : [];
    if (!nodes.length) return;
    if (property === "label" && nodes.length !== 1) return;
    if (this.pageController && this.pageController.checkpoint) this.pageController.checkpoint();

    nodes.forEach(node => {
      node[property] = value;
      if (property === "customCss") {
        const cssShape = this.shapeFromCssText(value);
        if (cssShape) node.shape = cssShape;
      }
    });
    this.syncGraph();
    if (property === "fill" || property === "stroke") this.refreshColorToolState();
    this.simulation.alpha(0.35).restart();
  },

  updateSelectedLink(property, value) {
    const links = this.selectedLinks.size ? [...this.selectedLinks] : this.selectedLink ? [this.selectedLink] : [];
    if (!links.length) return;
    if (this.pageController && this.pageController.checkpoint) this.pageController.checkpoint();

    links.forEach(link => {
      link[property] = value;
    });
    this.renderLinks({ skipRoutingPressure: true });
    this.refreshLinkInspector();
  },

  refreshInspector() {
    if (!this.inspector.form) return;

    const selectedNodes = [...this.selectedNodes];
    const selectedLinks = [...this.selectedLinks];
    const primaryNode = selectedNodes[0] || null;
    const hasNodeSelection = selectedNodes.length > 0;
    const hasLinkSelection = selectedLinks.length > 0 && !hasNodeSelection;
    const hasOnlyImageSelection = selectedNodes.length > 0 && selectedNodes.every(node =>
      node.shape === "image" || node.shape === "svgImage"
    );
    this.inspector.empty.classList.toggle("hidden", hasNodeSelection || hasLinkSelection);
    this.inspector.form.classList.toggle("hidden", !hasNodeSelection);
    this.inspector.linkInspector.classList.toggle("hidden", !hasLinkSelection);

    if (hasLinkSelection) this.refreshLinkInspector();
    if (!hasNodeSelection) return;

    this.inspector.selectionSummary.textContent = selectedNodes.length === 1
      ? "1 forme selectionnee"
      : `${selectedNodes.length} formes selectionnees`;
    this.inspector.label.value = selectedNodes.length === 1 ? primaryNode.label : "";
    this.inspector.label.disabled = selectedNodes.length !== 1;
    this.inspector.label.placeholder = selectedNodes.length === 1 ? "" : "Selection multiple";
    this.inspector.width.value = this.commonValue(selectedNodes, node => this.nodeWidth(node)) || this.nodeWidth(primaryNode);
    this.inspector.height.value = this.commonValue(selectedNodes, node => this.nodeHeight(node)) || this.nodeHeight(primaryNode);
    const widthLabel = this.inspector.width.closest("label");
    const heightLabel = this.inspector.height.closest("label");
    if (widthLabel) widthLabel.firstChild.textContent = hasOnlyImageSelection ? "Largeur image" : "Largeur";
    if (heightLabel) heightLabel.firstChild.textContent = hasOnlyImageSelection ? "Hauteur image" : "Hauteur";
    this.inspector.fontSize.value = this.commonValue(selectedNodes, node => this.nodeFontSize(node)) ||
      this.nodeFontSize(primaryNode);
    this.inspector.fontBold.checked = selectedNodes.every(node => Boolean(node.fontBold));
    this.inspector.fontItalic.checked = selectedNodes.every(node => Boolean(node.fontItalic));
    this.inspector.fontUnderline.checked = selectedNodes.every(node => Boolean(node.fontUnderline));
    this.inspector.fontStrike.checked = selectedNodes.every(node => Boolean(node.fontStrike));
    this.inspector.textAlign.value = this.commonValue(selectedNodes, node => node.textAlign || "center") || "center";
    this.inspector.textVAlign.value = this.commonValue(selectedNodes, node => node.textVAlign || "middle") || "middle";
    this.inspector.imageCropWrap.classList.toggle("hidden", !hasOnlyImageSelection);
    this.inspector.imageCrop.disabled = !hasOnlyImageSelection;
    const cropValue = hasOnlyImageSelection
      ? this.commonValue(selectedNodes, node => node.imageCrop !== false)
      : false;
    this.inspector.imageCrop.checked = Boolean(cropValue);
    const cropEnabled = hasOnlyImageSelection && Boolean(cropValue);
    this.inspector.imageZoomWrap.classList.toggle("hidden", !cropEnabled);
    this.inspector.imageOffsetXWrap.classList.toggle("hidden", !cropEnabled);
    this.inspector.imageOffsetYWrap.classList.toggle("hidden", !cropEnabled);
    this.inspector.imageZoom.disabled = !cropEnabled;
    this.inspector.imageOffsetX.disabled = !cropEnabled;
    this.inspector.imageOffsetY.disabled = !cropEnabled;
    this.inspector.imageZoom.value = this.commonValue(selectedNodes, node => Number(node.imageZoom) || 1) || 1;
    this.inspector.imageOffsetX.value = this.commonValue(selectedNodes, node => Number(node.imageOffsetX) || 0) || 0;
    this.inspector.imageOffsetY.value = this.commonValue(selectedNodes, node => Number(node.imageOffsetY) || 0) || 0;
    this.inspector.fill.value = this.commonValue(selectedNodes, node => this.normalizeHexColor(node.fill)) ||
      this.normalizeHexColor(primaryNode.fill) ||
      this.config.node.defaults.fill;
    this.inspector.stroke.value = this.commonValue(selectedNodes, node => this.normalizeHexColor(node.stroke)) ||
      this.normalizeHexColor(primaryNode.stroke) ||
      this.config.node.defaults.stroke;
    this.inspector.shapeCss.value = this.commonValue(selectedNodes, node => this.nodeShapeCssText(node)) ||
      this.nodeShapeCssText(primaryNode);
    this.inspector.lock.disabled = false;
    this.inspector.link.disabled = selectedNodes.length !== 1;
    this.inspector.addToLibrary.disabled = selectedNodes.length !== 1;
    if (selectedNodes.length === 1 && !this.canNodeCreateRelation(primaryNode)) {
      this.inspector.link.disabled = true;
    }
    this.inspector.subschema.disabled = selectedNodes.length !== 1;
    this.inspector.lock.textContent = this.lockButtonLabel(selectedNodes);
    this.inspector.link.textContent = !this.canNodeCreateRelation(primaryNode)
      ? "Relation indisponible"
      : this.pendingLinkSource === primaryNode
        ? "Choisir la cible"
        : "Ajouter relation";
    this.inspector.subschema.textContent = primaryNode && primaryNode.subPageId
      ? "Ouvrir sous-schema"
      : "Creer sous-schema";
    this.inspector.deleteNode.textContent = selectedNodes.length === 1
      ? "Supprimer forme"
      : "Supprimer selection";
    this.refreshColorToolState();
  },

  commonValue(items, getter) {
    if (!items.length) return "";

    const firstValue = getter(items[0]);
    return items.every(item => getter(item) === firstValue) ? firstValue : "";
  },

  lockButtonLabel(nodes) {
    if (nodes.length === 1) return nodes[0].locked ? "Deverrouiller" : "Verrouiller";
    return nodes.some(node => !node.locked) ? "Verrouiller selection" : "Deverrouiller selection";
  },

  refreshLinkInspector() {
    const selectedLinks = [...this.selectedLinks];

    if (selectedLinks.length > 1) {
      this.inspector.linkSource.textContent = `${selectedLinks.length} relations selectionnees`;
      this.inspector.linkTarget.textContent = "";
      this.inspector.linkDirection.classList.add("hidden");
      this.inspector.deleteLink.textContent = "Supprimer selection";
    } else {
      this.inspector.linkSource.textContent = this.selectedLink.source.label;
      this.inspector.linkTarget.textContent = this.selectedLink.target.label;
      this.inspector.linkDirection.classList.remove("hidden");
      this.inspector.deleteLink.textContent = "Supprimer relation";
    }

    this.inspector.linkColor.value = this.commonValue(selectedLinks, link => this.normalizeHexColor(link.color)) ||
      this.config.link.defaults.color;
    this.inspector.linkWidth.value = this.commonValue(selectedLinks, link => Number(link.width)) ||
      this.config.link.defaults.width;
    this.inspector.linkDashed.checked = selectedLinks.every(link => Boolean(link.dashed));
    this.inspector.linkDashed.indeterminate = selectedLinks.some(link => Boolean(link.dashed)) &&
      !selectedLinks.every(link => Boolean(link.dashed));
    this.inspector.linkStartMarker.value = this.commonValue(selectedLinks, link => link.startMarker || "none") ||
      this.config.link.defaults.startMarker;
    this.inspector.linkEndMarker.value = this.commonValue(selectedLinks, link => link.endMarker || "none") ||
      this.config.link.defaults.endMarker;
  },

  refreshNodeClasses() {
    if (this.nodeSelection) this.nodeSelection.attr("class", d => this.nodeClass(d));
  },

  refreshLinkClasses() {
    if (this.linkSelection) this.linkSelection.attr("class", d => this.linkClass(d));
  },

  addNode(type, position) {
    if (this.pageController && this.pageController.checkpoint) this.pageController.checkpoint();
    const node = this.store.createNode(type, position);
    this.syncGraph();
    this.selectNode(node);
    this.simulation.alpha(0.8).restart();
    return node;
  },

  addLink(source, target) {
    if (!this.canNodeCreateRelation(source) || !this.canNodeCreateRelation(target)) return;
    if (this.pageController && this.pageController.checkpoint) this.pageController.checkpoint();
    const linkAlreadyExists = this.store.links.some(link =>
      (link.source === source && link.target === target) ||
      (link.source === target && link.target === source)
    );
    const link = this.store.createLink(source, target);
    if (!link) return;

    if (!linkAlreadyExists) {
      const parentStroke = this.normalizeHexColor(source && source.stroke) || source.stroke;
      if (parentStroke) link.color = parentStroke;
    }

    this.syncGraph();
    this.selectLink(link);
    this.simulation.alpha(0.8).restart();
  },

  deleteSelectedNode() {
    this.deleteSelection();
  },

  deleteSelectedLink() {
    this.deleteSelection();
  },

  deleteSelection() {
    if (!this.hasSelection()) return;
    const nodesToDelete = [...this.selectedNodes];
    if (nodesToDelete.length && this.pageController && this.pageController.confirmDeleteNodes) {
      if (!this.pageController.confirmDeleteNodes(nodesToDelete)) return;
    }
    if (this.pageController && this.pageController.checkpoint) this.pageController.checkpoint();
    if (nodesToDelete.length && this.pageController && this.pageController.removeSubschemasForNodes) {
      this.pageController.removeSubschemasForNodes(nodesToDelete);
    }

    this.store.deleteLinks([...this.selectedLinks]);
    this.store.deleteNodes(nodesToDelete);
    this.selectedNodes.clear();
    this.selectedLinks.clear();
    this.selectedNode = null;
    this.selectedLink = null;
    this.pendingLinkSource = null;
    this.syncGraph();
    this.refreshInspector();
    this.simulation.alpha(0.8).restart();
  },

  hasSelection() {
    return this.selectedNodes.size > 0 || this.selectedLinks.size > 0;
  },

  syncGraph() {
    this.cleanDanglingTextAttachments();
    this.pruneSelection();
    this.linkSelection = this.createLinks();
    this.nodeSelection = this.createNodes();
    this.simulation.nodes(this.store.nodes);
    this.simulation.force("link").links(this.store.links);
    this.render();
  },

  pruneSelection() {
    this.selectedNodes.forEach(node => {
      if (!this.store.nodes.includes(node)) this.selectedNodes.delete(node);
    });
    this.selectedLinks.forEach(link => {
      if (!this.store.links.includes(link)) this.selectedLinks.delete(link);
    });
    this.syncSingleSelection();
  },

  cleanDanglingTextAttachments() {
    this.store.nodes.forEach(node => {
      if (!this.isAnnotationShape(node.shape) || !node.attachment) return;

      if (node.attachment.type === "node" && !this.store.nodes.includes(node.attachment.target)) {
        node.attachment = null;
      }

      if (node.attachment.type === "link" && !this.store.links.includes(node.attachment.target)) {
        node.attachment = null;
      }
    });
  }

});

