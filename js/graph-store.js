class GraphStore {
  constructor(graph, config) {
    this.config = config;
    this.nextNodeIndex = 1;
    this.nextLinkIndex = 1;
    this.nodes = graph.nodes.map(node => this.normalizeNode(node));
    this.links = graph.links.map(link => this.normalizeLink(link));
  }

  normalizeLink(link) {
    const normalized = {
      id: link.id || `link-${this.nextLinkIndex}`,
      ...this.config.link.defaults,
      ...link
    };

    this.nextLinkIndex += 1;
    return normalized;
  }

  normalizeNode(node) {
    const shapeConfig = this.config.node.shapeTypes[node.type] || this.config.node.shapeTypes.team;

    return {
      width: shapeConfig.width,
      height: shapeConfig.height,
      fill: shapeConfig.fill,
      stroke: shapeConfig.stroke,
      fontSize: shapeConfig.fontSize || this.config.node.defaults.fontSize,
      fontBold: Boolean(shapeConfig.fontBold || this.config.node.defaults.fontBold),
      fontItalic: Boolean(shapeConfig.fontItalic || this.config.node.defaults.fontItalic),
      fontUnderline: Boolean(shapeConfig.fontUnderline || this.config.node.defaults.fontUnderline),
      fontStrike: Boolean(shapeConfig.fontStrike || this.config.node.defaults.fontStrike),
      textAlign: shapeConfig.textAlign || this.config.node.defaults.textAlign,
      textVAlign: shapeConfig.textVAlign || this.config.node.defaults.textVAlign,
      shape: shapeConfig.shape,
      imageHref: shapeConfig.imageHref || "",
      imageCrop: shapeConfig.imageCrop !== false,
      imageZoom: Number(shapeConfig.imageZoom) || 1,
      imageOffsetX: Number(shapeConfig.imageOffsetX) || 0,
      imageOffsetY: Number(shapeConfig.imageOffsetY) || 0,
      imageAspect: Number(shapeConfig.imageAspect) || undefined,
      imageNaturalWidth: Number(shapeConfig.imageNaturalWidth) || undefined,
      imageNaturalHeight: Number(shapeConfig.imageNaturalHeight) || undefined,
      imageBaseWidth: Number(shapeConfig.imageBaseWidth) || undefined,
      imageBaseHeight: Number(shapeConfig.imageBaseHeight) || undefined,
      locked: false,
      ...node
    };
  }

  resolveLinks() {
    const nodeById = new Map(this.nodes.map(node => [node.id, node]));

    this.links.forEach(link => {
      if (typeof link.source === "string") link.source = nodeById.get(link.source);
      if (typeof link.target === "string") link.target = nodeById.get(link.target);
    });
  }

  createNode(type, position) {
    const shapeConfig = this.config.node.shapeTypes[type] || this.config.node.shapeTypes.team;
    const node = this.normalizeNode({
      id: `node-${this.nextNodeIndex}`,
      label: shapeConfig.label,
      type,
      x: position.x,
      y: position.y
    });

    this.nextNodeIndex += 1;
    this.nodes.push(node);
    return node;
  }

  createLink(source, target) {
    if (!source || !target || source === target) return null;

    const existing = this.links.find(link =>
      (link.source === source && link.target === target) ||
      (link.source === target && link.target === source)
    );

    if (existing) return existing;

    const link = {
      id: `link-${this.nextLinkIndex}`,
      source,
      target
    };

    this.nextLinkIndex += 1;
    this.links.push(link);
    return link;
  }

  deleteNode(node) {
    const parents = this.links
      .filter(link => link.target === node)
      .map(link => link.source);
    const children = this.links
      .filter(link => link.source === node)
      .map(link => link.target);

    this.nodes = this.nodes.filter(existingNode => existingNode !== node);
    this.links = this.links.filter(link => link.source !== node && link.target !== node);

    parents.forEach(parent => {
      children.forEach(child => {
        this.createLink(parent, child);
      });
    });
  }

  deleteNodes(nodes) {
    const selectedNodes = new Set(nodes);
    if (!selectedNodes.size) return;

    const parents = this.links
      .filter(link => selectedNodes.has(link.target) && !selectedNodes.has(link.source))
      .map(link => link.source);
    const children = this.links
      .filter(link => selectedNodes.has(link.source) && !selectedNodes.has(link.target))
      .map(link => link.target);

    this.nodes = this.nodes.filter(node => !selectedNodes.has(node));
    this.links = this.links.filter(link => !selectedNodes.has(link.source) && !selectedNodes.has(link.target));

    parents.forEach(parent => {
      children.forEach(child => {
        this.createLink(parent, child);
      });
    });
  }

  deleteLink(link) {
    this.links = this.links.filter(existingLink => existingLink !== link);
  }

  deleteLinks(links) {
    const selectedLinks = new Set(links);
    this.links = this.links.filter(link => !selectedLinks.has(link));
  }
}
