import type { LayoutNode, LaneMeta, LayoutConstants } from './layout.types';

export function buildLaneData(
  lanes: Array<{ id: string; y: number; height: number; element: unknown }>,
  nodeMap: Map<string, LayoutNode>
): { laneData: Map<string, LaneMeta>; maxGlobalRank: number } {
  const laneData = new Map<string, LaneMeta>();
  let maxGlobalRank = 0;

  for (const lane of lanes) {
    laneData.set(lane.id, {
      id: lane.id,
      element: lane.element,
      maxStack: 1,
      y: lane.y,
      height: lane.height,
      nodesByRank: new Map()
    });
  }

  nodeMap.forEach((node) => {
    if (node.rank > maxGlobalRank) maxGlobalRank = node.rank;
    const meta = laneData.get(node.laneId);
    if (!meta) return;
    if (!meta.nodesByRank.has(node.rank)) meta.nodesByRank.set(node.rank, []);
    meta.nodesByRank.get(node.rank)!.push(node);
  });

  return { laneData, maxGlobalRank };
}

export function computeRankWidths(
  laneData: Map<string, LaneMeta>,
  maxGlobalRank: number
): Map<number, number> {
  const rankWidths = new Map<number, number>();
  for (let r = 0; r <= maxGlobalRank; r++) {
    let maxWidth = 100;
    laneData.forEach((meta) => {
      const nodes = meta.nodesByRank.get(r) ?? [];
      for (const n of nodes) {
        if (n.width > maxWidth) maxWidth = n.width;
      }
    });
    rankWidths.set(r, maxWidth);
  }
  return rankWidths;
}

export function computeLaneHeights(
  laneData: Map<string, LaneMeta>,
  maxGlobalRank: number,
  constants: LayoutConstants
): void {
  laneData.forEach((meta) => {
    let maxStackHeight = 0;
    for (let r = 0; r <= maxGlobalRank; r++) {
      const nodes = meta.nodesByRank.get(r) ?? [];
      const stackHeight =
        nodes.reduce((sum, n) => sum + n.height, 0) + (nodes.length - 1) * constants.rowSpacing;
      if (stackHeight > maxStackHeight) maxStackHeight = stackHeight;
    }
    const requiredHeight = maxStackHeight + constants.lanePadding * 2;
    meta.height = Math.max((meta.element as { height?: number }).height ?? 0, requiredHeight);
  });
}

export interface NodePosition {
  nodeId: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  laneId: string;
}

export interface LaneResize {
  laneId: string;
  y: number;
  height: number;
  element: unknown;
  isRoot: boolean;
}

export function computeLayout(
  laneData: Map<string, LaneMeta>,
  nodeMap: Map<string, LayoutNode>,
  rankWidths: Map<number, number>,
  constants: LayoutConstants,
  rootElementId: string | null
): { nodePositions: NodePosition[]; laneResizes: LaneResize[] } {
  const nodePositions: NodePosition[] = [];
  const laneResizes: LaneResize[] = [];
  const laneList = Array.from(laneData.values()).sort(
    (a, b) => ((a.element as { y?: number }).y ?? 0) - ((b.element as { y?: number }).y ?? 0)
  );

  let currentLaneY = (laneList[0]?.element as { y?: number }).y ?? 0;

  for (const meta of laneList) {
    const isRoot = (meta.element as { id?: string }).id === rootElementId;
    if (!isRoot) {
      meta.y = currentLaneY;
      laneResizes.push({
        laneId: meta.id,
        y: currentLaneY,
        height: meta.height,
        element: meta.element,
        isRoot: false
      });
      currentLaneY += meta.height;
    } else {
      meta.y = 0;
      laneResizes.push({ laneId: meta.id, y: 0, height: meta.height, element: meta.element, isRoot: true });
    }
  }

  nodeMap.forEach((node) => {
    const meta = laneData.get(node.laneId);
    if (!meta) return;
    const isRoot = (meta.element as { id?: string }).id === rootElementId;
    const startX = isRoot ? constants.startXOffset : ((meta.element as { x?: number }).x ?? 0) + constants.lanePadding;

    let newX = startX;
    for (let i = 0; i < node.rank; i++) {
      newX += (rankWidths.get(i) ?? 100) + constants.colSpacing;
    }

    const siblings = meta.nodesByRank.get(node.rank) ?? [];
    const index = siblings.indexOf(node);
    const totalStackHeight =
      siblings.reduce((sum, n) => sum + n.height, 0) + Math.max(0, siblings.length - 1) * constants.rowSpacing;
    const laneCenterY = meta.y + meta.height / 2;
    const startStackY = laneCenterY - totalStackHeight / 2;

    let stackOffset = 0;
    for (let i = 0; i < index; i++) {
      stackOffset += siblings[i].height + constants.rowSpacing;
    }
    const newY = startStackY + stackOffset;

    const elem = node.element as { x: number; y: number };
    nodePositions.push({
      nodeId: node.id,
      x: newX,
      y: newY,
      dx: newX - elem.x,
      dy: newY - elem.y,
      laneId: node.laneId
    });
  });

  return { nodePositions, laneResizes };
}
