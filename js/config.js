const APP_CONFIG = {
  selectors: {
    canvas: "#canvas",
    selectToolButton: "#select-tool",
    panToolButton: "#pan-tool",
    resetLayoutButton: "#reset-layout",
    fitViewButton: "#fit-view",
    exportGraphButton: "#export-graph",
    importGraphButton: "#import-graph",
    importGraphInput: "#import-graph-input",
    exportImageButton: "#export-image",
    hideAthButton: "#hide-ath",
    showAthButton: "#show-ath",
    pageBackButton: "#page-back",
    pageTabs: "#page-tabs",
    zoomIndicator: "#zoom-indicator",
    zoomLabel: "#zoom-label",
    zoomSlider: "#zoom-slider",
    paletteItems: ".shape-palette-item",
    customShapeList: "#custom-shape-list",
    customShapeForm: "#custom-shape-form",
    customShapeNameInput: "#custom-shape-name",
    customShapeFileInput: "#custom-shape-file",
    emptyInspector: "#empty-inspector",
    canvasBackgroundInput: "#canvas-background",
    canvasGridInput: "#canvas-grid-enabled",
    routeStyleSelect: "#route-style",
    resetCanvasBackgroundButton: "#reset-canvas-background",
    selectionSummary: "#selection-summary",
    nodeInspector: "#node-inspector",
    nodeLabelInput: "#node-label",
    nodeWidthInput: "#node-width",
    nodeHeightInput: "#node-height",
    nodeFontSizeInput: "#node-font-size",
    nodeFontBoldInput: "#node-font-bold",
    nodeFontItalicInput: "#node-font-italic",
    nodeFontUnderlineInput: "#node-font-underline",
    nodeFontStrikeInput: "#node-font-strike",
    nodeTextAlignSelect: "#node-text-align",
    nodeTextVAlignSelect: "#node-text-valign",
    nodeImageCropInput: "#node-image-crop",
    nodeImageCropWrap: "#node-image-crop-wrap",
    nodeImageZoomInput: "#node-image-zoom",
    nodeImageZoomWrap: "#node-image-zoom-wrap",
    nodeImageOffsetXInput: "#node-image-offset-x",
    nodeImageOffsetXWrap: "#node-image-offset-x-wrap",
    nodeImageOffsetYInput: "#node-image-offset-y",
    nodeImageOffsetYWrap: "#node-image-offset-y-wrap",
    nodeFillInput: "#node-fill",
    nodeStrokeInput: "#node-stroke",
    nodeFillPalette: "#node-fill-palette",
    nodeStrokePalette: "#node-stroke-palette",
    nodeFillHistory: "#node-fill-history",
    nodeStrokeHistory: "#node-stroke-history",
    nodeShapeCssInput: "#node-shape-css",
    toggleNodeLockButton: "#toggle-node-lock",
    startLinkButton: "#start-link",
    addSelectedToLibraryButton: "#add-selected-to-library",
    openSubschemaButton: "#open-subschema",
    deleteNodeButton: "#delete-node",
    linkInspector: "#link-inspector",
    linkSourceLabel: "#link-source-label",
    linkDirection: "#link-direction",
    linkTargetLabel: "#link-target-label",
    linkColorInput: "#link-color",
    linkWidthInput: "#link-width",
    linkDashedInput: "#link-dashed",
    linkStartMarkerSelect: "#link-start-marker",
    linkEndMarkerSelect: "#link-end-marker",
    deleteLinkButton: "#delete-link"
  },
  link: {
    defaults: {
      color: "#556987",
      width: 2,
      dashed: false,
      startMarker: "none",
      endMarker: "none"
    },
    markerTypes: {
      none: "Aucun",
      arrow: "Fleche"
    }
  },
  node: {
    width: 150,
    height: 58,
    obstaclePadding: 18,
    defaults: {
      fill: "#ffffff",
      stroke: "#2f6fed",
      fontSize: 13,
      fontBold: false,
      fontItalic: false,
      fontUnderline: false,
      fontStrike: false,
      textAlign: "center",
      textVAlign: "middle"
    },
    shapeTypes: {
      team: {
        label: "Rectangle arrondi",
        shape: "roundedRect",
        width: 150,
        height: 58,
        fill: "#ffffff",
        stroke: "#2f6fed"
      },
      process: {
        label: "Rectangle",
        shape: "rect",
        width: 160,
        height: 58,
        fill: "#ffffff",
        stroke: "#0f9f6e"
      },
      decision: {
        label: "Decision",
        shape: "diamond",
        width: 145,
        height: 64,
        fill: "#fffaf0",
        stroke: "#d97706"
      },
      document: {
        label: "Document",
        shape: "document",
        width: 150,
        height: 58,
        fill: "#ffffff",
        stroke: "#7c3aed"
      },
      square: {
        label: "Carre",
        shape: "rect",
        width: 82,
        height: 82,
        fill: "#ffffff",
        stroke: "#2563eb"
      },
      circle: {
        label: "Cercle",
        shape: "circle",
        width: 92,
        height: 92,
        fill: "#f0fdfa",
        stroke: "#0f766e"
      },
      text: {
        label: "Texte",
        shape: "text",
        width: 150,
        height: 42,
        fill: "transparent",
        stroke: "#243447",
        fontSize: 18
      }
    }
  },
  colors: {
    canvasDefaultBackground: "#f6f7f9",
    palette: [
      "#ffffff",
      "#111827",
      "#2f6fed",
      "#0f9f6e",
      "#d97706"
    ],
    historyLimit: 10,
    storageKeys: {
      fill: "schematisation.nodeFillHistory",
      stroke: "schematisation.nodeStrokeHistory",
      canvasBackground: "schematisation.canvasBackground",
      canvasGridEnabled: "schematisation.canvasGridEnabled",
      routeStyle: "schematisation.routeStyle"
    }
  },
  router: {
    routeStyle: "straight",
    gridSize: 18,
    boundsMargin: 320,
    adaptiveRouting: {
      enabled: true,
      maxExtraBoundsMargin: 980,
      maxIterationMultiplier: 2.4,
      exteriorPadding: 90
    },
    maxIterations: 14000,
    linkCollisionGap: 18,
    costs: {
      step: 1,
      turn: 2.5,
      overlap: 8000,
      crossing: 1200,
      proximity: 60,
      nodeCollision: 100
    }
  },
  simulation: {
    linkDistance: 195,
    linkStrength: 0.58,
    chargeStrength: -650,
    collideRadius: 105,
    collideStrength: 0.72,
    gravityStrength: 0.035,
    routingPressure: {
      enabled: true,
      padding: 22,
      strength: 0.055,
      maxVelocity: 3.5
    },
    dragCollision: {
      enabled: true,
      padding: 10,
      iterations: 4
    },
    dragRouting: {
      connectedOnly: false,
      previewMode: "straight"
    }
  },
  zoom: {
    min: 0.25,
    max: 2.5,
    fitPaddingRatio: 0.86,
    fitMaxScale: 1.6,
    fitDuration: 450,
    wheelSensitivity: 0.42
  }
};
