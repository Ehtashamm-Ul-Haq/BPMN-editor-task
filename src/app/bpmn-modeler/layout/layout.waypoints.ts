import type { Point } from './layout.types';

export function computeManhattanWaypoints(
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number
): Point[] {
  const sourceCenter = { x: sourceX + sourceWidth / 2, y: sourceY + sourceHeight / 2 };
  const targetCenter = { x: targetX + targetWidth / 2, y: targetY + targetHeight / 2 };

  const waypoints: Point[] = [];
  waypoints.push({ x: sourceX + sourceWidth, y: sourceCenter.y });

  const midX = (sourceX + sourceWidth + targetX) / 2;
  if (targetX > sourceX + sourceWidth + 20) {
    waypoints.push({ x: midX, y: sourceCenter.y });
    waypoints.push({ x: midX, y: targetCenter.y });
  } else {
    waypoints.push({ x: targetX - 20, y: sourceCenter.y });
    waypoints.push({ x: targetX - 20, y: targetCenter.y });
  }

  waypoints.push({ x: targetX, y: targetCenter.y });
  return waypoints;
}
