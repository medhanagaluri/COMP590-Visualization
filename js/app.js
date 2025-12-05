// js/app.js
console.log("✅ app.js loaded, D3 version:", d3.version);

/*
  app.js - NC Depression Hotspots

  Minimal inline comments added below to explain the main pieces:
  - top-level state and DOM refs
  - selection / brushing behavior
  - Needs Index computation and controls
  - map + legend drawing
  - scatterplot drawing and brushing

  The aim is to keep comments short and intuitive so future readers can quickly
  understand why each function exists and what side-effects it has.
*/

// DOM references
const mapSvg       = d3.select("#map");
const tooltip      = d3.select("#tooltip");
// moved county details into the map container
const detailsTitle = d3.select("#map-county-title");
const detailsBox   = d3.select("#map-county-details");

const scatterSvgs = {
  income: d3.select("#scatter-income-svg"),
  poverty: d3.select("#scatter-poverty-svg"),
  education: d3.select("#scatter-education-svg")
};

let scatterData = [];
let currentTab = "income";
let selectedCountyName = null;
// Brushing state: set of county names currently selected by brush
let brushedCountyNames = new Set();
// Flag to ignore click events while brushing
let isBrushing = false;
// selection mode: 'individual' or 'cluster'
let selectionMode = 'individual';

function setSelectionMode(mode) {
  selectionMode = mode;
  // update UI buttons if present
  const ind = document.getElementById('mode-individual');
  const clu = document.getElementById('mode-cluster');
  if (ind && clu) {
    if (mode === 'individual') {
      ind.style.background = '#3182bd'; ind.style.color = 'white';
      clu.style.background = 'white'; clu.style.color = 'black';
    } else {
      clu.style.background = '#3182bd'; clu.style.color = 'white';
      ind.style.background = 'white'; ind.style.color = 'black';
    }
  }
  // show/hide brushes on all plots
  const show = mode === 'cluster';
  d3.selectAll('.brush').style('display', show ? null : 'none');
  // ensure we are not stuck in brushing state
  isBrushing = false;
}

// Toggle between 'individual' (click to pick a single county)
// and 'cluster' (enable brushes on all scatterplots for multi-select).
// Updates UI buttons and shows/hides brush groups accordingly.


function setupSelectionModeControls() {
  const ind = document.getElementById('mode-individual');
  const clu = document.getElementById('mode-cluster');
  if (!ind || !clu) return;
  ind.addEventListener('click', () => setSelectionMode('individual'));
  clu.addEventListener('click', () => setSelectionMode('cluster'));
  // initialize
  setSelectionMode(selectionMode);
}

/**
 * Update scatter point styles across all scatterplots based on a set of county names
 */
function updateScatterHighlightsByNames(nameSet) {
  Object.values(scatterSvgs).forEach(svg => {
    svg.selectAll(".scatter-point")
      .attr("fill", d => nameSet.has(d.CountyName) ? "#dc2626" : "#3182bd")
      .attr("stroke", d => nameSet.has(d.CountyName) ? "#000" : "none")
      .attr("stroke-width", d => nameSet.has(d.CountyName) ? 1.5 : 0)
      .attr("r", d => nameSet.has(d.CountyName) ? 6 : 4);
  });
  // Also outline matching counties on the map for multi-selection
  try {
    mapSvg.selectAll("path").each(function() {
      const el = d3.select(this);
      const name = el.attr("data-county-name");
      const isSel = name && nameSet.has(name);
      el.attr("stroke", isSel ? "#000" : "#fff")
        .attr("stroke-width", isSel ? 3 : 0.5);
    });
  } catch (e) {
    // in case map isn't ready yet, fail silently
    // console.warn("Map not ready for highlighting brush selection", e);
  }
}

// Update both the scatterplot points and the map paths to reflect a
// multi-selection (provided as a Set of CountyName strings).
// Visuals: selected points -> red fill + black stroke; map -> thicker black outline.


