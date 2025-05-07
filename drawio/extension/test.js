function createVisibleRectangle() {

    // --- Overlay rectangle on top of everything (HTML overlay) ---
    // Create overlay div
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.pointerEvents = 'none'; // So it doesn't block mouse events
    overlay.style.zIndex = '9999'; // Very high z-index

    // Create the rectangle
    const rect = document.createElement('div');
    rect.style.position = 'absolute';
    rect.style.left = '100px'; // Your X
    rect.style.top = '100px';  // Your Y
    rect.style.width = '200px';
    rect.style.height = '200px';
    rect.style.background = 'rgba(255,0,0,0.5)';
    rect.style.border = '2px solid #000';

    // Add rectangle to overlay, overlay to body
    overlay.appendChild(rect);
    document.body.appendChild(overlay);

    // --- End overlay rectangle code ---

    const graph = window.mcpGraph;

    if (!graph) {

        console.error("Graph not found");

        return;

    }

    // First, let's make sure we're operating on the main graph

    if (graph.getCurrentRoot()) {

        graph.home(); // Go back to main view

    }

    const view = graph.getView();

    const model = graph.getModel();

    const parent = graph.getDefaultParent();

    // Force the view to update

    graph.view.refresh();

    // Get the visible container dimensions

    const containerWidth = graph.container.clientWidth;

    const containerHeight = graph.container.clientHeight;

    // Calculate center of visible area - this is crucial

    const centerScreenX = containerWidth / 2;

    const centerScreenY = containerHeight / 2;

    // Convert from screen to graph coordinates

    // This is where the magic happens

    const centerX = graph.snap((centerScreenX / view.scale) - view.translate.x);

    const centerY = graph.snap((centerScreenY / view.scale) - view.translate.y);

    console.log("Placing rectangle at graph coordinates:", {centerX, centerY});

    model.beginUpdate();

    try {

        // Create the rectangle at the calculated coordinates

        const cell = graph.insertVertex(

            parent, null, "VISIBLE RECTANGLE",

            centerX, centerY,

            120, 80,

            "fillColor=red;strokeColor=black;fontColor=white;fontSize=12;overflow=visible;noLabel=0;labelBackgroundColor=none;"

        );

        // Force to front

        graph.orderCells(false); // Send all to back

        graph.orderCells(true, [cell]); // Bring our cell to front

        // Make sure it's visible

        graph.scrollCellToVisible(cell, true);

        graph.setSelectionCell(cell);

        // Force the view to refresh

        view.refresh();

        graph.sizeDidChange();

        console.log("Rectangle created:", cell);

    } finally {

        model.endUpdate();

    }

    return "Rectangle should now be visible";

}

createVisibleRectangle();

