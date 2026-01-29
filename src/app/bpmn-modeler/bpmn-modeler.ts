import { Component, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { lastValueFrom } from 'rxjs';
import BpmnModeler from 'bpmn-js/lib/Modeler';
import { BpmnLayoutService, type BpmnLayoutContext } from './layout';

interface ModelerServices {
  elementRegistry: BpmnLayoutContext['elementRegistry'];
  modeling: BpmnLayoutContext['modeling'] & { createShape: (shape: unknown, position: { x: number; y: number }, parent: unknown) => void };
  canvas: BpmnLayoutContext['canvas'] & { zoom: (preset: string) => void };
  bpmnFactory: { create: (type: string, opts: object) => unknown };
  elementFactory: { createShape: (opts: object) => unknown };
  dragDrop: { start: (event: MouseEvent, opts: { element: unknown }) => void };
  eventBus: { on: (event: string, fn: (e?: unknown) => void) => void };
}

@Component({
  selector: 'app-bpmn-modeler',
  templateUrl: './bpmn-modeler.html',
  styleUrls: ['./bpmn-modeler.css'],
  standalone: true
})
export class BpmnModelerComponent implements AfterViewInit {
  @ViewChild('container', { static: true }) private container!: ElementRef;
  private modeler: BpmnModeler | null = null;

  constructor(
    private http: HttpClient,
    private layoutService: BpmnLayoutService
  ) {}

  private getLayoutContext(): BpmnLayoutContext {
    return {
      elementRegistry: this.elementRegistry,
      modeling: this.modeling,
      canvas: this.canvas
    };
  }

  async ngAfterViewInit() {
    this.modeler = new BpmnModeler({
      container: this.container.nativeElement
    });

    try {
      const xml = await lastValueFrom(this.http.get('diagram.bpmn', { responseType: 'text' }));
      await this.modeler.importXML(xml);
      this.canvas.zoom('fit-viewport');
      this.initLineDrift();
    } catch (err) {
      console.error('Error loading BPMN diagram', err);
    }
  }

  get elementRegistry(): ModelerServices['elementRegistry'] { return this.modeler!.get('elementRegistry'); }
  get modeling(): ModelerServices['modeling'] { return this.modeler!.get('modeling'); }
  get canvas(): ModelerServices['canvas'] { return this.modeler!.get('canvas'); }
  get bpmnFactory(): ModelerServices['bpmnFactory'] { return this.modeler!.get('bpmnFactory'); }
  get elementFactory(): ModelerServices['elementFactory'] { return this.modeler!.get('elementFactory'); }
  get dragDrop(): ModelerServices['dragDrop'] { return this.modeler!.get('dragDrop'); }
  get eventBus(): ModelerServices['eventBus'] { return this.modeler!.get('eventBus'); }

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
    const participantEl = participant as { children?: unknown[]; y?: number; height?: number };
    const currentElements = participantEl.children?.length ?? 0;
    const x = 200 + (currentElements * 120);
    const y = (participantEl.y ?? 0) + ((participantEl.height ?? 0) / 2);

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
    this.layoutService.autoLayout(this.getLayoutContext());
  }

  detectCollisions() {
    const conflicts = this.layoutService.detectCollisions(this.getLayoutContext());
    console.log('Collision Detection Report:', conflicts);
    if (conflicts.length > 0) {
      alert(`Found ${conflicts.length} line collisions! Check console for details.`);
    } else {
      alert('No collisions detected.');
    }
  }

  private initLineDrift() {
    let timeout: ReturnType<typeof setTimeout>;
    const debouncedCheck = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => this.layoutService.resolveEdgeCollisions(this.getLayoutContext()), 300);
    };

    this.eventBus.on('connection.changed', () => debouncedCheck());
    this.eventBus.on('elements.changed', (event: unknown) => {
      const e = event as { elements?: Array<{ type?: string }> };
      const elements = e.elements ?? [];
      const hasConnectionOrShape = elements.some((el) =>
        el?.type === 'bpmn:SequenceFlow' || (el?.type?.startsWith('bpmn:') && el.type !== 'bpmn:Process' && el.type !== 'bpmn:Participant' && el.type !== 'bpmn:Lane')
      );
      if (hasConnectionOrShape) debouncedCheck();
    });
    this.eventBus.on('shape.move.end', () => debouncedCheck());
    this.eventBus.on('bendpoint.move.end', () => debouncedCheck());
    this.eventBus.on('connectionSegment.move.end', () => debouncedCheck());
  }
}