// Load CSV + GeoJSON
Promise.all([
  d3.csv("data/NC_County_Data.csv"),
  d3.json("data/nc-counties.geojson")
]).then(([rows, geo]) => {
    console.log("✅ Promise resolved");
console.log("Rows loaded from CSV:", rows.length);
console.log("GeoJSON type:", geo.type);
console.log("GeoJSON features:", geo.features ? geo.features.length : "NO FEATURES");

  // --- 1. Clean up CSV values / types ---
  rows.forEach(d => {
    d.DEPRESSION_AdjPrev   = +d["DEPRESSION_AdjPrev"];   // age-adjusted %
    d.DEPRESSION_CrudePrev = +d["DEPRESSION_CrudePrev"]; // crude %
    d.TotalPopulation      = +d["TotalPopulation"];
    d.TotalPop18plus       = +d["TotalPop18plus"];
    d.MedianIncome         = +d["MedianIncome"];
    d.PovertyRate          = +d["PovertyRate"];
    d.BAplusPercent        = +d["BAplusPercent"];        // education %
    d.CountyFIPS           = d["CountyFIPS"].toString().padStart(5, "0"); // e.g. 37001
  });

  const byFips = new Map(rows.map(d => [d.CountyFIPS, d]));

  // --- 2. Use your GeoJSON features ---
  const counties = geo.features;

  // Your properties look like:
  // { County: 'Alamance', FIPS: '001', ... }
  // We need to convert '001' -> '37001' to match CountyFIPS.
  function getFipsFromFeature(f) {
    const props = f.properties || {};
    if (props.GEOID) {
      return String(props.GEOID).padStart(5, "0");
    }
    if (props.FIPS) {
      // FIPS is 3-digit county code; NC state code is 37
      return ("37" + String(props.FIPS).padStart(3, "0"));
    }
    if (props.COUNTYFP) {
      return ("37" + String(props.COUNTYFP).padStart(3, "0"));
    }
    if (f.id != null) {
      return String(f.id).padStart(5, "0");
    }
    return "";
  }

  // Projection (use fixed size to avoid flexbox weirdness)
  const mapWidth  = 800;
  const mapHeight = 600;

  const projection = d3.geoMercator()
    .fitSize([mapWidth, mapHeight], {
      type: "FeatureCollection",
      features: counties
    });

  const path = d3.geoPath().projection(projection);


  // --- 3. Scales for depression hotspot encoding ---
  const depExtent = d3.extent(rows, d => d.DEPRESSION_AdjPrev);
  const colorDep = d3.scaleSequential(d3.interpolateReds).domain(depExtent);

  // Create placeholder needs color scale; domain will be updated when user applies the formula
  const colorNeeds = d3.scaleSequential(d3.interpolateReds).domain([0, 10]);

  // draw map initially colored by depression rate
  drawMap(counties, byFips, getFipsFromFeature, path, colorDep, depExtent, 'Depression Rate (age-adjusted %)');
  drawAllScatters(rows);
  setupTabs();
  // add region quick-select buttons
  setupRegionButtons(counties, byFips, getFipsFromFeature);
  // setup selection mode controls after scatters/brush groups created
  setupSelectionModeControls();
  // setup needs index controls (apply/reset handlers)
  setupNeedsIndexControls(rows, counties, byFips, getFipsFromFeature, path, colorNeeds);
  // setup sidebar internal tab switching (Formula / Graphs)
  setupSidebarTabs();
  // setup the toggle/close behavior for the needs index sidebar/tab
  setupNeedsTabToggle();
}).catch(err => {
  console.error("Error loading data or geojson:", err);
});

// Load, parse and initialize
// - CSV rows + GeoJSON features are fetched above.
// - Data types are normalized and a map (byFips) is created for lookups.
// - Projections, scales and initial visualizations are then created.


/**
 * Setup tabs inside the right sidebar: Formula (default) and Graphs
 */
function setupSidebarTabs() {
  const tabFormula = document.getElementById('tab-formula');
  const tabGraphs = document.getElementById('tab-graphs');
  const panelFormula = document.getElementById('panel-formula');
  const panelGraphs = document.getElementById('panel-graphs');
  if (!tabFormula || !tabGraphs || !panelFormula || !panelGraphs) return;

  function showFormula() {
    panelFormula.style.display = null;
    panelGraphs.style.display = 'none';
    tabFormula.classList.add('active');
    tabGraphs.classList.remove('active');
  }

  function showGraphs() {
    panelFormula.style.display = 'none';
    panelGraphs.style.display = null;
    tabGraphs.classList.add('active');
    tabFormula.classList.remove('active');
  }

  tabFormula.addEventListener('click', showFormula);
  tabGraphs.addEventListener('click', showGraphs);

  // default to showing Formula panel
  showFormula();
}

