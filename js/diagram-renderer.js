class DiagramRenderer {
  constructor(config, store, router) {
    this.config = config;
    this.store = store;
    this.router = router;
    this.svg = d3.select(config.selectors.canvas);
    this.defs = null;
    this.viewport = null;
    this.linkSelection = null;
    this.nodeSelection = null;
    this.simulation = null;
    this.zoom = null;
    this.selectedNode = null;
    this.selectedLink = null;
    this.selectedNodes = new Set();
    this.selectedLinks = new Set();
    this.pendingLinkSource = null;
    this.inspector = {};
    this.hud = {};
    this.customColorHistory = { fill: [], stroke: [] };
    this.interactionMode = "select";
    this.selectionDrag = null;
    this.selectionBox = null;
    this.suppressCanvasClick = false;
    this.draggingNode = null;
    this.draggingNodeIntent = null;
    this.dragCollisionTarget = null;
    this.dragRenderFrame = null;
    this.draggingLink = null;
    this.dragGroup = null;
    this.suppressLinkClick = false;
    this.clipboard = null;
    this.pasteSequence = 0;
    this.middlePanActive = false;
    this.pageController = null;
  }

  mount() {
    this.defs = this.svg.append("defs");
    this.viewport = this.svg.append("g");
    this.linkLayer = this.viewport.append("g").attr("class", "links");
    this.nodeLayer = this.viewport.append("g").attr("class", "nodes");
    this.zoom = this.createZoom();

    this.svg.call(this.zoom);
    this.svg.on("click", event => this.onCanvasClick(event));
    this.bindToolbarTools();
    this.bindHudControls();
    this.bindMiddleMousePan();
    this.bindSelectionBox();
    this.bindPalette();
    this.bindInspector();
    this.bindKeyboard();
    this.linkSelection = this.createLinks();
    this.nodeSelection = this.createNodes();
    this.simulation = this.createSimulation();
    this.updateZoomIndicator(1);
    this.refreshInspector();
  }

  createZoom() {
    return d3.zoom()
      .scaleExtent([this.config.zoom.min, this.config.zoom.max])
      .wheelDelta(event => this.zoomWheelDelta(event))
      .filter(event => {
        if (event.button === 1) return true;
        if (event.target.closest(".node")) return false;
        if (event.type === "wheel" || event.type === "dblclick") return true;
        return this.interactionMode === "pan";
      })
      .on("zoom", event => {
        this.viewport.attr("transform", event.transform);
        this.updateZoomIndicator(event.transform.k);
      });
  }

  zoomWheelDelta(event) {
    const modeFactor = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002;
    const ctrlFactor = event.ctrlKey ? 10 : 1;
    return -event.deltaY * modeFactor * ctrlFactor * this.config.zoom.wheelSensitivity;
  }

  createLinks() {
    return this.linkLayer
      .selectAll("path")
      .data(this.store.links, d => d.id)
      .join("path")
      .attr("class", d => this.linkClass(d))
      .on("click", (event, link) => this.onLinkClick(event, link))
      .call(this.createLinkDragBehavior());
  }

  createNodes() {
    const node = this.nodeLayer
      .selectAll("g")
      .data(this.store.nodes, d => d.id)
      .join(
        enter => this.createNodeEnter(enter),
        update => update,
        exit => exit.remove()
      )
      .attr("class", d => this.nodeClass(d));

    node.each((nodeData, index, elements) => {
      const nodeSelection = d3.select(elements[index]);
      this.renderNodeShape(nodeSelection, nodeData);
      this.renderNodeLabel(nodeSelection, nodeData);
    });
    node.select(".lock-badge")
      .attr("x", d => this.nodeWidth(d) / 2 - 10)
      .attr("y", d => -this.nodeHeight(d) / 2 + 8);
    node.select(".hit-area")
      .attr("x", d => -this.nodeWidth(d) / 2)
      .attr("y", d => -this.nodeHeight(d) / 2)
      .attr("width", d => this.nodeWidth(d))
      .attr("height", d => this.nodeHeight(d));
    node.select(".subschema-badge")
      .classed("hidden", d => !d.subPageId)
      .attr("transform", d => `translate(${this.nodeWidth(d) / 2 - 12},${-this.nodeHeight(d) / 2 + 12})`);

    return node;
  }

  createNodeEnter(enter) {
    const node = enter.append("g")
      .on("click", (event, nodeData) => this.onNodeClick(event, nodeData))
      .on("dblclick", (event, nodeData) => this.toggleLock(event, nodeData))
      .call(this.createDragBehavior());

    node.append("g")
      .attr("class", "shape-host");
    node.append("rect")
      .attr("class", "hit-area");
    node.append("text")
      .attr("class", "node-label");
    node.append("text")
      .attr("class", "lock-badge")
      .text("LOCK");
    const subBadge = node.append("g")
      .attr("class", "subschema-badge hidden")
      .on("click", (event, nodeData) => this.openNodeSubschema(event, nodeData));
    subBadge.append("circle")
      .attr("r", 9);
    subBadge.append("text")
      .text("S");

    return node;
  }

  nodeClass(node) {
    return [
      "node",
      node.type,
      node.locked ? "locked" : "",
      this.selectedNodes.has(node) ? "selected" : "",
      this.pendingLinkSource === node ? "relation-source" : ""
    ].filter(Boolean).join(" ");
  }

  linkClass(link) {
    return `link${this.selectedLinks.has(link) ? " selected" : ""}`;
  }

  nodeWidth(node) {
    return node.width || this.config.node.width;
  }

  nodeHeight(node) {
    return node.height || this.config.node.height;
  }

  nodeFontSize(node) {
    return Number(node.fontSize) || this.config.node.defaults.fontSize;
  }

  nodeTextAlign(node) {
    const value = String(node.textAlign || this.config.node.defaults.textAlign || "center");
    return ["left", "center", "right"].includes(value) ? value : "center";
  }

  nodeTextVAlign(node) {
    const value = String(node.textVAlign || this.config.node.defaults.textVAlign || "middle");
    return ["top", "middle", "bottom"].includes(value) ? value : "middle";
  }

  isAnnotationShape(shape) {
    return shape === "text" || shape === "image" || shape === "svgImage";
  }

  renderNodeLabel(nodeSelection, node) {
    const label = nodeSelection.select(".node-label");
    const fill = node.shape === "text" ? node.stroke : "#243447";
    const fontSize = this.fitNodeLabel(label, node, this.nodeFontSize(node));
    const decorations = [];
    if (node.fontUnderline) decorations.push("underline");
    if (node.fontStrike) decorations.push("line-through");

    label
      .attr("fill", fill)
      .style("font-weight", node.fontBold ? "800" : "700")
      .style("font-style", node.fontItalic ? "italic" : "normal")
      .style("text-decoration", decorations.length ? decorations.join(" ") : "none")
      .style("font-size", `${fontSize}px`);
  }

  fitNodeLabel(label, node, preferredFontSize) {
    const minFontSize = 7;
    let fontSize = preferredFontSize;
    let lines = [];

    while (fontSize >= minFontSize) {
      lines = this.wrapNodeLabel(label, node, fontSize);
      if (this.nodeLabelFits(node, lines, fontSize)) break;
      fontSize -= 1;
    }

    fontSize = Math.max(minFontSize, fontSize);
    this.positionNodeLabelLines(label, lines, fontSize, node);
    return fontSize;
  }

  wrapNodeLabel(label, node, fontSize) {
    const maxWidth = Math.max(24, this.nodeWidth(node) - 24);
    const lines = [];
    label.style("font-size", `${fontSize}px`).text(null);
    const rawLines = String(node.label || "").replace(/\r/g, "").split("\n");
    rawLines.forEach(rawLine => {
      if (!rawLine.trim()) {
        lines.push("");
        return;
      }
      this.wrapRawLabelLine(label, rawLine, maxWidth).forEach(line => lines.push(line));
    });
    return lines.length ? lines : [""];
  }

  wrapRawLabelLine(label, rawLine, maxWidth) {
    const words = rawLine
      .trim()
      .split(/\s+/)
      .flatMap(word => this.splitLongLabelWord(word));
    const lines = [];
    let line = [];

    words.forEach(word => {
      const candidate = [...line, word];
      if (!line.length || this.measureLabelText(label, candidate.join(" ")) <= maxWidth) {
        line = candidate;
        return;
      }

      lines.push(line.join(" "));
      line = [word];
    });

    if (line.length) lines.push(line.join(" "));
    return lines.length ? lines : [""];
  }

  splitLongLabelWord(word) {
    if (word.length <= 18) return [word];

    const chunks = [];
    for (let index = 0; index < word.length; index += 12) {
      chunks.push(word.slice(index, index + 12));
    }

    return chunks;
  }

  measureLabelText(label, text) {
    label.text(text);
    return label.node().getComputedTextLength();
  }

  nodeLabelFits(node, lines, fontSize) {
    const lineHeight = fontSize * 1.16;
    const maxHeight = Math.max(18, this.nodeHeight(node) - 18);
    return lines.length * lineHeight <= maxHeight;
  }

  positionNodeLabelLines(label, lines, fontSize, node) {
    const lineHeight = fontSize * 1.16;
    const textAlign = this.nodeTextAlign(node);
    const textVAlign = this.nodeTextVAlign(node);
    const contentHeight = lines.length * lineHeight;
    const top = -this.nodeHeight(node) / 2 + 10;
    const bottom = this.nodeHeight(node) / 2 - 10;
    let startY;
    if (textVAlign === "top") {
      startY = top + lineHeight / 2;
    } else if (textVAlign === "bottom") {
      startY = bottom - contentHeight + lineHeight / 2;
    } else {
      startY = -((lines.length - 1) * lineHeight) / 2;
    }
    const paddingX = 12;
    let x = 0;
    let anchor = "middle";
    if (textAlign === "left") {
      x = -this.nodeWidth(node) / 2 + paddingX;
      anchor = "start";
    } else if (textAlign === "right") {
      x = this.nodeWidth(node) / 2 - paddingX;
      anchor = "end";
    }

    label.text(null);
    label.attr("text-anchor", anchor);
    lines.forEach((line, index) => {
      label.append("tspan")
        .attr("x", x)
        .attr("y", startY + index * lineHeight)
        .attr("dominant-baseline", "middle")
        .text(line);
    });
  }

  renderNodeShape(nodeSelection, node) {
    let shapeHost = nodeSelection.select(".shape-host");
    const width = this.nodeWidth(node);
    const height = this.nodeHeight(node);
    const shape = node.shape || "roundedRect";

    if (shapeHost.empty()) {
      shapeHost = nodeSelection.insert("g", ":first-child")
        .attr("class", "shape-host");
    }

    shapeHost.selectAll("*").remove();

    if (shape === "circle") {
      shapeHost.append("ellipse")
        .attr("class", "node-body")
        .attr("rx", width / 2)
        .attr("ry", height / 2)
        .attr("fill", node.fill)
        .attr("stroke", node.stroke);
      this.applyNodeCustomCss(shapeHost, node);
      return;
    }

    if (shape === "diamond") {
      shapeHost.append("path")
        .attr("class", "node-body")
        .attr("d", `M0,${-height / 2} L${width / 2},0 L0,${height / 2} L${-width / 2},0 Z`)
        .attr("fill", node.fill)
        .attr("stroke", node.stroke);
      this.applyNodeCustomCss(shapeHost, node);
      return;
    }

    if (shape === "document") {
      const corner = Math.min(22, width * 0.18, height * 0.35);
      shapeHost.append("path")
        .attr("class", "node-body")
        .attr("d", [
          `M${-width / 2},${-height / 2}`,
          `H${width / 2 - corner}`,
          `L${width / 2},${-height / 2 + corner}`,
          `V${height / 2}`,
          `H${-width / 2}`,
          "Z",
          `M${width / 2 - corner},${-height / 2}`,
          `V${-height / 2 + corner}`,
          `H${width / 2}`
        ].join(" "))
        .attr("fill", node.fill)
        .attr("stroke", node.stroke);
      this.applyNodeCustomCss(shapeHost, node);
      return;
    }

    if (shape === "database") {
      const capHeight = Math.min(24, height * 0.28);
      shapeHost.append("path")
        .attr("class", "node-body")
        .attr("d", [
          `M${-width / 2},${-height / 2 + capHeight / 2}`,
          `C${-width / 2},${-height / 2 - capHeight / 2} ${width / 2},${-height / 2 - capHeight / 2} ${width / 2},${-height / 2 + capHeight / 2}`,
          `V${height / 2 - capHeight / 2}`,
          `C${width / 2},${height / 2 + capHeight / 2} ${-width / 2},${height / 2 + capHeight / 2} ${-width / 2},${height / 2 - capHeight / 2}`,
          "Z",
          `M${-width / 2},${-height / 2 + capHeight / 2}`,
          `C${-width / 2},${-height / 2 + capHeight * 1.45} ${width / 2},${-height / 2 + capHeight * 1.45} ${width / 2},${-height / 2 + capHeight / 2}`
        ].join(" "))
        .attr("fill", node.fill)
        .attr("stroke", node.stroke);
      this.applyNodeCustomCss(shapeHost, node);
      return;
    }

    if (shape === "image") {
      const cropMode = node.imageCrop !== false;
      const innerX = -width / 2 + 5;
      const innerY = -height / 2 + 5;
      const innerWidth = width - 10;
      const innerHeight = height - 10;
      shapeHost.append("rect")
        .attr("class", "node-body image-frame")
        .attr("x", -width / 2)
        .attr("y", -height / 2)
        .attr("width", width)
        .attr("height", height)
        .attr("rx", 8)
        .attr("fill", node.fill)
        .attr("stroke", node.stroke);
      this.renderNodeImageContent(shapeHost, node, {
        x: innerX,
        y: innerY,
        width: innerWidth,
        height: innerHeight,
        clipId: `img-clip-${String(node.id || "").replace(/[^a-zA-Z0-9_-]/g, "-")}`
      }, cropMode);
      this.applyNodeCustomCss(shapeHost, node);
      return;
    }

    if (shape === "svgImage") {
      this.renderSvgImage(shapeHost, node, width, height);
      this.applyNodeCustomCss(shapeHost, node);
      return;
    }

    if (shape === "text") {
      shapeHost.append("rect")
        .attr("class", "node-body text-body")
        .attr("x", -width / 2)
        .attr("y", -height / 2)
        .attr("width", width)
        .attr("height", height)
        .attr("fill", "transparent")
        .attr("stroke", "transparent");
      this.applyNodeCustomCss(shapeHost, node);
      return;
    }

    shapeHost.append("rect")
      .attr("class", "node-body")
      .attr("x", -width / 2)
      .attr("y", -height / 2)
      .attr("width", width)
      .attr("height", height)
      .attr("rx", shape === "roundedRect" ? 7 : 0)
      .attr("fill", node.fill)
      .attr("stroke", node.stroke);
    this.applyNodeCustomCss(shapeHost, node);
  }

  renderSvgImage(shapeHost, node, width, height) {
    if (!node.imageHref) return;
    const cropMode = Boolean(node.imageCrop);
    this.renderNodeImageContent(shapeHost, node, {
      x: -width / 2,
      y: -height / 2,
      width,
      height,
      clipId: `svg-clip-${String(node.id || "").replace(/[^a-zA-Z0-9_-]/g, "-")}`
    }, cropMode, true);
  }

  renderNodeImageContent(shapeHost, node, frame, cropMode, asSvg = false) {
    const image = shapeHost.append("image")
      .attr("class", asSvg ? "node-image svg-image" : "node-image")
      .attr("href", node.imageHref)
      .style("image-rendering", "auto");

    if (!cropMode) {
      const baseWidth = Math.max(12, Number(node.imageBaseWidth) || frame.width);
      const baseHeight = Math.max(12, Number(node.imageBaseHeight) || frame.height);
      const drawX = frame.x + (frame.width - baseWidth) / 2;
      const drawY = frame.y + (frame.height - baseHeight) / 2;
      const defs = shapeHost.append("defs");
      const clipPath = defs.append("clipPath").attr("id", frame.clipId);
      clipPath.append("rect")
        .attr("x", frame.x)
        .attr("y", frame.y)
        .attr("width", frame.width)
        .attr("height", frame.height);

      image
        .attr("x", drawX)
        .attr("y", drawY)
        .attr("width", baseWidth)
        .attr("height", baseHeight)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .attr("clip-path", `url(#${frame.clipId})`);
      return;
    }

    const defs = shapeHost.append("defs");
    const clipPath = defs.append("clipPath").attr("id", frame.clipId);
    clipPath.append("rect")
      .attr("x", frame.x)
      .attr("y", frame.y)
      .attr("width", frame.width)
      .attr("height", frame.height);

    const zoom = Math.max(0.2, Number(node.imageZoom) || 1);
    const offsetX = Number(node.imageOffsetX) || 0;
    const offsetY = Number(node.imageOffsetY) || 0;
    const aspect = Number(node.imageAspect) > 0 ? Number(node.imageAspect) : frame.width / frame.height;
    let baseWidth = Math.max(12, Number(node.imageBaseWidth) || frame.width);
    let baseHeight = Math.max(12, Number(node.imageBaseHeight) || frame.height);
    if (!(Number(baseWidth) > 0 && Number(baseHeight) > 0)) {
      baseWidth = frame.width;
      baseHeight = frame.height;
    }
    const baseAspect = baseWidth / baseHeight;
    if (Math.abs(baseAspect - aspect) > 0.001) {
      baseHeight = baseWidth / aspect;
    }
    const drawWidth = baseWidth * zoom;
    const drawHeight = baseHeight * zoom;
    const drawX = frame.x + (frame.width - drawWidth) / 2 + offsetX;
    const drawY = frame.y + (frame.height - drawHeight) / 2 + offsetY;

    image
      .attr("x", drawX)
      .attr("y", drawY)
      .attr("width", drawWidth)
      .attr("height", drawHeight)
      .attr("preserveAspectRatio", "none")
      .attr("clip-path", `url(#${frame.clipId})`);
  }

  nodeShapeCssText(node) {
    const customCss = String(node.customCss || "").trim();
    if (customCss) return customCss;

    const width = this.nodeWidth(node);
    const height = this.nodeHeight(node);
    const fontSize = this.nodeFontSize(node);
    return [
      `shape: ${node.shape || "roundedRect"};`,
      `fill: ${node.fill};`,
      `stroke: ${node.stroke};`,
      `width: ${width}px;`,
      `height: ${height}px;`,
      `font-size: ${fontSize}px;`
    ].join("\n");
  }

  applyNodeCustomCss(shapeHost, node) {
    const cssText = String(node.customCss || "").trim();
    if (!cssText) return;

    const declarations = this.parseCssDeclarations(cssText);
    if (!declarations.length) return;

    const targets = shapeHost.selectAll(".node-body, .node-image");
    const svgAttributes = new Set([
      "fill",
      "stroke",
      "stroke-width",
      "stroke-dasharray",
      "stroke-linecap",
      "stroke-linejoin",
      "opacity",
      "rx",
      "ry",
      "r",
      "x",
      "y",
      "width",
      "height",
      "d",
      "filter",
      "transform"
    ]);

    targets.each((_, index, elements) => {
      const selection = d3.select(elements[index]);
      declarations.forEach(({ property, value }) => {
        if (svgAttributes.has(property)) {
          selection.attr(property, value);
        } else {
          selection.style(property, value);
        }
      });
    });
  }

  parseCssDeclarations(cssText) {
    return cssText
      .split(";")
      .map(entry => entry.trim())
      .filter(Boolean)
      .map(entry => {
        const separator = entry.indexOf(":");
        if (separator <= 0) return null;
        const property = entry.slice(0, separator).trim().toLowerCase();
        const value = entry.slice(separator + 1).trim();
        if (!property || !value) return null;
        return { property, value };
      })
      .filter(Boolean);
  }

  shapeFromCssText(cssText) {
    const declaration = this.parseCssDeclarations(cssText)
      .find(entry => entry.property === "shape");
    if (!declaration) return null;
    return this.normalizeShapeToken(declaration.value);
  }

  normalizeShapeToken(shapeValue) {
    const token = String(shapeValue || "").trim().toLowerCase();
    const aliases = {
      rectangle: "rect",
      rect: "rect",
      "rectangle-arrondi": "roundedRect",
      roundedrect: "roundedRect",
      "rounded-rect": "roundedRect",
      circle: "circle",
      cercle: "circle",
      diamond: "diamond",
      losange: "diamond",
      document: "document",
      database: "database",
      text: "text",
      texte: "text",
      image: "image",
      svg: "svgImage",
      svgimage: "svgImage",
      "svg-image": "svgImage"
    };

    return aliases[token] || null;
  }

  svgViewBox(svgElement) {
    const viewBox = svgElement.getAttribute("viewBox");
    if (viewBox) {
      const [x, y, width, height] = viewBox.split(/[\s,]+/).map(Number);
      if ([x, y, width, height].every(Number.isFinite) && width > 0 && height > 0) {
        return { x, y, width, height };
      }
    }

    const width = Number.parseFloat(svgElement.getAttribute("width")) || 100;
    const height = Number.parseFloat(svgElement.getAttribute("height")) || 100;
    return { x: 0, y: 0, width, height };
  }

  createSimulation() {
    const simulationConfig = this.config.simulation;

    return d3.forceSimulation(this.store.nodes)
      .force("link", d3.forceLink(this.store.links)
        .id(d => d.id)
        .distance(simulationConfig.linkDistance)
        .strength(simulationConfig.linkStrength))
      .force("charge", d3.forceManyBody().strength(d => this.isAnnotationShape(d.shape) ? 0 : simulationConfig.chargeStrength))
      .force("collide", d3.forceCollide()
        .radius(d => this.isAnnotationShape(d.shape) ? 0 : Math.max(this.nodeWidth(d), this.nodeHeight(d)) * 0.7)
        .strength(simulationConfig.collideStrength))
      .force("x", d3.forceX(0).strength(simulationConfig.gravityStrength))
      .force("y", d3.forceY(0).strength(simulationConfig.gravityStrength))
      .on("tick", () => this.render());
  }

  setPageController(controller) {
    this.pageController = controller || null;
  }

  openNodeSubschema(event, node) {
    if (!this.pageController || !node || !node.subPageId) return;

    event.preventDefault();
    event.stopPropagation();
    this.pageController.openSubschema(node);
  }

  resetTransientInteractionState() {
    this.pendingLinkSource = null;
    this.suppressCanvasClick = false;
    this.suppressLinkClick = false;
    this.draggingNode = null;
    this.draggingNodeIntent = null;
    this.dragCollisionTarget = null;
    this.draggingLink = null;
    this.dragGroup = null;
    this.middlePanActive = false;
    this.svg.classed("mode-middle-pan", false);

    if (this.selectionBox) this.removeSelectionBoxElement();
    this.selectionDrag = null;
    this.setInteractionMode("select");
  }

}
