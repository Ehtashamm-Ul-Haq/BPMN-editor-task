import type { LayoutNode } from './layout.types';

export function buildGraphFromElements(elements: Array<{ id: string; parent: { id: string }; width: number; height: number; outgoing?: Array<{ target: { id: string } }> }>): {
  nodeMap: Map<string, LayoutNode>;
  adjacency: Map<string, string[]>;
  inDegree: Map<string, number>;
} {
  const nodeMap = new Map<string, LayoutNode>();
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  for (const el of elements) {
    nodeMap.set(el.id, {
      id: el.id,
      element: el,
      rank: 0,
      laneId: el.parent.id,
      width: el.width,
      height: el.height
    });
    adjacency.set(el.id, []);
    inDegree.set(el.id, 0);
  }

  for (const el of elements) {
    for (const conn of el.outgoing ?? []) {
      const targetId = conn.target.id;
      if (nodeMap.has(targetId)) {
        adjacency.get(el.id)!.push(targetId);
        inDegree.set(targetId, (inDegree.get(targetId) ?? 0) + 1);
      }
    }
  }

  return { nodeMap, adjacency, inDegree };
}

export function assignRanks(
  nodeMap: Map<string, LayoutNode>,
  adjacency: Map<string, string[]>
): void {
  const inDegree = new Map<string, number>();
  nodeMap.forEach((_, id) => inDegree.set(id, 0));
  adjacency.forEach((neighbors, fromId) => {
    for (const toId of neighbors) {
      inDegree.set(toId, (inDegree.get(toId) ?? 0) + 1);
    }
  });

  const queue: string[] = [];
  nodeMap.forEach((node) => {
    if (inDegree.get(node.id) === 0) queue.push(node.id);
  });
  if (queue.length === 0 && nodeMap.size > 0) {
    queue.push(nodeMap.keys().next().value!);
  }

  while (queue.length > 0) {
    const currId = queue.shift()!;
    const currNode = nodeMap.get(currId)!;
    const neighbors = adjacency.get(currId) ?? [];
    for (const nextId of neighbors) {
      const nextNode = nodeMap.get(nextId)!;
      if (nextNode.rank <= currNode.rank) {
        nextNode.rank = currNode.rank + 1;
        queue.push(nextId);
      }
    }
  }
}