// Manage the Formula / Graphs tabs inside the right-hand sidebar.
// Clicking a tab toggles which panel's content is visible.


/**
 * Compute NeedsIndex for each row using provided weights object {income, education, depression, poverty}
 * Each variable is normalized to 0-1 (income/education inverted so higher means less need).
 * Resulting index is scaled to 0-10 and stored on row.NeedsIndex.
 */
function computeNeedsIndex(rows, weights) {
  // determine selected variables (weights may be zero)
  const vars = [];
  if (weights.income > 0) vars.push('income');
  if (weights.education > 0) vars.push('education');
  if (weights.depression > 0) vars.push('depression');
  if (weights.poverty > 0) vars.push('poverty');

  // helper to safe extent and normalization
  function norm(values, invert=false) {
    const min = d3.min(values);
    const max = d3.max(values);
    if (min === max) return values.map(_ => 0.5);
    return values.map(v => {
      const t = (v - min) / (max - min);
      return invert ? 1 - t : t;
    });
  }

  // collect arrays
  const incomeVals = rows.map(r => r.MedianIncome);
  const eduVals = rows.map(r => r.BAplusPercent);
  const depVals = rows.map(r => r.DEPRESSION_AdjPrev);
  const povVals = rows.map(r => r.PovertyRate);

  const nIncome = norm(incomeVals, true); // invert: higher income = less need
  const nEdu = norm(eduVals, true); // invert: higher education = less need
  const nDep = norm(depVals, false);
  const nPov = norm(povVals, false);

  // normalize weight sum
  let total = (weights.income || 0) + (weights.education || 0) + (weights.depression || 0) + (weights.poverty || 0);
  if (total === 0) total = 1; // avoid div by zero

  const wi = (weights.income || 0) / total;
  const we = (weights.education || 0) / total;
  const wd = (weights.depression || 0) / total;
  const wp = (weights.poverty || 0) / total;

  rows.forEach((r, i) => {
    const score = (nIncome[i] * wi) + (nEdu[i] * we) + (nDep[i] * wd) + (nPov[i] * wp);
    r.NeedsIndex = +(score * 10).toFixed(2); // 0-10 scale
  });
}

// Compute a normalized 'NeedsIndex' on a 0-10 scale from selected variables.
// Variables are normalized (income/education inverted so higher means less need),
// weights are normalized, and the combined score is scaled to 0-10 and stored on each row.


/**
 * Make the right-hand needs-index sidebar closable and provide a small tab to re-open it.
 */
function setupNeedsTabToggle() {
  const close = document.getElementById('close-needs-tab');
  const sidebar = document.getElementById('sidebar');
  const panelFormula = document.getElementById('panel-formula');
  const panelGraphs = document.getElementById('panel-graphs');
  if (!close || !sidebar || !panelFormula || !panelGraphs) return;

  // toggle panels collapsed vs expanded while keeping the sidebar/tabs visible
  close.addEventListener('click', () => {
    const collapsed = (panelFormula.style.display === 'none' && panelGraphs.style.display === 'none');
    if (!collapsed) {
      // collapse content but keep tabs visible
      panelFormula.style.display = 'none';
      panelGraphs.style.display = 'none';
      close.textContent = '▸';
    } else {
      // expand: show formula panel by default
      panelFormula.style.display = null;
      panelGraphs.style.display = 'none';
      close.textContent = '✕';
    }
  });
}

// Keep the sidebar tabs visible while allowing the content panels to be
// collapsed — useful when the user wants more map space but still reopen the tab.


