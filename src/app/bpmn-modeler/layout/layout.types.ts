export interface LayoutNode {
  id: string;
  element: unknown;
  rank: number;
  laneId: string;
  width: number;
  height: number;
}

export interface LaneMeta {
  id: string;
  element: unknown;
  maxStack: number;
  y: number;
  height: number;
  nodesByRank: Map<number, LayoutNode[]>;
}

export interface Point {
  x: number;
  y: number;
}

export interface Segment {
  connectionId: string;
  p1: Point;
  p2: Point;
  orientation: 'horizontal' | 'vertical' | 'diagonal';
}

export interface CollisionConflict {
  connections: [string, string];
  reason: string;
  segment1: Segment;
  segment2: Segment;
}

export interface LayoutConstants {
  colSpacing: number;
  rowSpacing: number;
  lanePadding: number;
  startXOffset: number;
  collisionThreshold: number;
  parallelOffset: number;
}

export const DEFAULT_LAYOUT_CONSTANTS: LayoutConstants = {
  colSpacing: 80,
  rowSpacing: 30,
  lanePadding: 80,
  startXOffset: 150,
  collisionThreshold: 5,
  parallelOffset: 18
};
