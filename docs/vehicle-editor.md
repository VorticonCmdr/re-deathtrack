# Vehicle Foundry

Vehicle Foundry is a local vehicle mesh editor with a Node.js backend and a stdio MCP server. Open `vehicles.html` through Vite; no original game files are needed. It creates custom authoring assets and edits original DOS `.TBL` vehicles without rebuilding their binary containers. Loading custom models into the remaster garage/race is a separate integration step.

## Start

```sh
npm install
npm run vehicle:studio
```

Open <http://127.0.0.1:5188/vehicles.html>. The existing `npm run dev` also serves the editor/API on its own port. Use **one Vite instance for an active Foundry workspace**, and point MCP at that same instance. Node must satisfy Vite's engine requirements (Node 22.12+ recommended).

Projects and their last 40 undo states are saved under `.local/vehicles/`, which is already ignored by git. Individual writes use a temporary file plus atomic rename. Requests within one server are serialized and every mutation requires the current revision. UI and MCP clients share this revision, document and history. The browser polls for external changes when no drag, text entry or dialog is active. Revision conflicts reload the latest document and report that the attempted edit was not applied.

The editor requires the local Node/Vite server; the built HTML alone does not provide a filesystem API on GitHub Pages. Existing game pages still build normally. Export JSON for portable backups.

## Modeling

- Start from the editable Interceptor or an empty project.
- Add boxes, tapered wedges and twelve-sided wheels. Wheels run along the X axis.
- Use the component tree to select, name, hide or reveal parts.
- Drag in the large view to orbit, scroll to zoom, and Fit views to reframe.
- Drag components in Top, Side or Front to move them on that view's plane. Optional snapping uses 0.05 m increments. A complete drag is one undoable change.
- Switch to Vertices, select a mesh point or choose its index, then drag in an orthographic view or enter coordinates and click Apply vertex. Position/Dimensions also have an explicit Apply coordinates control; Enter applies the relevant coordinates.
- Rotate components in 90° increments, duplicate, or create a copy mirrored across global X=0. Mirroring reverses polygon winding.
- Set per-component panel colors; switch Wireframe to Solid + edges for a shaded shape check.
- Undo/redo works across human and MCP edits and survives reloads. Ctrl/⌘ Z, Shift Z, Ctrl/⌘ D, Delete, 1/2 and F have shortcuts.

Units are metres, X is width, Y is up and **+Z is forward**. Part vertices are world-space coordinates; rotation and scale apply around the component bounding-box center. Faces use zero-based vertex indices. Vertices can be moved freely; there is no automatic welding, subdivision, UV painting, rigging, or manifold/planarity repair. The preview is a lightweight projected Canvas wireframe/polygon renderer, not a physical-material render.

Import accepts original `.TBL` files and this editor's JSON format and always creates a new project. OBJ export includes visible geometry and object names; it does not include colors/material libraries or hidden parts. JSON preserves editable geometry, visibility and colors. Limits: 80 components, 2,048 vertices per component, 10,000 vertices total, 4,096 faces per component, 32 indices per face, coordinates within ±1,000 m, and 3 MB HTTP requests. Invalid indices, duplicate indices in a face, duplicate component IDs and nonfinite coordinates are rejected before saving.

A working [MCP-authored Marauder example](../examples/vehicles/marauder.vehicle.json) is included. Import it using “Import JSON / TBL.” Original files in `game/` are never overwritten or bundled.

## MCP setup

Keep the editor server running. Configure any stdio MCP client to launch Node with the absolute script path:

```json
{
  "mcpServers": {
    "vehicle-foundry": {
      "command": "node",
      "args": ["/Users/valentin.pletzer/Downloads/dosgames/Deathtrack/server/vehicle-mcp.mjs"],
      "env": {"VEHICLE_STUDIO_URL": "http://127.0.0.1:5188"}
    }
  }
}
```

Adapt the path on another computer. If a GUI client cannot find Node, use the absolute Node executable path. This is a configuration example; creating these files does not automatically register a server with your MCP host.