function setupNeedsIndexControls(rows, counties, byFips, getFipsFromFeature, path, colorNeeds) {
  const apply = document.getElementById('apply-needs');
  const reset = document.getElementById('reset-needs');
  if (!apply || !reset) return;

  apply.addEventListener('click', () => {
    // read checkboxes and sliders
    const useIncome = document.getElementById('var-income').checked;
    const useEdu = document.getElementById('var-education').checked;
    const useDep = document.getElementById('var-depression').checked;
    const usePov = document.getElementById('var-poverty').checked;
    const wIncome = +document.getElementById('w-income').value;
    const wEdu = +document.getElementById('w-education').value;
    const wDep = +document.getElementById('w-depression').value;
    const wPov = +document.getElementById('w-poverty').value;

    const weights = {
      income: useIncome ? wIncome : 0,
      education: useEdu ? wEdu : 0,
      depression: useDep ? wDep : 0,
      poverty: usePov ? wPov : 0
    };

    computeNeedsIndex(rows, weights);
    // update color scale domain
    const newExtent = d3.extent(rows, d => d.NeedsIndex);
    colorNeeds.domain(newExtent);
    // redraw map colored by needs
    drawMap(counties, byFips, getFipsFromFeature, path, colorNeeds, newExtent, 'Needs Index (0-10)');
  });

  reset.addEventListener('click', () => {
    // reset sliders and checkboxes to defaults
    document.getElementById('var-income').checked = true;
    document.getElementById('var-education').checked = true;
    document.getElementById('var-depression').checked = true;
    document.getElementById('var-poverty').checked = true;
    document.getElementById('w-income').value = 25;
    document.getElementById('w-education').value = 25;
    document.getElementById('w-depression').value = 25;
    document.getElementById('w-poverty').value = 25;
    computeNeedsIndex(rows, { income:0.25, education:0.25, depression:0.25, poverty:0.25 });
    const newExtent = d3.extent(rows, d => d.NeedsIndex);
    colorNeeds.domain(newExtent);
    drawMap(counties, byFips, getFipsFromFeature, path, colorNeeds, newExtent, 'Needs Index (0-10)');
  });
}

// Wire the Apply/Reset buttons for the Needs Index UI.
// - Reads checkboxes + slider weights, computes NeedsIndex, updates the color domain,
//   and redraws the map using the Needs color scale when Apply is clicked.


/**
 * Create quick-select buttons that select geographic regions (west/central/east/all)
 * Regions are computed by county centroid longitude tertiles.
 */
function setupRegionButtons(counties, byFips, getFipsFromFeature) {
  const container = d3.select('#region-controls');
  if (container.empty()) return;

  // compute centroid longitudes for each county
  const lonByFeature = counties.map(f => ({
    f,
    lon: d3.geoCentroid(f)[0]
  }));

  const lons = lonByFeature.map(d => d.lon).sort((a,b) => a-b);
  const t1 = lons[Math.floor(lons.length/3)];
  const t2 = lons[Math.floor((lons.length*2)/3)];

  function regionNamesForPredicate(pred) {
    const names = new Set();
    lonByFeature.forEach(({f, lon}) => {
      if (!pred(lon)) return;
      const fips = getFipsFromFeature(f);
      const row = byFips.get(fips);
      if (row) names.add(row.CountyName);
    });
    return names;
  }

  // helper to create a button
  function makeButton(label, onClick) {
    const btn = container.append('button')
      .attr('type', 'button')
      .style('padding', '6px 10px')
      .style('border', '1px solid #ccc')
      .style('background', 'white')
      .style('cursor', 'pointer')
      .text(label)
      .on('click', onClick);
    return btn;
  }

  makeButton('Select West', () => {
    const names = regionNamesForPredicate(lon => lon <= t1);
    brushedCountyNames = names;
    updateScatterHighlightsByNames(brushedCountyNames);
  });

  makeButton('Select Central', () => {
    const names = regionNamesForPredicate(lon => lon > t1 && lon <= t2);
    brushedCountyNames = names;
    updateScatterHighlightsByNames(brushedCountyNames);
  });

  makeButton('Select East', () => {
    const names = regionNamesForPredicate(lon => lon > t2);
    brushedCountyNames = names;
    updateScatterHighlightsByNames(brushedCountyNames);
  });

  makeButton('Select All', () => {
    const names = regionNamesForPredicate(() => true);
    brushedCountyNames = names;
    updateScatterHighlightsByNames(brushedCountyNames);
  });

  makeButton('Clear Selection', () => {
    brushedCountyNames.clear();
    updateScatterHighlightsByNames(brushedCountyNames);
    // also clear single selection outline
    highlightScatter(null);
  });
}

// Quick-select geographic regions (west/central/east) by using centroid longitudes.
// These helpers produce a Set of CountyName strings which is applied as a brushed selection.


/**
 * Draw NC map with depression hotspots colored by county
 */
