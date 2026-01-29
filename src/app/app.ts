import { Component } from '@angular/core';
import { BpmnModelerComponent } from './bpmn-modeler/bpmn-modeler';

@Component({
  selector: 'app-root',
  imports: [BpmnModelerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {}
