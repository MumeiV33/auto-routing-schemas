Object.assign(DiagramRenderer.prototype, {
  createDragBehavior() {
    const renderer = this;

    return d3.drag()
      .filter(event =>
        renderer.interactionMode === "select" &&
        event.button === 0 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      )
      .on("start", function(event, node) {
        renderer.onDragStart(event, node, this);
      })
      .on("drag", function(event, node) {
        renderer.onDrag(event, node);
      })
      .on("end", function(event, node) {
        renderer.onDragEnd(event, node, this);
      });
  },

  createLinkDragBehavior() {
    const renderer = this;

    return d3.drag()
      .filter(event =>
        renderer.interactionMode === "select" &&
        event.button === 0 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey
      )
      .on("start", function(event, link) {
        renderer.onLinkDragStart(event, link, this);
      })
      .on("drag", function(event, link) {
        renderer.onLinkDrag(event, link);
      })
      .on("end", function(event, link) {
        renderer.onLinkDragEnd(event, link, this);
      });
  },

  bindToolbarTools() {
    const selectors = this.config.selectors;
    this.toolButtons = {
      select: document.querySelector(selectors.selectToolButton),
      pan: document.querySelector(selectors.panToolButton)
    };

    if (this.toolButtons.select) {
      this.toolButtons.select.addEventListener("click", () => this.setInteractionMode("select"));
    }

    if (this.toolButtons.pan) {
      this.toolButtons.pan.addEventListener("click", () => this.setInteractionMode("pan"));
    }

    this.setInteractionMode(this.interactionMode);
  },

  bindHudControls() {
    const selectors = this.config.selectors;
    this.hud = {
      hide: document.querySelector(selectors.hideAthButton),
      show: document.querySelector(selectors.showAthButton),
      zoom: document.querySelector(selectors.zoomIndicator),
      zoomLabel: document.querySelector(selectors.zoomLabel),
      zoomSlider: document.querySelector(selectors.zoomSlider)
    };

    if (this.hud.hide) {
      this.hud.hide.addEventListener("click", () => this.setAthHidden(true));
    }

    if (this.hud.show) {
      this.hud.show.addEventListener("click", () => this.setAthHidden(false));
    }

    if (this.hud.zoomSlider) {
      this.hud.zoomSlider.min = String(Math.round(this.config.zoom.min * 100));
      this.hud.zoomSlider.max = String(Math.round(this.config.zoom.max * 100));
      this.hud.zoomSlider.step = "1";
      this.hud.zoomSlider.value = "100";
      this.hud.zoomSlider.addEventListener("input", event => {
        this.setZoomScale(Number(event.target.value) / 100);
      });
    }
  },

  setAthHidden(hidden) {
    document.body.classList.toggle("ath-hidden", hidden);
    if (this.hud.show) this.hud.show.classList.toggle("hidden", !hidden);
  },

  updateZoomIndicator(scale) {
    if (!this.hud.zoomLabel) return;
    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

    this.hud.zoomLabel.textContent = `${Math.round(safeScale * 100)}%`;
    if (this.hud.zoomSlider) this.hud.zoomSlider.value = String(Math.round(safeScale * 100));
  },

  setZoomScale(scale) {
    if (!Number.isFinite(scale) || scale <= 0) return;

    const svgNode = this.svg.node();
    const currentTransform = d3.zoomTransform(svgNode);
    const width = svgNode.clientWidth || window.innerWidth;
    const height = svgNode.clientHeight || window.innerHeight;
    const center = [width / 2, height / 2];
    const worldCenter = currentTransform.invert(center);
    const clampedScale = Math.max(this.config.zoom.min, Math.min(this.config.zoom.max, scale));
    const transform = d3.zoomIdentity
      .translate(center[0] - worldCenter[0] * clampedScale, center[1] - worldCenter[1] * clampedScale)
      .scale(clampedScale);

    this.svg.call(this.zoom.transform, transform);
  },

  setInteractionMode(mode) {
    this.interactionMode = mode;
    this.svg
      .classed("mode-select", mode === "select")
      .classed("mode-pan", mode === "pan");

    if (!this.toolButtons) return;

    Object.entries(this.toolButtons).forEach(([toolMode, button]) => {
      if (!button) return;
      const active = toolMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
  },

  bindSelectionBox() {
    this.svg.on("pointerdown.selection-box", event => this.onSelectionBoxStart(event));
    window.addEventListener("pointermove", event => this.onSelectionBoxMove(event));
    window.addEventListener("pointerup", event => this.onSelectionBoxEnd(event));
  },

  onSelectionBoxStart(event) {
    if (this.interactionMode !== "select" || event.button !== 0) return;
    if (event.target.closest(".node") || event.target.closest(".link")) return;

    event.preventDefault();
    this.selectionDrag = {
      startClient: { x: event.clientX, y: event.clientY },
      currentClient: { x: event.clientX, y: event.clientY },
      append: event.shiftKey || event.ctrlKey || event.metaKey,
      moved: false
    };

    this.selectionBox = document.createElement("div");
    this.selectionBox.className = "selection-box";
    document.body.appendChild(this.selectionBox);
    this.updateSelectionBoxElement();
  },

  onSelectionBoxMove(event) {
    if (!this.selectionDrag) return;

    this.selectionDrag.currentClient = { x: event.clientX, y: event.clientY };
    const dx = Math.abs(this.selectionDrag.currentClient.x - this.selectionDrag.startClient.x);
    const dy = Math.abs(this.selectionDrag.currentClient.y - this.selectionDrag.startClient.y);
    this.selectionDrag.moved = dx > 4 || dy > 4;
    this.updateSelectionBoxElement();
  },

  onSelectionBoxEnd() {
    if (!this.selectionDrag) return;

    const drag = this.selectionDrag;
    this.removeSelectionBoxElement();
    this.selectionDrag = null;

    if (!drag.moved) return;

    this.suppressCanvasClick = true;
    window.setTimeout(() => {
      this.suppressCanvasClick = false;
    }, 0);

    const rect = this.clientSelectionRect(drag.startClient, drag.currentClient);
    const worldRect = this.clientRectToWorldRect(rect);
    const selectedNodes = this.store.nodes.filter(node => this.nodeIntersectsWorldRect(node, worldRect));
    const selectedLinks = this.store.links.filter(link => this.linkIntersectsWorldRect(link, worldRect));

    this.setSelection(selectedNodes, selectedLinks, { append: drag.append });
  },

  updateSelectionBoxElement() {
    if (!this.selectionBox || !this.selectionDrag) return;

    const rect = this.clientSelectionRect(this.selectionDrag.startClient, this.selectionDrag.currentClient);
    this.selectionBox.style.left = `${rect.left}px`;
    this.selectionBox.style.top = `${rect.top}px`;
    this.selectionBox.style.width = `${rect.width}px`;
    this.selectionBox.style.height = `${rect.height}px`;
  },

  removeSelectionBoxElement() {
    if (!this.selectionBox) return;
    this.selectionBox.remove();
    this.selectionBox = null;
  },

  clientSelectionRect(start, end) {
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const right = Math.max(start.x, end.x);
    const bottom = Math.max(start.y, end.y);

    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top
    };
  },

  clientRectToWorldRect(rect) {
    const transform = d3.zoomTransform(this.svg.node());
    const svgRect = this.svg.node().getBoundingClientRect();
    const topLeft = transform.invert([rect.left - svgRect.left, rect.top - svgRect.top]);
    const bottomRight = transform.invert([rect.right - svgRect.left, rect.bottom - svgRect.top]);

    return {
      left: Math.min(topLeft[0], bottomRight[0]),
      right: Math.max(topLeft[0], bottomRight[0]),
      top: Math.min(topLeft[1], bottomRight[1]),
      bottom: Math.max(topLeft[1], bottomRight[1])
    };
  },

  nodeIntersectsWorldRect(node, rect) {
    const nodeRect = Geometry.nodeRect(node, {
      ...this.config.node,
      obstaclePadding: 0
    });

    return nodeRect.left <= rect.right &&
      nodeRect.right >= rect.left &&
      nodeRect.top <= rect.bottom &&
      nodeRect.bottom >= rect.top;
  },

  linkIntersectsWorldRect(link, rect) {
    const points = link.routePoints || [];
    for (let index = 0; index < points.length - 1; index += 1) {
      if (Geometry.segmentIntersectsRect({ a: points[index], b: points[index + 1] }, rect)) return true;
    }

    return points.some(point =>
      point.x >= rect.left &&
      point.x <= rect.right &&
      point.y >= rect.top &&
      point.y <= rect.bottom
    );
  },

  bindPalette() {
    document.querySelectorAll(this.config.selectors.paletteItems).forEach(item => {
      this.bindPaletteItem(item);
    });

    this.bindCustomShapeForm();

    this.svg.node().addEventListener("dragover", event => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    });

    this.svg.node().addEventListener("drop", event => {
      event.preventDefault();
      const shapeType = event.dataTransfer.getData("text/plain");
      if (!shapeType) return;

      const dropPosition = this.pointerToWorld(event);
      const targetNode = this.findNodeAt(dropPosition);
      const nodePosition = targetNode
        ? this.nextToNodePosition(targetNode, shapeType)
        : dropPosition;
      const node = this.addNode(shapeType, nodePosition);

      if (targetNode) this.addLink(targetNode, node);
    });
  },

  bindPaletteItem(item) {
    item.addEventListener("dragstart", event => {
      event.dataTransfer.setData("text/plain", item.dataset.shapeType);
      event.dataTransfer.effectAllowed = "copy";
    });

    item.addEventListener("click", () => {
      this.addNode(item.dataset.shapeType, this.viewportCenter());
    });
  },

  bindCustomShapeForm() {
    const form = document.querySelector(this.config.selectors.customShapeForm);
    if (!form) return;

    form.addEventListener("submit", event => {
      event.preventDefault();
      this.addCustomShapeFromFile();
    });
  },

  addCustomShapeFromFile() {
    const nameInput = document.querySelector(this.config.selectors.customShapeNameInput);
    const fileInput = document.querySelector(this.config.selectors.customShapeFileInput);
    const file = fileInput.files[0];

    if (!file) return;

    if (this.isSvgFile(file)) {
      this.addCustomSvgShape(file, nameInput, fileInput);
      return;
    }

    this.addCustomImageShape(file, nameInput, fileInput);
  },

  addCustomImageShape(file, nameInput, fileInput) {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const label = nameInput.value.trim() || this.fileNameWithoutExtension(file.name) || "Forme importee";
      const shapeType = this.uniqueShapeType(label);
      const image = new Image();
      image.addEventListener("load", () => {
        const naturalWidth = Math.max(1, image.naturalWidth || 130);
        const naturalHeight = Math.max(1, image.naturalHeight || 90);
        const maxSize = 260;
        const minSize = 72;
        const ratio = Math.min(1, maxSize / Math.max(naturalWidth, naturalHeight));
        const width = Math.max(minSize, Math.round(naturalWidth * ratio));
        const height = Math.max(minSize, Math.round(naturalHeight * ratio));

        this.config.node.shapeTypes[shapeType] = {
          label,
          shape: "image",
          width,
          height,
          fill: "#ffffff",
          stroke: "#db2777",
          imageCrop: false,
          imageZoom: 1,
          imageOffsetX: 0,
          imageOffsetY: 0,
          imageAspect: naturalWidth / naturalHeight,
          imageNaturalWidth: naturalWidth,
          imageNaturalHeight: naturalHeight,
          imageBaseWidth: Math.max(24, width - 10),
          imageBaseHeight: Math.max(24, height - 10),
          imageHref: reader.result
        };

        this.appendCustomShapePaletteItem(shapeType, label, reader.result);
        nameInput.value = "";
        fileInput.value = "";
      });
      image.src = reader.result;
    });
    reader.readAsDataURL(file);
  },

  addCustomSvgShape(file, nameInput, fileInput) {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const label = nameInput.value.trim() || this.fileNameWithoutExtension(file.name) || "SVG importe";
      const shapeType = this.uniqueShapeType(label);
      const svgText = this.cleanSvgText(reader.result);
      const previewHref = this.svgTextToDataUrl(svgText);

      this.config.node.shapeTypes[shapeType] = {
        label,
        shape: "svgImage",
        width: 130,
        height: 90,
        fill: "transparent",
        stroke: "#475569",
        imageCrop: false,
        imageZoom: 1,
        imageOffsetX: 0,
        imageOffsetY: 0,
        imageHref: previewHref,
        svgText
      };

      this.appendCustomShapePaletteItem(shapeType, label, previewHref);
      nameInput.value = "";
      fileInput.value = "";
    });
    reader.readAsText(file);
  },

  isSvgFile(file) {
    return file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg");
  },

  cleanSvgText(svgText) {
    const parser = new DOMParser();
    const documentSvg = parser.parseFromString(svgText, "image/svg+xml");
    documentSvg.querySelectorAll("script, foreignObject").forEach(element => element.remove());
    return new XMLSerializer().serializeToString(documentSvg.documentElement);
  },

  svgTextToDataUrl(svgText) {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
  },

  appendCustomShapePaletteItem(shapeType, label, imageHref, shape = "image") {
    const list = document.querySelector(this.config.selectors.customShapeList);
    if (!list) return;

    const entry = document.createElement("div");
    entry.className = "custom-shape-entry";
    entry.dataset.shapeType = shapeType;
    const swatchHtml = imageHref
      ? `<span class="shape-swatch custom-image"><img src="${imageHref}" alt=""></span>`
      : `<span class="shape-swatch ${shape === "circle" ? "circle" : shape === "diamond" ? "diamond" : shape === "document" ? "document" : shape === "text" ? "text" : shape === "rect" ? "rect" : "rounded-rect"}"></span>`;
    entry.innerHTML = `
      <button class="shape-palette-item custom" type="button" draggable="true" data-shape-type="${shapeType}">
        ${swatchHtml}
        <span>${this.escapeHtml(label)}</span>
      </button>
      <button class="custom-shape-remove" type="button" title="Supprimer de la bibliotheque" aria-label="Supprimer de la bibliotheque">x</button>
    `;

    const item = entry.querySelector(".shape-palette-item");
    const removeButton = entry.querySelector(".custom-shape-remove");
    if (item) this.bindPaletteItem(item);
    if (removeButton) {
      removeButton.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        this.removeCustomShape(shapeType);
      });
    }

    list.appendChild(entry);
  },

  removeCustomShape(shapeType) {
    if (!shapeType || !shapeType.startsWith("custom-")) return;
    if (this.pageController && this.pageController.checkpoint) this.pageController.checkpoint();
    delete this.config.node.shapeTypes[shapeType];
    document.querySelectorAll(`[data-shape-type="${shapeType}"]`).forEach(element => {
      const entry = element.closest(".custom-shape-entry");
      if (entry) {
        entry.remove();
      } else {
        element.remove();
      }
    });
  },

  uniqueShapeType(label) {
    const base = this.slugify(label) || "custom-shape";
    let candidate = `custom-${base}`;
    let index = 2;

    while (this.config.node.shapeTypes[candidate]) {
      candidate = `custom-${base}-${index}`;
      index += 1;
    }

    return candidate;
  },

  slugify(value) {
    return value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  },

  fileNameWithoutExtension(fileName) {
    return fileName.replace(/\.[^/.]+$/, "");
  },

  escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },

  bindInspector() {
    const selectors = this.config.selectors;
    this.customColorHistory = this.loadColorHistories();
    this.inspector = {
      empty: document.querySelector(selectors.emptyInspector),
      canvasBackground: document.querySelector(selectors.canvasBackgroundInput),
      canvasGrid: document.querySelector(selectors.canvasGridInput),
      routeStyle: document.querySelector(selectors.routeStyleSelect),
      resetCanvasBackground: document.querySelector(selectors.resetCanvasBackgroundButton),
      form: document.querySelector(selectors.nodeInspector),
      selectionSummary: document.querySelector(selectors.selectionSummary),
      label: document.querySelector(selectors.nodeLabelInput),
      width: document.querySelector(selectors.nodeWidthInput),
      height: document.querySelector(selectors.nodeHeightInput),
      fontSize: document.querySelector(selectors.nodeFontSizeInput),
      fontBold: document.querySelector(selectors.nodeFontBoldInput),
      fontItalic: document.querySelector(selectors.nodeFontItalicInput),
      fontUnderline: document.querySelector(selectors.nodeFontUnderlineInput),
      fontStrike: document.querySelector(selectors.nodeFontStrikeInput),
      textAlign: document.querySelector(selectors.nodeTextAlignSelect),
      textVAlign: document.querySelector(selectors.nodeTextVAlignSelect),
      imageCrop: document.querySelector(selectors.nodeImageCropInput),
      imageCropWrap: document.querySelector(selectors.nodeImageCropWrap),
      imageZoom: document.querySelector(selectors.nodeImageZoomInput),
      imageZoomWrap: document.querySelector(selectors.nodeImageZoomWrap),
      imageOffsetX: document.querySelector(selectors.nodeImageOffsetXInput),
      imageOffsetXWrap: document.querySelector(selectors.nodeImageOffsetXWrap),
      imageOffsetY: document.querySelector(selectors.nodeImageOffsetYInput),
      imageOffsetYWrap: document.querySelector(selectors.nodeImageOffsetYWrap),
      fill: document.querySelector(selectors.nodeFillInput),
      stroke: document.querySelector(selectors.nodeStrokeInput),
      fillPalette: document.querySelector(selectors.nodeFillPalette),
      strokePalette: document.querySelector(selectors.nodeStrokePalette),
      fillHistory: document.querySelector(selectors.nodeFillHistory),
      strokeHistory: document.querySelector(selectors.nodeStrokeHistory),
      shapeCss: document.querySelector(selectors.nodeShapeCssInput),
      lock: document.querySelector(selectors.toggleNodeLockButton),
      link: document.querySelector(selectors.startLinkButton),
      addToLibrary: document.querySelector(selectors.addSelectedToLibraryButton),
      subschema: document.querySelector(selectors.openSubschemaButton),
      deleteNode: document.querySelector(selectors.deleteNodeButton),
      linkInspector: document.querySelector(selectors.linkInspector),
      linkSource: document.querySelector(selectors.linkSourceLabel),
      linkDirection: document.querySelector(selectors.linkDirection),
      linkTarget: document.querySelector(selectors.linkTargetLabel),
      linkColor: document.querySelector(selectors.linkColorInput),
      linkWidth: document.querySelector(selectors.linkWidthInput),
      linkDashed: document.querySelector(selectors.linkDashedInput),
      linkStartMarker: document.querySelector(selectors.linkStartMarkerSelect),
      linkEndMarker: document.querySelector(selectors.linkEndMarkerSelect),
      deleteLink: document.querySelector(selectors.deleteLinkButton)
    };

    this.inspector.form.addEventListener("submit", event => event.preventDefault());
    this.populateLinkMarkerOptions();
    this.bindCanvasBackgroundControl();
    this.bindRouteStyleControl();
    this.inspector.label.addEventListener("input", event => this.updateSelectedNode("label", event.target.value));
    this.inspector.width.addEventListener("input", event => this.updateSelectedNode("width", Number(event.target.value)));
    this.inspector.height.addEventListener("input", event => this.updateSelectedNode("height", Number(event.target.value)));
    this.inspector.width.addEventListener("wheel", event => event.preventDefault(), { passive: false });
    this.inspector.height.addEventListener("wheel", event => event.preventDefault(), { passive: false });
    this.inspector.fontSize.addEventListener("input", event => this.updateSelectedNode("fontSize", Number(event.target.value)));
    this.inspector.fontBold.addEventListener("change", event => this.updateSelectedNode("fontBold", event.target.checked));
    this.inspector.fontItalic.addEventListener("change", event => this.updateSelectedNode("fontItalic", event.target.checked));
    this.inspector.fontUnderline.addEventListener("change", event => this.updateSelectedNode("fontUnderline", event.target.checked));
    this.inspector.fontStrike.addEventListener("change", event => this.updateSelectedNode("fontStrike", event.target.checked));
    this.inspector.textAlign.addEventListener("change", event => this.updateSelectedNode("textAlign", event.target.value));
    this.inspector.textVAlign.addEventListener("change", event => this.updateSelectedNode("textVAlign", event.target.value));
    this.inspector.imageCrop.addEventListener("change", event => {
      this.updateSelectedNode("imageCrop", event.target.checked);
      this.refreshInspector();
    });
    this.inspector.imageZoom.addEventListener("input", event => this.updateSelectedNode("imageZoom", Number(event.target.value)));
    this.inspector.imageOffsetX.addEventListener("input", event => this.updateSelectedNode("imageOffsetX", Number(event.target.value)));
    this.inspector.imageOffsetY.addEventListener("input", event => this.updateSelectedNode("imageOffsetY", Number(event.target.value)));
    this.inspector.fill.addEventListener("input", event => this.updateSelectedNode("fill", event.target.value));
    this.inspector.stroke.addEventListener("input", event => this.updateSelectedNode("stroke", event.target.value));
    this.inspector.fill.addEventListener("change", event => {
      this.updateSelectedNode("fill", event.target.value);
      this.rememberCustomColor("fill", event.target.value);
    });
    this.inspector.stroke.addEventListener("change", event => {
      this.updateSelectedNode("stroke", event.target.value);
      this.rememberCustomColor("stroke", event.target.value);
    });
    this.inspector.shapeCss.addEventListener("input", event => {
      this.updateSelectedNode("customCss", event.target.value);
    });
    this.inspector.lock.addEventListener("click", () => {
      this.toggleSelectedNodesLock();
    });
    this.inspector.link.addEventListener("click", () => this.startRelationFromSelected());
    this.inspector.addToLibrary.addEventListener("click", () => this.addSelectedNodeToLibrary());
    this.inspector.subschema.addEventListener("click", () => this.openOrCreateSelectedSubschema());
    this.inspector.deleteNode.addEventListener("click", () => this.deleteSelectedNode());
    this.inspector.deleteLink.addEventListener("click", () => this.deleteSelectedLink());
    this.inspector.linkColor.addEventListener("input", event => this.updateSelectedLink("color", event.target.value));
    this.inspector.linkWidth.addEventListener("input", event => this.updateSelectedLink("width", Number(event.target.value)));
    this.inspector.linkDashed.addEventListener("change", event => this.updateSelectedLink("dashed", event.target.checked));
    this.inspector.linkStartMarker.addEventListener("change", event => this.updateSelectedLink("startMarker", event.target.value));
    this.inspector.linkEndMarker.addEventListener("change", event => this.updateSelectedLink("endMarker", event.target.value));
    this.renderColorTools();
  },

  bindMiddleMousePan() {
    const svgNode = this.svg.node();
    if (!svgNode) return;

    svgNode.addEventListener("mousedown", event => {
      if (event.button !== 1) return;
      event.preventDefault();
      this.middlePanActive = true;
      this.svg.classed("mode-middle-pan", true);
    });

    window.addEventListener("mouseup", event => {
      if (event.button !== 1) return;
      this.middlePanActive = false;
      this.svg.classed("mode-middle-pan", false);
    });

    window.addEventListener("blur", () => {
      this.middlePanActive = false;
      this.svg.classed("mode-middle-pan", false);
    });
  },

  populateLinkMarkerOptions() {
    const markerTypes = this.config.link.markerTypes;
    [this.inspector.linkStartMarker, this.inspector.linkEndMarker].forEach(select => {
      if (!select) return;

      select.innerHTML = "";
      Object.entries(markerTypes).forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      });
    });
  },

  bindCanvasBackgroundControl() {
    if (!this.inspector.canvasBackground) return;

    const storedColor = this.normalizeHexColor(this.readStorageValue(this.config.colors.storageKeys.canvasBackground));
    const initialColor = storedColor || this.config.colors.canvasDefaultBackground;
    const storedGrid = this.readStorageValue(this.config.colors.storageKeys.canvasGridEnabled);
    const gridEnabled = storedGrid === null ? true : storedGrid === "true";

    this.inspector.canvasBackground.value = initialColor;
    if (this.inspector.canvasGrid) this.inspector.canvasGrid.checked = gridEnabled;
    this.applyCanvasBackground(initialColor, gridEnabled);
    this.inspector.canvasBackground.addEventListener("input", event => {
      this.applyCanvasBackground(event.target.value, this.isCanvasGridEnabled());
    });
    this.inspector.canvasBackground.addEventListener("change", event => {
      const color = this.normalizeHexColor(event.target.value);
      if (!color) return;
      this.writeStorageValue(this.config.colors.storageKeys.canvasBackground, color);
    });

    if (this.inspector.canvasGrid) {
      this.inspector.canvasGrid.addEventListener("change", event => {
        this.applyCanvasBackground(this.inspector.canvasBackground.value, event.target.checked);
        this.writeStorageValue(this.config.colors.storageKeys.canvasGridEnabled, String(event.target.checked));
      });
    }

    if (this.inspector.resetCanvasBackground) {
      this.inspector.resetCanvasBackground.addEventListener("click", () => this.resetCanvasBackground());
    }
  },

  bindRouteStyleControl() {
    if (!this.inspector.routeStyle) return;

    const storedRouteStyle = this.readStorageValue(this.config.colors.storageKeys.routeStyle);
    const initialRouteStyle = storedRouteStyle || this.config.router.routeStyle || "straight";

    this.setRouteStyle(initialRouteStyle, { persist: false, render: false });
    this.inspector.routeStyle.value = this.config.router.routeStyle;
    this.inspector.routeStyle.addEventListener("change", event => {
      this.setRouteStyle(event.target.value);
    });
  },

  setRouteStyle(routeStyle, options = {}) {
    const nextRouteStyle = routeStyle === "orthogonal" ? "orthogonal" : "straight";

    this.config.router.routeStyle = nextRouteStyle;
    if (this.inspector.routeStyle) this.inspector.routeStyle.value = nextRouteStyle;
    if (options.persist !== false) {
      this.writeStorageValue(this.config.colors.storageKeys.routeStyle, nextRouteStyle);
    }
    if (options.render !== false) {
      this.store.links.forEach(link => {
        if (nextRouteStyle === "straight") delete link.manualPoints;
      });
      this.renderLinks({ skipRoutingPressure: true, ignoreManualRoutes: nextRouteStyle === "straight" });
    }
  },

  isCanvasGridEnabled() {
    return !this.inspector.canvasGrid || this.inspector.canvasGrid.checked;
  },

  resetCanvasBackground() {
    const defaultColor = this.config.colors.canvasDefaultBackground;

    this.inspector.canvasBackground.value = defaultColor;
    if (this.inspector.canvasGrid) this.inspector.canvasGrid.checked = true;
    this.applyCanvasBackground(defaultColor, true);
    this.writeStorageValue(this.config.colors.storageKeys.canvasBackground, defaultColor);
    this.writeStorageValue(this.config.colors.storageKeys.canvasGridEnabled, "true");
  },

  applyCanvasBackground(color, gridEnabled = true) {
    const normalizedColor = this.normalizeHexColor(color);
    if (!normalizedColor) return;

    const gridColor = this.gridColorForBackground(normalizedColor);
    this.svg.node().style.background = gridEnabled
      ? [
        `linear-gradient(${gridColor} 1px, transparent 1px)`,
        `linear-gradient(90deg, ${gridColor} 1px, transparent 1px)`,
        normalizedColor
      ].join(", ")
      : normalizedColor;
    this.svg.node().style.backgroundSize = gridEnabled ? "24px 24px" : "auto";
  },

  gridColorForBackground(color) {
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

    return luminance > 0.55
      ? "rgba(100, 116, 139, 0.24)"
      : "rgba(255, 255, 255, 0.16)";
  },

  loadColorHistories() {
    return {
      fill: this.loadColorHistory("fill"),
      stroke: this.loadColorHistory("stroke")
    };
  },

  loadColorHistory(target) {
    const key = this.config.colors.storageKeys[target];
    const rawValue = this.readStorageValue(key);

    if (!rawValue) return [];

    try {
      const colors = JSON.parse(rawValue);
      if (!Array.isArray(colors)) return [];
      return colors
        .map(color => this.normalizeHexColor(color))
        .filter(Boolean)
        .slice(0, this.config.colors.historyLimit);
    } catch (error) {
      return [];
    }
  },

  readStorageValue(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  },

  writeStorageValue(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // Storage can be unavailable in some privacy modes; the UI still works in memory.
    }
  },

  renderColorTools() {
    this.renderColorPalette("fill");
    this.renderColorPalette("stroke");
    this.renderColorHistory("fill");
    this.renderColorHistory("stroke");
    this.refreshColorToolState();
  },

  renderColorPalette(target) {
    const container = this.inspector[`${target}Palette`];
    if (!container) return;

    container.innerHTML = "";
    this.config.colors.palette.forEach(color => {
      container.appendChild(this.createColorButton(color, "Palette", () => this.applyInspectorColor(target, color)));
    });
  },

  renderColorHistory(target) {
    const container = this.inspector[`${target}History`];
    if (!container) return;

    container.innerHTML = "";
    const colors = this.customColorHistory[target];
    const slots = Math.max(colors.length, this.config.colors.historyLimit);

    for (let index = 0; index < slots; index += 1) {
      const color = colors[index];
      if (color) {
        container.appendChild(this.createColorButton(color, "Historique", () => this.applyInspectorColor(target, color)));
      } else {
        const slot = document.createElement("span");
        slot.className = "color-sample empty";
        container.appendChild(slot);
      }
    }
  },

  createColorButton(color, label, onClick) {
    const button = document.createElement("button");
    button.className = "color-sample";
    button.type = "button";
    button.title = `${label} ${color}`;
    button.setAttribute("aria-label", `${label} ${color}`);
    button.style.setProperty("--sample-color", color);
    button.addEventListener("click", onClick);
    return button;
  },

  applyInspectorColor(target, color) {
    if (!this.selectedNodes.size) return;

    const normalizedColor = this.normalizeHexColor(color);
    if (!normalizedColor) return;

    const input = this.inspector[target];
    input.value = normalizedColor;
    this.updateSelectedNode(target, normalizedColor);
    this.refreshColorToolState();
  },

  rememberCustomColor(target, color) {
    const normalizedColor = this.normalizeHexColor(color);
    if (!normalizedColor) return;

    const limit = this.config.colors.historyLimit;
    this.customColorHistory[target] = [
      normalizedColor,
      ...this.customColorHistory[target].filter(existingColor => existingColor !== normalizedColor)
    ].slice(0, limit);

    this.writeStorageValue(
      this.config.colors.storageKeys[target],
      JSON.stringify(this.customColorHistory[target])
    );
    this.renderColorHistory(target);
    this.refreshColorToolState();
  },

  normalizeHexColor(color) {
    if (typeof color !== "string") return null;

    const trimmed = color.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
    if (/^#[0-9a-f]{3}$/.test(trimmed)) {
      return `#${trimmed.slice(1).split("").map(character => character + character).join("")}`;
    }

    return null;
  },

  refreshColorToolState() {
    const selectedNodes = [...this.selectedNodes];
    const activeFill = selectedNodes.length
      ? this.commonValue(selectedNodes, node => this.normalizeHexColor(node.fill))
      : null;
    const activeStroke = selectedNodes.length
      ? this.commonValue(selectedNodes, node => this.normalizeHexColor(node.stroke))
      : null;

    this.markActiveColorButtons(this.inspector.fillPalette, activeFill);
    this.markActiveColorButtons(this.inspector.fillHistory, activeFill);
    this.markActiveColorButtons(this.inspector.strokePalette, activeStroke);
    this.markActiveColorButtons(this.inspector.strokeHistory, activeStroke);
  },

  markActiveColorButtons(container, activeColor) {
    if (!container) return;

    container.querySelectorAll(".color-sample").forEach(button => {
      button.classList.toggle("active", Boolean(activeColor) && button.style.getPropertyValue("--sample-color") === activeColor);
    });
  },

  bindKeyboard() {
    window.addEventListener("keydown", event => {
      if (this.isEditingText(event.target)) return;
      const hasModifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (hasModifier && key === "c") {
        if (!this.selectedNodes.size) return;
        event.preventDefault();
        this.copySelectionToClipboard();
        return;
      }

      if (hasModifier && key === "x") {
        if (!this.selectedNodes.size) return;
        event.preventDefault();
        this.cutSelectionToClipboard();
        return;
      }

      if (hasModifier && key === "v") {
        if (!this.clipboard || !this.clipboard.nodes.length) return;
        event.preventDefault();
        this.pasteClipboardSelection();
        return;
      }

      if (hasModifier && key === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          if (this.pageController && this.pageController.redo) this.pageController.redo();
        } else {
          if (this.pageController && this.pageController.undo) this.pageController.undo();
        }
        return;
      }

      if (hasModifier && key === "y") {
        event.preventDefault();
        if (this.pageController && this.pageController.redo) this.pageController.redo();
        return;
      }

      if (!["Delete", "Backspace"].includes(event.key)) return;

      if (this.hasSelection()) {
        event.preventDefault();
        this.deleteSelection();
      }
    });
  },

  copySelectionToClipboard() {
    const nodes = [...this.selectedNodes];
    if (!nodes.length) return;

    const copiedNodeIds = new Set(nodes.map(node => node.id));
    const links = this.store.links.filter(link => copiedNodeIds.has(link.source.id) && copiedNodeIds.has(link.target.id));
    this.clipboard = {
      nodes: nodes.map(node => ({
        id: node.id,
        type: node.type,
        label: node.label,
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
        imageCrop: node.imageCrop !== false,
        imageZoom: Number(node.imageZoom) || 1,
        imageOffsetX: Number(node.imageOffsetX) || 0,
        imageOffsetY: Number(node.imageOffsetY) || 0,
        imageAspect: Number(node.imageAspect) || undefined,
        imageNaturalWidth: Number(node.imageNaturalWidth) || undefined,
        imageNaturalHeight: Number(node.imageNaturalHeight) || undefined,
        imageBaseWidth: Number(node.imageBaseWidth) || undefined,
        imageBaseHeight: Number(node.imageBaseHeight) || undefined,
        imageHref: node.imageHref || "",
        svgText: node.svgText || "",
        customCss: node.customCss || ""
      })),
      links: links.map(link => ({
        sourceId: link.source.id,
        targetId: link.target.id,
        color: link.color,
        width: link.width,
        dashed: Boolean(link.dashed),
        startMarker: link.startMarker || "none",
        endMarker: link.endMarker || "none"
      }))
    };
    this.pasteSequence = 0;
  },

  cutSelectionToClipboard() {
    this.copySelectionToClipboard();
    this.deleteSelection();
  },

  pasteClipboardSelection() {
    if (!this.clipboard || !this.clipboard.nodes.length) return;
    if (this.pageController && this.pageController.checkpoint) this.pageController.checkpoint();

    const sourceNodes = this.clipboard.nodes;
    const sourceBounds = {
      left: Math.min(...sourceNodes.map(node => node.x)),
      right: Math.max(...sourceNodes.map(node => node.x)),
      top: Math.min(...sourceNodes.map(node => node.y)),
      bottom: Math.max(...sourceNodes.map(node => node.y))
    };
    const sourceCenter = {
      x: (sourceBounds.left + sourceBounds.right) / 2,
      y: (sourceBounds.top + sourceBounds.bottom) / 2
    };
    const viewCenter = this.viewportCenter();
    const step = 28 * (this.pasteSequence + 1);
    const offset = {
      x: viewCenter.x - sourceCenter.x + step,
      y: viewCenter.y - sourceCenter.y + step
    };
    const nodeBySourceId = new Map();
    const createdNodes = [];

    sourceNodes.forEach(sourceNode => {
      const node = this.store.createNode(sourceNode.type, {
        x: sourceNode.x + offset.x,
        y: sourceNode.y + offset.y
      });
      node.label = sourceNode.label;
      node.shape = sourceNode.shape;
      node.width = sourceNode.width;
      node.height = sourceNode.height;
      node.fontSize = sourceNode.fontSize;
      node.fontBold = Boolean(sourceNode.fontBold);
      node.fontItalic = Boolean(sourceNode.fontItalic);
      node.fontUnderline = Boolean(sourceNode.fontUnderline);
      node.fontStrike = Boolean(sourceNode.fontStrike);
      node.textAlign = sourceNode.textAlign || "center";
      node.textVAlign = sourceNode.textVAlign || "middle";
      node.fill = sourceNode.fill;
      node.stroke = sourceNode.stroke;
      node.imageCrop = sourceNode.imageCrop !== false;
      node.imageZoom = Number(sourceNode.imageZoom) || 1;
      node.imageOffsetX = Number(sourceNode.imageOffsetX) || 0;
      node.imageOffsetY = Number(sourceNode.imageOffsetY) || 0;
      node.imageAspect = Number(sourceNode.imageAspect) || node.imageAspect;
      node.imageNaturalWidth = Number(sourceNode.imageNaturalWidth) || node.imageNaturalWidth;
      node.imageNaturalHeight = Number(sourceNode.imageNaturalHeight) || node.imageNaturalHeight;
      node.imageBaseWidth = Number(sourceNode.imageBaseWidth) || node.imageBaseWidth;
      node.imageBaseHeight = Number(sourceNode.imageBaseHeight) || node.imageBaseHeight;
      node.imageHref = sourceNode.imageHref || "";
      node.svgText = sourceNode.svgText || "";
      node.customCss = sourceNode.customCss || "";
      node.locked = false;
      node.fx = null;
      node.fy = null;
      nodeBySourceId.set(sourceNode.id, node);
      createdNodes.push(node);
    });

    const createdLinks = [];
    this.clipboard.links.forEach(sourceLink => {
      const sourceNode = nodeBySourceId.get(sourceLink.sourceId);
      const targetNode = nodeBySourceId.get(sourceLink.targetId);
      if (!sourceNode || !targetNode) return;
      const link = this.store.createLink(sourceNode, targetNode);
      if (!link) return;
      link.color = sourceLink.color;
      link.width = sourceLink.width;
      link.dashed = sourceLink.dashed;
      link.startMarker = sourceLink.startMarker;
      link.endMarker = sourceLink.endMarker;
      createdLinks.push(link);
    });

    this.pasteSequence += 1;
    this.syncGraph();
    this.setSelection(createdNodes, createdLinks);
    this.simulation.alpha(0.75).restart();
  },

  isEditingText(target) {
    return target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;
  },

  addSelectedNodeToLibrary() {
    if (!this.selectedNode) return;
    const node = this.selectedNode;
    const baseLabel = (node.label || "Forme").trim();
    const label = `${baseLabel} style`;
    const shapeType = this.uniqueShapeType(label);
    const shapeConfig = {
      label,
      shape: node.shape || "roundedRect",
      width: this.nodeWidth(node),
      height: this.nodeHeight(node),
      fill: node.fill,
      stroke: node.stroke,
      fontSize: this.nodeFontSize(node),
      fontBold: Boolean(node.fontBold),
      fontItalic: Boolean(node.fontItalic),
      fontUnderline: Boolean(node.fontUnderline),
      fontStrike: Boolean(node.fontStrike),
      textAlign: node.textAlign || "center",
      textVAlign: node.textVAlign || "middle",
      customCss: node.customCss || "",
      imageCrop: node.imageCrop !== false,
      imageZoom: Number(node.imageZoom) || 1,
      imageOffsetX: Number(node.imageOffsetX) || 0,
      imageOffsetY: Number(node.imageOffsetY) || 0,
      imageAspect: Number(node.imageAspect) || undefined,
      imageNaturalWidth: Number(node.imageNaturalWidth) || undefined,
      imageNaturalHeight: Number(node.imageNaturalHeight) || undefined,
      imageBaseWidth: Number(node.imageBaseWidth) || undefined,
      imageBaseHeight: Number(node.imageBaseHeight) || undefined
    };
    if (node.imageHref) shapeConfig.imageHref = node.imageHref;
    if (node.svgText) shapeConfig.svgText = node.svgText;
    this.config.node.shapeTypes[shapeType] = shapeConfig;
    const previewHref = node.imageHref || "";
    this.appendCustomShapePaletteItem(shapeType, label, previewHref, shapeConfig.shape);
  }

});