function drawMap(counties, byFips, getFipsFromFeature, path, color, legendExtent, legendTitle) {
  mapSvg.selectAll("*").remove();

  const container = mapSvg.node();
  const w = 800;
  const h = 600;

  const g = mapSvg
    .attr("viewBox", `0 0 ${w} ${h}`)
    .append("g");

  // County polygons colored by depression rate
  g.selectAll("path")
    .data(counties)
    .join("path")
    .attr("d", path)
    .attr("fill", d => {
      const fips = getFipsFromFeature(d);
      const row = byFips.get(fips);
      if (!row) return "#f5f5f5";
      // prefer NeedsIndex if available, otherwise fall back to depression
      const val = (row.NeedsIndex != null) ? row.NeedsIndex : row.DEPRESSION_AdjPrev;
      return color(val);
    })
    // keep the county name on the element so other functions can find it
    .attr("data-county-name", d => {
      const fips = getFipsFromFeature(d);
      const row = byFips.get(fips);
      return row ? row.CountyName : "";
    })
    // stroke depends on whether this county is currently selected
    .attr("stroke", d => {
      const fips = getFipsFromFeature(d);
      const row = byFips.get(fips);
      return row && row.CountyName === selectedCountyName ? "#000" : "#fff";
    })
    .attr("stroke-width", d => {
      const fips = getFipsFromFeature(d);
      const row = byFips.get(fips);
      return row && row.CountyName === selectedCountyName ? 3 : 0.5;
    })
    .style("cursor", "pointer")
    .on("mouseover", function (event, d) {
      const fips = getFipsFromFeature(d);
      const row = byFips.get(fips);
      if (!row) return;
      const isSelected = row.CountyName === selectedCountyName;
      // If already selected, keep black outline; otherwise use hover color
      d3.select(this)
        .attr("stroke-width", isSelected ? 3 : 2)
        .attr("stroke", isSelected ? "#000" : "#333");

      tooltip
        .style("opacity", 1)
        .html(`
          <strong>${row.CountyName} County</strong><br/>
          Depression (age-adjusted): ${row.DEPRESSION_AdjPrev.toFixed(1)}%<br/>
          Depression (crude): ${row.DEPRESSION_CrudePrev.toFixed(1)}%
        `)
        .style("left", (event.pageX + 10) + "px")
        .style("top",  (event.pageY + 10) + "px");
    })
    .on("mousemove", (event) => {
      tooltip
        .style("left", (event.pageX + 10) + "px")
        .style("top",  (event.pageY + 10) + "px");
    })
    .on("mouseout", function (event, d) {
      // On mouseout, restore either the selected outline or normal style
      const fips = getFipsFromFeature(d);
      const row = byFips.get(fips);
      const isSelected = row && row.CountyName === selectedCountyName;
      d3.select(this)
        .attr("stroke-width", isSelected ? 3 : 0.5)
        .attr("stroke", isSelected ? "#000" : "#fff");
      tooltip.style("opacity", 0);
    })
    .on("click", (event, d) => {
      const fips = getFipsFromFeature(d);
      const row = byFips.get(fips);
      if (row) {
        updateCountyDetails(row);
        highlightScatter(row.CountyName);
      }
    });

  // Draw color legend
  drawColorLegend(g, color, legendExtent, w, h, legendTitle);
}

// Draw the main choropleth map. Each county is filled by the provided color scale.
// Attaches tooltip, hover, and click behaviors and then calls drawColorLegend.


/**
 * Draw color legend for a given scale
 */
