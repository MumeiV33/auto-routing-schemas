const SAMPLE_GRAPH = {
  nodes: [
    { id: "direction", label: "Direction", type: "team", x: -80, y: -210, width: 150, height: 58, fill: "#ffffff", stroke: "#2f6fed" },
    { id: "operations", label: "Operations", type: "process", x: -300, y: -40, width: 160, height: 58, fill: "#ffffff", stroke: "#0f9f6e" },
    { id: "commerce", label: "Commerce", type: "process", x: 120, y: -45, width: 160, height: 58, fill: "#ffffff", stroke: "#0f9f6e" },
    { id: "support", label: "Support", type: "process", x: 0, y: 130, width: 160, height: 58, fill: "#ffffff", stroke: "#0f9f6e" },
    { id: "qualite", label: "Qualite", type: "decision", x: -250, y: 185, width: 145, height: 64, fill: "#fffaf0", stroke: "#d97706" },
    { id: "finance", label: "Finance", type: "team", x: 260, y: 175, width: 150, height: 58, fill: "#ffffff", stroke: "#2f6fed" }
  ],
  links: [
    { source: "direction", target: "operations" },
    { source: "direction", target: "commerce" },
    { source: "operations", target: "support" },
    { source: "commerce", target: "support" },
    { source: "support", target: "qualite" },
    { source: "support", target: "finance" },
    { source: "commerce", target: "finance" }
  ]
};
