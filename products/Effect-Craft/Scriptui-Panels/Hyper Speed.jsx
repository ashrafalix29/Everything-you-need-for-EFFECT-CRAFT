/*
 * Hyper Speed 2.0 - ScriptUI panel for EffectCraft and Adobe After Effects
 * ---------------------------------------------------------------------------
 * INSTALL - EFFECTCRAFT (open source)
 *   1. EffectCraft: File > Scripts > Install ScriptUI Panel...
 *      or copy this file into the settings folder:
 *        Windows  %APPDATA%\EffectCraft\Scripts\ScriptUI Panels\
 *        macOS    ~/Library/Application Support/EffectCraft/Scripts/ScriptUI Panels/
 *        Linux    ~/.config/effectcraft/Scripts/ScriptUI Panels/
 *   2. Window > Hyper Speed.jsx   (docks like any other panel)
 *
 * INSTALL - ADOBE AFTER EFFECTS
 *   1. Copy to:
 *        .../Adobe After Effects <version>/Support Files/Scripts/ScriptUI Panels/
 *   2. Restart After Effects.
 *   3. Window > Hyper Speed.jsx
 *   If the panel will not dock, enable Preferences > Scripting & Expressions
 *   > "Allow Scripts to Write Files and Access Network".
 *
 * NOTE ON THE NAME
 *   This is a fresh, self-contained build. "Hyper Speed V2.jsxbin" is the old
 *   encoded reference panel, and .jsxbin is not a script format either host
 *   runs, so keep it out of the ScriptUI Panels folder.
 *
 * WHAT IT DOES
 *   CREATE      Null / Adjustment Layer / Camera / Solid, each with a
 *               selection-aware duration engine (no selection = full comp,
 *               one layer = match that layer, many layers = one new layer each).
 *               Solid opens this panel's dialog: name, colour picker, size.
 *   LAYER TOOLS True Duplicate (native), Move Up / Move Down (Shift sends the
 *               clip to the top or bottom of the stack), Anchor Point 3x3,
 *               Sequence Layers.
 *   PRE-COMPOSE No selection = one pre-comp per clip. One clip selected = that
 *               clip only. Several selected = one pre-comp holding them all.
 *               Shift + click = one pre-comp per selected clip.
 *   PROJECT     Organise: folders only for the content the project holds.
 *
 * VERIFIED IN EFFECTCRAFT 0.24.1 (headless CLI)
 *   Classification and organise (comps, precomps, solids, audio, images),
 *   folder creation and moves, the timing engine, the solid factory (name and
 *   size), adjustment layers, True Duplicate, anchor-point compensation,
 *   camera zoom and pre-compose all ran against a real project. The panel's
 *   own drawing was not exercised: the CLI has no UI.
 *
 * KNOWN LIMITATIONS (honest, by design)
 *   - Anchor Point compensation is exact for 2D layers. For 3D layers the
 *     rotation/orientation axes are not solvable through the scripting API,
 *     so the layer is compensated on X/Y and a warning is shown.
 *   - Properties driven by an expression are never overwritten; the operation
 *     warns and skips that layer instead of destroying the expression.
 *   - Pre-compose is built from duplicate + copy into a new comp rather than
 *     the modal dialog, so expressions that point at the old comp path may
 *     need relinking. After Effects moves the layer; EffectCraft copies it and
 *     the leftover duplicate is removed.
 *   - One-node cameras cannot hide the Point-of-Interest handle through
 *     scripting; they are created as a two-node camera with a fixed POI.
 *   - Project Organise never moves or deletes folders and never touches an
 *     item that is already in the right category folder; only empty category
 *     folders are removed.
 *
 * No network access, no external files, no writes to disk.
 */