function drawColorLegend(g, color, legendExtent, mapWidth, mapHeight, title) {
  const legendWidth = 300;
  const legendHeight = 18;
  const tickCount = 5;
  const stops = d3.range(tickCount).map(i => {
    const value = d3.interpolateNumber(legendExtent[0], legendExtent[1])(i / (tickCount - 1));
    return { offset: `${(i / (tickCount - 1)) * 100}%`, color: color(value), value: value };
  });

  // If there's a dedicated HTML container for the map legend, render the legend there
  const htmlLegend = document.getElementById('map-legend');
  if (htmlLegend) {
    // clear existing
    htmlLegend.innerHTML = '';
    const svg = d3.select(htmlLegend).append('svg')
      .attr('viewBox', `0 0 ${legendWidth + 40} ${legendHeight + 40}`)
      .attr('width', '100%')
      .attr('height', legendHeight + 40);

    const defs = svg.append('defs');
    const gradient = defs.append('linearGradient').attr('id', 'legend-gradient').attr('x1', '0%').attr('x2', '100%');

    const stops = d3.range(tickCount).map(i => {
      const value = d3.interpolateNumber(legendExtent[0], legendExtent[1])(i / (tickCount - 1));
      return { offset: `${(i / (tickCount - 1)) * 100}%`, color: color(value), value: value };
    });
    stops.forEach(s => gradient.append('stop').attr('offset', s.offset).attr('stop-color', s.color));

    const g2 = svg.append('g').attr('transform', `translate(20,20)`);
    g2.append('rect')
      .attr('width', legendWidth)
      .attr('height', legendHeight)
      .style('fill', 'url(#legend-gradient)')
      .style('stroke', '#333')
      .style('stroke-width', 1);

    // title
    g2.append('text')
      .attr('x', legendWidth / 2)
      .attr('y', -6)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .style('font-weight', 'bold')
      .text(title || 'Legend');

    // ticks
    const tickValues = d3.range(tickCount).map(i => d3.interpolateNumber(legendExtent[0], legendExtent[1])(i / (tickCount - 1)));
    const tickScale = d3.scaleLinear().domain(legendExtent).range([0, legendWidth]);
    tickValues.forEach(value => {
      const x = tickScale(value);
      g2.append('line').attr('x1', x).attr('x2', x).attr('y1', legendHeight).attr('y2', legendHeight + 6).style('stroke', '#333');
      g2.append('text').attr('x', x).attr('y', legendHeight + 20).attr('text-anchor', 'middle').style('font-size', '10px').text(value.toFixed(1));
    });
    return;
  }

  // Fallback: draw inside the provided SVG group (map area)
  const legendX = mapWidth - legendWidth - 20;
  const legendY = 20;
  const legend = g.append("g")
    .attr("class", "legend")
    .attr("transform", `translate(${legendX}, ${legendY})`);

  const svgDefs = mapSvg.append("defs");
  const gradient2 = svgDefs.append("linearGradient").attr("id", "legend-gradient").attr("x1", "0%").attr("x2", "100%");
  stops.forEach(stop => gradient2.append("stop").attr("offset", stop.offset).attr("stop-color", stop.color));

  legend.append("rect").attr("width", legendWidth).attr("height", legendHeight).style("fill", "url(#legend-gradient)").style("stroke", "#333").style("stroke-width", 1);
  legend.append("text").attr("x", legendWidth / 2).attr("y", -5).attr("text-anchor", "middle").style("font-size", "12px").style("font-weight", "bold").text(title || "Legend");
  const tickValues = d3.range(tickCount).map(i => d3.interpolateNumber(legendExtent[0], legendExtent[1])(i / (tickCount - 1)));
  const tickScale = d3.scaleLinear().domain(legendExtent).range([0, legendWidth]);
  tickValues.forEach((value) => {
    const x = tickScale(value);
    legend.append("line").attr("x1", x).attr("x2", x).attr("y1", legendHeight).attr("y2", legendHeight + 5).style("stroke", "#333").style("stroke-width", 1);
    legend.append("text").attr("x", x).attr("y", legendHeight + 18).attr("text-anchor", "middle").style("font-size", "10px").text(value.toFixed(1));
  });
}

// Render a horizontal color ramp legend. If an HTML container `#map-legend` exists,
// draw the legend there (gives more layout control); otherwise fall back to drawing
// inside the SVG group passed in.


/**
 * Update the details panel
 */
function updateCountyDetails(row) {
  detailsTitle.text(`${row.CountyName} County`);
  detailsBox.html(`
    <p><strong>Needs index:</strong> ${row.NeedsIndex != null ? row.NeedsIndex.toFixed(2) + '/10' : 'N/A'}</p>
    <p><strong>Depression (age-adjusted):</strong> ${row.DEPRESSION_AdjPrev.toFixed(1)}%</p>
    <p><strong>Depression (crude):</strong> ${row.DEPRESSION_CrudePrev.toFixed(1)}%</p>
    <p><strong>Total population:</strong> ${row.TotalPopulation.toLocaleString()}</p>
    <p><strong>Median income:</strong> $${row.MedianIncome.toLocaleString()}</p>
    <p><strong>Poverty rate:</strong> ${row.PovertyRate.toFixed(1)}%</p>
    <p><strong>Bachelor's degree or higher:</strong> ${row.BAplusPercent.toFixed(1)}%</p>
  `);
}