The server uses the [official TypeScript SDK's local stdio transport](https://ts.sdk.modelcontextprotocol.io/server), implemented as plain Node.js ESM. Logs/errors stay off the protocol channel. MCP communicates with the local editor API; `VEHICLE_STUDIO_URL` only accepts local HTTP hosts. There is no arbitrary-file-read/write tool, remote service or account requirement.

| Tool | Purpose |
|---|---|
| `vehicle_list` | Project IDs, names and revisions |
| `vehicle_create` | New `blank` or `interceptor` project |
| `vehicle_get` | Full document, current revision and history availability |
| `vehicle_edit` | One atomic, undoable operation |
| `vehicle_undo`, `vehicle_redo` | Shared document history, with revision checks |
| `vehicle_originals` | Available original TBL filenames in `game/` |
| `vehicle_inspect_original` | Model indices and counts for a library file or uploaded base64 TBL |
| `vehicle_import_original` | New editable copy of the chosen file/model |
| `vehicle_export` | JSON/OBJ text, or TBL base64 and filename; no arbitrary filesystem destination |

`vehicle_edit` operations: `rename`, `add`, `mesh`, `update`, `remove`, `duplicate`, `vertex`, `transform`. `mesh` creates a custom polygon component; `update` changes name/color/visibility; `transform` accepts translation, positive scale factors and Euler rotations in degrees. Read component IDs from `vehicle_get`; do not invent IDs or revisions.

Example tool call after reading a project's current revision:

```json
{
  "id": "PROJECT-ID-FROM-VEHICLE-GET",
  "revision": 3,
  "operation": {
    "type": "add",
    "kind": "box",
    "name": "Left armored sill",
    "size": [0.16, 0.24, 2.5],
    "position": [-1.04, 0.63, 0],
    "color": "#d89c68"
  }
}
```

For this agent's command-line workflow, the included client makes **real MCP calls** without requiring changes to the host configuration:

```sh
npm run vehicle:tool
npm run vehicle:tool -- vehicle_list '{}'
npm run vehicle:tool -- vehicle_create '{"name":"New contender","preset":"blank"}'
```

With no arguments it prints tool schemas. Otherwise pass the tool name and a JSON argument object; failures return a nonzero exit. The MCP response contains JSON data in its text content.

## Verification

`node scripts/inspect-vehicle-mcp.mjs` connects through the SDK's real stdio client, creates a demonstration project, and verifies create/add/mirror/vertex/undo/redo/export, stale-revision rejection and invalid-geometry rejection without a revision change. It writes review exports under `.local/vehicle-review/` and leaves its new project in the workspace. Run from the repository root while the studio is running.

Interactive browser checks covered adding and undoing a wedge, component selection, numeric vertex application, a top-view drag and its undo, and live UI→MCP→UI synchronization. A UI cockpit vertex edit was read back through MCP; an MCP rename appeared automatically in the open editor. Desktop and narrow responsive layouts were inspected. Production build and existing 166-check verification passed; those existing checks primarily cover the faithful game, not editor behavior.

## Original vehicle editing

Choose **Open original vehicle** to browse the twelve player/rival showroom files and `SHAPE.TBL` from your local `game/` folder. Alternatively import a `.TBL` from disk. Select a model, then open an editable copy. `MYCAR0/1/2.TBL` and named rival files are showroom/driver previews; the 124-model `SHAPE.TBL` contains race cars and scenery. Model indices are zero-based.

Use Vertices to reshape existing points, or apply whole-mesh position, dimensions and rotations. **Export vehicle → Original game file** downloads a binary `.TBL` with the original filename. The source in `game/` is never overwritten. JSON backups also retain the complete source container for later TBL export. Importing the exported TBL starts another editable project.

This is a topology-preserving mode: adding/removing vertices, faces or components is disabled. Existing lines, repeated indices, draw groups, LOD thresholds, offsets, reserved bytes and every other model are retained. An unchanged import exports byte-for-byte identically. Geometry uses 0.05 metres per original unit, with the original Y/Z axes exchanged for the editor; export rounds to signed 16-bit coordinates. Geometry fit excludes embedded normal vectors. Face palette colors are shown individually; setting Panel color recolors the mesh to the nearest EGA palette entry, preserving the high bits of both color bytes. Visibility and names remain editor-only metadata for TBL exports.

Whole-mesh transforms update face and group normal vectors using inverse scale and rotation. Individual vertex edits recompute affected face normals, preserving sign and magnitude; original group sorting normals remain unchanged for these local edits. Edits that collapse a previously nondegenerate face or make shared normals inconsistent are rejected. This does not guarantee that large reshaping preserves the original renderer's hand-authored draw order, so inspect major edits in the original renderer. This is not a general converter from custom Foundry geometry to DOS TBL.

MCP uses the same import/edit/export path:

```sh
npm run vehicle:tool -- vehicle_originals '{}'
npm run vehicle:tool -- vehicle_inspect_original '{"filename":"mycar0.tbl"}'
npm run vehicle:tool -- vehicle_import_original '{"filename":"mycar0.tbl","modelIndex":0}'
```

Read the returned project ID/revision, edit with `vehicle_edit`, and call `vehicle_export` with `format: "tbl"`. Decode the returned `base64` to obtain the binary file. The import/inspect tools also accept `base64` for a user-supplied file. Library access is restricted to known TBL basenames, not arbitrary paths.

`node scripts/inspect-vehicle-tbl.mjs` checks all 136 original models for exact round trips, translated/rotated/scaled exports, preservation of other models, edited-file reimport, vertex edits and invalid inputs. Browser verification also decoded the downloaded MYCAR0 file after changing its first vertex from X=22 to X=23 in original units.
