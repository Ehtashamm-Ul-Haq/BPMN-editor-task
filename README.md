# BpmnDemo

Angular app with an embedded BPMN modeler (bpmn-js). Load and edit BPMN diagrams with lane-aware auto-layout and collision-free sequence flows.

## Overview

- **Auto-arrange** — Button to automatically arrange elements by lanes and topological rank (Manhattan-style layout).
- **Line overlap prevention** — Sequence flows from the same source share the same start point, then fan out so lines do not overlap; drift is applied after the first segment. Collisions are resolved on connection change, shape move, and bendpoint move.

## Setup

```bash
npm install
```

## Run

```bash
ng serve
```

Open **http://localhost:4200** in your browser. The app reloads on source changes.

## Build

```bash
ng build
```

Output is in `dist/`.