// Fill the details panel under the map with a concise set of stats for the
// selected county. The panel is scrollable if there are many fields.


/**
 * Draw all scatterplots
 */
function drawAllScatters(rows) {
  scatterData = rows;
  
  drawScatter(rows, "income", scatterSvgs.income, {
    xField: "MedianIncome",
    xLabel: "Median household income",
    xFormat: d => `$${(d/1000).toFixed(0)}k`,
    xValue: d => d.MedianIncome,
    tooltipValue: d => `$${d.MedianIncome.toLocaleString()}`
  });
  
  drawScatter(rows, "poverty", scatterSvgs.poverty, {
    xField: "PovertyRate",
    xLabel: "Poverty rate (%)",
    xFormat: d => d + "%",
    xValue: d => d.PovertyRate,
    tooltipValue: d => `${d.PovertyRate.toFixed(1)}%`
  });
  
  drawScatter(rows, "education", scatterSvgs.education, {
    xField: "BAplusPercent",
    xLabel: "Bachelor's degree or higher (%)",
    xFormat: d => d + "%",
    xValue: d => d.BAplusPercent,
    tooltipValue: d => `${d.BAplusPercent.toFixed(1)}%`
  });
}

// Create the three scatterplots (each compares a factor vs depression).
// This function delegates to drawScatter for each variable of interest.


/**
 * Draw correlation scatterplot: depression vs various factors
 */
function drawScatter(rows, tabName, svg, config) {
  svg.selectAll("*").remove();

  const margin = { top: 20, right: 20, bottom: 40, left: 50 };
  const fullWidth  = 360;
  const fullHeight = 260;
  const width  = fullWidth  - margin.left - margin.right;
  const height = fullHeight - margin.top  - margin.bottom;

  const g = svg
    .attr("viewBox", `0 0 ${fullWidth} ${fullHeight}`)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const filtered = rows.filter(d =>
    !isNaN(config.xValue(d)) && !isNaN(d.DEPRESSION_AdjPrev)
  );

  const x = d3.scaleLinear()
    .domain(d3.extent(filtered, config.xValue)).nice()
    .range([0, width]);

  const y = d3.scaleLinear()
    .domain(d3.extent(filtered, d => d.DEPRESSION_AdjPrev)).nice()
    .range([height, 0]);

  // Axes
  g.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(
      d3.axisBottom(x)
        .ticks(5)
        .tickFormat(config.xFormat)
    );

  g.append("g")
    .call(
      d3.axisLeft(y)
        .ticks(5)
        .tickFormat(d => d + "%")
    );

  // Axis labels
  g.append("text")
    .attr("x", width / 2)
    .attr("y", height + 32)
    .attr("text-anchor", "middle")
    .style("font-size", 11)
    .text(config.xLabel);

  g.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -38)
    .attr("text-anchor", "middle")
    .style("font-size", 11)
    .text("Depression (age-adjusted, %)");

  // Points
  g.selectAll("circle")
    .data(filtered)
    .join("circle")
    .attr("class", `scatter-point scatter-${tabName}`)
    .attr("cx", d => x(config.xValue(d)))
    .attr("cy", d => y(d.DEPRESSION_AdjPrev))
    .attr("r", 4)
    .attr("fill", "#3182bd")
    .attr("opacity", 0.8)
    .style("cursor", "pointer")
    .on("mouseover", (event, d) => {
      tooltip
        .style("opacity", 1)
        .html(`
          <strong>${d.CountyName} County</strong><br/>
          Depression (age-adjusted): ${d.DEPRESSION_AdjPrev.toFixed(1)}%<br/>
          Depression (crude): ${d.DEPRESSION_CrudePrev.toFixed(1)}%
        `)
        .style("left", (event.pageX + 10) + "px")
        .style("top",  (event.pageY + 10) + "px");
    })
    .on("mouseout", () => tooltip.style("opacity", 0))
    .on("click", (event, d) => {
      // ignore click events when brushing
      if (isBrushing) return;
      // only allow single-click selection in 'individual' mode
      if (selectionMode !== 'individual') return;
      updateCountyDetails(d);
      // clicking a single point should select that county (map outline + scatter highlight)
      highlightScatter(d.CountyName);
    });

  // -- Brushing: allow selecting clusters of points and highlight them across all plots
  const brush = d3.brush()
    .extent([[0, 0], [width, height]])
    .on("start", () => { isBrushing = true; })
    .on("brush", (event) => {
      // while brushing, optionally provide live feedback by highlighting points in this plot
      if (!event.selection) return;
      const [[x0, y0], [x1, y1]] = event.selection;
      const names = new Set(filtered.filter(d => {
        const cx = x(config.xValue(d));
        const cy = y(d.DEPRESSION_AdjPrev);
        return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
      }).map(d => d.CountyName));
      // show live selection on all plots
      updateScatterHighlightsByNames(names);
    })
    .on("end", (event) => {
      isBrushing = false;
      if (!event.selection) {
        // clear selection
        brushedCountyNames.clear();
        updateScatterHighlightsByNames(brushedCountyNames);
        return;
      }
      const [[x0, y0], [x1, y1]] = event.selection;
      const names = new Set(filtered.filter(d => {
        const cx = x(config.xValue(d));
        const cy = y(d.DEPRESSION_AdjPrev);
        return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
      }).map(d => d.CountyName));
      // store the brush selection and apply it across all plots
      brushedCountyNames = names;
      updateScatterHighlightsByNames(brushedCountyNames);
    });

  // Attach brush to the plotting group so coordinates match the scales
  g.append("g")
    .attr("class", "brush")
    .call(brush);
}

