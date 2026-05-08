class DiagramApp {
  constructor(config, initialGraph) {
    this.config = config;
    this.store = new GraphStore(initialGraph, config);
    this.router = new OrthogonalRouter(config.node, config.router);
    this.renderer = new DiagramRenderer(config, this.store, this.router);
    this.pages = new Map();
    this.activePageId = "page-main";
    this.nextPageIndex = 1;
    this.history = [];
    this.historyIndex = -1;
    this.initializePages(initialGraph);
  }

  start() {
    this.activatePageGraph(this.activePageId);
    this.renderer.mount();
    this.renderer.setPageController({
      openOrCreateForNode: node => this.openOrCreateSubschemaForNode(node),
      openSubschema: node => this.openNodeSubschema(node),
      checkpoint: () => this.checkpoint(),
      undo: () => this.undo(),
      redo: () => this.redo(),
      confirmDeleteNodes: nodes => this.confirmDeleteNodes(nodes),
      removeSubschemasForNodes: nodes => this.removeSubschemasForNodes(nodes)
    });
    this.bindCommands();
    this.bindPageNavigation();
    this.renderPageTabs();
    this.renderer.fitViewSoon();
    this.checkpoint();
  }

  bindCommands() {
    document
      .querySelector(this.config.selectors.resetLayoutButton)
      .addEventListener("click", () => this.renderer.resetLayout());

    document
      .querySelector(this.config.selectors.fitViewButton)
      .addEventListener("click", () => this.renderer.fitView());

    document
      .querySelector(this.config.selectors.exportGraphButton)
      .addEventListener("click", () => this.exportProjectJson());

    const importInput = document.querySelector(this.config.selectors.importGraphInput);
    document
      .querySelector(this.config.selectors.importGraphButton)
      .addEventListener("click", () => this.triggerProjectImport(importInput));

    importInput.addEventListener("change", event => {
      this.importProjectFile(event.target.files[0]);
    });

    document
      .querySelector(this.config.selectors.exportImageButton)
      .addEventListener("click", () => this.renderer.exportImage());

    window.addEventListener("resize", () => this.renderer.fitView());
  }

  exportProjectJson() {
    this.saveActivePageGraph();
    const payload = {
      version: 2,
      kind: "multi-page-graph",
      exportedAt: new Date().toISOString(),
      activePageId: this.activePageId,
      nextPageIndex: this.nextPageIndex,
      pages: [...this.pages.values()].map(page => ({
        id: page.id,
        name: page.name,
        parentPageId: page.parentPageId,
        parentNodeId: page.parentNodeId,
        visited: Boolean(page.visited),
        graph: page.graph
      }))
    };

    this.renderer.downloadTextFile(
      `schema-${this.renderer.timestampForFileName()}.json`,
      JSON.stringify(payload, null, 2),
      "application/json"
    );
  }

  triggerProjectImport(input) {
    if (!input) return;
    input.value = "";
    input.click();
  }

  importProjectFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        this.importProjectJson(String(reader.result || ""));
      } catch (error) {
        window.alert("Impossible d'importer ce fichier JSON.");
        console.error(error);
      }
    });
    reader.readAsText(file);
  }

  importProjectJson(jsonText) {
    const data = JSON.parse(jsonText);
    if (data && data.kind === "multi-page-graph" && Array.isArray(data.pages)) {
      this.importMultiPageData(data);
      return;
    }

    // Backward compatibility: legacy single-page graph payload.
    this.pages.clear();
    this.pages.set("page-main", {
      id: "page-main",
      name: "Principale",
      parentPageId: null,
      parentNodeId: null,
      graph: data,
      visited: true
    });
    this.activePageId = "page-main";
    this.nextPageIndex = 1;
    this.renderer.importGraphData(data);
    this.renderPageTabs();
    this.checkpoint();
  }

  importMultiPageData(data) {
    this.pages.clear();
    data.pages.forEach(page => {
      if (!page || !page.id || !page.graph) return;
      this.pages.set(page.id, {
        id: page.id,
        name: page.name || "Sous-schema",
        parentPageId: page.parentPageId || null,
        parentNodeId: page.parentNodeId || null,
        visited: Boolean(page.visited),
        graph: page.graph
      });
    });
    this.reconcileSubschemaLinks();

    if (!this.pages.has("page-main")) {
      this.pages.set("page-main", {
        id: "page-main",
        name: "Principale",
        parentPageId: null,
        parentNodeId: null,
        visited: true,
        graph: { nodes: [], links: [] }
      });
    }

    this.activePageId = this.pages.has(data.activePageId) ? data.activePageId : "page-main";
    this.nextPageIndex = Number.isFinite(Number(data.nextPageIndex))
      ? Math.max(1, Number(data.nextPageIndex))
      : this.deriveNextPageIndex();

    this.renderer.resetTransientInteractionState();
    this.activatePageGraph(this.activePageId);
    this.renderer.clearSelection();
    this.renderer.syncGraph();
    this.renderPageTabs();
    this.renderer.fitViewSoon();
    this.checkpoint();
  }

  reconcileSubschemaLinks() {
    this.pages.forEach(page => {
      if (!page.parentPageId || !page.parentNodeId) return;
      const parentPage = this.pages.get(page.parentPageId);
      if (!parentPage || !parentPage.graph || !Array.isArray(parentPage.graph.nodes)) return;

      const parentNode = parentPage.graph.nodes.find(node => node.id === page.parentNodeId);
      if (!parentNode) return;
      parentNode.subPageId = page.id;
    });
  }

  deriveNextPageIndex() {
    return [...this.pages.keys()].reduce((highest, pageId) => {
      const match = String(pageId).match(/^page-(\d+)$/);
      return match ? Math.max(highest, Number(match[1]) + 1) : highest;
    }, 1);
  }

  initializePages(initialGraph) {
    this.pages.set("page-main", {
      id: "page-main",
      name: "Principale",
      parentPageId: null,
      parentNodeId: null,
      graph: this.cloneGraph(initialGraph),
      visited: true
    });
  }

  cloneGraph(graph) {
    return JSON.parse(JSON.stringify({
      nodes: graph.nodes || [],
      links: graph.links || []
    }));
  }

  currentPage() {
    return this.pages.get(this.activePageId);
  }

  saveActivePageGraph() {
    const page = this.currentPage();
    if (!page) return;

    page.graph = this.renderer.serializeGraph();
  }

  activatePageGraph(pageId) {
    const page = this.pages.get(pageId);
    if (!page) return;

    const graph = page.graph || { nodes: [], links: [] };
    if (Array.isArray(graph.customShapes)) this.renderer.importCustomShapeTypes(graph.customShapes);
    if (graph.canvas) this.renderer.importCanvasSettings(graph.canvas);
    this.store.nodes = (graph.nodes || []).map(node => this.store.normalizeNode({ ...node }));
    this.store.nodes.forEach(node => {
      node.locked = Boolean(node.locked);
      if (node.locked) {
        node.fx = node.x;
        node.fy = node.y;
      } else {
        node.fx = null;
        node.fy = null;
      }
    });
    this.store.links = (graph.links || []).map(link => this.store.normalizeLink({ ...link }));
    this.store.nextNodeIndex = this.nextIndexFromIds(this.store.nodes, "node");
    this.store.nextLinkIndex = this.nextIndexFromIds(this.store.links, "link");
    this.store.resolveLinks();
    this.renderer.restoreTextAttachments(graph.nodes || []);
  }

  nextIndexFromIds(items, prefix) {
    return items.reduce((highest, item) => {
      const match = String(item.id || "").match(new RegExp(`^${prefix}-(\\d+)$`));
      return match ? Math.max(highest, Number(match[1]) + 1) : highest;
    }, 1);
  }

  bindPageNavigation() {
    const backButton = document.querySelector(this.config.selectors.pageBackButton);
    if (backButton) {
      backButton.addEventListener("click", () => this.goBackPage());
    }
  }

  openOrCreateSubschemaForNode(node) {
    if (!node) return;

    if (!node.subPageId) {
      this.checkpoint();
      const newPageId = `page-${this.nextPageIndex}`;
      this.nextPageIndex += 1;
      node.subPageId = newPageId;
      this.pages.set(newPageId, {
        id: newPageId,
        name: node.label || "Sous-schema",
        parentPageId: this.activePageId,
        parentNodeId: node.id,
        graph: { nodes: [], links: [] },
        visited: false
      });
      this.renderer.syncGraph();
      this.renderer.refreshInspector();
    }

    this.openPage(node.subPageId);
  }

  openNodeSubschema(node) {
    if (!node || !node.subPageId) return;
    this.openPage(node.subPageId);
  }

  openPage(pageId) {
    if (!this.pages.has(pageId) || this.activePageId === pageId) return;

    this.saveActivePageGraph();
    this.renderer.resetTransientInteractionState();
    this.activePageId = pageId;
    this.activatePageGraph(pageId);
    this.renderer.clearSelection();
    this.renderer.syncGraph();

    const page = this.currentPage();
    if (page && !page.visited) {
      page.visited = true;
      this.renderer.fitViewSoon();
    }

    this.renderPageTabs();
  }

  goBackPage() {
    const page = this.currentPage();
    if (!page || !page.parentPageId) return;
    this.openPage(page.parentPageId);
  }

  pageLineage() {
    const lineage = [];
    let cursor = this.currentPage();

    while (cursor) {
      lineage.push(cursor);
      cursor = cursor.parentPageId ? this.pages.get(cursor.parentPageId) : null;
    }

    return lineage.reverse();
  }

  serializeProjectState() {
    this.saveActivePageGraph();
    return {
      activePageId: this.activePageId,
      nextPageIndex: this.nextPageIndex,
      pages: [...this.pages.values()].map(page => ({
        id: page.id,
        name: page.name,
        parentPageId: page.parentPageId,
        parentNodeId: page.parentNodeId,
        visited: Boolean(page.visited),
        graph: JSON.parse(JSON.stringify(page.graph || { nodes: [], links: [] }))
      }))
    };
  }

  applyProjectState(state) {
    if (!state || !Array.isArray(state.pages)) return;

    this.pages.clear();
    state.pages.forEach(page => {
      if (!page || !page.id) return;
      this.pages.set(page.id, {
        id: page.id,
        name: page.name || "Sous-schema",
        parentPageId: page.parentPageId || null,
        parentNodeId: page.parentNodeId || null,
        visited: Boolean(page.visited),
        graph: JSON.parse(JSON.stringify(page.graph || { nodes: [], links: [] }))
      });
    });
    this.reconcileSubschemaLinks();
    if (!this.pages.has("page-main")) {
      this.pages.set("page-main", {
        id: "page-main",
        name: "Principale",
        parentPageId: null,
        parentNodeId: null,
        visited: true,
        graph: { nodes: [], links: [] }
      });
    }
    this.activePageId = this.pages.has(state.activePageId) ? state.activePageId : "page-main";
    this.nextPageIndex = Math.max(1, Number(state.nextPageIndex) || this.deriveNextPageIndex());
    this.renderer.resetTransientInteractionState();
    this.activatePageGraph(this.activePageId);
    this.renderer.clearSelection();
    this.renderer.syncGraph();
    this.renderPageTabs();
  }

  checkpoint() {
    const state = this.serializeProjectState();
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(state);
    if (this.history.length > 120) this.history.shift();
    this.historyIndex = this.history.length - 1;
  }

  undo() {
    if (this.historyIndex <= 0) return;
    this.historyIndex -= 1;
    this.applyProjectState(this.history[this.historyIndex]);
  }

  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    this.historyIndex += 1;
    this.applyProjectState(this.history[this.historyIndex]);
  }

  collectSubschemaDependencyInfoForNodes(nodes) {
    const pageIds = new Set();
    const pageNames = [];
    const walk = pageId => {
      if (!pageId || pageIds.has(pageId) || !this.pages.has(pageId)) return;
      pageIds.add(pageId);
      const page = this.pages.get(pageId);
      pageNames.push(page.name || page.id);
      this.pages.forEach(candidate => {
        if (candidate.parentPageId === pageId) walk(candidate.id);
      });
    };

    (nodes || []).forEach(node => {
      if (node && node.subPageId) walk(node.subPageId);
    });
    return { pageIds, pageNames };
  }

  confirmDeleteNodes(nodes) {
    const deps = this.collectSubschemaDependencyInfoForNodes(nodes);
    if (!deps.pageIds.size) return true;
    const preview = deps.pageNames.slice(0, 8).join(", ");
    const extra = deps.pageNames.length > 8 ? ` (+${deps.pageNames.length - 8} autres)` : "";
    return window.confirm(
      `Cette suppression va aussi supprimer ${deps.pageIds.size} sous-schema(s): ${preview}${extra}. Continuer ?`
    );
  }

  removeSubschemasForNodes(nodes) {
    const deps = this.collectSubschemaDependencyInfoForNodes(nodes);
    if (!deps.pageIds.size) return;

    deps.pageIds.forEach(pageId => {
      if (pageId !== "page-main") this.pages.delete(pageId);
    });
    if (!this.pages.has(this.activePageId)) this.activePageId = "page-main";

    this.pages.forEach(page => {
      const graph = page.graph;
      if (!graph || !Array.isArray(graph.nodes)) return;
      graph.nodes.forEach(node => {
        if (node && node.subPageId && deps.pageIds.has(node.subPageId)) delete node.subPageId;
      });
    });
  }

  renderPageTabs() {
    const tabsRoot = document.querySelector(this.config.selectors.pageTabs);
    const backButton = document.querySelector(this.config.selectors.pageBackButton);
    if (!tabsRoot) return;

    tabsRoot.innerHTML = "";
    this.pageLineage().forEach(page => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `page-tab${page.id === this.activePageId ? " active" : ""}`;
      button.textContent = page.name || "Sous-schema";
      button.addEventListener("click", () => this.openPage(page.id));
      tabsRoot.appendChild(button);
    });

    if (backButton) backButton.disabled = !this.currentPage().parentPageId;
  }
}
