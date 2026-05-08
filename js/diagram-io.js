Object.assign(DiagramRenderer.prototype, {
  exportGraphJson() {
    const data = this.serializeGraph();
    this.downloadTextFile(
      `schema-${this.timestampForFileName()}.json`,
      JSON.stringify(data, null, 2),
      "application/json"
    );
  },

  triggerGraphImport(input) {
    if (!input) return;

    input.value = "";
    input.click();
  },

  importGraphFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        this.importGraphJson(String(reader.result || ""));
      } catch (error) {
        window.alert("Impossible d'importer ce fichier JSON.");
        console.error(error);
      }
    });
    reader.readAsText(file);
  },

  importGraphJson(jsonText) {
    const data = JSON.parse(jsonText);
    this.importGraphData(data);
  },

  importGraphData(data) {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.links)) {
      throw new Error("Format de graphe invalide.");
    }

    this.importCustomShapeTypes(data.customShapes || []);
    this.store.nodes = data.nodes.map(node => this.deserializeNode(node));
    this.store.links = data.links.map(link => this.deserializeLink(link));
    this.store.nextNodeIndex = this.nextIndexFromIds(this.store.nodes, "node");
    this.store.nextLinkIndex = this.nextIndexFromIds(this.store.links, "link");
    this.store.resolveLinks();
    this.restoreTextAttachments(data.nodes);
    this.importCanvasSettings(data.canvas);
    this.clearSelection();
    this.pendingLinkSource = null;
    this.syncGraph();
    this.fitViewSoon();
    this.simulation.alpha(0.8).restart();
  },

  serializeGraph() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      canvas: this.serializeCanvasSettings(),
      customShapes: this.serializeCustomShapeTypes(),
      nodes: this.store.nodes.map(node => this.serializeNode(node)),
      links: this.store.links.map(link => this.serializeLink(link))
    };
  },

  serializeCanvasSettings() {
    return {
      background: this.inspector.canvasBackground
        ? this.inspector.canvasBackground.value
        : this.config.colors.canvasDefaultBackground,
      gridEnabled: this.isCanvasGridEnabled(),
      routeStyle: this.config.router.routeStyle || "straight"
    };
  },

  serializeCustomShapeTypes() {
    return Object.entries(this.config.node.shapeTypes)
      .filter(([type, shape]) => type.startsWith("custom-") || shape.svgText || shape.imageHref)
      .map(([type, shape]) => ({
        type,
        label: shape.label,
        shape: shape.shape,
        width: shape.width,
        height: shape.height,
        fill: shape.fill,
        stroke: shape.stroke,
        imageCrop: shape.imageCrop !== false,
        imageZoom: Number(shape.imageZoom) || 1,
        imageOffsetX: Number(shape.imageOffsetX) || 0,
        imageOffsetY: Number(shape.imageOffsetY) || 0,
        imageAspect: Number(shape.imageAspect) || undefined,
        imageNaturalWidth: Number(shape.imageNaturalWidth) || undefined,
        imageNaturalHeight: Number(shape.imageNaturalHeight) || undefined,
        imageBaseWidth: Number(shape.imageBaseWidth) || undefined,
        imageBaseHeight: Number(shape.imageBaseHeight) || undefined,
        imageHref: shape.imageHref || "",
        svgText: shape.svgText || ""
      }));
  },

  serializeNode(node) {
    const serialized = {
      id: node.id,
      label: node.label,
      type: node.type,
      shape: node.shape,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      fontSize: node.fontSize,
      fontBold: Boolean(node.fontBold),
      fontItalic: Boolean(node.fontItalic),
      fontUnderline: Boolean(node.fontUnderline),
      fontStrike: Boolean(node.fontStrike),
      textAlign: node.textAlign || "center",
      textVAlign: node.textVAlign || "middle",
      fill: node.fill,
      stroke: node.stroke,
      customCss: node.customCss || "",
      imageCrop: node.imageCrop !== false,
      imageZoom: Number(node.imageZoom) || 1,
      imageOffsetX: Number(node.imageOffsetX) || 0,
      imageOffsetY: Number(node.imageOffsetY) || 0,
      imageAspect: Number(node.imageAspect) || undefined,
      imageNaturalWidth: Number(node.imageNaturalWidth) || undefined,
      imageNaturalHeight: Number(node.imageNaturalHeight) || undefined,
      imageBaseWidth: Number(node.imageBaseWidth) || undefined,
      imageBaseHeight: Number(node.imageBaseHeight) || undefined,
      subPageId: node.subPageId || "",
      locked: Boolean(node.locked)
    };

    if (node.imageHref) serialized.imageHref = node.imageHref;
    if (node.svgText) serialized.svgText = node.svgText;
    if (node.attachment) serialized.attachment = this.serializeAttachment(node.attachment);

    return serialized;
  },

  serializeAttachment(attachment) {
    if (!attachment || !attachment.target) return null;

    return {
      type: attachment.type,
      targetId: attachment.target.id,
      dx: Number(attachment.dx) || 0,
      dy: Number(attachment.dy) || 0
    };
  },

  serializeLink(link) {
    const serialized = {
      id: link.id,
      source: link.source.id || link.source,
      target: link.target.id || link.target,
      color: link.color,
      width: link.width,
      dashed: Boolean(link.dashed),
      startMarker: link.startMarker || "none",
      endMarker: link.endMarker || "none"
    };

    if (link.manualPoints && link.manualPoints.length) {
      serialized.manualPoints = link.manualPoints.map(point => ({ x: point.x, y: point.y }));
    }

    return serialized;
  },

  deserializeNode(node) {
    const normalized = this.store.normalizeNode({
      ...node,
      attachment: null
    });

    normalized.locked = Boolean(node.locked);
    if (normalized.locked) {
      normalized.fx = normalized.x;
      normalized.fy = normalized.y;
    } else {
      normalized.fx = null;
      normalized.fy = null;
    }

    return normalized;
  },

  deserializeLink(link) {
    return this.store.normalizeLink({
      id: link.id,
      source: link.source,
      target: link.target,
      color: link.color,
      width: link.width,
      dashed: Boolean(link.dashed),
      startMarker: link.startMarker || "none",
      endMarker: link.endMarker || "none",
      manualPoints: Array.isArray(link.manualPoints)
        ? link.manualPoints.map(point => ({ x: point.x, y: point.y }))
        : undefined
    });
  },

  restoreTextAttachments(serializedNodes) {
    const nodeById = new Map(this.store.nodes.map(node => [node.id, node]));
    const linkById = new Map(this.store.links.map(link => [link.id, link]));

    serializedNodes.forEach(serializedNode => {
      if (!serializedNode.attachment) return;

      const node = nodeById.get(serializedNode.id);
      const targetMap = serializedNode.attachment.type === "link" ? linkById : nodeById;
      const target = targetMap.get(serializedNode.attachment.targetId);
      if (!node || !target) return;
      const legacyOffset = serializedNode.attachment.offset || null;
      const dx = Number.isFinite(Number(serializedNode.attachment.dx))
        ? Number(serializedNode.attachment.dx)
        : legacyOffset && Number.isFinite(Number(legacyOffset.x))
          ? Number(legacyOffset.x)
          : 0;
      const dy = Number.isFinite(Number(serializedNode.attachment.dy))
        ? Number(serializedNode.attachment.dy)
        : legacyOffset && Number.isFinite(Number(legacyOffset.y))
          ? Number(legacyOffset.y)
          : 0;

      node.attachment = {
        type: serializedNode.attachment.type,
        target,
        dx,
        dy
      };
    });
  },

  importCustomShapeTypes(customShapes) {
    customShapes.forEach(shape => {
      if (!shape || !shape.type) return;

      this.config.node.shapeTypes[shape.type] = {
        label: shape.label || "Forme importee",
        shape: shape.shape || "image",
        width: shape.width || 130,
        height: shape.height || 90,
        fill: shape.fill || "#ffffff",
        stroke: shape.stroke || "#475569",
        imageCrop: shape.imageCrop !== false,
        imageZoom: Number(shape.imageZoom) || 1,
        imageOffsetX: Number(shape.imageOffsetX) || 0,
        imageOffsetY: Number(shape.imageOffsetY) || 0,
        imageAspect: Number(shape.imageAspect) || undefined,
        imageNaturalWidth: Number(shape.imageNaturalWidth) || undefined,
        imageNaturalHeight: Number(shape.imageNaturalHeight) || undefined,
        imageBaseWidth: Number(shape.imageBaseWidth) || undefined,
        imageBaseHeight: Number(shape.imageBaseHeight) || undefined,
        imageHref: shape.imageHref || "",
        svgText: shape.svgText || ""
      };

      if (shape.imageHref || shape.svgText) {
        this.ensureCustomShapePaletteItem(shape.type, this.config.node.shapeTypes[shape.type]);
      }
    });
  },

  importCanvasSettings(canvas) {
    if (!canvas) return;

    const background = this.normalizeHexColor(canvas.background) || this.config.colors.canvasDefaultBackground;
    const gridEnabled = canvas.gridEnabled !== false;
    const routeStyle = canvas.routeStyle || this.config.router.routeStyle || "straight";

    if (this.inspector.canvasBackground) this.inspector.canvasBackground.value = background;
    if (this.inspector.canvasGrid) this.inspector.canvasGrid.checked = gridEnabled;
    this.applyCanvasBackground(background, gridEnabled);
    this.setRouteStyle(routeStyle, { render: false });
    this.writeStorageValue(this.config.colors.storageKeys.canvasBackground, background);
    this.writeStorageValue(this.config.colors.storageKeys.canvasGridEnabled, String(gridEnabled));
  },

  ensureCustomShapePaletteItem(shapeType, shape) {
    const list = document.querySelector(this.config.selectors.customShapeList);
    if (!list || list.querySelector(`[data-shape-type="${shapeType}"]`)) return;

    this.appendCustomShapePaletteItem(shapeType, shape.label, shape.imageHref || this.svgTextToDataUrl(shape.svgText));
  },

  nextIndexFromIds(items, prefix) {
    const next = items.reduce((highest, item) => {
      const match = String(item.id || "").match(new RegExp(`^${prefix}-(\\d+)$`));
      return match ? Math.max(highest, Number(match[1]) + 1) : highest;
    }, 1);

    return next;
  },

  exportImage() {
    this.render({ forceLinks: true, skipRoutingPressure: true });
    const exportSvg = this.createExportSvg();
    const width = Number(exportSvg.getAttribute("width"));
    const height = Number(exportSvg.getAttribute("height"));
    const svgText = new XMLSerializer().serializeToString(exportSvg);
    const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const image = new Image();

    image.addEventListener("load", () => {
      const canvas = document.createElement("canvas");
      const scale = 2;
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");

      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        if (!blob) return;
        this.downloadBlob(`schema-${this.timestampForFileName()}.png`, blob);
      }, "image/png");
    });

    image.addEventListener("error", () => {
      URL.revokeObjectURL(url);
      window.alert("Impossible d'exporter l'image.");
    });

    image.src = url;
  },

  createExportSvg() {
    const bounds = this.exportContentBounds();
    const width = Math.ceil(bounds.right - bounds.left);
    const height = Math.ceil(bounds.bottom - bounds.top);
    const exportSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const viewportClone = this.viewport.node().cloneNode(true);
    const defsClone = this.defs ? this.defs.node().cloneNode(true) : null;

    viewportClone.removeAttribute("transform");
    this.cleanExportViewport(viewportClone);
    exportSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    exportSvg.setAttribute("width", String(width));
    exportSvg.setAttribute("height", String(height));
    exportSvg.setAttribute("viewBox", `${bounds.left} ${bounds.top} ${width} ${height}`);
    this.inlineExportBackground(exportSvg, bounds);
    this.inlineExportStyles(exportSvg);
    if (defsClone) exportSvg.appendChild(defsClone);
    exportSvg.appendChild(viewportClone);

    return exportSvg;
  },

  exportContentBounds() {
    const padding = 80;
    const nodeRects = this.store.nodes
      .filter(node => node.shape !== "text")
      .map(node => Geometry.nodeRect(node, { ...this.config.node, obstaclePadding: 0 }));
    const textRects = this.store.nodes
      .filter(node => node.shape === "text")
      .map(node => Geometry.nodeRect(node, { ...this.config.node, obstaclePadding: 12 }));
    const linkPoints = this.store.links.flatMap(link => link.routePoints || []);
    const rects = [...nodeRects, ...textRects];

    if (!rects.length && !linkPoints.length) {
      return { left: -400, right: 400, top: -260, bottom: 260 };
    }

    const left = Math.min(...rects.map(rect => rect.left), ...linkPoints.map(point => point.x));
    const right = Math.max(...rects.map(rect => rect.right), ...linkPoints.map(point => point.x));
    const top = Math.min(...rects.map(rect => rect.top), ...linkPoints.map(point => point.y));
    const bottom = Math.max(...rects.map(rect => rect.bottom), ...linkPoints.map(point => point.y));

    return {
      left: Math.floor(left - padding),
      right: Math.ceil(right + padding),
      top: Math.floor(top - padding),
      bottom: Math.ceil(bottom + padding)
    };
  },

  cleanExportViewport(viewportClone) {
    viewportClone.querySelectorAll(".lock-badge, .hit-area, .subschema-badge").forEach(element => element.remove());
    viewportClone.querySelectorAll(".selected, .dragging, .relation-source").forEach(element => {
      element.classList.remove("selected", "dragging", "relation-source");
    });
  },

  inlineExportBackground(svgClone, bounds) {
    const background = this.inspector.canvasBackground
      ? this.inspector.canvasBackground.value
      : this.config.colors.canvasDefaultBackground;
    const gridEnabled = this.isCanvasGridEnabled();
    const backgroundRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");

    backgroundRect.setAttribute("x", String(bounds.left));
    backgroundRect.setAttribute("y", String(bounds.top));
    backgroundRect.setAttribute("width", String(bounds.right - bounds.left));
    backgroundRect.setAttribute("height", String(bounds.bottom - bounds.top));
    backgroundRect.setAttribute("fill", background);
    svgClone.insertBefore(backgroundRect, svgClone.firstChild);

    if (gridEnabled) this.inlineExportGrid(svgClone, bounds, background);
  },

  inlineExportGrid(svgClone, bounds, background) {
    const gridColor = this.gridColorForBackground(background);
    const grid = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const commands = [];
    const startX = Math.floor(bounds.left / 24) * 24;
    const startY = Math.floor(bounds.top / 24) * 24;

    for (let x = startX; x <= bounds.right; x += 24) {
      commands.push(`M${x} ${bounds.top}V${bounds.bottom}`);
    }

    for (let y = startY; y <= bounds.bottom; y += 24) {
      commands.push(`M${bounds.left} ${y}H${bounds.right}`);
    }

    grid.setAttribute("d", commands.join(""));
    grid.setAttribute("stroke", gridColor);
    grid.setAttribute("stroke-width", "1");
    grid.setAttribute("fill", "none");
    svgClone.insertBefore(grid, svgClone.children[1] || null);
  },

  inlineExportStyles(svgClone) {
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `
      .node-label { font: 700 13px Arial, Helvetica, sans-serif; fill: #243447; pointer-events: none; }
      .node.text .node-label { font-size: 18px; font-weight: 800; }
      .node-body { stroke-width: 2; }
      .link { fill: none; stroke: var(--link-color, #556987); stroke-width: var(--link-width, 2); stroke-dasharray: var(--link-dasharray, none); stroke-linejoin: round; stroke-linecap: round; }
      .node .node-body { filter: drop-shadow(0 3px 5px rgba(31, 41, 51, 0.14)); }
      .node.text .node-body { filter: none; }
    `;
    svgClone.insertBefore(style, svgClone.firstChild);
  },

  downloadTextFile(fileName, text, mimeType) {
    this.downloadBlob(fileName, new Blob([text], { type: `${mimeType};charset=utf-8` }));
  },

  downloadBlob(fileName, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  },

  timestampForFileName() {
    return new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-");
  }
});