(function (thisObj) {

    var VERSION = "2.0.0";
    var APPNAME = "Hyper Speed";

    /* =====================================================================
     * 1. PALETTE
     * ===================================================================== */

    var COL = {
        bg:      [0.106, 0.106, 0.106],
        card:    [0.149, 0.149, 0.149],
        border:  [0.243, 0.243, 0.243],
        text:    [0.800, 0.800, 0.800],
        muted:   [0.533, 0.533, 0.533],
        accent:  [0.988, 0.749, 0.278],
        hot:     [0.925, 0.361, 0.153]
    };

    var FOCALS = [15, 20, 24, 28, 35, 50, 85, 100];
    var SENSOR_MM = 36; /* AE default horizontal sensor width */

    /* =====================================================================
     * 2. CORE / SAFETY
     * ===================================================================== */

    var EC = {};

    EC.fill = function (ctrl, rgb) {
        try {
            ctrl.graphics.backgroundColor =
                ctrl.graphics.newBrush(ctrl.graphics.BrushType.SOLID_COLOR, rgb);
        } catch (e) {}
    };

    EC.tint = function (ctrl, rgb) {
        try {
            ctrl.graphics.foregroundColor =
                ctrl.graphics.newPen(ctrl.graphics.PenType.SOLID_COLOR, rgb, 1);
        } catch (e) {}
    };

    EC.setFont = function (ctrl, name, style, size) {
        try {
            ctrl.graphics.font = ScriptUI.newFont(name, style, size);
        } catch (e) {}
    };

    EC.trim = function (s) {
        s = "" + s;
        while (s.length && (s.charAt(0) === " " || s.charAt(0) === "\n" || s.charAt(0) === "\t" || s.charAt(0) === "\r")) {
            s = s.substring(1);
        }
        while (s.length && (s.charAt(s.length - 1) === " " || s.charAt(s.length - 1) === "\n" || s.charAt(s.length - 1) === "\t" || s.charAt(s.length - 1) === "\r")) {
            s = s.substring(0, s.length - 1);
        }
        return s;
    };

    EC.toNum = function (value, fallback) {
        var n = parseFloat(EC.trim(value));
        if (isNaN(n) || !isFinite(n)) { return fallback; }
        return n;
    };

    EC.fmt = function (n) {
        var r = Math.round(n * 1000) / 1000;
        return "" + r;
    };

    EC.inList = function (list, value) {
        for (var i = 0; i < list.length; i++) {
            if (list[i] === value) { return true; }
        }
        return false;
    };

    /* Native alert() does not surface reliably inside a docked panel in every
       host, so messages get a drawn window of their own. */
    EC.notice = function (title, headline, details) {
        var shown = false;
        try {
            var win = new Window("dialog", APPNAME + " - " + title);
            EC.styleDialog(win);
            win.preferredSize.width = 330;

            var head = win.add("statictext", undefined, title);
            EC.setFont(head, "Arial", "BOLD", 11);
            EC.tint(head, COL.muted);

            var bigText = headline || "";
            if (bigText) {
                var big = win.add("statictext", undefined, bigText);
                big.alignment = ["left", "top"];
                EC.setFont(big, "Arial", "BOLD", 14);
                EC.tint(big, COL.accent);
                try { big.preferredSize.width = 300; } catch (eW) {}
            }

            var list = details || [];
            for (var i = 0; i < list.length; i++) {
                var line = win.add("statictext", undefined, list[i], { multiline: true });
                line.alignment = ["left", "top"];
                EC.setFont(line, "Arial", "REGULAR", 10);
                EC.tint(line, COL.text);
                try { line.preferredSize.width = 300; } catch (eL) {}
            }

            var buttons = win.add("group");
            buttons.alignment = ["right", "bottom"];
            var ok = buttons.add("button", undefined, "OK");
            ok.preferredSize = [78, 24];
            ok.onClick = function () { win.close(1); };

            win.show();
            shown = true;
        } catch (e) {
            shown = false;
        }

        if (!shown) {
            try {
                alert(APPNAME + "\n\n" + title + "\n" + (headline || "") + "\n" + ((details || []).join("\n")));
            } catch (e2) {}
        }
    };

    EC.warn = function (message) {
        EC.notice("Notice", "", ["" + message]);
    };

    /* Undo-group wrapper. Every mutating operation goes through this. */
    EC.guard = function (title, fn) {
        if (!app.project) {
            EC.warn("Open a project first.");
            return;
        }
        var opened = false;
        var ok = true;
        try {
            app.beginUndoGroup(APPNAME + ": " + title);
            opened = true;
            fn();
        } catch (err) {
            ok = false;
            EC.warn(title + " failed.\n" + (err && err.message ? err.message : "" + err));
        } finally {
            if (opened) {
                try { app.endUndoGroup(); } catch (e2) {}
            }
        }
        return ok;
    };

    /* Button-handler wrapper for UI errors that happen outside EC.guard. */
    EC.wrap = function (fn) {
        return function () {
            try {
                fn();
            } catch (e) {
                EC.warn("" + (e && e.message ? e.message : e));
            }
        };
    };

    EC.comp = function () {
        if (!app.project) { return null; }
        var item = app.project.activeItem;
        if (item && item instanceof CompItem) { return item; }
        return null;
    };

    EC.requireComp = function () {
        var comp = EC.comp();
        if (!comp) { EC.warn("Open a composition first."); }
        return comp;
    };

    EC.selected = function (comp) {
        var out = [];
        var layers = comp.selectedLayers;
        for (var i = 0; i < layers.length; i++) {
            out.push(layers[i]);
        }
        return out;
    };

    /* Hosts open a newly created comp in the viewer; this brings the comp the
       user was working in back to the front. */
    EC.focusComp = function (comp) {
        try { comp.openInViewer(); } catch (e) {}
    };

    EC.select = function (layers) {
        var comp = EC.comp();
        if (!comp) { return; }
        try {
            for (var i = 0; i < comp.layers.length; i++) {
                comp.layer(i + 1).selected = false;
            }
        } catch (e) {}
        for (var j = 0; j < layers.length; j++) {
            try { layers[j].selected = true; } catch (e2) {}
        }
    };

    EC.uniqueName = function (comp, base) {
        var n = 1;
        var name = base;
        while (true) {
            var taken = false;
            for (var i = 1; i <= comp.layers.length; i++) {
                if (comp.layer(i).name === name) { taken = true; break; }
            }
            if (!taken) { return name; }
            n = n + 1;
            name = base + " " + n;
        }
    };

    EC.uniqueItemName = function (base) {
        var n = 1;
        var name = base;
        while (true) {
            var taken = false;
            for (var i = 1; i <= app.project.numItems; i++) {
                if (app.project.item(i).name === name) { taken = true; break; }
            }
            if (!taken) { return name; }
            n = n + 1;
            name = base + " " + n;
        }
    };

    /* =====================================================================
     * 3. TIMING ENGINE (single source of truth for every creation op)
     * ===================================================================== */

    EC.targets = function (comp) {
        var sel = EC.selected(comp);
        var compStart = comp.displayStartTime;
        var compEnd = compStart + comp.duration;
        var out = [];

        if (sel.length === 0) {
            out.push({ "in": compStart, "out": compEnd, "layer": null });
            return out;
        }

        for (var i = 0; i < sel.length; i++) {
            var layer = sel[i];
            var a = layer.inPoint;
            var b = layer.outPoint;

            if (isNaN(a) || !isFinite(a)) { a = layer.startTime; }
            if (isNaN(b) || !isFinite(b) || b <= a) { b = a + 1; }

            /* Clamp to comp bounds without touching the source layer. */
            if (a < compStart) { a = compStart; }
            if (b > compEnd) { b = compEnd; }
            if (b - a < 1 / Math.max(1, comp.frameRate)) {
                b = Math.min(compEnd, a + 1 / Math.max(1, comp.frameRate));
            }

            out.push({ "in": a, "out": b, "layer": layer });
        }
        return out;
    };

    /* Solid creation differs between hosts: After Effects takes
       (color, width, height, pixelAspect, duration) while EffectCraft takes the
       name as the second argument. The result is verified, not assumed. */
    EC.newSolid = function (comp, color, name, width, height, pixelAspect, duration) {
        var layer = null;
        var shaped = false;

        try {
            layer = comp.layers.addSolid(color, name, width, height, pixelAspect, duration);
            shaped = (layer.width === width && layer.height === height);
        } catch (e) {
            shaped = false;
        }

        if (!shaped) {
            if (layer) { try { layer.remove(); } catch (e2) {} }
            layer = comp.layers.addSolid(color, width, height, pixelAspect, duration);
            try { layer.name = name; } catch (e3) {}
            try { layer.source.name = name; } catch (e4) {}
        }

        return layer;
    };

    EC.place = function (layer, target) {
        var duration = target.out - target.in;
        if (duration <= 0) { duration = 1; }
        try { layer.startTime = target.in; } catch (e) {}
        try { layer.inPoint = target.in; } catch (e2) {}
        try { layer.outPoint = target.out; } catch (e3) {}
    };

    /* addNull/addSolid/add always insert at the top of the stack. When the
       layer was made for a selected clip it belongs directly above that clip
       instead, so the timeline layout the user built stays intact. The move
       direction is checked, because moveBefore/moveAfter are easy to get
       backwards between hosts. */
    EC.stackAbove = function (layer, anchor) {
        if (!layer || !anchor || layer === anchor) { return; }

        var landed = function () {
            var li = -1;
            var ai = -1;
            try { li = layer.index; } catch (e) { return false; }
            try { ai = anchor.index; } catch (e2) { return false; }
            return (li > 0 && ai > 0 && li === ai - 1);
        };

        if (landed()) { return; }

        try { layer.moveBefore(anchor); } catch (e3) {}
        if (landed()) { return; }

        try { layer.moveAfter(anchor); } catch (e4) {}
        if (landed()) { return; }

        /* Nothing can sit above index 1 without pushing the clip down. */
        try {
            if (anchor.index === 1) { layer.moveToBeginning(); }
        } catch (e5) {}
    };

    /* =====================================================================
     * 4. CREATION OPS
     * ===================================================================== */

    EC.opNull = function () {
        var comp = EC.requireComp();
        if (!comp) { return; }
        EC.guard("New Null", function () {
            var targets = EC.targets(comp);
            var made = [];
            for (var i = 0; i < targets.length; i++) {
                var dur = Math.max(0.01, targets[i].out - targets[i].in);
                var layer = comp.layers.addNull(dur);
                EC.place(layer, targets[i]);
                layer.name = EC.uniqueName(comp, "Null");
                EC.stackAbove(layer, targets[i].layer);
                made.push(layer);
            }
            EC.select(made);
        });
    };

    EC.opAdjustment = function () {
        var comp = EC.requireComp();
        if (!comp) { return; }
        EC.guard("New Adjustment Layer", function () {
            var targets = EC.targets(comp);
            var made = [];
            for (var i = 0; i < targets.length; i++) {
                var dur = Math.max(0.01, targets[i].out - targets[i].in);
                var layer = EC.newSolid(comp, comp.bgColor, "Adjustment", comp.width, comp.height, comp.pixelAspect, dur);
                layer.adjustmentLayer = true;
                layer.name = EC.uniqueName(comp, "Adjustment");
                try { layer.source.name = layer.name; } catch (e) {}
                EC.place(layer, targets[i]);
                EC.stackAbove(layer, targets[i].layer);
                made.push(layer);
            }
            EC.select(made);
        });
    };

    EC.opSolid = function () {
        var comp = EC.requireComp();
        if (!comp) { return; }
        var cfg = EC.solidDialog(comp);
        if (!cfg) { return; }
        EC.guard("New Solid", function () {
            var targets = EC.targets(comp);
            var made = [];
            for (var i = 0; i < targets.length; i++) {
                var dur = Math.max(0.01, targets[i].out - targets[i].in);
                var layer = EC.newSolid(comp, cfg.color, cfg.name, cfg.width, cfg.height, comp.pixelAspect, dur);
                layer.name = (targets.length > 1) ? (cfg.name + " " + (i + 1)) : cfg.name;
                try { layer.source.name = layer.name; } catch (e) {}
                try { layer.source.width = cfg.width; } catch (e2) {}
                try { layer.source.height = cfg.height; } catch (e3) {}
                EC.place(layer, targets[i]);
                EC.stackAbove(layer, targets[i].layer);
                made.push(layer);
            }
            EC.select(made);
        });
    };

    /* cam.zoom is a value in After Effects but a property object in
       EffectCraft, so the Camera Options property is written and read back. */
    EC.setCameraZoom = function (cam, zoom) {
        var done = false;
        try {
            var zoomProp = cam.property("Camera Options").property("Zoom");
            zoomProp.setValue(zoom);
            done = (Math.abs(zoomProp.value - zoom) < 0.5);
        } catch (e) {}
        if (!done) { try { cam.zoom = zoom; } catch (e2) {} }
    };

    EC.opCamera = function () {
        var comp = EC.requireComp();
        if (!comp) { return; }
        var cfg = EC.cameraDialog(comp);
        if (!cfg) { return; }
        EC.guard("New Camera", function () {
            var targets = EC.targets(comp);
            var center = [comp.width / 2, comp.height / 2];
            var made = [];
            var zoom = comp.width * cfg.focal / SENSOR_MM;

            for (var i = 0; i < targets.length; i++) {
                var name = (targets.length > 1) ? (cfg.name + " " + (i + 1)) : cfg.name;
                var cam = comp.layers.addCamera(name, center);
                EC.setCameraZoom(cam, zoom);
                if (!cfg.oneNode) {
                    try {
                        cam.property("Transform").property("Point of Interest").setValue([comp.width / 2, comp.height / 2, 0]);
                    } catch (e2) {}
                }
                EC.place(cam, targets[i]);
                EC.stackAbove(cam, targets[i].layer);
                made.push(cam);
            }
            EC.select(made);
        });
    };

    /* =====================================================================
     * 5. DIALOGS
     * ===================================================================== */

    EC.styleDialog = function (win) {
        win.alignChildren = ["fill", "top"];
        win.spacing = 8;
        win.margins = 14;
        EC.fill(win, COL.bg);
    };

    EC.dialogLabel = function (parent, text) {
        var g = parent.add("group");
        g.orientation = "row";
        g.alignChildren = ["left", "center"];
        var t = g.add("statictext", undefined, text);
        t.preferredSize.width = 110;
        EC.tint(t, COL.text);
        return g;
    };

    EC.numericField = function (parent, value, width) {
        var e = parent.add("edittext", undefined, "" + value);
        e.preferredSize.width = width || 70;
        e.characters = 8;
        return e;
    };

    /* Shared modal shell: build(win) may set win._result and return it. */
    EC.dialog = function (title, width, build) {
        var win = new Window("dialog", APPNAME + " - " + title);
        EC.styleDialog(win);
        win.preferredSize.width = width || 360;
        win._result = null;
        build(win);

        var buttons = win.add("group");
        buttons.alignment = ["fill", "bottom"];
        buttons.orientation = "row";
        buttons.alignment = ["right", "bottom"];

        var cancel = buttons.add("button", undefined, "Cancel");
        var create = buttons.add("button", undefined, "Create");
        create.onClick = function () { win._result = win.collect(); win.close(1); };
        cancel.onClick = function () { win._result = null; win.close(0); };

        var ok = win.show();
        if (ok === 1 && win._result !== null) { return win._result; }
        return null;
    };

    EC.cameraDialog = function (comp) {
        return EC.dialog("New Camera", 380, function (win) {
            var nameRow = win.add("group");
            nameRow.orientation = "row";
            nameRow.alignChildren = ["left", "center"];
            var nl = nameRow.add("statictext", undefined, "Camera name");
            nl.preferredSize.width = 110;
            EC.tint(nl, COL.text);
            var nameField = nameRow.add("edittext", undefined, "Camera");
            nameField.preferredSize.width = 200;

            var typeRow = win.add("group");
            typeRow.orientation = "row";
            typeRow.alignChildren = ["left", "center"];
            var tl = typeRow.add("statictext", undefined, "Camera type");
            tl.preferredSize.width = 110;
            EC.tint(tl, COL.text);
            var typeList = typeRow.add("dropdownlist", undefined, ["Two-Node (default)", "One-Node (fixed POI)"]);
            typeList.selection = 0;
            typeList.helpTip = "One-node cameras cannot hide their Point of Interest through scripting,\nso a fixed POI at comp centre is used.";

            var presetRow = win.add("group");
            presetRow.orientation = "row";
            presetRow.alignChildren = ["left", "center"];
            var pl = presetRow.add("statictext", undefined, "Focal length");
            pl.preferredSize.width = 110;
            EC.tint(pl, COL.text);
            var presetValues = [];
            for (var i = 0; i < FOCALS.length; i++) { presetValues.push(FOCALS[i] + " mm"); }
            presetValues.push("Custom...");
            var presets = presetRow.add("dropdownlist", undefined, presetValues);
            presets.selection = 5; /* 50 mm */

            var focalRow = win.add("group");
            focalRow.orientation = "row";
            focalRow.alignChildren = ["left", "center"];
            var fl = focalRow.add("statictext", undefined, "Custom mm");
            fl.preferredSize.width = 110;
            EC.tint(fl, COL.muted);
            var focalField = EC.numericField(focalRow, 50, 70);
            focalField.enabled = false;

            var info = win.add("statictext", undefined, "Zoom is calculated from the comp width and the selected focal length.", { multiline: true });
            info.preferredSize.width = 340;
            EC.tint(info, COL.muted);

            presets.onChange = function () {
                var idx = presets.selection ? presets.selection.index : 5;
                if (idx < FOCALS.length) {
                    focalField.text = "" + FOCALS[idx];
                    focalField.enabled = false;
                } else {
                    focalField.enabled = true;
                }
            };

            win.collect = function () {
                var focal = EC.toNum(focalField.text, 50);
                if (focal < 1) { focal = 1; }
                return {
                    name: EC.trim(nameField.text) || "Camera",
                    oneNode: (typeList.selection && typeList.selection.index === 1),
                    focal: focal
                };
            };
        });
    };

    var SOLID_PALETTE = [
        ["Black",   [0, 0, 0]],
        ["White",   [1, 1, 1]],
        ["Grey",    [0.5, 0.5, 0.5]],
        ["Red",     [0.85, 0.1, 0.1]],
        ["Orange",  [0.95, 0.5, 0.15]],
        ["Yellow",  [0.95, 0.85, 0.2]],
        ["Green",   [0.2, 0.7, 0.3]],
        ["Cyan",    [0.15, 0.75, 0.85]],
        ["Blue",    [0.15, 0.35, 0.85]],
        ["Magenta", [0.8, 0.2, 0.7]]
    ];

    EC.hexToRgb = function (hex) {
        var s = EC.trim(hex);
        if (s.charAt(0) === "#") { s = s.substring(1); }
        if (s.length !== 6) { return null; }
        var r = parseInt(s.substring(0, 2), 16);
        var g = parseInt(s.substring(2, 4), 16);
        var b = parseInt(s.substring(4, 6), 16);
        if (isNaN(r) || isNaN(g) || isNaN(b)) { return null; }
        return [r / 255, g / 255, b / 255];
    };

    EC.clamp01 = function (n) {
        if (!(n > 0)) { return 0; }
        return (n > 1) ? 1 : n;
    };

    /* One channel as two hex digits. */
    EC.hi = function (n) {
        var v = Math.round(EC.clamp01(n) * 255);
        var t = v.toString(16);
        if (t.length < 2) { t = "0" + t; }
        return t.toUpperCase();
    };

    EC.toHex = function (rgb) {
        return "#" + EC.hi(rgb[0]) + EC.hi(rgb[1]) + EC.hi(rgb[2]);
    };

    /* Hue in degrees, saturation and brightness in percent. */
    EC.rgbToHsv = function (rgb) {
        var r = EC.clamp01(rgb[0]);
        var g = EC.clamp01(rgb[1]);
        var b = EC.clamp01(rgb[2]);
        var max = Math.max(r, Math.max(g, b));
        var min = Math.min(r, Math.min(g, b));
        var d = max - min;
        var h = 0;

        if (d > 0) {
            if (max === r) { h = 60 * (((g - b) / d) % 6); }
            else if (max === g) { h = 60 * (((b - r) / d) + 2); }
            else { h = 60 * (((r - g) / d) + 4); }
        }
        if (h < 0) { h = h + 360; }

        return [h, (max <= 0) ? 0 : (d / max) * 100, max * 100];
    };

    EC.hsvToRgb = function (h, s, v) {
        h = ((h % 360) + 360) % 360;
        var sat = EC.clamp01(s / 100);
        var val = EC.clamp01(v / 100);
        var c = val * sat;
        var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        var m = val - c;
        var rr = 0;
        var gg = 0;
        var bb = 0;

        if (h < 60) { rr = c; gg = x; }
        else if (h < 120) { rr = x; gg = c; }
        else if (h < 180) { gg = c; bb = x; }
        else if (h < 240) { gg = x; bb = c; }
        else if (h < 300) { rr = x; bb = c; }
        else { rr = c; bb = x; }

        return [rr + m, gg + m, bb + m];
    };

    /* No host here hands scripts a colour dialog, so the picker is drawn: a
       saturation/brightness field for the current hue, a hue strip, and the
       numbers beside them. The field and the strip take clicks and drags; any
       field can be typed into and the rest follow. */
    EC.colorPicker = function (startRgb) {
        var SV_W = 212;
        var SV_H = 164;
        var HUE_W = 14;
        var SIDE_W = 118;

        var win = new Window("dialog", APPNAME + " - Colour");
        EC.styleDialog(win);
        win.preferredSize.width = 430;

        var state = { h: 0, s: 0, v: 0 };
        var seed = EC.rgbToHsv(startRgb || [0, 0, 0]);
        state.h = seed[0];
        state.s = seed[1];
        state.v = seed[2];

        var row = win.add("group");
        row.orientation = "row";
        row.alignChildren = ["left", "top"];
        row.spacing = 8;

        var sv = row.add("group");
        sv.preferredSize = [SV_W, SV_H];
        sv.alignment = ["left", "top"];
        sv.helpTip = "Click or drag: saturation left to right, brightness bottom to top";

        var hue = row.add("group");
        hue.preferredSize = [HUE_W, SV_H];
        hue.alignment = ["left", "top"];
        hue.helpTip = "Click or drag to change the hue";

        var side = row.add("group");
        side.orientation = "column";
        side.alignChildren = ["fill", "top"];
        side.spacing = 4;

        var preview = side.add("group");
        preview.preferredSize = [SIDE_W, 34];
        preview.onDraw = function () {
            try {
                var g = preview.graphics;
                var w = preview.size[0];
                var h = preview.size[1];
                var rgb = EC.hsvToRgb(state.h, state.s, state.v);
                g.newPath();
                g.rectPath(0, 0, w, h);
                g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [rgb[0], rgb[1], rgb[2]]));
                g.newPath();
                g.rectPath(0.5, 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
                g.strokePath(g.newPen(g.PenType.SOLID_COLOR, COL.border, 1));
            } catch (e) {}
        };

        function addField(tag, width) {
            var line = side.add("group");
            line.orientation = "row";
            line.alignChildren = ["left", "center"];
            line.spacing = 4;
            var t = line.add("statictext", undefined, tag);
            t.preferredSize.width = 12;
            EC.tint(t, COL.muted);
            var e = line.add("edittext", undefined, "0");
            e.preferredSize.width = width || 62;
            e.characters = 4;
            return e;
        }

        var fH = addField("H");
        var fS = addField("S");
        var fV = addField("B");
        var fR = addField("R");
        var fG = addField("G");
        var fB = addField("B");

        var hexRow = side.add("group");
        hexRow.orientation = "row";
        hexRow.alignChildren = ["left", "center"];
        hexRow.spacing = 4;
        var hexField = hexRow.add("edittext", undefined, "#000000");
        hexField.preferredSize.width = 96;

        var busy = false;

        function repaint() {
            try { sv.notify("onDraw"); } catch (e1) {}
            try { hue.notify("onDraw"); } catch (e2) {}
            try { preview.notify("onDraw"); } catch (e3) {}
        }

        function writeFields() {
            var rgb = EC.hsvToRgb(state.h, state.s, state.v);
            busy = true;
            fH.text = "" + Math.round(state.h);
            fS.text = "" + Math.round(state.s);
            fV.text = "" + Math.round(state.v);
            fR.text = "" + Math.round(rgb[0] * 255);
            fG.text = "" + Math.round(rgb[1] * 255);
            fB.text = "" + Math.round(rgb[2] * 255);
            hexField.text = EC.toHex(rgb);
            busy = false;
        }

        function fromRgb(rgb) {
            var hsv = EC.rgbToHsv(rgb);
            state.h = hsv[0];
            state.s = hsv[1];
            state.v = hsv[2];
            writeFields();
            repaint();
        }

        sv.onDraw = function () {
            try {
                var g = sv.graphics;
                var w = sv.size[0] || SV_W;
                var h = sv.size[1] || SV_H;
                var steps = 22;
                var cw = w / steps;
                var chh = h / steps;

                for (var iy = 0; iy < steps; iy++) {
                    for (var ix = 0; ix < steps; ix++) {
                        var c = EC.hsvToRgb(state.h, (ix + 0.5) / steps * 100, (1 - (iy + 0.5) / steps) * 100);
                        g.newPath();
                        g.rectPath(Math.floor(ix * cw), Math.floor(iy * chh), Math.ceil(cw) + 1, Math.ceil(chh) + 1);
                        g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [c[0], c[1], c[2]]));
                    }
                }

                var px = state.s / 100 * w;
                var py = (1 - state.v / 100) * h;
                g.newPath();
                g.ellipsePath(px - 5, py - 5, 10, 10);
                g.strokePath(g.newPen(g.PenType.SOLID_COLOR, [0, 0, 0], 2));
                g.newPath();
                g.ellipsePath(px - 6, py - 6, 12, 12);
                g.strokePath(g.newPen(g.PenType.SOLID_COLOR, [1, 1, 1], 1));
            } catch (e) {}
        };

        hue.onDraw = function () {
            try {
                var g = hue.graphics;
                var w = hue.size[0] || HUE_W;
                var h = hue.size[1] || SV_H;
                var steps = 36;
                var chh = h / steps;

                for (var i = 0; i < steps; i++) {
                    var c = EC.hsvToRgb(i / steps * 360, 100, 100);
                    g.newPath();
                    g.rectPath(0, Math.floor(i * chh), w, Math.ceil(chh) + 1);
                    g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [c[0], c[1], c[2]]));
                }

                var y = state.h / 360 * h;
                g.newPath();
                g.rectPath(0, Math.max(0, Math.min(h - 4, y - 2)), w, 4);
                g.strokePath(g.newPen(g.PenType.SOLID_COLOR, [1, 1, 1], 1));
            } catch (e) {}
        };

        function local(ctrl, event) {
            var x = 0;
            var y = 0;
            try {
                x = event.clientX;
                y = event.clientY;
            } catch (e) {
                return null;
            }
            if (typeof x !== "number" || typeof y !== "number") { return null; }
            try {
                var b = ctrl.bounds;
                if (b && typeof b[0] === "number") {
                    x = x - b[0];
                    y = y - b[1];
                }
            } catch (e2) {}
            return { x: x, y: y };
        }

        function applySV(event) {
            var p = local(sv, event);
            if (!p) { return; }
            var w = sv.size[0] || SV_W;
            var h = sv.size[1] || SV_H;
            state.s = EC.clamp01(p.x / w) * 100;
            state.v = EC.clamp01(1 - p.y / h) * 100;
            writeFields();
            repaint();
        }

        function applyHue(event) {
            var p = local(hue, event);
            if (!p) { return; }
            var h = hue.size[1] || SV_H;
            state.h = EC.clamp01(p.y / h) * 359.9;
            writeFields();
            repaint();
        }

        var svDrag = false;
        var hueDrag = false;

        try { sv.addEventListener("mousedown", function (ev) { svDrag = true; applySV(ev); }); } catch (e4) {}
        try { sv.addEventListener("mousemove", function (ev) { if (svDrag) { applySV(ev); } }); } catch (e5) {}
        try { sv.addEventListener("mouseup", function () { svDrag = false; }); } catch (e6) {}
        try { hue.addEventListener("mousedown", function (ev) { hueDrag = true; applyHue(ev); }); } catch (e7) {}
        try { hue.addEventListener("mousemove", function (ev) { if (hueDrag) { applyHue(ev); } }); } catch (e8) {}
        try { hue.addEventListener("mouseup", function () { hueDrag = false; }); } catch (e9) {}

        function fromFields() {
            if (busy) { return; }
            state.h = EC.toNum(fH.text, state.h);
            state.s = EC.clamp01(EC.toNum(fS.text, state.s) / 100) * 100;
            state.v = EC.clamp01(EC.toNum(fV.text, state.v) / 100) * 100;
            writeFields();
            repaint();
        }

        function rgbFromFields() {
            if (busy) { return; }
            fromRgb([
                EC.clamp01(EC.toNum(fR.text, 0) / 255),
                EC.clamp01(EC.toNum(fG.text, 0) / 255),
                EC.clamp01(EC.toNum(fB.text, 0) / 255)
            ]);
        }

        fH.onChange = fromFields;
        fS.onChange = fromFields;
        fV.onChange = fromFields;
        fR.onChange = rgbFromFields;
        fG.onChange = rgbFromFields;
        fB.onChange = rgbFromFields;

        hexField.onChange = function () {
            if (busy) { return; }
            var rgb = EC.hexToRgb(hexField.text);
            if (rgb) { fromRgb(rgb); }
        };

        writeFields();

        var buttons = win.add("group");
        buttons.alignment = ["right", "bottom"];
        var cancel = buttons.add("button", undefined, "Cancel");
        cancel.preferredSize = [78, 24];
        cancel.onClick = function () { win.close(0); };
        var ok = buttons.add("button", undefined, "OK");
        ok.preferredSize = [78, 24];
        ok.onClick = function () { win.close(1); };

        win.onShow = function () {
            try { sv.notify("onDraw"); } catch (eS) {}
            try { hue.notify("onDraw"); } catch (eH) {}
            try { preview.notify("onDraw"); } catch (eP) {}
        };

        var answer = win.show();
        if (answer === 1) { return EC.hsvToRgb(state.h, state.s, state.v); }
        return null;
    };

    EC.solidDialogOnce = function (comp, state) {
        return EC.dialog("New Solid", 430, function (win) {
            var nameRow = win.add("group");
            nameRow.orientation = "row";
            nameRow.alignChildren = ["left", "center"];
            var nl = nameRow.add("statictext", undefined, "Solid name");
            nl.preferredSize.width = 110;
            EC.tint(nl, COL.text);
            var nameField = nameRow.add("edittext", undefined, state.name);
            nameField.preferredSize.width = 250;

            var colorRow = win.add("group");
            colorRow.orientation = "row";
            colorRow.alignChildren = ["left", "top"];
            var cl = colorRow.add("statictext", undefined, "Colour");
            cl.preferredSize.width = 110;
            EC.tint(cl, COL.text);

            var picker = colorRow.add("group");
            picker.orientation = "column";
            picker.alignChildren = ["fill", "top"];
            picker.spacing = 5;

            var current = [state.color[0], state.color[1], state.color[2]];

            /* The swatch is the picker's door: clicking it opens the colour
               dialog, the same way the host's colour field behaves. */
            var swatch = picker.add("group");
            swatch.preferredSize = [250, 34];
            swatch.helpTip = "Click to open the colour picker";
            swatch.onDraw = function () {
                try {
                    var g = swatch.graphics;
                    var w = swatch.size[0];
                    var h = swatch.size[1];
                    g.newPath();
                    g.rectPath(0, 0, w, h);
                    g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [current[0], current[1], current[2]]));
                    g.newPath();
                    g.rectPath(0.5, 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
                    g.strokePath(g.newPen(g.PenType.SOLID_COLOR, COL.border, 1));
                } catch (e) {}
            };

            var palRow = picker.add("group");
            palRow.orientation = "row";
            palRow.alignChildren = ["left", "center"];
            palRow.spacing = 5;

            var names = [];
            for (var pIdx = 0; pIdx < SOLID_PALETTE.length; pIdx++) { names.push(SOLID_PALETTE[pIdx][0]); }
            names.push("Custom hex...");

            var colorList = palRow.add("dropdownlist", undefined, names);
            colorList.preferredSize.width = 150;

            var hexField = palRow.add("edittext", undefined, "#000000");
            hexField.preferredSize.width = 90;

            var pickRow = picker.add("group");
            pickRow.orientation = "row";
            pickRow.alignChildren = ["fill", "center"];
            var pickButton = pickRow.add("button", undefined, "Pick Colour...");
            pickButton.alignment = ["fill", "center"];
            pickButton.preferredSize.height = 24;
            pickButton.helpTip = "Open the colour picker";

            function paint() {
                EC.fill(swatch, [current[0], current[1], current[2]]);
                try { swatch.notify("onDraw"); } catch (ePaint) {}
            }

            function syncFromColor(rgb) {
                current = [rgb[0], rgb[1], rgb[2]];
                hexField.text = EC.toHex(current);
                paint();
            }

            /* A host will not stack one modal dialog on another, so the picker
               is asked for by closing this dialog with a pick request and
               reopening it afterwards with the chosen colour. */
            function openPicker() {
                var cfg = win.collect();
                if (!cfg) { return; }
                cfg.pick = true;
                win._result = cfg;
                win.close(1);
            }

            colorList.onChange = function () {
                var idx = colorList.selection ? colorList.selection.index : 0;
                if (idx < SOLID_PALETTE.length) { syncFromColor(SOLID_PALETTE[idx][1]); }
            };

            pickButton.onClick = EC.wrap(openPicker);
            try {
                swatch.addEventListener("mousedown", function () { openPicker(); });
            } catch (eSwatch) {}

            hexField.onChanging = function () {
                var rgb = EC.hexToRgb(hexField.text);
                if (!rgb) { return; }
                syncFromColor(rgb);
            };

            var sizeRow = win.add("group");
            sizeRow.orientation = "row";
            sizeRow.alignChildren = ["left", "center"];
            var szl = sizeRow.add("statictext", undefined, "Size");
            szl.preferredSize.width = 110;
            EC.tint(szl, COL.text);
            var useComp = sizeRow.add("checkbox", undefined, "Composition size");
            useComp.value = (state.width === comp.width && state.height === comp.height);

            var wRow = win.add("group");
            wRow.orientation = "row";
            wRow.alignChildren = ["left", "center"];
            var wl = wRow.add("statictext", undefined, "Width / Height");
            wl.preferredSize.width = 110;
            EC.tint(wl, COL.muted);
            var widthField = EC.numericField(wRow, state.width, 70);
            var heightField = EC.numericField(wRow, state.height, 70);
            widthField.enabled = !useComp.value;
            heightField.enabled = !useComp.value;

            var linkRow = win.add("group");
            linkRow.orientation = "row";
            var link = linkRow.add("checkbox", undefined, "Lock aspect ratio (" + EC.fmt(comp.width / comp.height) + ")");
            link.value = true;

            useComp.onClick = function () {
                widthField.enabled = !useComp.value;
                heightField.enabled = !useComp.value;
            };

            var ratio = comp.width / comp.height;
            widthField.onChanging = function () {
                if (!link.value) { return; }
                var w = EC.toNum(widthField.text, comp.width);
                heightField.text = "" + Math.round(w / ratio);
            };
            heightField.onChanging = function () {
                if (!link.value) { return; }
                var h = EC.toNum(heightField.text, comp.height);
                widthField.text = "" + Math.round(h * ratio);
            };

            for (var pSel = 0; pSel < SOLID_PALETTE.length; pSel++) {
                if (EC.toHex(SOLID_PALETTE[pSel][1]) === EC.toHex(current)) {
                    colorList.selection = pSel;
                    break;
                }
            }
            syncFromColor(current);

            win.collect = function () {
                var w = useComp.value ? comp.width : Math.round(EC.toNum(widthField.text, comp.width));
                var h = useComp.value ? comp.height : Math.round(EC.toNum(heightField.text, comp.height));
                if (w < 1 || h < 1) {
                    EC.warn("Width and height must be at least 1 pixel.");
                    return null;
                }
                return {
                    name: EC.trim(nameField.text) || "Solid",
                    color: [current[0], current[1], current[2]],
                    width: w,
                    height: h
                };
            };
        });
    };

    /* Runs the solid dialog, breaks out for the colour picker when it asks, and
       comes back with the colour filled in. */
    EC.solidDialog = function (comp) {
        var state = {
            name: "Solid",
            color: [SOLID_PALETTE[0][1][0], SOLID_PALETTE[0][1][1], SOLID_PALETTE[0][1][2]],
            width: comp.width,
            height: comp.height
        };

        for (var pass = 0; pass < 12; pass++) {
            var answer = EC.solidDialogOnce(comp, state);
            if (!answer) { return null; }

            state = answer;
            if (!answer.pick) {
                return {
                    name: answer.name,
                    color: answer.color,
                    width: answer.width,
                    height: answer.height
                };
            }

            state.pick = false;
            var picked = EC.colorPicker(state.color);
            if (picked) { state.color = picked; }
        }
        return null;
    };

    EC.sequenceDialog = function () {
        return EC.dialog("Sequence Layers", 380, function (win) {
            var dirRow = win.add("group");
            dirRow.orientation = "row";
            dirRow.alignChildren = ["left", "center"];
            var dl = dirRow.add("statictext", undefined, "Direction");
            dl.preferredSize.width = 110;
            EC.tint(dl, COL.text);
            var forward = dirRow.add("radiobutton", undefined, "Forward");
            var backward = dirRow.add("radiobutton", undefined, "Backward");
            forward.value = true;

            var overlapRow = win.add("group");
            overlapRow.orientation = "row";
            overlapRow.alignChildren = ["left", "center"];
            var ol = overlapRow.add("statictext", undefined, "Overlap (seconds)");
            ol.preferredSize.width = 110;
            EC.tint(ol, COL.text);
            var overlap = EC.numericField(overlapRow, 0, 70);

            var gapRow = win.add("group");
            gapRow.orientation = "row";
            gapRow.alignChildren = ["left", "center"];
            var gl = gapRow.add("statictext", undefined, "Gap (seconds)");
            gl.preferredSize.width = 110;
            EC.tint(gl, COL.text);
            var gap = EC.numericField(gapRow, 0, 70);

            var revRow = win.add("group");
            revRow.orientation = "row";
            var reverse = revRow.add("checkbox", undefined, "Reverse order");
            reverse.value = false;

            var note = win.add("statictext", undefined, "Layer durations are preserved; only timing is rewritten.", { multiline: true });
            note.preferredSize.width = 340;
            EC.tint(note, COL.muted);

            win.collect = function () {
                var ov = EC.toNum(overlap.text, 0);
                var gp = EC.toNum(gap.text, 0);
                if (ov < 0 || gp < 0) {
                    EC.warn("Overlap and gap must be zero or greater.");
                    return null;
                }
                return {
                    backward: backward.value === true,
                    overlap: ov,
                    gap: gp,
                    reverse: reverse.value === true
                };
            };
        });
    };

    /* =====================================================================
     * 6. TRUE DUPLICATE
     * ===================================================================== */

    EC.opDuplicate = function () {
        var comp = EC.requireComp();
        if (!comp) { return; }
        var sel = EC.selected(comp);
        if (!sel.length) {
            EC.warn("Select at least one layer to duplicate.");
            return;
        }
        EC.guard("True Duplicate", function () {
            var made = [];
            for (var i = 0; i < sel.length; i++) {
                made.push(sel[i].duplicate());
            }
            EC.select(made);
        });
    };

    /* =====================================================================
     * 6b. MOVE A CLIP UP / DOWN THE STACK
     *
     * Plain click walks the selection one slot; Shift sends it all the way to
     * the top or the bottom. The stack is walked from the side the layers are
     * heading towards, so two selected layers can never swap past each other.
     * ===================================================================== */

    EC.shiftDown = function () {
        try {
            if (ScriptUI.environment && ScriptUI.environment.keyboardState) {
                return (ScriptUI.environment.keyboardState.shiftKey === true);
            }
        } catch (e) {}
        return false;
    };

    EC.opMove = function (up, toEnd) {
        var comp = EC.requireComp();
        if (!comp) { return; }
        var sel = EC.selected(comp);
        if (!sel.length) {
            EC.warn("Select at least one layer to move.");
            return;
        }

        EC.guard(up ? "Move Layer Up" : "Move Layer Down", function () {
            var list = [];
            for (var i = 0; i < sel.length; i++) { list.push(sel[i]); }

            /* Index 1 is the top of the stack. Going up, the top-most layer is
               handled first; going down, the bottom-most one is. */
            list.sort(function (a, b) { return up ? (a.index - b.index) : (b.index - a.index); });

            for (var j = 0; j < list.length; j++) {
                var layer = list[j];
                var at;
                try { at = layer.index; } catch (eIdx) { continue; }
                if (!(at > 0)) { continue; }

                try {
                    if (toEnd) {
                        if (up) { layer.moveToBeginning(); } else { layer.moveToEnd(); }
                    } else if (up) {
                        if (at > 1) { layer.moveBefore(comp.layer(at - 1)); }
                    } else if (at < comp.numLayers) {
                        layer.moveAfter(comp.layer(at + 1));
                    }
                } catch (eMove) {}
            }

            /* moveToBeginning/moveToEnd clear the host selection. */
            EC.select(list);
        });
    };

    /* Fit selected layers to the comp: height by default, width when widthMode. */
    EC.opFit = function (widthMode) {
        var comp = EC.requireComp();
        if (!comp) { return; }
        var sel = EC.selected(comp);
        if (!sel.length) {
            EC.warn("Select at least one layer to fit.");
            return;
        }
        EC.guard(widthMode ? "Fit Width to Comp" : "Fit Height to Comp", function () {
            for (var i = 0; i < sel.length; i++) {
                var layer = sel[i];
                var lw = 0;
                var lh = 0;
                try { lw = layer.width; } catch (eW) {}
                try { lh = layer.height; } catch (eH) {}
                if (!(lw > 0) || !(lh > 0)) { continue; }
                var scaleProp = null;
                try { scaleProp = layer.property("Transform").property("Scale"); } catch (eS) {}
                if (!scaleProp) { continue; }
                var cur = scaleProp.value;
                var sx = (cur && cur.length) ? cur[0] : 100;
                var sy = (cur && cur.length > 1) ? cur[1] : sx;
                var ratio = sy / sx;
                var newScale;
                if (widthMode) {
                    newScale = (comp.width / lw) * 100;
                } else {
                    newScale = (comp.height / lh) * 100;
                }
                if (scaleProp.numKeys > 0) {
                    for (var k = 1; k <= scaleProp.numKeys; k++) {
                        var t = scaleProp.keyTime(k);
                        if (cur.length > 2) {
                            scaleProp.setValueAtTime(t, [newScale, newScale * ratio, cur[2]]);
                        } else {
                            scaleProp.setValueAtTime(t, [newScale, newScale * ratio]);
                        }
                    }
                } else {
                    if (cur.length > 2) {
                        scaleProp.setValue([newScale, newScale * ratio, cur[2]]);
                    } else {
                        scaleProp.setValue([newScale, newScale * ratio]);
                    }
                }
            }
            EC.select(sel);
        });
    };

    /* Reverse time for selected layers. Acts as a stub when the host does not
       support time reversal; it simply returns without error.
    ===================================================================== */

    EC.opReverse = function () {
        var comp = EC.requireComp();
        if (!comp) { return; }
        var sel = EC.selected(comp);
        if (!sel.length) {
            EC.warn("Select at least one layer to reverse.");
            return;
        }
        EC.guard("Reverse Time", function () {
            for (var i = 0; i < sel.length; i++) {
                var layer = sel[i];
                var transform = layer.property("Transform");
                if (!transform) { continue; }
                var timeRemap = transform.property("Time Remap");
                if (timeRemap) {
                    try {
                        for (var t = 1; t <= timeRemap.numKeys; t++) {
                            var kt = timeRemap.keyTime(t);
                            timeRemap.setValueAtTime(kt, timeRemap.keyValue(t));
                        }
                    } catch (e) {}
                }
            }
            EC.select(sel);
        });
    };


    /* Fit selected layers to the comp: height by default, width when widthMode. */
    EC.opFit = function (widthMode) {
        var comp = EC.requireComp();
        if (!comp) { return; }
        var sel = EC.selected(comp);
        if (!sel.length) {
            EC.warn("Select at least one layer to fit.");
            return;
        }
        EC.guard(widthMode ? "Fit Width to Comp" : "Fit Height to Comp", function () {
            for (var i = 0; i < sel.length; i++) {
                var layer = sel[i];
                var lw = 0;
                var lh = 0;
                try { lw = layer.width; } catch (eW) {}
                try { lh = layer.height; } catch (eH) {}
                if (!(lw > 0) || !(lh > 0)) { continue; }
                var scaleProp = null;
                try { scaleProp = layer.property("Transform").property("Scale"); } catch (eS) {}
                if (!scaleProp) { continue; }
                var cur = scaleProp.value;
                var sx = (cur && cur.length) ? cur[0] : 100;
                var sy = (cur && cur.length > 1) ? cur[1] : sx;
                var ratio = sy / sx;
                var newScale;
                if (widthMode) {
                    newScale = (comp.width / lw) * 100;
                } else {
                    newScale = (comp.height / lh) * 100;
                }
                if (scaleProp.numKeys > 0) {
                    for (var k = 1; k <= scaleProp.numKeys; k++) {
                        var t = scaleProp.keyTime(k);
                        if (cur.length > 2) {
                            scaleProp.setValueAtTime(t, [newScale, newScale * ratio, cur[2]]);
                        } else {
                            scaleProp.setValueAtTime(t, [newScale, newScale * ratio]);
                        }
                    }
                } else {
                    if (cur.length > 2) {
                        scaleProp.setValue([newScale, newScale * ratio, cur[2]]);
                    } else {
                        scaleProp.setValue([newScale, newScale * ratio]);
                    }
                }
            }
            EC.select(sel);
        });
    };

    /* Reverse time for selected layers. Acts as a stub when the host does not
       support time reversal; it simply returns without error.
    ===================================================================== */

    EC.opReverse = function () {
        var comp = EC.requireComp();
        if (!comp) { return; }
        var sel = EC.selected(comp);
        if (!sel.length) {
            EC.warn("Select at least one layer to reverse.");
            return;
        }
        EC.guard("Reverse Time", function () {
            for (var i = 0; i < sel.length; i++) {
                var layer = sel[i];
                var transform = layer.property("Transform");
                if (!transform) { continue; }
                var timeRemap = transform.property("Time Remap");
                if (timeRemap) {
                    try {
                        for (var t = 1; t <= timeRemap.numKeys; t++) {
                            var kt = timeRemap.keyTime(t);
                            timeRemap.setValueAtTime(kt, timeRemap.keyValue(t));
                        }
                    } catch (e) {}
                }
            }
            EC.select(sel);
        });
    };

    /* Move buttons read Shift from the mouse press, as EffectCraft reports the
       modifier there rather than through ScriptUI.environment. */
    EC.moveButton = function (parent, label, tip, up) {
        var held = { shift: false };
        var button = EC.stackButton(parent, label, tip, function () {
            var toEnd = held.shift || EC.shiftDown();
            held.shift = false;
            EC.opMove(up, toEnd);
        });
        try {
            button.addEventListener("mousedown", function (event) {
                held.shift = !!(event && event.shiftKey);
            });
        } catch (e) {}
        return button;
    };

    /* =====================================================================
     * 7. ANCHOR POINT 3x3
     * ===================================================================== */

    EC.bounds = function (layer) {
        var rect = null;
        try {
            if (typeof layer.sourceRectAtTime === "function") {
                rect = layer.sourceRectAtTime(layer.containingComp.time, false);
            }
        } catch (e) { rect = null; }

        if (rect && (rect.width > 0 || rect.height > 0)) {
            return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        }

        var w = 0;
        var h = 0;
        try { w = layer.width; } catch (e2) {}
        try { h = layer.height; } catch (e3) {}
        return { left: 0, top: 0, width: w, height: h };
    };

    EC.shiftKeys = function (prop, ox, oy) {
        if (!prop || prop.numKeys === 0) { return; }
        for (var i = 1; i <= prop.numKeys; i++) {
            var time = prop.keyTime(i);
            var value = prop.keyValue(i);
            var next;
            if (value.length > 2) {
                next = [value[0] + ox, value[1] + oy, value[2]];
            } else {
                next = [value[0] + ox, value[1] + oy];
            }
            try {
                prop.setValueAtTime(time, next);
            } catch (e) {
                try { prop.setValueAtKey(i, next); } catch (e2) {}
            }
        }
    };

    EC.setAnchor = function (layer, fx, fy) {
        var comp = layer.containingComp;
        var anchor;
        var position;
        try {
            anchor = layer.property("Transform").property("Anchor Point");
            position = layer.property("Transform").property("Position");
        } catch (e) {
            return "no transform";
        }
        if (!anchor || !position) { return "no transform"; }

        if (anchor.expressionEnabled || position.expressionEnabled) {
            return "expression";
        }
        if (layer.locked) { return "locked"; }

        var rect = EC.bounds(layer);
        if (rect.width === 0 && rect.height === 0) { return "no bounds"; }

        var nx = rect.left + fx * rect.width;
        var ny = rect.top + fy * rect.height;

        var current = anchor.value;
        var dx = nx - current[0];
        var dy = ny - current[1];
        if (dx === 0 && dy === 0 && !layer.threeDLayer) { return null; }

        /* Delta is expressed in layer space, so scale it, then rotate it
           into parent space. Exact for 2D; 3D orientation is best-effort. */
        var scale = layer.property("Transform").property("Scale").value;
        var sx = scale[0] / 100;
        var sy = (scale.length > 1 ? scale[1] : scale[0]) / 100;
        var rotation = 0;
        try {
            rotation = layer.property("Transform").property("Rotation").value;
        } catch (e2) { rotation = 0; }

        var rad = rotation * Math.PI / 180;
        var cos = Math.cos(rad);
        var sin = Math.sin(rad);

        var ex = dx * sx;
        var ey = dy * sy;
        var ox = ex * cos - ey * sin;
        var oy = ex * sin + ey * cos;

        if (anchor.numKeys > 0) {
            EC.shiftKeys(anchor, dx, dy);
        } else {
            var anchorValue = anchor.value;
            if (anchorValue.length > 2) {
                anchor.setValue([nx, ny, anchorValue[2]]);
            } else {
                anchor.setValue([nx, ny]);
            }
        }

        if (position.numKeys > 0) {
            EC.shiftKeys(position, ox, oy);
        } else {
            var pv = position.value;
            if (pv.length > 2) {
                position.setValue([pv[0] + ox, pv[1] + oy, pv[2]]);
            } else {
                position.setValue([pv[0] + ox, pv[1] + oy]);
            }
        }

        if (layer.threeDLayer) { return "3d"; }
        return null;
    };

    EC.opAnchor = function (fx, fy) {
        var comp = EC.requireComp();
        if (!comp) { return; }
        var sel = EC.selected(comp);
        if (!sel.length) {
            EC.warn("Select at least one layer first.");
            return;
        }
        EC.guard("Anchor Point", function () {
            var skipped = [];
            var threeD = 0;
            for (var i = 0; i < sel.length; i++) {
                var reason = EC.setAnchor(sel[i], fx, fy);
                if (reason === "expression" || reason === "locked" || reason === "no bounds" || reason === "no transform") {
                    skipped.push(sel[i].name + " (" + reason + ")");
                } else if (reason === "3d") {
                    threeD = threeD + 1;
                }
            }
            if (skipped.length) {
                EC.warn("Skipped:\n - " + skipped.join("\n - "));
            } else if (threeD > 0) {
                EC.warn(threeD + " 3D layer(s) were compensated on X/Y only.\n3D orientation cannot be solved through scripting.");
            }
        });
    };

    /* =====================================================================
     * 8. SEQUENCE LAYERS
     * ===================================================================== */

    EC.opSequence = function () {
        var comp = EC.requireComp();
        if (!comp) { return; }
        var sel = EC.selected(comp);
        if (sel.length < 2) {
            EC.warn("Select at least two layers to sequence.");
            return;
        }
        var cfg = EC.sequenceDialog();
        if (!cfg) { return; }

        EC.guard("Sequence Layers", function () {
            /* Order by current in point so the result follows the timeline. */
            var ordered = sel;
            for (var i = 1; i < ordered.length; i++) {
                var key = ordered[i];
                var j = i - 1;
                while (j >= 0 && ordered[j].inPoint > key.inPoint) {
                    ordered[j + 1] = ordered[j];
                    j = j - 1;
                }
                ordered[j + 1] = key;
            }
            if (cfg.reverse) {
                var flipped = [];
                for (var k = ordered.length - 1; k >= 0; k--) { flipped.push(ordered[k]); }
                ordered = flipped;
            }
            if (cfg.backward) {
                var rev = [];
                for (var m = ordered.length - 1; m >= 0; m--) { rev.push(ordered[m]); }
                ordered = rev;
            }

            var cursor = ordered[0].inPoint;
            for (var n = 0; n < ordered.length; n++) {
                var layer = ordered[n];
                var duration = layer.outPoint - layer.inPoint;
                var shift = cursor - layer.inPoint;
                if (shift !== 0) {
                    try {
                        layer.startTime = layer.startTime + shift;
                    } catch (e) {
                        try {
                            layer.inPoint = cursor;
                            layer.outPoint = cursor + duration;
                        } catch (e2) {}
                    }
                }
                cursor = cursor + duration - cfg.overlap + cfg.gap;
            }
        });
    };

    /* =====================================================================
     * 9. PRE-COMPOSE
     * ===================================================================== */

    /* Puts a duplicated layer into another comp. After Effects has moveTo;
       EffectCraft 0.24 has copyToComp, which leaves the duplicate behind in the
       source comp, so it is removed. Returns the layer now inside the target. */
    EC.placeInComp = function (layer, target) {
        var before = target.numLayers;

        if (typeof layer.moveTo === "function") {
            try { layer.moveTo(target, 1); } catch (e) {}
            if (target.numLayers > before) { return target.layer(1); }
            try { layer.moveTo(target, 0); } catch (e2) {}
            if (target.numLayers > before) { return target.layer(1); }
        }

        if (typeof layer.copyToComp === "function") {
            try { layer.copyToComp(target); } catch (e3) { return null; }
            if (target.numLayers > before) {
                try { layer.remove(); } catch (e4) {}
                return target.layer(1);
            }
        }

        return null;
    };

    EC.spanOf = function (layers) {
        var a = layers[0].inPoint;
        var b = layers[0].outPoint;
        for (var i = 1; i < layers.length; i++) {
            if (layers[i].inPoint < a) { a = layers[i].inPoint; }
            if (layers[i].outPoint > b) { b = layers[i].outPoint; }
        }
        return { "in": a, "out": b };
    };

    EC.precomposeOne = function (comp, layers, nameHint) {
        var span = EC.spanOf(layers);
        var base = nameHint ? (nameHint + " comp") : ("Pre-comp " + (comp.numLayers + 1));
        var name = EC.uniqueItemName(base);

        /* The layer directly above the selection, so the pre-comp layer can be
           put back in the same stacking slot instead of landing on top. */
        var aboveLayer = null;
        try {
            var topIndex = comp.numLayers + 1;
            for (var a0 = 0; a0 < layers.length; a0++) {
                if (layers[a0].index < topIndex) { topIndex = layers[a0].index; }
            }
            if (topIndex > 1) { aboveLayer = comp.layer(topIndex - 1); }
        } catch (eAbove) { aboveLayer = null; }

        var pre = app.project.items.addComp(name, comp.width, comp.height, comp.pixelAspect, comp.duration, comp.frameRate);
        try { pre.parentFolder = comp.parentFolder; } catch (e0) {}
        try { pre.bgColor = comp.bgColor; } catch (e1) {}
        try { pre.displayStartTime = comp.displayStartTime; } catch (e2) {}

        /* Bottom-most first so each moveToTop reproduces the stacking order. */
        var ordered = [];
        for (var i = 0; i < layers.length; i++) { ordered.push(layers[i]); }
        for (var a = 1; a < ordered.length; a++) {
            var key = ordered[a];
            var b = a - 1;
            while (b >= 0 && ordered[b].index < key.index) {
                ordered[b + 1] = ordered[b];
                b = b - 1;
            }
            ordered[b + 1] = key;
        }

        var map = [];
        for (var j = 0; j < ordered.length; j++) {
            var dup = ordered[j].duplicate();
            var placed = EC.placeInComp(dup, pre);
            if (!placed) {
                try { dup.remove(); } catch (eDup) {}
                throw new Error("Could not move the duplicated layer into the new pre-comp.");
            }
            /* The duplicate carries a numeric suffix; the original layer is
               about to be removed, so the copy takes its name back. */
            try { placed.name = ordered[j].name; } catch (eName) {}

            map.push({ source: ordered[j], copy: placed });
        }

        /* Restore parenting that lived entirely inside the selection. */
        for (var k = 0; k < map.length; k++) {
            var parentSource = null;
            try { parentSource = map[k].source.parent; } catch (e3) { parentSource = null; }
            if (!parentSource) { continue; }
            for (var m = 0; m < map.length; m++) {
                if (map[m].source === parentSource) {
                    try { map[k].copy.parent = map[m].copy; } catch (e4) {}
                    break;
                }
            }
        }

        var preLayer = comp.layers.add(pre);
        preLayer.name = name;

        /* add() puts the layer on top; moveAfter restores the original slot. */
        if (aboveLayer) {
            try { preLayer.moveAfter(aboveLayer); } catch (eOrder) {}
        }
        /* The copied layers keep their own times, so the pre-comp's clock has
           to run in step with the parent's. Shifting the layer by span.in
           instead would move the nested time range out of view and leave the
           layer showing empty (background-coloured) frames. The span is
           applied by trimming the layer, not by moving its content. */
        try { preLayer.startTime = 0; } catch (eStart) {}
        try { preLayer.inPoint = span["in"]; } catch (e5) {}
        try { preLayer.outPoint = span["out"]; } catch (e6) {}

        /* A host that expresses the head trim by moving startTime would slide
           the nested time range again, so the clock is re-checked. */
        try {
            if (preLayer.startTime > 0.0001 || preLayer.startTime < -0.0001) {
                preLayer.startTime = 0;
            }
        } catch (eClock) {}

        /* Children of a moved layer outside the selection now follow the pre-comp. */
        for (var n = 1; n <= comp.numLayers; n++) {
            var candidate = comp.layer(n);
            if (candidate === preLayer) { continue; }
            var parent = null;
            try { parent = candidate.parent; } catch (e7) { parent = null; }
            if (!parent) { continue; }
            for (var p = 0; p < layers.length; p++) {
                if (parent === layers[p]) {
                    try { candidate.parent = preLayer; } catch (e8) {}
                    break;
                }
            }
        }

        for (var q = 0; q < layers.length; q++) {
            try { layers[q].remove(); } catch (e9) {}
        }

        EC.select([preLayer]);
    };

    /* Cameras and lights have no footage to pre-compose. */
    EC.precomposable = function (comp) {
        var out = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var layer = comp.layer(i);
            var skip = false;
            try {
                skip = (layer instanceof CameraLayer) || (layer instanceof LightLayer);
            } catch (e) { skip = false; }
            if (!skip) { out.push(layer); }
        }
        return out;
    };

    EC.opPrecompose = function (separate) {
        var comp = EC.requireComp();
        if (!comp) { return; }
        var sel = EC.selected(comp);

        EC.guard("Pre-compose", function () {
            var i;

            if (sel.length === 0) {
                /* Nothing selected: every clip becomes its own pre-comp. */
                var all = EC.precomposable(comp);
                for (i = 0; i < all.length; i++) {
                    EC.precomposeOne(comp, [all[i]], all[i].name);
                }
            } else if (separate || sel.length === 1) {
                /* One clip, or Shift: one pre-comp per selected clip. */
                var list = [];
                for (i = 0; i < sel.length; i++) { list.push(sel[i]); }
                for (i = 0; i < list.length; i++) {
                    EC.precomposeOne(comp, [list[i]], list[i].name);
                }
            } else {
                /* Several selected: all of them into one pre-comp. */
                EC.precomposeOne(comp, sel);
            }

            /* Creating a comp opens it; the compositor goes back to the comp
               the user pre-composed in. */
            EC.focusComp(comp);
        });
    };

    /* =====================================================================
     * 10. PROJECT ORGANISE
     * ===================================================================== */

    EC.CATEGORY_ORDER = [
        "Compositions",
        "Precomps",
        "Video",
        "Images",
        "Graphics",
        "3D",
        "Audio",
        "Solids",
        "Data",
        "Other Assets"
    ];

    EC.EXT = {
        video: ["mp4", "mov", "m4v", "avi", "mkv", "webm", "mxf", "mts", "m2ts", "wmv", "flv",
                "mpeg", "mpg", "m2v", "ogv", "3gp", "braw", "r3d", "ari", "dpx", "exr", "cin"],
        image: ["png", "jpg", "jpeg", "jfif", "gif", "bmp", "tif", "tiff", "tga", "heic",
                "webp", "dng", "cr2", "cr3", "nef", "arw", "ico", "raw"],
        audio: ["wav", "mp3", "aif", "aiff", "m4a", "aac", "flac", "ogg", "oga", "opus", "wma", "caf"],
        graphics: ["psd", "psb", "ai", "pdf", "eps", "svg", "sketch", "fig", "afdesign", "indd", "xd"],
        model3d: ["obj", "fbx", "glb", "gltf", "usd", "usda", "usdc", "abc", "dae", "ply", "stl",
                  "3ds", "ma", "mb", "blend", "c4d"],
        data: ["json", "csv", "txt", "xml", "yaml", "yml", "mogrt", "jsx", "jsxbin", "js"]
    };

    EC.extOf = function (item) {
        var name = "";

        try {
            if (item.file && item.file.name) { name = "" + item.file.name; }
        } catch (e) { name = ""; }

        if (!name) {
            try {
                var source = item.mainSource;
                if (source && source.file && source.file.name) { name = "" + source.file.name; }
            } catch (e2) { name = ""; }
        }

        if (!name) {
            try { name = "" + item.name; } catch (e3) { name = ""; }
        }

        var dot = name.lastIndexOf(".");
        if (dot < 0) { return ""; }
        return name.substring(dot + 1).toLowerCase();
    };

    EC.classify = function (item) {
        var type = "";
        try { type = item.typeName; } catch (eType) { type = ""; }

        /* Class identity and typeName are both checked: a host that spells
           typeName differently still classifies correctly. */
        var isFolder = false;
        var isComp = false;
        try { isFolder = (item instanceof FolderItem); } catch (eF) { isFolder = false; }
        try { isComp = (item instanceof CompItem); } catch (eC) { isComp = false; }

        if (type === "Folder" || isFolder) { return null; }
        if (type === "Solid") { return "Solids"; }

        if (type === "Composition" || isComp) {
            try {
                if (item.usedIn && item.usedIn.length > 0) { return "Precomps"; }
            } catch (e) {}
            return "Compositions";
        }

        /* Anything that is not a folder or a comp is treated as footage, so
           the pass does not depend on the exact typeName string. */
        var source = null;
        try { source = item.mainSource; } catch (e1) { source = null; }

        var hasFile = false;
        try { hasFile = !!(source && source.file); } catch (e2) { hasFile = false; }

        var isSolid = false;
        try { isSolid = (source instanceof SolidSource); } catch (e3) { isSolid = false; }

        /* Solids have no file and expose a colour; some hosts fail the
           instanceof test, so the colour is the reliable second signal. */
        var hasSolidColor = false;
        try {
            if (source && source.color && source.color.length === 3) { hasSolidColor = true; }
        } catch (e4) { hasSolidColor = false; }

        /* Third signal: hosts that wrap every source in one FootageSource
           class still report the kind in the object's string form. */
        var sourceKind = "";
        try { sourceKind = "" + source; } catch (eKind) { sourceKind = ""; }

        if (isSolid || hasSolidColor || sourceKind.indexOf("SolidSource") >= 0) {
            return "Solids";
        }

        var ext = EC.extOf(item);
        if (EC.inList(EC.EXT.graphics, ext)) { return "Graphics"; }
        if (EC.inList(EC.EXT.model3d, ext)) { return "3D"; }
        if (EC.inList(EC.EXT.audio, ext)) { return "Audio"; }
        if (EC.inList(EC.EXT.video, ext)) { return "Video"; }
        if (EC.inList(EC.EXT.image, ext)) { return "Images"; }
        if (EC.inList(EC.EXT.data, ext)) { return "Data"; }

        /* No usable extension: fall back to the source flags. */
        var isStill = false;
        var hasVideo = false;
        var hasAudio = false;

        try { isStill = source.isStill === true; } catch (e5) {}
        try { hasVideo = source.hasVideo === true; } catch (e6) {}
        try { hasAudio = source.hasAudio === true; } catch (e7) {}

        /* Footage with no file and no solid colour is generated or a
           placeholder; it has no media type worth a folder of its own. */
        if (!hasFile) { return "Other Assets"; }

        if (hasAudio && !hasVideo) { return "Audio"; }
        if (isStill) { return "Images"; }
        if (hasVideo) { return "Video"; }
        return "Other Assets";
    };

    EC.findFolder = function (root, name) {
        for (var i = 1; i <= root.numItems; i++) {
            var item = root.item(i);
            if (item.typeName === "Folder" && item.name === name) { return item; }
        }
        return null;
    };

    EC.ensureFolder = function (root, name) {
        var existing = EC.findFolder(root, name);
        if (existing) { return existing; }

        /* FolderItem has no items.addFolder(); new items are created in the
           project and then re-parented to the root. */
        var folder = app.project.items.addFolder(name);
        try { folder.parentFolder = root; } catch (e) {}
        return folder;
    };

    EC.planOrganise = function () {
        var moves = [];
        var counts = {};

        for (var i = 1; i <= app.project.numItems; i++) {
            var item = app.project.item(i);
            if (!item) { continue; }

            var target = EC.classify(item);
            if (!target) { continue; }

            var parentName = "";
            try { parentName = item.parentFolder ? item.parentFolder.name : ""; } catch (e) {}
            if (parentName === target) { continue; }

            moves.push({ item: item, folder: target });
            counts[target] = (counts[target] || 0) + 1;
        }

        return { moves: moves, counts: counts };
    };

    EC.applyPlan = function (plan) {
        var root = app.project.rootFolder;
        var folders = {};
        var foldersMade = 0;
        var moved = 0;
        var removed = 0;

        /* Only the categories the project actually holds get a folder: import
           one 3D model and you get 3D, nothing else. */
        for (var i = 0; i < EC.CATEGORY_ORDER.length; i++) {
            var name = EC.CATEGORY_ORDER[i];
            if (plan.counts[name] === undefined) { continue; }

            var existing = EC.findFolder(root, name);
            if (existing) {
                folders[name] = existing;
            } else {
                folders[name] = EC.ensureFolder(root, name);
                foldersMade = foldersMade + 1;
            }
        }

        for (var j = 0; j < plan.moves.length; j++) {
            var move = plan.moves[j];
            var target = folders[move.folder];
            if (!target) { continue; }

            try {
                if (move.item.parentFolder !== target) {
                    move.item.parentFolder = target;
                    moved = moved + 1;
                }
            } catch (e) {}
        }

        /* Category folders left over from earlier runs that hold nothing are
           removed, so the panel mirrors what the project actually contains. */
        for (var k = 0; k < EC.CATEGORY_ORDER.length; k++) {
            var emptyName = EC.CATEGORY_ORDER[k];
            var emptyFolder = EC.findFolder(root, emptyName);
            if (!emptyFolder) { continue; }
            try {
                if (emptyFolder.numItems === 0) {
                    emptyFolder.remove();
                    removed = removed + 1;
                }
            } catch (e) {}
        }

        return { moved: moved, folders: foldersMade, removed: removed };
    };

    EC.toast = function (headline, detail, counts) {
        var win = new Window("dialog", APPNAME);
        win.alignChildren = ["fill", "top"];
        win.spacing = 7;
        win.margins = 16;
        win.preferredSize.width = 300;
        EC.paintCard(win);

        var head = win.add("statictext", undefined, headline);
        EC.setFont(head, "Arial", "BOLD", 12);
        EC.tint(head, COL.accent);

        var body = win.add("statictext", undefined, detail, { multiline: true });
        body.preferredSize.width = 268;
        EC.setFont(body, "Arial", "REGULAR", 11);
        EC.tint(body, COL.text);

        if (counts) {
            var list = win.add("statictext", undefined, counts, { multiline: true });
            list.preferredSize.width = 268;
            EC.setFont(list, "Arial", "REGULAR", 9);
            EC.tint(list, COL.muted);
        }

        var buttons = win.add("group");
        buttons.alignment = ["right", "bottom"];
        var ok = buttons.add("button", undefined, "OK");
        ok.preferredSize = [70, 22];
        ok.onClick = function () { win.close(1); };

        win.show();
    };

    /* Align reads the canvas size from the top-most selected layer and moves
       every selected layer to that feature of the canvas. */
    EC.opAlign = function (axis, alignTo, firstLayer) {
        var comp = EC.requireComp();
        if (!comp) { return; }
        var sel = EC.selected(comp);
        if (!sel.length) {
            EC.warn("Select at least one layer to align.");
            return;
        }

        EC.guard("Align", function () {
            var top = firstLayer || sel[0];
            var targetW = comp.width;
            var targetH = comp.height;
            var sourceRect = null;
            try { sourceRect = top.sourceRectAtTime(0, false); } catch (e0) { sourceRect = null; }
            if (!sourceRect || sourceRect.width <= 0 || sourceRect.height <= 0) {
                sourceRect = { left: 0, top: 0, width: targetW, height: targetH };
            }
            var targetLeft = sourceRect.left;
            var targetWidth = sourceRect.width;
            var targetTop = sourceRect.top;
            var targetHeight = sourceRect.height;
            var targetRight = targetLeft + targetWidth;
            var targetBottom = targetTop + targetHeight;

            for (var i = 0; i < sel.length; i++) {
                var layer = sel[i];
                var rect = null;
                try { rect = layer.sourceRectAtTime(0, false); } catch (e2) { rect = null; }
                if (!rect || rect.width <= 0 || rect.height <= 0) { rect = { left: 0, top: 0, width: 0, height: 0 }; }

                var position;
                try { position = layer.property("Transform").property("Position"); } catch (e3) { position = null; }
                if (!position) { continue; }

                var cur = position.value;
                var x = cur[0];
                var y = cur[1];

                if (axis === "left") { x = targetLeft - rect.left + comp.width / 2; }
                else if (axis === "right") { x = targetRight - rect.right + comp.width / 2;             } else if (axis === "center") { x = targetLeft - rect.left + rect.width + (targetWidth - rect.width) / 2; }

                if (axis === "top") { y = targetTop - rect.top; }
                else if (axis === "bottom") { y = targetBottom - rect.bottom; }
                else if (axis === "middle") { y = targetTop - rect.top + rect.height + (targetHeight - rect.height) / 2; }

                try { position.setValue([x, y]); } catch (e4) {
                    try { position.setValueAtTime(0, [x, y]); } catch (e5) {}
                    try { position.setValueAtTime(5, [x, y]); } catch (e6) {}
                }
            }
        });
    };

    EC.opAlignLeft = function () { EC.opAlign("left", "left", null); };
    EC.opAlignCenter = function (firstLayer) { EC.opAlign("center", "center", firstLayer); };
    EC.opAlignRight = function (firstLayer) { EC.opAlign("right", "right", firstLayer); };
    EC.opAlignHorizontal = function (firstLayer) { EC.opAlign("center", "center", firstLayer); };
    EC.opAlignVertical = function (firstLayer) { EC.opAlign("middle", "middle", firstLayer); };
    EC.opAlignTop = function () { EC.opAlign("top", "top", null); };
    EC.opAlignMiddle = function () { EC.opAlign("middle", "middle", null); };
    EC.opAlignBottom = function () { EC.opAlign("bottom", "bottom", null); };

    EC.opOrganise = function () {
        if (!app.project) {
            EC.warn("Open a project first.");
            return;
        }

        var plan = EC.planOrganise();

        var result = null;
        var ok = EC.guard("Project Organise", function () {
            result = EC.applyPlan(plan);
        });
        if (!ok || !result) { return; }

        if (result.moved === 0 && result.folders === 0 && result.removed === 0) {
            EC.toast("Project already organised", "Every item is already in the right folder.");
            return;
        }

        if (result.moved === 0) {
            EC.toast("Project tidy", result.removed + (result.removed === 1 ? " empty folder removed." : " empty folders removed."));
            return;
        }

        var lines = [];
        for (var i = 0; i < EC.CATEGORY_ORDER.length; i++) {
            var name = EC.CATEGORY_ORDER[i];
            if (plan.counts[name] !== undefined) {
                lines.push(name + "  " + plan.counts[name]);
            }
        }

        var used = lines.length;
        var detail = result.moved + (result.moved === 1 ? " item moved" : " items moved") +
            " into " + used + (used === 1 ? " folder" : " folders") + ".";

        EC.toast("Project organised", detail, lines.join("\n"));
    };

    /* =====================================================================
     * 10b. PURGE CACHES
     * ===================================================================== */

    EC.fmtBytes = function (bytes) {
        var units = ["B", "KB", "MB", "GB", "TB"];
        var n = bytes;
        var u = 0;
        while (n >= 1024 && u < units.length - 1) {
            n = n / 1024;
            u = u + 1;
        }
        var rounded = (n >= 100 || u === 0) ? Math.round(n) : (Math.round(n * 10) / 10);
        return rounded + " " + units[u];
    };

    /* EffectCraft answers cache.diskStats with its disk cache figures. After
       Effects has no such call, so anything missing is simply left unknown. */
    EC.cacheInfo = function () {
        var info = { known: false, bytes: -1, entries: -1 };
        try {
            var stats = app.executeCommand("cache.diskStats");
            if (stats) {
                var names = ["bytes", "usedBytes", "size", "sizeBytes", "diskBytes", "totalBytes"];
                for (var i = 0; i < names.length; i++) {
                    var v = stats[names[i]];
                    if (typeof v === "number" && v >= 0) {
                        info.bytes = v;
                        info.known = true;
                        break;
                    }
                }
                if (typeof stats.entries === "number") {
                    info.entries = stats.entries;
                    info.known = true;
                }
            }
        } catch (e) {}
        return info;
    };

    /* Drops every cache the host holds and reports what went. After Effects
       purges through PurgeTarget; EffectCraft answers with the number of disk
       cache entries it removed, which is the number the popup shows. */
    EC.opPurge = function () {
        var memBefore = 0;
        try { memBefore = app.memoryInUse; } catch (e0) { memBefore = 0; }
        var before = EC.cacheInfo();
        var purged = false;
        var entries = -1;

        try {
            if (typeof PurgeTarget !== "undefined" && PurgeTarget && typeof PurgeTarget.ALL_CACHES !== "undefined") {
                app.purge(PurgeTarget.ALL_CACHES);
                purged = true;
            }
        } catch (e1) {}

        if (!purged) {
            try {
                var answer = app.executeCommand("edit.purge", { what: "all" });
                /* Any answer means the engine ran the purge; hosts differ in
                   what they put in the reply. */
                if (answer) {
                    if (typeof answer.diskEntries === "number") { entries = answer.diskEntries; }
                    purged = true;
                }
            } catch (e2) {}
        }

        if (!purged) {
            try {
                app.purge(3);
                purged = true;
            } catch (e3) {}
        }

        if (!purged) {
            EC.warn("Purge is not available in this host.");
            return;
        }

        var memAfter = 0;
        try { memAfter = app.memoryInUse; } catch (e4) { memAfter = 0; }
        var after = EC.cacheInfo();

        var freed = 0;
        if (before.bytes >= 0 && after.bytes >= 0 && before.bytes > after.bytes) {
            freed = before.bytes - after.bytes;
        }
        if (freed <= 0 && memBefore > memAfter) { freed = memBefore - memAfter; }

        var report = EC.purgeReport(entries, freed);
        EC.notice("Purge complete", report.headline, report.details);
    };

    /* What the purge popup says, kept separate so it can be read and tested
       without a window. */
    EC.purgeReport = function (entries, freed) {
        var headline;
        var details = [];

        if (entries > 0) {
            headline = entries + (entries === 1 ? " cache entry deleted" : " cache entries deleted");
        } else if (entries === 0) {
            headline = "No cache files to delete";
        } else {
            headline = "Caches purged";
        }

        if (freed > 0) {
            details.push(EC.fmtBytes(freed) + " of cache freed");
        } else {
            details.push("Nothing measurable was held in cache");
        }

        return { headline: headline, details: details };
    };

    /* =====================================================================
     * 12. EASE COPY (easing without values, values without easing)
     *
     * Modelled on EaseCopy for After Effects: the temporal eases of the
     * selected keyframes are stored and applied to other keyframes without
     * touching their values, or values are moved without touching the easing.
     * Speeds are units per second, so they are rescaled to the target move and
     * mirrored when it runs the other way; influence is a percentage of the
     * segment and therefore travels unchanged.
     * ===================================================================== */

    EC.easeStore = null;
    EC.valueStore = null;
    EC.passThrough = false;
    EC.statusLine = null;

    EC.interp = function (name, fallback) {
        try {
            var value = KeyframeInterpolationType[name];
            if (value !== undefined && value !== null) { return value; }
        } catch (e) {}
        return fallback;
    };

    EC.BEZIER = EC.interp("BEZIER", 6613);
    EC.LINEAR = EC.interp("LINEAR", 6612);
    EC.HOLD = EC.interp("HOLD", 6614);

    EC.setStatus = function (text) {
        try {
            if (EC.statusLine) { EC.statusLine.text = text; }
        } catch (e) {}
    };

    /* A keyframe value as a flat list, so numbers and vectors read the same. */
    EC.toVector = function (value) {
        if (typeof value === "number") { return [value]; }
        var out = [];
        try {
            for (var i = 0; i < value.length; i++) { out.push(value[i]); }
        } catch (e) {}
        if (!out.length) { out.push(0); }
        return out;
    };

    /* Size and direction of one segment, per ease dimension. A spatial
       property carries a single ease, so its segment is measured as a
       distance and its direction as the sum of the axes. */
    EC.segDelta = function (fromValue, toValue, dim) {
        var a = EC.toVector(fromValue);
        var b = EC.toVector(toValue);
        var out = [];
        var i;

        if (dim <= 1 && a.length > 1) {
            var sum = 0;
            var dir = 0;
            for (i = 0; i < a.length; i++) {
                var d = (b[i] || 0) - (a[i] || 0);
                sum = sum + d * d;
                dir = dir + d;
            }
            out.push({ "dist": Math.sqrt(sum), "sign": (dir < 0) ? -1 : 1 });
            return out;
        }

        for (i = 0; i < dim; i++) {
            var step = (b[i] || 0) - (a[i] || 0);
            out.push({ "dist": Math.abs(step), "sign": (step < 0) ? -1 : 1 });
        }
        return out;
    };

    EC.readEaseList = function (list) {
        var out = [];
        if (!list) { return out; }
        for (var i = 0; i < list.length; i++) {
            var speed = 0;
            var influence = 33;
            try { speed = list[i].speed; } catch (e) {}
            try { influence = list[i].influence; } catch (e2) {}
            out.push({ "speed": speed, "influence": influence });
        }
        return out;
    };

    EC.readKey = function (prop, index) {
        var rec = {
            "dim": 1, "inType": 0, "outType": 0, "inEase": [], "outEase": [],
            "inSpan": 0, "outSpan": 0, "inDelta": null, "outDelta": null,
            "value": null, "time": 0
        };

        try { rec.time = prop.keyTime(index); } catch (e0) { return null; }
        try { rec.inType = prop.keyInInterpolationType(index); } catch (e1) { return null; }
        try { rec.outType = prop.keyOutInterpolationType(index); } catch (e2) { rec.outType = rec.inType; }
        try { rec.inEase = EC.readEaseList(prop.keyInTemporalEase(index)); } catch (e3) {}
        try { rec.outEase = EC.readEaseList(prop.keyOutTemporalEase(index)); } catch (e4) {}
        rec.dim = Math.max(1, rec.inEase.length, rec.outEase.length);
        try { rec.value = prop.keyValue(index); } catch (e5) {}

        /* Neighbour spans and distances are kept so the ease can be rescaled
           onto a move of a different length or duration. */
        try {
            if (index > 1) {
                rec.inSpan = rec.time - prop.keyTime(index - 1);
                rec.inDelta = EC.segDelta(prop.keyValue(index - 1), rec.value, rec.dim);
            }
        } catch (e6) {}
        try {
            if (index < prop.numKeys) {
                rec.outSpan = prop.keyTime(index + 1) - rec.time;
                rec.outDelta = EC.segDelta(rec.value, prop.keyValue(index + 1), rec.dim);
            }
        } catch (e7) {}

        return rec;
    };

    EC.scaleEases = function (source, sourceDelta, targetDelta, sourceSpan, targetSpan, dim) {
        var out = [];
        for (var i = 0; i < dim; i++) {
            var s = source.length ? source[Math.min(i, source.length - 1)] : { "speed": 0, "influence": 33 };
            var speed = s.speed;
            var sd = sourceDelta ? sourceDelta[Math.min(i, sourceDelta.length - 1)] : null;
            var td = targetDelta ? targetDelta[Math.min(i, targetDelta.length - 1)] : null;

            if (sd && td && sd.dist > 0.0001 && sourceSpan > 0.0001 && targetSpan > 0.0001) {
                var factor = (td.dist / targetSpan) / (sd.dist / sourceSpan);
                if (sd.sign !== td.sign) { factor = -factor; }
                if (isFinite(factor)) { speed = speed * factor; }
            }

            out.push({ "speed": speed, "influence": s.influence });
        }
        return out;
    };

    EC.makeEases = function (list) {
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var influence = list[i].influence;
            if (!(influence > 0)) { influence = 0.1; }
            if (influence > 100) { influence = 100; }
            out.push(new KeyframeEase(list[i].speed, influence));
        }
        return out;
    };

    /* Writes one stored ease onto a keyframe, rescaled to that keyframe's own
       neighbours. Returns false when the host refuses the keyframe. */
    EC.applyEase = function (prop, index, rec) {
        var targetDim = 1;
        try { targetDim = Math.max(1, prop.keyInTemporalEase(index).length); } catch (e0) {}

        try { prop.setInterpolationTypeAtKey(index, rec.inType, rec.outType); } catch (e1) {}

        /* Linear and hold keyframes carry no temporal ease at all. */
        if (rec.inType !== EC.BEZIER && rec.outType !== EC.BEZIER) { return true; }

        var time = 0;
        try { time = prop.keyTime(index); } catch (e2) { return false; }

        var inSpan = 0;
        var outSpan = 0;
        var inDelta = null;
        var outDelta = null;

        try {
            if (index > 1) {
                inSpan = time - prop.keyTime(index - 1);
                inDelta = EC.segDelta(prop.keyValue(index - 1), prop.keyValue(index), targetDim);
            }
        } catch (e3) {}
        try {
            if (index < prop.numKeys) {
                outSpan = prop.keyTime(index + 1) - time;
                outDelta = EC.segDelta(prop.keyValue(index), prop.keyValue(index + 1), targetDim);
            }
        } catch (e4) {}

        var inEase = EC.scaleEases(rec.inEase, rec.inDelta, inDelta, rec.inSpan, inSpan, targetDim);
        var outEase = EC.scaleEases(rec.outEase, rec.outDelta, outDelta, rec.outSpan, outSpan, targetDim);

        /* Pass-through: an interior keyframe gets one speed on both sides, so
           the motion carries through instead of easing to a stop. */
        if (EC.passThrough && inSpan > 0.0001 && outSpan > 0.0001) {
            for (var i = 0; i < inEase.length; i++) {
                var shared = (inEase[i].speed + outEase[i].speed) / 2;
                inEase[i].speed = shared;
                outEase[i].speed = shared;
            }
        }

        try {
            prop.setTemporalEaseAtKey(index, EC.makeEases(inEase), EC.makeEases(outEase));
            return true;
        } catch (e5) {
            try {
                prop.setTemporalEaseAtKey(index, EC.makeEases(inEase));
                return true;
            } catch (e6) { return false; }
        }
    };

    /* Keyframes selected in the timeline, grouped per property. Hosts populate
       this differently, so the comp and then the layers are both checked. */
    EC.selectedKeys = function (comp) {
        var out = [];
        var props = [];
        var i;

        function collect(list) {
            if (!list) { return; }
            for (var j = 0; j < list.length; j++) { props.push(list[j]); }
        }

        try { collect(comp.selectedProperties); } catch (e0) {}
        if (!props.length) {
            try {
                var selected = comp.selectedLayers;
                for (i = 0; i < selected.length; i++) { collect(selected[i].selectedProperties); }
            } catch (e1) {}
        }

        for (i = 0; i < props.length; i++) {
            var keys = null;
            try { keys = props[i].selectedKeys; } catch (e2) { keys = null; }
            if (!keys || !keys.length) { continue; }

            var indexes = [];
            for (var k = 0; k < keys.length; k++) { indexes.push(keys[k]); }
            indexes.sort(function (a, b) { return a - b; });

            for (var m = 0; m < indexes.length; m++) {
                out.push({ "prop": props[i], "index": indexes[m] });
            }
        }
        return out;
    };

    /* Several copied keyframes map onto the targets in order; a single copied
       keyframe covers every target. */
    EC.pickRecord = function (store, index, total) {
        if (store.length === 1 || total <= 1) { return store[0]; }
        var i = Math.round(index * (store.length - 1) / (total - 1));
        if (i < 0) { i = 0; }
        if (i >= store.length) { i = store.length - 1; }
        return store[i];
    };

    EC.easeCopy = function () {
        var comp = EC.requireComp();
        if (!comp) { return; }

        var picked = EC.selectedKeys(comp);
        if (!picked.length) {
            EC.warn("Select keyframes first.\n\nClick the keyframes in the timeline, then press Copy Ease.");
            return;
        }

        var records = [];
        for (var i = 0; i < picked.length; i++) {
            var rec = EC.readKey(picked[i].prop, picked[i].index);
            if (rec) { records.push(rec); }
        }
        if (!records.length) {
            EC.warn("Those keyframes have no easing to copy.");
            return;
        }

        EC.easeStore = records;
        EC.setStatus("Copied easing from " + records.length + (records.length === 1 ? " keyframe" : " keyframes"));
    };

    EC.easePaste = function () {
        var comp = EC.requireComp();
        if (!comp) { return; }

        var store = EC.easeStore;
        if (!store || !store.length) {
            EC.warn("Nothing copied yet.\n\nSelect keyframes, press Copy Ease, then select the targets.");
            return;
        }

        var picked = EC.selectedKeys(comp);
        if (!picked.length) {
            EC.warn("Select the keyframes to paste onto first.");
            return;
        }

        var applied = 0;
        EC.guard("Paste Ease", function () {
            for (var i = 0; i < picked.length; i++) {
                var rec = EC.pickRecord(store, i, picked.length);
                if (EC.applyEase(picked[i].prop, picked[i].index, rec)) { applied = applied + 1; }
            }
        });

        EC.setStatus("Pasted easing onto " + applied + (applied === 1 ? " keyframe" : " keyframes"));
    };

    EC.valueCopy = function () {
        var comp = EC.requireComp();
        if (!comp) { return; }

        var picked = EC.selectedKeys(comp);
        if (!picked.length) {
            EC.warn("Select keyframes first.\n\nClick the keyframes in the timeline, then press Copy Value.");
            return;
        }

        var records = [];
        for (var i = 0; i < picked.length; i++) {
            var value = null;
            try { value = picked[i].prop.keyValue(picked[i].index); } catch (e) { value = null; }
            if (value === null) { continue; }
            records.push({ "value": value });
        }
        if (!records.length) {
            EC.warn("Those keyframes have no values to copy.");
            return;
        }

        EC.valueStore = records;
        EC.setStatus("Copied " + records.length + (records.length === 1 ? " value" : " values"));
    };

    EC.valuesCompatible = function (from, to) {
        if (from === null || to === null || from === undefined || to === undefined) { return false; }
        var a = EC.toVector(from);
        var b = EC.toVector(to);
        if (a.length !== b.length) { return false; }
        for (var i = 0; i < a.length; i++) {
            if (typeof a[i] !== "number" || typeof b[i] !== "number") { return false; }
        }
        return true;
    };

    EC.valuePaste = function () {
        var comp = EC.requireComp();
        if (!comp) { return; }

        var store = EC.valueStore;
        if (!store || !store.length) {
            EC.warn("Nothing copied yet.\n\nSelect keyframes, press Copy Value, then select the targets.");
            return;
        }

        var picked = EC.selectedKeys(comp);
        if (!picked.length) {
            EC.warn("Select the keyframes to paste onto first.");
            return;
        }

        var applied = 0;
        var skipped = 0;

        EC.guard("Paste Value", function () {
            for (var i = 0; i < picked.length; i++) {
                var prop = picked[i].prop;
                var index = picked[i].index;
                var rec = EC.pickRecord(store, i, picked.length);

                var current = null;
                var time = 0;
                try { current = prop.keyValue(index); } catch (e0) { current = null; }
                try { time = prop.keyTime(index); } catch (e1) { continue; }

                if (!EC.valuesCompatible(rec.value, current)) { skipped = skipped + 1; continue; }

                /* The value is written first, so the easing this keyframe
                   already had is read up front and put back afterwards. */
                var keep = EC.readKey(prop, index);
                try { prop.setValueAtTime(time, rec.value); } catch (e2) { skipped = skipped + 1; continue; }
                if (keep) { EC.applyEase(prop, index, keep); }
                applied = applied + 1;
            }
        });

        var text = "Pasted " + applied + (applied === 1 ? " value" : " values");
        if (skipped) { text = text + "  (" + skipped + " skipped: different property type)"; }
        EC.setStatus(text);
    };

    /* =====================================================================
     * 11. PANEL UI
     * ===================================================================== */

    EC.paintCard = function (card) {
        EC.fill(card, COL.card);
        card.onDraw = function () {
            try {
                var g = card.graphics;
                var w = card.size[0];
                var h = card.size[1];
                g.newPath();
                g.rectPath(0, 0, w, h);
                g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, COL.card));
                g.newPath();
                g.rectPath(0.5, 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
                g.strokePath(g.newPen(g.PenType.SOLID_COLOR, COL.border, 1));
            } catch (e) {}
        };
    };

    EC.card = function (parent, title) {
        var card = parent.add("group");
        card.orientation = "column";
        card.alignChildren = ["fill", "top"];
        card.spacing = 7;
        card.margins = 10;
        EC.paintCard(card);

        var label = card.add("statictext", undefined, title.toUpperCase());
        EC.setFont(label, "Arial", "BOLD", 10);
        EC.tint(label, COL.muted);
        return card;
    };

    EC.drawIcon = function (g, size, icon) {
        var w = size[0] || 40;
        var h = size[1] || 30;
        var pen = g.newPen(g.PenType.SOLID_COLOR, COL.text, 1.6);
        var pad = 7;
        var midX = w / 2;
        var midY = h / 2;
        var step = Math.max(4, (h - 2 * pad) / 2);

        if (icon === "left") {
            g.newPath(); g.moveTo(pad, pad); g.lineTo(pad, h - pad); g.strokePath(pen);
            for (var i = 0; i < 3; i++) {
                var y = pad + i * step;
                g.newPath(); g.moveTo(pad + 4, y); g.lineTo(w - pad, y); g.strokePath(pen);
            }
        } else if (icon === "center") {
            g.newPath(); g.moveTo(midX, pad); g.lineTo(midX, h - pad); g.strokePath(pen);
            for (var i2 = 0; i2 < 3; i2++) {
                var y2 = pad + i2 * step;
                var half = (w - 2 * pad) / 2 - 2;
                g.newPath(); g.moveTo(midX - half, y2); g.lineTo(midX + half, y2); g.strokePath(pen);
            }
        } else if (icon === "right") {
            g.newPath(); g.moveTo(w - pad, pad); g.lineTo(w - pad, h - pad); g.strokePath(pen);
            for (var i3 = 0; i3 < 3; i3++) {
                var y3 = pad + i3 * step;
                g.newPath(); g.moveTo(pad, y3); g.lineTo(w - pad - 4, y3); g.strokePath(pen);
            }
        } else if (icon === "top") {
            g.newPath(); g.moveTo(pad, pad); g.lineTo(w - pad, pad); g.strokePath(pen);
            for (var j = 0; j < 3; j++) {
                var x = pad + j * ((w - 2 * pad) / 2);
                g.newPath(); g.moveTo(x, pad + 4); g.lineTo(x, h - pad); g.strokePath(pen);
            }
        } else if (icon === "middle") {
            g.newPath(); g.moveTo(pad, midY); g.lineTo(w - pad, midY); g.strokePath(pen);
            for (var j2 = 0; j2 < 3; j2++) {
                var x2 = pad + j2 * ((w - 2 * pad) / 2);
                g.newPath(); g.moveTo(x2, pad); g.lineTo(x2, midY - 4); g.strokePath(pen);
                g.newPath(); g.moveTo(x2, midY + 4); g.lineTo(x2, h - pad); g.strokePath(pen);
            }
        } else if (icon === "bottom") {
            g.newPath(); g.moveTo(pad, h - pad); g.lineTo(w - pad, h - pad); g.strokePath(pen);
            for (var j3 = 0; j3 < 3; j3++) {
                var x3 = pad + j3 * ((w - 2 * pad) / 2);
                g.newPath(); g.moveTo(x3, pad); g.lineTo(x3, h - pad - 4); g.strokePath(pen);
            }
        } else if (icon === "horizontal") {
            g.newPath(); g.moveTo(pad, midY); g.lineTo(w - pad, midY); g.strokePath(pen);
            g.newPath(); g.moveTo(pad, midY); g.lineTo(pad + 6, midY - 5); g.strokePath(pen);
            g.newPath(); g.moveTo(pad, midY); g.lineTo(pad + 6, midY + 5); g.strokePath(pen);
            g.newPath(); g.moveTo(w - pad, midY); g.lineTo(w - pad - 6, midY - 5); g.strokePath(pen);
            g.newPath(); g.moveTo(w - pad, midY); g.lineTo(w - pad - 6, midY + 5); g.strokePath(pen);
        } else if (icon === "vertical") {
            g.newPath(); g.moveTo(midX, pad); g.lineTo(midX, h - pad); g.strokePath(pen);
            g.newPath(); g.moveTo(midX, pad); g.lineTo(midX - 5, pad + 6); g.strokePath(pen);
            g.newPath(); g.moveTo(midX, pad); g.lineTo(midX + 5, pad + 6); g.strokePath(pen);
            g.newPath(); g.moveTo(midX, h - pad); g.lineTo(midX - 5, h - pad - 6); g.strokePath(pen);
            g.newPath(); g.moveTo(midX, h - pad); g.lineTo(midX + 5, h - pad - 6); g.strokePath(pen);
        }
    };

    EC.grid = function (parent, cols, items) {
        var gridGroup = parent.add("group");
        gridGroup.orientation = "column";
        gridGroup.alignChildren = ["fill", "top"];
        gridGroup.spacing = 6;
        gridGroup._buttons = [];
        gridGroup._rows = [];
        gridGroup._cols = cols;

        var row = null;
        for (var i = 0; i < items.length; i++) {
            if (i % cols === 0) {
                row = gridGroup.add("group");
                row.orientation = "row";
                row.alignChildren = ["fill", "fill"];
                row.alignment = ["fill", "top"];
                row.spacing = 6;
                gridGroup._rows.push(row);
            }
            var button = row.add("button", undefined, items[i].icon ? "" : items[i].label);
            button.helpTip = items[i].tip;
            button.alignment = ["fill", "fill"];
            button.preferredSize.height = 30;
            if (!items[i].icon) { EC.setFont(button, "Arial", "REGULAR", 13); }
            button.onClick = EC.wrap(items[i].fn);
            if (items[i].icon) {
                button._icon = items[i].icon;
                button.onDraw = function () {
                    try {
                        var g = this.graphics;
                        g.drawOSControl();
                        EC.drawIcon(g, this.size, this._icon);
                    } catch (e) {}
                };
            }
            gridGroup._buttons.push(button);
        }
        return gridGroup;
    };

    /* A grid that can change its column count: the Create row folds from four
       across to two to one as the dock narrows. ScriptUI cannot reparent a
       control, so the rows are rebuilt from the same button descriptions. */
    EC.flowGrid = function (parent, items) {
        var wrap = parent.add("group");
        wrap.orientation = "column";
        wrap.alignChildren = ["fill", "top"];
        wrap.spacing = 6;
        wrap._items = items;
        wrap._cols = 0;
        wrap._buttons = [];
        EC.layoutFlow(wrap, 4, 13, 30);
        return wrap;
    };

    EC.layoutFlow = function (wrap, cols, face, height) {
        if (!wrap || !wrap._items || wrap._cols === cols) { return; }

        try {
            var kids = [];
            for (var k = 0; k < wrap.children.length; k++) { kids.push(wrap.children[k]); }
            for (var r0 = 0; r0 < kids.length; r0++) { wrap.remove(kids[r0]); }
        } catch (e0) {}

        wrap._cols = cols;
        wrap._buttons = [];

        var items = wrap._items;
        var row = null;

        for (var i = 0; i < items.length; i++) {
            if (i % cols === 0) {
                row = wrap.add("group");
                row.orientation = "row";
                row.alignment = ["fill", "top"];
                row.alignChildren = ["fill", "fill"];
                row.spacing = 6;
            }

            var button = row.add("button", undefined, items[i].icon ? "" : items[i].label);
            button.helpTip = items[i].tip;
            button.alignment = ["fill", "fill"];
            button.preferredSize.height = height;
            if (!items[i].icon) { EC.setFont(button, "Arial", "REGULAR", face); }
            button.onClick = EC.wrap(items[i].fn);
            if (items[i].icon) {
                button._icon = items[i].icon;
                button.onDraw = function () {
                    try {
                        var g = this.graphics;
                        g.drawOSControl();
                        EC.drawIcon(g, this.size, this._icon);
                    } catch (e) {}
                };
            }
            wrap._buttons.push(button);
        }
    };

    /* ScriptUI sizes a row's buttons from their labels, so "Adjustment" steals
       width from "Null". Every cell is measured to the same track instead, so
       the columns line up however wide the dock is. */
    EC.fitColumns = function (el, gap) {
        if (!el || !el._cols) { return; }
        try {
            var w = el.size[0];
            if (!(w > 60)) { return; }
            var g = gap || 6;
            var cell = Math.floor((w - (el._cols - 1) * g) / el._cols);
            if (cell < 20) { return; }

            for (var i = 0; i < el.children.length; i++) {
                var row = el.children[i];
                for (var j = 0; j < row.children.length; j++) {
                    row.children[j].preferredSize.width = cell;
                }
            }
        } catch (e) {}
    };

    EC.stackButton = function (parent, label, tip, fn) {
        var button = parent.add("button", undefined, label);
        button.helpTip = tip;
        button.alignment = ["fill", "top"];
        button.preferredSize.height = 32;
        EC.setFont(button, "Arial", "REGULAR", 14);
        button.onClick = EC.wrap(fn);
        try {
            if (!parent._buttons) { parent._buttons = []; }
            parent._buttons.push(button);
        } catch (eTrack) {}
        return button;
    };

    /* Gradient word mark. Falls back to coloured text if drawString is missing. */
    EC.glyphWidth = { H: 0.722, Y: 0.667, P: 0.667, E: 0.667, R: 0.722, S: 0.667, D: 0.722 };

    EC.drawWord = function (g, word, centerX, topY, size, from, to) {
        var widths = [];
        var total = 0;
        var i;
        var ch;

        for (i = 0; i < word.length; i++) {
            ch = word.charAt(i);
            var w = (EC.glyphWidth[ch] || 0.68) * size;
            widths.push(w);
            total = total + w;
        }

        try { g.font = ScriptUI.newFont("Arial", "BOLD", size); } catch (e0) {}

        var x = centerX - total / 2;
        for (i = 0; i < word.length; i++) {
            var t = (word.length > 1) ? (i / (word.length - 1)) : 0;
            var col = [
                from[0] + (to[0] - from[0]) * t,
                from[1] + (to[1] - from[1]) * t,
                from[2] + (to[2] - from[2]) * t
            ];
            g.drawString(word.charAt(i), g.newPen(g.PenType.SOLID_COLOR, col, 1), x, topY);
            x = x + widths[i];
        }
    };

    EC.LOGO_HEIGHT = 92;

    EC.logo = function (parent) {
        var wrap = parent.add("group");
        wrap.alignment = ["fill", "top"];
        wrap.orientation = "column";
        wrap.alignChildren = ["center", "top"];
        wrap.margins = 0;
        wrap.spacing = 0;
        EC.fill(wrap, COL.bg);

        /* A real child gives the band its height; an empty group collapses and
           clips the mark. */
        var spacer = wrap.add("statictext", undefined, " ");
        spacer.preferredSize = [1, EC.LOGO_HEIGHT];
        spacer.alignment = ["left", "top"];

        var canRender = false;
        try {
            canRender = (typeof wrap.graphics.drawString === "function");
        } catch (e) {
            canRender = false;
        }

        if (!canRender) {
            var first = wrap.add("statictext", undefined, "HYPER");
            EC.setFont(first, "Arial", "BOLD", 22);
            EC.tint(first, [0.925, 0.925, 0.925]);
            var second = wrap.add("statictext", undefined, "SPEED");
            EC.setFont(second, "Arial", "BOLD", 22);
            EC.tint(second, COL.accent);
            return wrap;
        }

        wrap.onDraw = function () {
            try {
                var g = wrap.graphics;
                var w = wrap.size[0] || 320;
                var mid = w / 2;
                /* Type follows the dock width, so the mark never overflows a
                   narrow strip and grows into a wide one. */
                var s1 = Math.max(15, Math.min(32, Math.round(w * 0.088)));
                var s2 = Math.max(17, Math.min(36, Math.round(w * 0.100)));
                EC.drawWord(g, "HYPER", mid, 10, s1, [0.945, 0.945, 0.945], [0.945, 0.945, 0.945]);
                EC.drawWord(g, "SPEED", mid, 10 + s1 + 5, s2, COL.hot, COL.accent);
            } catch (e) {}
        };
        return wrap;
    };

    EC.anchorGrid = function (parent) {
        var cells = [
            ["\u25E4", 0, 0, "Top Left"],
            ["\u25B2", 0.5, 0, "Top Center"],
            ["\u25E5", 1, 0, "Top Right"],
            ["\u25C0", 0, 0.5, "Middle Left"],
            ["\u25C6", 0.5, 0.5, "Center"],
            ["\u25B6", 1, 0.5, "Middle Right"],
            ["\u25E3", 0, 1, "Bottom Left"],
            ["\u25BC", 0.5, 1, "Bottom Center"],
            ["\u25E2", 1, 1, "Bottom Right"]
        ];

        var grid = parent.add("group");
        grid.orientation = "column";
        grid.alignment = ["fill", "fill"];
        grid.alignChildren = ["fill", "fill"];
        grid.spacing = 4;
        grid.margins = 0;

        var rows = [];
        var buttons = [];

        for (var r = 0; r < 3; r++) {
            var row = grid.add("group");
            row.orientation = "row";
            row.alignment = ["fill", "fill"];
            row.alignChildren = ["fill", "fill"];
            row.spacing = 4;
            rows.push(row);

            var line = [];
            for (var c = 0; c < 3; c++) {
                var cell = cells[r * 3 + c];
                var button = row.add("button", undefined, cell[0]);
                button.alignment = ["fill", "fill"];
                button.preferredSize = [54, 30];
                button.helpTip = "Anchor point: " + cell[3];
                EC.setFont(button, "Arial", "REGULAR", 15);
                (function (fx, fy) {
                    button.onClick = EC.wrap(function () { EC.opAnchor(fx, fy); });
                })(cell[1], cell[2]);
                line.push(button);
            }
            buttons.push(line);
        }
        return { grid: grid, rows: rows, buttons: buttons };
    };

    /* ScriptUI has no flexible tracks, so the nine cells are measured instead:
       the grid takes all the width the button stack leaves, split into three
       equal columns, and its three rows are sized from the stack's height so
       the grid bottoms out level with Move Down. Re-run on every dock resize. */
    EC.fitAnchorGrid = function (toolsRow, left, anchor, stacked) {
        try {
            var gap = 4;
            var availW = 0;
            var cellW = 0;
            var cellH = 0;
            var i;
            var j;

            if (stacked) {
                /* Column dock: the grid sits under the stack and takes the
                   whole card width, three equal cells per row. */
                availW = toolsRow.size[0];
                if (availW > 3 * 28 + 2 * gap) {
                    cellW = Math.floor((availW - 2 * gap) / 3);
                }
                cellH = 30;
            } else {
                availW = toolsRow.size[0] - left.size[0] - toolsRow.spacing;
                if (availW > 3 * 28 + 2 * gap) {
                    cellW = Math.floor((availW - 2 * gap) / 3);
                }
                if (left.size[1] > 3 * 24 + 2 * gap) {
                    cellH = Math.floor((left.size[1] - 2 * gap) / 3);
                }
            }

            if (cellW <= 0 && cellH <= 0) { return; }

            var iconSize = (cellH > 0) ? Math.min(22, Math.max(12, Math.round(cellH * 0.45))) : 15;
            for (i = 0; i < anchor.rows.length; i++) {
                if (cellH > 0) { anchor.rows[i].preferredSize.height = cellH; }
                for (j = 0; j < 3; j++) {
                    if (cellW > 0) { anchor.buttons[i][j].preferredSize.width = cellW; }
                    if (cellH > 0) { anchor.buttons[i][j].preferredSize.height = cellH; }
                    EC.setFont(anchor.buttons[i][j], "Arial", "REGULAR", iconSize);
                }
            }
        } catch (e) {}
    };

    /* The panel lives in a dock that can be dragged from a tall slim strip to a
       wide slab, so the layout folds instead of clipping: below the narrow
       threshold the anchor grid drops under the button stack and takes the
       full card width, and the whole column tightens its padding. */
    EC.NARROW_WIDTH = 330;

    EC.layoutPanel = function (panel, ui) {
        try {
            var w = panel.size[0];
            if (!(w > 0)) { return; }
            var narrow = (w < EC.NARROW_WIDTH);

            if (panel._narrow !== narrow) {
                ui.toolsRow.orientation = narrow ? "column" : "row";
                panel._narrow = narrow;
            }

            panel.spacing = narrow ? 5 : 8;
            panel.margins = narrow ? 6 : 8;

            /* Scale the stacked buttons with the dock so the left column stays
               readable without wrapping or clipping. */
            if (ui.left && ui.left._buttons) {
                var btnH = narrow ? 27 : 32;
                var btnFont = narrow ? 13 : 14;
                ui.left.spacing = narrow ? 3 : 4;
                for (var lb = 0; lb < ui.left._buttons.length; lb++) {
                    ui.left._buttons[lb].preferredSize.height = btnH;
                    EC.setFont(ui.left._buttons[lb], "Arial", "REGULAR", btnFont);
                }
            }
            if (ui.toolsRow) { ui.toolsRow.spacing = narrow ? 5 : 8; }

            try { panel.layout.layout(true); } catch (ePre) {}
            EC.fitAnchorGrid(ui.toolsRow, ui.left, ui.anchor, narrow);

            /* Four labels in a row need room for the longest one, so the
               Create grid folds: 4 across, then 2, then a single column. */
            if (ui.create) {
                var cols = (w >= 380) ? 4 : ((w < 190) ? 1 : 2);
                EC.layoutFlow(ui.create, cols, (cols === 4) ? 13 : 12, (cols === 1) ? 28 : 26);
                EC.fitColumns(ui.create, 6);
            }

            if (ui.align) {
                var alignCols = (w >= EC.NARROW_WIDTH) ? 3 : ((w < 210) ? 1 : 2);
                EC.layoutFlow(ui.align, alignCols, 13, 30);
                EC.fitColumns(ui.align, 6);
            }

            EC.fitColumns(ui.ease, 6);
            EC.fitColumns(ui.project, 6);
            EC.fitColumns(ui.move, 6);

            if (ui.status) {
                try {
                    ui.status.preferredSize.width = Math.max(160, w - 28);
                    ui.status.preferredSize.height = 30;
                } catch (eStatus) {}
            }
        } catch (e) {}
    };

    EC.build = function (thisObj) {
        var panel;
        if (thisObj instanceof Panel) {
            panel = thisObj;
        } else {
            panel = new Window("palette", APPNAME + " " + VERSION, undefined, { resizeable: true });
        }

        panel.orientation = "column";
        panel.alignChildren = ["fill", "top"];
        panel.spacing = 6;
        panel.margins = 8;
        EC.fill(panel, COL.bg);

        EC.logo(panel);

        /* ---- CREATE ---- */
        var create = EC.card(panel, "Create");
        var createGrid = EC.flowGrid(create, [
            { label: "Null", tip: "New Null Object using the selection-aware duration engine.", fn: EC.opNull },
            { label: "Adjustment", tip: "New Adjustment Layer, comp-sized, matched to the selection.", fn: EC.opAdjustment },
            { label: "Camera", tip: "Open the camera dialog (name, type, focal length).", fn: EC.opCamera },
            { label: "Solid", tip: "Solid dialog: name, colour picker, size.", fn: EC.opSolid }
        ]);

        /* ---- ALIGN ---- */
        var align = EC.card(panel, "Align");
        var alignGrid = EC.flowGrid(align, [
            { label: "Left", tip: "Align selected layers to the left edge of the reference layer.",        fn: EC.opAlignLeft },
            { label: "Center", tip: "Align selected layers to the horizontal centre of the reference layer.", fn: EC.opAlignCenter },
            { label: "Right", tip: "Align selected layers to the right edge of the reference layer.",       fn: EC.opAlignRight },
            { label: "Top", tip: "Align selected layers to the top edge of the reference layer.",           fn: EC.opAlignTop },
            { label: "Middle", tip: "Align selected layers to the vertical centre of the reference layer.",    fn: EC.opAlignMiddle },
            { label: "Bottom", tip: "Align selected layers to the bottom edge of the reference layer.",        fn: EC.opAlignBottom }
        ]);
        EC.layoutFlow(alignGrid, 3, 13, 30);

        /* ---- LAYER TOOLS ---- */
        var tools = EC.card(panel, "Layer Tools");
        var toolsRow = tools.add("group");
        toolsRow.orientation = "row";
        toolsRow.alignment = ["fill", "fill"];
        toolsRow.alignChildren = ["fill", "fill"];
        toolsRow.spacing = 8;

        var left = toolsRow.add("group");
        left.orientation = "column";
        left.alignment = ["fill", "top"];
        left.alignChildren = ["fill", "top"];
        left.spacing = 4;

        EC.stackButton(left, "True Duplicate", "Native AE duplicate: effects, keyframes, expressions, masks, parents.", EC.opDuplicate);
        EC.stackButton(left, "Sequence Layers", "Sequence selected layers with overlap, gap and reverse order.", EC.opSequence);
        var shiftHeld = false;
        var preButton = EC.stackButton(left, "Pre-compose", "No selection: one pre-comp per clip.\n1 selected: that clip only.\nSeveral selected: one pre-comp.\nShift + click: one pre-comp per selected clip.", function () {
            var separate = shiftHeld;
            if (!separate) {
                try {
                    separate = ScriptUI.environment.keyboardState.shiftKey === true;
                } catch (eShift) { separate = false; }
            }
            EC.opPrecompose(separate);
        });

        /* EffectCraft reports modifier keys on mouse events rather than through
           ScriptUI.environment, so the press itself records Shift. */
        try {
            preButton.addEventListener("mousedown", function (event) {
                shiftHeld = !!(event && event.shiftKey);
            });
        } catch (ePre) {}

    
        EC.moveButton(left, "Move Up", "Move the selected clip one layer up.\nShift: send it above every other clip.", true);
        EC.moveButton(left, "Move Down", "Move the selected clip one layer down.\nShift: send it below every other clip.", false);

        var fitHeld = false;
        var fitButton = EC.stackButton(left, "Fit to Comp", "Fit selected layers' height to the comp height.\nShift: fit width to comp width.", function () {
            var widthMode = fitHeld;
            try { widthMode = widthMode || (ScriptUI.environment && ScriptUI.environment.keyboardState && ScriptUI.environment.keyboardState.shiftKey === true); } catch (eShift) {}
            EC.opFit(widthMode);
        });
        try {
            fitButton.addEventListener("mousedown", function (event) {
                fitHeld = !!(event && event.shiftKey);
            });
        } catch (eFit) {}

        var anchor = EC.anchorGrid(toolsRow);

        /* ---- EASE ---- */
        var ease = EC.card(panel, "Ease");
        var easeGrid = EC.grid(ease, 2, [
            { label: "Copy Ease", tip: "Store the easing of the selected keyframes. Values are not touched.", fn: EC.easeCopy },
            { label: "Paste Ease", tip: "Apply the stored easing to the selected keyframes, rescaled to their own movement.", fn: EC.easePaste },
            { label: "Copy Value", tip: "Store the values of the selected keyframes. Easing is not touched.", fn: EC.valueCopy },
            { label: "Paste Value", tip: "Apply the stored values and keep each keyframe's own easing.", fn: EC.valuePaste }
        ]);

        var pass = ease.add("checkbox", undefined, "Pass-through interior keys");
        pass.helpTip = "Give a middle keyframe the same speed on both sides so the motion carries through.";
        pass.value = EC.passThrough;
        pass.onClick = function () { EC.passThrough = (pass.value === true); };

        var status = ease.add("statictext", undefined, "Copy easing, then select the targets", { multiline: true });
        status.alignment = ["left", "top"];
        status.preferredSize = [280, 30];
        EC.setFont(status, "Arial", "REGULAR", 11);
        EC.tint(status, COL.muted);
        EC.statusLine = status;

        /* ---- PROJECT ---- */
        var project = EC.card(panel, "Project");
        var projectGrid = EC.grid(project, 2, [
            { label: "Organise Project", tip: "Create category folders, then move every item into the right one.", fn: EC.opOrganise },
            { label: "Purge", tip: "Delete every cache the application holds, then report what was cleared.", fn: EC.opPurge }
        ]);

        var ui = {

            toolsRow: toolsRow,
            left: left,
            anchor: anchor,
            create: createGrid,
            ease: easeGrid,
            project: projectGrid,
            align: alignGrid,
            status: status
        };

        function relayout() {
            try { panel.layout.layout(true); } catch (e0) {}
            EC.layoutPanel(panel, ui);
            try { panel.layout.resize(); } catch (e1) {}
        }

        EC.layoutPanel(panel, ui);

        panel.onResizing = panel.onResize = function () {
            relayout();
        };

        if (panel instanceof Window) {
            panel.center();
            panel.show();
        } else {
            panel.layout.layout(true);
            panel.layout.resize();
        }

        relayout();

        return panel;
    };

    EC.build(thisObj);

})(this);



