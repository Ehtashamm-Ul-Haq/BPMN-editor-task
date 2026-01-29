import { Injectable } from '@angular/core';
import { buildGraphFromElements, assignRanks } from './layout.graph';
import {
  buildLaneData,
  computeRankWidths,
  computeLaneHeights,
  computeLayout
} from './layout.geometry';
import {
  extractSegments,
  detectCollisions,
  computeResolvedWaypoints
} from './layout.collision';
import type { Segment } from './layout.types';
import { computeManhattanWaypoints } from './layout.waypoints';
import {
  DEFAULT_LAYOUT_CONSTANTS,
  type LayoutConstants,
  type CollisionConflict
} from './layout.types';

export interface BpmnLayoutContext {
  elementRegistry: {
    filter: (predicate: (element: BpmnElementLike) => boolean) => BpmnElementLike[];
  };
  modeling: {
    moveElements: (elements: unknown[], delta: { x: number; y: number }, target?: unknown) => void;
    resizeShape: (shape: unknown, bounds: { x: number; y: number; width: number; height: number }) => void;
    updateWaypoints: (connection: BpmnConnectionLike, waypoints: Array<{ x: number; y: number }>) => void;
  };
  canvas: {
    getRootElement: () => { id: string };
  };
}

export interface BpmnElementLike {
  id: string;
  type: string;
  parent?: { id: string };
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  outgoing?: Array<{ target: { id: string } }>;
  hidden?: boolean;
  businessObject?: unknown;
}

export interface BpmnConnectionLike {
  id: string;
  waypoints: Array<{ x: number; y: number }>;
  source: unknown;
  target: unknown;
}

@Injectable({ providedIn: 'root' })
export class BpmnLayoutService {
  autoLayout(
    context: BpmnLayoutContext,
    constants: LayoutConstants = DEFAULT_LAYOUT_CONSTANTS
  ): void {
    const lanes = this.getLanes(context.elementRegistry);
    const elements = this.getFlowElements(context.elementRegistry);
    if (lanes.length === 0 || elements.length === 0) return;

    const { nodeMap, adjacency } = buildGraphFromElements(
      elements as Parameters<typeof buildGraphFromElements>[0]
    );
    assignRanks(nodeMap, adjacency);

    const laneInput = lanes.map((lane) => ({
      id: lane.id,
      y: lane.y ?? 0,
      height: lane.height ?? 0,
      element: lane
    }));
    const { laneData, maxGlobalRank } = buildLaneData(laneInput, nodeMap);

    computeLaneHeights(laneData, maxGlobalRank, constants);
    const rankWidths = computeRankWidths(laneData, maxGlobalRank);

    const rootElement = context.canvas.getRootElement();
    const rootId = rootElement?.id ?? null;
    const { nodePositions, laneResizes } = computeLayout(
      laneData,
      nodeMap,
      rankWidths,
      constants,
      rootId
    );

    for (const resize of laneResizes) {
      if (resize.isRoot) continue;
      const el = resize.element as BpmnElementLike;
      if (resize.height !== el.height) {
        context.modeling.resizeShape(el, {
          x: el.x ?? 0,
          y: resize.y,
          width: el.width ?? 0,
          height: resize.height
        });
      } else if (resize.y !== el.y) {
        context.modeling.moveElements([el], { x: 0, y: resize.y - (el.y ?? 0) });
      }
    }

    const laneById = new Map(lanes.map((l) => [l.id, l]));
    for (const pos of nodePositions) {
      const node = nodeMap.get(pos.nodeId);
      if (!node) continue;
      const meta = laneData.get(pos.laneId);
      if (!meta) continue;
      const dx = pos.dx;
      const dy = pos.dy;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        const parent = laneById.get(pos.laneId) ?? meta.element;
        context.modeling.moveElements([node.element], { x: dx, y: dy }, parent);
      }
    }