// Draw a single scatterplot of depression vs a chosen x-variable.
// - Shows points, axes, and axis labels.
// - Supports click selection (when not brushing) and a brush for cluster selection.


/**
 * Setup tab switching
 */
function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".scatter-panel");
  
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const tabName = tab.getAttribute("data-tab");
      
      // Update active tab
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      
      // Update active panel
      panels.forEach(p => p.classList.remove("active"));
      document.getElementById(`scatter-${tabName}`).classList.add("active");
      
      currentTab = tabName;
      
      // Re-highlight if a county is selected
      if (selectedCountyName) {
        highlightScatter(selectedCountyName);
      }
    });
  });
}

// Tab switching for the older scatter-panel UI: select which scatter tab is active.


/**
 * Highlight scatterpoint when its county is selected on map
 */
function highlightScatter(countyName) {
  // allow clearing selection by passing a falsy countyName
  if (!countyName) {
    selectedCountyName = null;
    // reset scatter points
    Object.values(scatterSvgs).forEach(svg => {
      svg.selectAll(".scatter-point")
        .attr("fill", "#3182bd")
        .attr("stroke", "none")
        .attr("stroke-width", 0)
        .attr("r", 4);
    });
    // reset map outlines
    mapSvg.selectAll("path").each(function() {
      d3.select(this)
        .attr("stroke", "#fff")
        .attr("stroke-width", 0.5);
    });
    return;
  }

  // Clear any brush-based multi-selection when a single county is explicitly chosen
  brushedCountyNames.clear();

  selectedCountyName = countyName;

  // Highlight in all scatterplots (selected point gets black outline)
  Object.values(scatterSvgs).forEach(svg => {
    svg.selectAll(".scatter-point")
      .attr("fill", d => d.CountyName === countyName ? "#dc2626" : "#3182bd")
      .attr("stroke", d => d.CountyName === countyName ? "#000" : "none")
      .attr("stroke-width", d => d.CountyName === countyName ? 1.5 : 0)
      .attr("r", d => d.CountyName === countyName ? 6 : 4);
  });

  // Update map paths to outline the selected county in black, clear others
  mapSvg.selectAll("path").each(function() {
    const el = d3.select(this);
    const name = el.attr("data-county-name");
    const isSel = name === countyName;
    el.attr("stroke", isSel ? "#000" : "#fff")
      .attr("stroke-width", isSel ? 3 : 0.5);
  });
}

// Highlight a single county consistently across the map and all scatterplots.
// Passing a falsy `countyName` clears the selection and resets visuals.

