import type { Point, Segment, CollisionConflict, LayoutConstants } from './layout.types';
import { DEFAULT_LAYOUT_CONSTANTS } from './layout.types';

export function getOrientation(p1: Point, p2: Point): 'horizontal' | 'vertical' | 'diagonal' {
  if (Math.abs(p1.x - p2.x) < 2) return 'vertical';
  if (Math.abs(p1.y - p2.y) < 2) return 'horizontal';
  return 'diagonal';
}

export function checkIntervalOverlap(
  min1: number,
  max1: number,
  min2: number,
  max2: number
): boolean {
  return Math.max(min1, min2) < Math.min(max1, max2) - 2;
}

export function checkSegmentCollision(
  seg1: Segment,
  seg2: Segment,
  threshold: number = DEFAULT_LAYOUT_CONSTANTS.collisionThreshold
): boolean {
  if (seg1.orientation !== seg2.orientation) return false;

  if (seg1.orientation === 'horizontal') {
    if (Math.abs(seg1.p1.y - seg2.p1.y) > threshold) return false;
    return checkIntervalOverlap(
      Math.min(seg1.p1.x, seg1.p2.x), Math.max(seg1.p1.x, seg1.p2.x),
      Math.min(seg2.p1.x, seg2.p2.x), Math.max(seg2.p1.x, seg2.p2.x)
    );
  }

  if (seg1.orientation === 'vertical') {
    if (Math.abs(seg1.p1.x - seg2.p1.x) > threshold) return false;
    return checkIntervalOverlap(
      Math.min(seg1.p1.y, seg1.p2.y), Math.max(seg1.p1.y, seg1.p2.y),
      Math.min(seg2.p1.y, seg2.p2.y), Math.max(seg2.p1.y, seg2.p2.y)
    );
  }

  return false;
}

export function extractSegments(
  connectionId: string,
  waypoints: Point[]
): Segment[] {
  const segments: Segment[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    segments.push({
      connectionId,
      p1: waypoints[i],
      p2: waypoints[i + 1],
      orientation: getOrientation(waypoints[i], waypoints[i + 1])
    });
  }
  return segments;
}

export function detectCollisions(
  allSegments: Segment[],
  threshold: number = DEFAULT_LAYOUT_CONSTANTS.collisionThreshold
): CollisionConflict[] {
  const conflicts: CollisionConflict[] = [];
  for (let i = 0; i < allSegments.length; i++) {
    for (let j = i + 1; j < allSegments.length; j++) {
      const seg1 = allSegments[i];
      const seg2 = allSegments[j];
      if (seg1.connectionId === seg2.connectionId) continue;
      if (checkSegmentCollision(seg1, seg2, threshold)) {
        conflicts.push({
          connections: [seg1.connectionId, seg2.connectionId],
          reason: 'Overlap or near-collision detected',
          segment1: seg1,
          segment2: seg2
        });
      }
    }
  }
  return conflicts;
}

export function applySegmentDrift(
  waypoints: Point[],
  segmentIndex: number,
  offset: number,
  orientation: 'horizontal' | 'vertical'
): void {
  if (segmentIndex < 0 || segmentIndex >= waypoints.length - 1) return;
  const p1 = waypoints[segmentIndex];
  const p2 = waypoints[segmentIndex + 1];
  if (orientation === 'horizontal') {
    p1.y += offset;
    p2.y += offset;
  } else {
    p1.x += offset;
    p2.x += offset;
  }
}

export function applyDriftToWaypoints(
  waypoints: Point[],
  offset: number
): void {
  for (let i = 2; i < waypoints.length - 1; i++) {
    waypoints[i].y += offset;
  }
}

export interface ConnectionLike {
  id: string;
  waypoints: Point[];
  source: unknown;
  target: unknown;
}

export function checkConnectionOverlapDetails(
  conn1: { waypoints: Point[] },
  conn2: ConnectionLike,
  checkCollision: (s1: Segment, s2: Segment) => boolean
): { segmentIndex: number; orientation: 'horizontal' | 'vertical'; isPositiveDirection: boolean } | null {
  for (let i = 0; i < conn1.waypoints.length - 1; i++) {
    const p1 = conn1.waypoints[i];
    const p2 = conn1.waypoints[i + 1];
    const orientation = getOrientation(p1, p2);

    for (let j = 0; j < conn2.waypoints.length - 1; j++) {
      const q1 = conn2.waypoints[j];
      const q2 = conn2.waypoints[j + 1];
      const otherOrientation = getOrientation(q1, q2);
      if (orientation !== otherOrientation) continue;

      const seg1: Segment = { connectionId: '', p1, p2, orientation };
      const seg2: Segment = { connectionId: '', p1: q1, p2: q2, orientation: otherOrientation };
      if (!checkCollision(seg1, seg2)) continue;

      if (orientation === 'diagonal') continue;

      let isPositiveDirection: boolean;
      if (orientation === 'horizontal') {
        const center1 = (p1.y + p2.y) / 2;
        const center2 = (q1.y + q2.y) / 2;
        isPositiveDirection = center1 >= center2;
      } else {
        const center1 = (p1.x + p2.x) / 2;
        const center2 = (q1.x + q2.x) / 2;
        isPositiveDirection = center1 >= center2;
      }
      return { segmentIndex: i, orientation, isPositiveDirection };
    }
  }
  return null;
}

export function computeResolvedWaypoints(
  targetConnection: ConnectionLike,
  otherConnections: ConnectionLike[],
  constants: LayoutConstants = DEFAULT_LAYOUT_CONSTANTS
): { waypoints: Point[]; updated: boolean } {
  const waypoints = targetConnection.waypoints.map((w) => ({ x: w.x, y: w.y }));
  if (waypoints.length < 2) return { waypoints, updated: false };

  const checkCollision = (s1: Segment, s2: Segment) =>
    checkSegmentCollision(s1, s2, constants.collisionThreshold);
  let updated = false;

  const parallelGroup = otherConnections.filter(
    (other) =>
      (targetConnection.source === other.source && targetConnection.target === other.target) ||
      (targetConnection.source === other.target && targetConnection.target === other.source)
  );
  if (parallelGroup.length > 0) {
    const allParallel = [targetConnection, ...parallelGroup].sort((a, b) => a.id.localeCompare(b.id));
    const index = allParallel.findIndex((c) => c.id === targetConnection.id);
    const n = allParallel.length;
    const offset = (index - (n - 1) / 2) * constants.parallelOffset;
    if (Math.abs(offset) > 1) {
      applyDriftToWaypoints(waypoints, offset);
      updated = true;
    }
  }

  for (const other of otherConnections) {
    const isParallel =
      (targetConnection.source === other.source && targetConnection.target === other.target) ||
      (targetConnection.source === other.target && targetConnection.target === other.source);
    if (isParallel) continue;

    const overlap = checkConnectionOverlapDetails(
      { waypoints },
      other,
      checkCollision
    );
    if (overlap) {
      const direction = overlap.isPositiveDirection ? 1 : -1;
      applySegmentDrift(
        waypoints,
        overlap.segmentIndex,
        constants.parallelOffset * direction,
        overlap.orientation
      );
      updated = true;
    }
  }

  return { waypoints, updated };
}
