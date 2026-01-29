import { Component, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import BpmnModeler from 'bpmn-js/lib/Modeler';

// Types for our layout engine
interface LayoutNode {
  id: string;
  element: any;
  rank: number;       // Horizontal level (0, 1, 2...)
  laneId: string;     // Parent Lane ID
  width: number;
  height: number;
}

interface LaneMeta {
  id: string;
  element: any;
  maxStack: number;   // Max vertical items in any column
  y: number;          // Calculated Y position
  height: number;     // Calculated Height
  nodesByRank: Map<number, LayoutNode[]>;
}

@Component({
  selector: 'app-bpmn-modeler',
  templateUrl: './bpmn-modeler.html',
  styleUrls: ['./bpmn-modeler.css'],
  standalone: true
})
export class BpmnModelerComponent implements AfterViewInit {
  @ViewChild('container', { static: true }) private container!: ElementRef;
  private modeler: any;

  constructor(private http: HttpClient) { }

  async ngAfterViewInit() {
    this.modeler = new BpmnModeler({
      container: this.container.nativeElement
    });

    try {
      const xml = await lastValueFrom(this.http.get('diagram.bpmn', { responseType: 'text' }));
      await this.modeler.importXML(xml);
      this.canvas.zoom('fit-viewport');

      // Initialize Line Drift Handler
      this.initLineDrift();
    } catch (err) {
      console.error('Error loading BPMN diagram', err);
    }
  }

  // Accessors as requested
  get elementRegistry() { return this.modeler.get('elementRegistry'); }
  get modeling() { return this.modeler.get('modeling'); }
  get canvas() { return this.modeler.get('canvas'); }
  get bpmnFactory() { return this.modeler.get('bpmnFactory'); }
  get elementFactory() { return this.modeler.get('elementFactory'); }
  get dragDrop() { return this.modeler.get('dragDrop'); }

  get eventBus() { return this.modeler.get('eventBus'); }

  addTaskToLane() {
    this.addElementToLane('bpmn:Task', { name: 'New Task' });
  }

  addGatewayToLane() {
    this.addElementToLane('bpmn:ExclusiveGateway', { name: 'Gateway' });
  }

  addEventToLane() {
    this.addElementToLane('bpmn:IntermediateThrowEvent', { name: 'Event' });
  }

  onDragStart(event: MouseEvent, type: string) {
    event.stopPropagation();
    event.preventDefault();

    const shape = this.elementFactory.createShape({
      type: type,
      businessObject: this.bpmnFactory.create(type, { name: 'New ' + type.split(':')[1] })
    });

    this.dragDrop.start(event, { element: shape });
  }

  private addElementToLane(type: string, options: any = {}) {
    // Find the first participant (pool/lane)
    const participant = this.elementRegistry.filter((element: any) => element.type === 'bpmn:Participant')[0];

    if (!participant) {
      console.warn('No participant found to add element to.');
      return;
    }

    // Determine a position inside the lane
    // Use participant bounds to constrain, but for demo, we'll shift x slightly each time
    const currentElements = participant.children.length;
    const x = 200 + (currentElements * 120);
    const y = participant.y + (participant.height / 2);

    // Create the shape using elementFactory as per best practices
    const shape = this.elementFactory.createShape({
      type: type,
      businessObject: this.bpmnFactory.create(type, options)
    });

    // The modeling service handles adding it to the XML and the DI (Diagram Interchange)
    // Passing 'participant' as the parent ensures it belongs to the correct process/lane
    this.modeling.createShape(shape, { x, y }, participant);
  }

  autoOrganize() {
    // 1. Identify Scope: Find all Lanes or fallback to Process
    let lanes = this.elementRegistry.filter((e: any) => e.type === 'bpmn:Lane');
    
    // Fallback: If no Lanes, treat Participants as Lanes
    if (lanes.length === 0) {
      lanes = this.elementRegistry.filter((e: any) => e.type === 'bpmn:Participant');
    }

    // Fallback: If no Participants, treat Root Process as a single Lane
    if (lanes.length === 0) {
      lanes = this.elementRegistry.filter((e: any) => e.type === 'bpmn:Process');
    }

    // 2. Identify Elements: All FlowNodes (Task, Gateway, Event)
    // Filter out connections, lanes, labels, etc.
    const allElements = this.elementRegistry.filter((e: any) => 
      e.type !== 'bpmn:Lane' && 
      e.type !== 'bpmn:Participant' && 
      e.type !== 'bpmn:Process' && 
      e.type !== 'bpmn:SequenceFlow' &&
      e.type !== 'bpmn:Association' &&
      e.type !== 'label' &&
      !e.hidden &&
      e.businessObject
    );

    this.autoLayoutByLanes(lanes, allElements, this.modeling);
  }

  private autoLayoutByLanes(lanes: any[], elements: any[], modeling: any) {
    if (lanes.length === 0 || elements.length === 0) return;

    // --- Step A: Build Global Graph & Assign Ranks (Topological Sort) ---
    // We do this globally to respect cross-lane dependencies.
    
    const nodeMap = new Map<string, LayoutNode>();
    const adjacency = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    // Initialize Graph Nodes
    elements.forEach(el => {
      nodeMap.set(el.id, {
        id: el.id,
        element: el,
        rank: 0,
        laneId: el.parent.id, // Group by parent (Lane/Participant)
        width: el.width,
        height: el.height
      });
      adjacency.set(el.id, []);
      inDegree.set(el.id, 0);
    });

    // Build Edges
    elements.forEach(el => {
      (el.outgoing || []).forEach((conn: any) => {
        const targetId = conn.target.id;
        if (nodeMap.has(targetId)) {
          adjacency.get(el.id)?.push(targetId);
          inDegree.set(targetId, (inDegree.get(targetId) || 0) + 1);
        }
      });
    });

    // BFS for Ranking (Longest Path Layering)
    const queue: string[] = [];
    
    // Find Roots
    nodeMap.forEach(node => {
      if (inDegree.get(node.id) === 0) {
        queue.push(node.id);
      }
    });

    // Handle Cycles: If no roots but nodes exist, pick arbitrary node
    if (queue.length === 0 && nodeMap.size > 0) {
      queue.push(nodeMap.keys().next().value!);
    }

    // Process Queue
    while (queue.length > 0) {
      const currId = queue.shift()!;
      const currNode = nodeMap.get(currId)!;
      const neighbors = adjacency.get(currId) || [];

      neighbors.forEach(nextId => {
        const nextNode = nodeMap.get(nextId)!;
        // Rank = ParentRank + 1. We prioritize Longest Path to push items to the right.
        if (nextNode.rank <= currNode.rank) {
          nextNode.rank = currNode.rank + 1;
          queue.push(nextId);
        }
      });
    }

    // --- Step B: Organize Data by Lane & Rank ---

    const laneData = new Map<string, LaneMeta>();
    let maxGlobalRank = 0;

    // Initialize Lane Metas
    lanes.forEach(lane => {
      laneData.set(lane.id, {
        id: lane.id,
        element: lane,
        maxStack: 1,
        y: lane.y,
        height: lane.height,
        nodesByRank: new Map()
      });
    });

    // Populate Lanes with Ranked Nodes
    nodeMap.forEach(node => {
      if (node.rank > maxGlobalRank) maxGlobalRank = node.rank;
      
      const meta = laneData.get(node.laneId);
      // If node's parent isn't in our lane list (e.g. nested sub-lanes), skip or handle
      if (!meta) return; 

      if (!meta.nodesByRank.has(node.rank)) {
        meta.nodesByRank.set(node.rank, []);
      }
      meta.nodesByRank.get(node.rank)!.push(node);
    });

    // --- Step C: Calculate Geometry (Col Widths & Row Heights) ---

    const COL_SPACING = 80;
    const ROW_SPACING = 30; // Vertical spacing between stacked elements
    const LANE_PADDING = 80; // Top/Bottom padding inside lane
    const START_X_OFFSET = 150; // Added extra space from left for Root elements (avoids palette overlap)

    // 1. Calculate Column Widths (Global Grid)
    // Width of Rank X = Max width of any element at Rank X across ALL lanes
    const rankWidths = new Map<number, number>();
    for (let r = 0; r <= maxGlobalRank; r++) {
      let maxWidth = 100; // Min width
      laneData.forEach(meta => {
        const nodes = meta.nodesByRank.get(r) || [];
        nodes.forEach(n => {
          if (n.width > maxWidth) maxWidth = n.width;
        });
      });
      rankWidths.set(r, maxWidth);
    }

    // 2. Calculate Lane Heights
    // Height of Lane = Max(Stacked Elements in any Rank) * (ElementHeight + Spacing)
    laneData.forEach(meta => {
      let maxStackHeight = 0;
      
      // Check every rank in this lane
      for (let r = 0; r <= maxGlobalRank; r++) {
        const nodes = meta.nodesByRank.get(r) || [];
        // Calculate total height needed for this stack
        const stackHeight = nodes.reduce((sum, n) => sum + n.height, 0) + 
                            ((nodes.length - 1) * ROW_SPACING);
        
        if (stackHeight > maxStackHeight) maxStackHeight = stackHeight;
      }

      // Enforce min height or calculated height
      const requiredHeight = maxStackHeight + (LANE_PADDING * 2);
      // Update metadata (we'll resize later)
      meta.height = Math.max(meta.element.height, requiredHeight);
    });

    // --- Step D: Execute Layout Commands ---

    const sortedLanes = Array.from(laneData.values()).sort((a, b) => a.element.y - b.element.y);
    const rootElement = this.canvas.getRootElement();
    
    // Start Y: If we are layouting inside a Participant, use its Y. 
    // If layouting Root Process, start at 0.
    let currentLaneY = (sortedLanes[0]?.element.y !== undefined) ? sortedLanes[0].element.y : 0;

    sortedLanes.forEach(meta => {
      // Check if this container is the Root Element (Canvas)
      // Root element cannot be resized or moved via modeling.resizeShape
      const isRoot = meta.element === rootElement || meta.element.id === rootElement.id;

      if (!isRoot) {
        if (meta.height !== meta.element.height) {
          modeling.resizeShape(meta.element, {
            x: meta.element.x,
            y: currentLaneY,
            width: meta.element.width,
            height: meta.height
          });
        } else if (meta.element.y !== currentLaneY) {
          modeling.moveElements([meta.element], { x: 0, y: currentLaneY - meta.element.y });
        }
        // Update Y for next iteration
        meta.y = currentLaneY;
        currentLaneY += meta.height;
      } else {
        // For Root, we just use 0,0 as origin for elements
        meta.y = 0;
      }
    });

    // Move Elements
    nodeMap.forEach(node => {
      const meta = laneData.get(node.laneId);
      if (!meta) return;

      const isRoot = meta.element === rootElement || meta.element.id === rootElement.id;
      const startX = isRoot ? START_X_OFFSET : (meta.element.x || 0) + LANE_PADDING;

      let newX = startX;
      for (let i = 0; i < node.rank; i++) {
        newX += (rankWidths.get(i) || 100) + COL_SPACING;
      }

      const siblings = meta.nodesByRank.get(node.rank) || [];
      const index = siblings.indexOf(node);
      
      const totalStackHeight = siblings.reduce((sum, n) => sum + n.height, 0) + 
                               ((Math.max(0, siblings.length - 1)) * ROW_SPACING);
      
      // If Root, we don't have a "Lane Center", so just use top-down or simulated center
      const laneCenterY = isRoot ? (meta.y + (meta.height / 2)) : (meta.y + (meta.height / 2));
      const startStackY = laneCenterY - (totalStackHeight / 2);

      let stackOffset = 0;
      for (let i = 0; i < index; i++) {
        stackOffset += siblings[i].height + ROW_SPACING;
      }
      
      const newY = startStackY + stackOffset;

      const dx = newX - node.element.x;
      const dy = newY - node.element.y;

      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
         // Passing meta.element as parent hint
         modeling.moveElements([node.element], { x: dx, y: dy }, meta.element);
      }
    });

    // --- Step E: Reroute Sequence Flows (Manhattan Style) ---
    this.rerouteConnections(elements);
  }

  private rerouteConnections(elements: any[]) {
    // Collect all unique connections from the elements
    const connections = new Set<any>();
    elements.forEach(el => {
      (el.outgoing || []).forEach((conn: any) => connections.add(conn));
    });

    connections.forEach(conn => {
      // 1. Get Source and Target
      const source = conn.source;
      const target = conn.target;

      // 2. Calculate Center Points
      const sourceCenter = {
        x: source.x + source.width / 2,
        y: source.y + source.height / 2
      };
      
      const targetCenter = {
        x: target.x + target.width / 2,
        y: target.y + target.height / 2
      };

      // 3. Define Waypoints (Manhattan Layout)
      // Logic: Exit Right -> Mid Point -> Enter Left
      // This creates a standard [Source] --(horiz)--> | --(vert)--> | --(horiz)--> [Target] shape
      
      const waypoints = [];
      
      // Start at Source Right Center
      waypoints.push({ x: source.x + source.width, y: sourceCenter.y });

      // Calculate Midpoint X (Horizontal space between elements)
      // If elements are far apart, bend in the middle. 
      // If close or overlapping x, we might need a more complex route, but for auto-layout grid:
      // Grid ensures Target X > Source X usually.
      
      const midX = (source.x + source.width + target.x) / 2;
      
      // Check if we are moving forward (Left to Right)
      if (target.x > source.x + source.width + 20) {
        // Standard Forward Flow
        waypoints.push({ x: midX, y: sourceCenter.y }); // Move out to mid
        waypoints.push({ x: midX, y: targetCenter.y }); // Move up/down to target Y
      } else {
        // Backward or Vertical Flow (e.g. loops or stacked)
        // Exit right, go down/up, go left, enter left
        // For simple auto-layout, we stick to basic Manhattan:
        // Just direct horizontal/vertical snaps
        // Let's force a "Right-angle" turn
        waypoints.push({ x: target.x - 20, y: sourceCenter.y });
        waypoints.push({ x: target.x - 20, y: targetCenter.y });
      }

      // End at Target Left Center
      waypoints.push({ x: target.x, y: targetCenter.y });

      // 4. Update via Modeling Service
      this.modeling.updateWaypoints(conn, waypoints);
    });
  }

  detectCollisions() {
    const connections = this.elementRegistry.filter((e: any) => e.type === 'bpmn:SequenceFlow');
    const conflicts: any[] = [];

    // Extract segments
    const allSegments: any[] = [];
    connections.forEach((conn: any) => {
      const waypoints = conn.waypoints;
      for (let i = 0; i < waypoints.length - 1; i++) {
        allSegments.push({
          connectionId: conn.id,
          p1: waypoints[i],
          p2: waypoints[i+1],
          orientation: this.getOrientation(waypoints[i], waypoints[i+1])
        });
      }
    });

    // Detect Collisions (Naive O(N^2))
    for (let i = 0; i < allSegments.length; i++) {
      for (let j = i + 1; j < allSegments.length; j++) {
        const seg1 = allSegments[i];
        const seg2 = allSegments[j];

        // Skip segments from same connection
        if (seg1.connectionId === seg2.connectionId) continue;

        if (this.checkCollision(seg1, seg2)) {
          conflicts.push({
            connections: [seg1.connectionId, seg2.connectionId],
            reason: 'Overlap or near-collision detected',
            segment1: seg1,
            segment2: seg2
          });
        }
      }
    }

    console.log('Collision Detection Report:', conflicts);
    if (conflicts.length > 0) {
      alert(`Found ${conflicts.length} line collisions! Check console for details.`);
    } else {
      alert('No collisions detected.');
    }
  }

  private getOrientation(p1: any, p2: any): 'horizontal' | 'vertical' | 'diagonal' {
    if (Math.abs(p1.x - p2.x) < 2) return 'vertical';
    if (Math.abs(p1.y - p2.y) < 2) return 'horizontal';
    return 'diagonal';
  }

  private checkCollision(seg1: any, seg2: any): boolean {
    const THRESHOLD = 5; // Pixels tolerance for "overlapping"

    // 1. Parallel Check
    if (seg1.orientation !== seg2.orientation) return false;

    // 2. Co-linear Check (Distance)
    if (seg1.orientation === 'horizontal') {
      if (Math.abs(seg1.p1.y - seg2.p1.y) > THRESHOLD) return false;
      
      // 3. Interval Overlap Check (X-axis)
      return this.checkIntervalOverlap(
        Math.min(seg1.p1.x, seg1.p2.x), Math.max(seg1.p1.x, seg1.p2.x),
        Math.min(seg2.p1.x, seg2.p2.x), Math.max(seg2.p1.x, seg2.p2.x)
      );
    } 
    
    if (seg1.orientation === 'vertical') {
      if (Math.abs(seg1.p1.x - seg2.p1.x) > THRESHOLD) return false;

      // 3. Interval Overlap Check (Y-axis)
      return this.checkIntervalOverlap(
        Math.min(seg1.p1.y, seg1.p2.y), Math.max(seg1.p1.y, seg1.p2.y),
        Math.min(seg2.p1.y, seg2.p2.y), Math.max(seg2.p1.y, seg2.p2.y)
      );
    }

    return false;
  }

  private checkIntervalOverlap(min1: number, max1: number, min2: number, max2: number): boolean {
    // Standard interval intersection: max(min1, min2) < min(max1, max2)
    // We add a small buffer to avoid touching-endpoints being flagged as full overlaps
    return Math.max(min1, min2) < Math.min(max1, max2) - 2; 
  }

  // --- Line Drift Algorithm (Collision Resolution) ---
  
  private isAdjusting = false; // Guard against infinite loops

  private initLineDrift() {
    let timeout: ReturnType<typeof setTimeout>;
    const debouncedCheck = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (this.isAdjusting) return;
        this.runCollisionCheck();
      }, 300);
    };

    this.eventBus.on('connection.changed', () => debouncedCheck());
    this.eventBus.on('elements.changed', (event: any) => {
      const elements = event.elements ?? [];
      const hasConnectionOrShape = elements.some((el: any) =>
        el?.type === 'bpmn:SequenceFlow' || (el?.type && el.type.startsWith('bpmn:') && el.type !== 'bpmn:Process' && el.type !== 'bpmn:Participant' && el.type !== 'bpmn:Lane')
      );
      if (hasConnectionOrShape) debouncedCheck();
    });
    this.eventBus.on('shape.move.end', () => debouncedCheck());
    this.eventBus.on('bendpoint.move.end', () => debouncedCheck());
    this.eventBus.on('connectionSegment.move.end', () => debouncedCheck());
  }

  private runCollisionCheck() {
    const allConnections = this.elementRegistry.filter((e: any) => e.type === 'bpmn:SequenceFlow');
    if (allConnections.length === 0) return;

    const maxPasses = 5;
    for (let pass = 0; pass < maxPasses; pass++) {
      let anyUpdated = false;
      for (const conn of allConnections) {
        if (this.resolveLineDrift(conn)) anyUpdated = true;
      }
      if (!anyUpdated) break;
    }
  }

  private resolveLineDrift(targetConnection: any): boolean {
    const allConnections = this.elementRegistry.filter((e: any) =>
      e.type === 'bpmn:SequenceFlow' && e.id !== targetConnection.id
    );

    const waypoints = targetConnection.waypoints;
    if (!waypoints || waypoints.length < 2) return false;

    let newWaypoints = waypoints.map((w: { x: number; y: number }) => ({ x: w.x, y: w.y }));
    let needsUpdate = false;

    const parallelGroup = allConnections.filter((other: any) =>
      (targetConnection.source === other.source && targetConnection.target === other.target) ||
      (targetConnection.source === other.target && targetConnection.target === other.source)
    );
    if (parallelGroup.length > 0) {
      const allParallel = [targetConnection, ...parallelGroup].sort((a: any, b: any) => a.id.localeCompare(b.id));
      const index = allParallel.findIndex((c: any) => c.id === targetConnection.id);
      const n = allParallel.length;
      const offset = (index - (n - 1) / 2) * 18;
      if (Math.abs(offset) > 1) {
        this.applyDriftToWaypoints(newWaypoints, offset);
        needsUpdate = true;
      }
    }

    allConnections.forEach((other: any) => {
      const isParallel = (
        (targetConnection.source === other.source && targetConnection.target === other.target) ||
        (targetConnection.source === other.target && targetConnection.target === other.source)
      );
      if (isParallel) return;

      const overlap = this.checkConnectionOverlapDetails(
        { waypoints: newWaypoints } as any,
        other
      );
      if (overlap) {
        const offset = 18;
        const direction = overlap.isPositiveDirection ? 1 : -1;
        this.applySegmentDrift(newWaypoints, overlap.segmentIndex, offset * direction, overlap.orientation);
        needsUpdate = true;
      }
    });

    if (needsUpdate) {
      this.isAdjusting = true;
      try {
        this.modeling.updateWaypoints(targetConnection, newWaypoints);
      } finally {
        setTimeout(() => { this.isAdjusting = false; }, 100);
      }
    }
    return needsUpdate;
  }

  private checkConnectionOverlapDetails(conn1: any, conn2: any): any {
    for (let i = 0; i < conn1.waypoints.length - 1; i++) {
        const p1 = conn1.waypoints[i];
        const p2 = conn1.waypoints[i+1];
        const orientation = this.getOrientation(p1, p2);
        
        for (let j = 0; j < conn2.waypoints.length - 1; j++) {
            const q1 = conn2.waypoints[j];
            const q2 = conn2.waypoints[j+1];
            const otherOrientation = this.getOrientation(q1, q2);

            // Only care if parallel orientation
            if (orientation !== otherOrientation) continue;

            const seg1 = { p1, p2, orientation };
            const seg2 = { p1: q1, p2: q2, orientation: otherOrientation };

            if (this.checkCollision(seg1, seg2)) {
                // Return collision details
                // Determine direction: should we push conn1 Positive or Negative?
                // Compare center coordinate
                let isPositiveDirection = true;
                if (orientation === 'horizontal') {
                    // Compare Y
                    const center1 = (p1.y + p2.y) / 2;
                    const center2 = (q1.y + q2.y) / 2;
                    isPositiveDirection = center1 >= center2;
                } else {
                    // Compare X
                    const center1 = (p1.x + p2.x) / 2;
                    const center2 = (q1.x + q2.x) / 2;
                    isPositiveDirection = center1 >= center2;
                }

                return { segmentIndex: i, orientation, isPositiveDirection };
            }
        }
    }
    return null;
  }

  private applySegmentDrift(waypoints: any[], segmentIndex: number, offset: number, orientation: string) {
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

  private applyDriftToWaypoints(waypoints: { x: number; y: number }[], offset: number) {
    for (let i = 2; i < waypoints.length - 1; i++) {
      waypoints[i].y += offset;
    }
  }
}