    this.rerouteConnections(context, elements as BpmnElementLike[]);
  }

  resolveEdgeCollisions(
    context: BpmnLayoutContext,
    maxPasses: number = 5,
    constants: LayoutConstants = DEFAULT_LAYOUT_CONSTANTS
  ): void {
    const connections = context.elementRegistry.filter(
      (e: BpmnElementLike) => e.type === 'bpmn:SequenceFlow'
    ) as unknown as BpmnConnectionLike[];
    if (connections.length === 0) return;

    let isAdjusting = false;
    for (let pass = 0; pass < maxPasses; pass++) {
      let anyUpdated = false;
      for (const conn of connections) {
        const others = connections.filter((c) => c.id !== conn.id);
        const { waypoints, updated } = computeResolvedWaypoints(
          { id: conn.id, waypoints: conn.waypoints, source: conn.source, target: conn.target },
          others.map((c) => ({ id: c.id, waypoints: c.waypoints, source: c.source, target: c.target })),
          constants
        );
        if (updated) {
          anyUpdated = true;
          isAdjusting = true;
          try {
            context.modeling.updateWaypoints(conn, waypoints);
          } finally {
            setTimeout(() => { isAdjusting = false; }, 100);
          }
        }
      }
      if (!anyUpdated) break;
    }
  }

  detectCollisions(context: BpmnLayoutContext): CollisionConflict[] {
    const connections = context.elementRegistry.filter(
      (e: BpmnElementLike) => e.type === 'bpmn:SequenceFlow'
    ) as unknown as BpmnConnectionLike[];
    const allSegments: Segment[] = [];
    for (const conn of connections) {
      allSegments.push(...extractSegments(conn.id, conn.waypoints));
    }
    return detectCollisions(allSegments, DEFAULT_LAYOUT_CONSTANTS.collisionThreshold);
  }

  private getLanes(registry: BpmnLayoutContext['elementRegistry']): BpmnElementLike[] {
    let lanes = registry.filter((e: BpmnElementLike) => e.type === 'bpmn:Lane');
    if (lanes.length === 0) {
      lanes = registry.filter((e: BpmnElementLike) => e.type === 'bpmn:Participant');
    }
    if (lanes.length === 0) {
      lanes = registry.filter((e: BpmnElementLike) => e.type === 'bpmn:Process');
    }
    return lanes;
  }

  private getFlowElements(registry: BpmnLayoutContext['elementRegistry']): BpmnElementLike[] {
    return registry.filter((e: BpmnElementLike) =>
      e.type !== 'bpmn:Lane' &&
      e.type !== 'bpmn:Participant' &&
      e.type !== 'bpmn:Process' &&
      e.type !== 'bpmn:SequenceFlow' &&
      e.type !== 'bpmn:Association' &&
      e.type !== 'label' &&
      !e.hidden &&
      e.businessObject != null
    );
  }

  private rerouteConnections(context: BpmnLayoutContext, elements: BpmnElementLike[]): void {
    const connections = new Set<BpmnConnectionLike>();
    for (const el of elements) {
      const out = (el as BpmnElementLike & { outgoing?: BpmnConnectionLike[] }).outgoing;
      if (out) for (const c of out) connections.add(c as BpmnConnectionLike);
    }
    const sourceTargetMap = new Map<string, BpmnElementLike>();
    for (const el of elements) sourceTargetMap.set(el.id, el);

    for (const conn of connections) {
      const source = (conn as BpmnConnectionLike & { source: BpmnElementLike }).source as BpmnElementLike;
      const target = (conn as BpmnConnectionLike & { target: BpmnElementLike }).target as BpmnElementLike;
      if (!source || !target) continue;
      const waypoints = computeManhattanWaypoints(
        source.x ?? 0,
        source.y ?? 0,
        source.width ?? 0,
        source.height ?? 0,
        target.x ?? 0,
        target.y ?? 0,
        target.width ?? 0,
        target.height ?? 0
      );
      context.modeling.updateWaypoints(conn, waypoints);
    }
  }
}
