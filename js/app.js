// JavaScript functionality for NC Depression Hotspots visualization

// References the DOM elements we'll interact with to link JS and HTML elements so we can use D3 later to draw charts and update text
const mapSvg       = d3.select("#map");
const tooltip      = d3.select("#tooltip");
//Detail panel elements
const detailsTitle = d3.select("#map-county-title");
const detailsBox   = d3.select("#map-county-details");
//Scatter plot elements
const scatterSvgs = {
  income: d3.select("#scatter-income-svg"),
  poverty: d3.select("#scatter-poverty-svg"),
  education: d3.select("#scatter-education-svg")
};

// Sets intial states for variables and data sets
let scatterData = [];
let currentTab = "income";
let selectedCountyName = null;
// Set of selected county names for the select cluster feature
let brushedCountyNames = new Set();
// Sets selection mode states
let isBrushing = false;
let selectionMode = 'individual';

// Update UI and brush visibility based on selection mode
function setSelectionMode(mode) {
  selectionMode = mode;
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
  // Adjusts show state of brush so it is not showing up when not in use
  const show = mode === 'cluster';
  d3.selectAll('.brush').style('display', show ? null : 'none');
  isBrushing = false;
}


// Toggles between individual and cluster selection modes and updates the UI accordingly
function setupSelectionModeControls() {
  const ind = document.getElementById('mode-individual');
  const clu = document.getElementById('mode-cluster');
  if (!ind || !clu) return;
  ind.addEventListener('click', () => setSelectionMode('individual'));
  clu.addEventListener('click', () => setSelectionMode('cluster'));
  setSelectionMode(selectionMode);
}

// Emphasize selected points in scatterplots with red fill and black stroke and outline them on the map with a thicker black outline
function updateScatterHighlightsByNames(nameSet) {
  Object.values(scatterSvgs).forEach(svg => {
    svg.selectAll(".scatter-point")
      .attr("fill", d => nameSet.has(d.CountyName) ? "#dc2626" : "#3182bd")
      .attr("stroke", d => nameSet.has(d.CountyName) ? "#000" : "none")
      .attr("stroke-width", d => nameSet.has(d.CountyName) ? 1.5 : 0)
      .attr("r", d => nameSet.has(d.CountyName) ? 6 : 4);
  });
  try {
    mapSvg.selectAll("path").each(function() {
      const el = d3.select(this);
      const name = el.attr("data-county-name");
      const isSel = name && nameSet.has(name);
      el.attr("stroke", isSel ? "#000" : "#fff")
        .attr("stroke-width", isSel ? 3 : 0.5);
    });
  } catch (e) {
    // If map hasn't loaded yet, fail silently
  }
}


// Load CSV + GeoJSON data files
Promise.all([
  d3.csv("data/NC_County_Data.csv"),
  d3.json("data/nc-counties.geojson")
]).then(([rows, geo]) => {
    console.log("✅ Promise resolved");
console.log("Rows loaded from CSV:", rows.length);
console.log("GeoJSON type:", geo.type);
console.log("GeoJSON features:", geo.features ? geo.features.length : "NO FEATURES");

  // Clean up the CSV values from data files and assign types
  rows.forEach(d => {
    d.DEPRESSION_AdjPrev   = +d["DEPRESSION_AdjPrev"];   // age-adjusted %
    d.DEPRESSION_CrudePrev = +d["DEPRESSION_CrudePrev"]; // crude %
    d.TotalPopulation      = +d["TotalPopulation"]; // total population
    d.TotalPop18plus       = +d["TotalPop18plus"]; // adult population
    d.MedianIncome         = +d["MedianIncome"]; // median income
    d.PovertyRate          = +d["PovertyRate"]; // poverty %
    d.BAplusPercent        = +d["BAplusPercent"]; // education %
    d.CountyFIPS           = d["CountyFIPS"].toString().padStart(5, "0"); // count FIPS code: connects the counties from CSV to GeoJSON boundaries
  });

  // maps the CSV rows by CountyFIPS for easy lookup
  const byFips = new Map(rows.map(d => [d.CountyFIPS, d]));

  // Uses the GeoJSON features to set up county boundaries
  const counties = geo.features;

  // Match county FIPS between CSV and GeoJSON
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

  // Sets fixed size for map
  const mapWidth  = 800;
  const mapHeight = 600;

  // Uses D3 to draw NC counties using a mercator projection for NC
  const projection = d3.geoMercator()
    .fitSize([mapWidth, mapHeight], {
      type: "FeatureCollection",
      features: counties
    });

  const path = d3.geoPath().projection(projection);


  // Create color scale for depression rate and assigns a sequential red scale using the D3 interpolateReds scale
  const depExtent = d3.extent(rows, d => d.DEPRESSION_AdjPrev);
  const colorDep = d3.scaleSequential(d3.interpolateReds).domain(depExtent);

  // Depression rate color scale for intial state
  const colorNeeds = d3.scaleSequential(d3.interpolateReds).domain([0, 10]);
  drawMap(counties, byFips, getFipsFromFeature, path, colorDep, depExtent, 'Depression Rate (age-adjusted %)');
  drawAllScatters(rows);
  setupTabs();
  // Add region buttons
  setupRegionButtons(counties, byFips, getFipsFromFeature);
  // Add selection mode controls
  setupSelectionModeControls();
  // Create needs index controls
  setupNeedsIndexControls(rows, counties, byFips, getFipsFromFeature, path, colorNeeds);
  // Create sidebar tabs and toggle feature for them
  setupSidebarTabs();
  setupNeedsTabToggle();
}).catch(err => {
  console.error("Error loading data or geojson:", err);
});


// Set up the two tab views in the sidebar and style their intial state
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

  // Graphs show as default
  showGraphs();
}

// Function to calculate formula for needs index using user-defined weights
function computeNeedsIndex(rows, weights) {
  // If variables were chosen, assigns weights
  const vars = [];
  if (weights.income > 0) vars.push('income');
  if (weights.education > 0) vars.push('education');
  if (weights.depression > 0) vars.push('depression');
  if (weights.poverty > 0) vars.push('poverty');

  // Ensures normalization of values
  function norm(values, invert=false) {
    const min = d3.min(values);
    const max = d3.max(values);
    if (min === max) return values.map(_ => 0.5);
    return values.map(v => {
      const t = (v - min) / (max - min);
      return invert ? 1 - t : t;
    });
  }

  // Creates arrays of each variable's values from the CSV data
  const incomeVals = rows.map(r => r.MedianIncome);
  const eduVals = rows.map(r => r.BAplusPercent);
  const depVals = rows.map(r => r.DEPRESSION_AdjPrev);
  const povVals = rows.map(r => r.PovertyRate);

  const nIncome = norm(incomeVals, true); 
  const nEdu = norm(eduVals, true); 
  const nDep = norm(depVals, false);
  const nPov = norm(povVals, false);

  // Creates a sum of normalized weights
  let total = (weights.income || 0) + (weights.education || 0) + (weights.depression || 0) + (weights.poverty || 0);
  if (total === 0) total = 1; 

  const wi = (weights.income || 0) / total;
  const we = (weights.education || 0) / total;
  const wd = (weights.depression || 0) / total;
  const wp = (weights.poverty || 0) / total;

  // Computes the final NeedsIndex score for each row (county)
  rows.forEach((r, i) => {
    const score = (nIncome[i] * wi) + (nEdu[i] * we) + (nDep[i] * wd) + (nPov[i] * wp);
    r.NeedsIndex = +(score * 10).toFixed(2);
  });
}

// Creates apply and reset buttons for the Needs Index controls
function setupNeedsIndexControls(rows, counties, byFips, getFipsFromFeature, path, colorNeeds) {
  const apply = document.getElementById('apply-needs');
  const reset = document.getElementById('reset-needs');
  if (!apply || !reset) return;

  apply.addEventListener('click', () => {
    // Gets user input from checkboxes and sliders in the formula tab
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
    // Update the color scale domain for Needs Index
    const newExtent = d3.extent(rows, d => d.NeedsIndex);
    colorNeeds.domain(newExtent);
    drawMap(counties, byFips, getFipsFromFeature, path, colorNeeds, newExtent, 'Needs Index (0-10)');
  });

  // Reset button to default values upon clicking reset
  reset.addEventListener('click', () => {
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




// Add functionality for region selection buttons by splitting counties into west/central/east based on centroid longitudes and selecting + outlining the counties of those regions
function setupRegionButtons(counties, byFips, getFipsFromFeature) {
  const container = d3.select('#region-controls');
  if (container.empty()) return;
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

  // Function to create a button with label and onClick handler for other functions to use for UI creation
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
    highlightScatter(null);
  });
}


// Function to draw the main choropleth map. Each county is filled by the provided color scale.
function drawMap(counties, byFips, getFipsFromFeature, path, color, legendExtent, legendTitle) {
  mapSvg.selectAll("*").remove();

  const container = mapSvg.node();
  const w = 800;
  const h = 600;

  const g = mapSvg
    .attr("viewBox", `0 0 ${w} ${h}`)
    .append("g");

  g.selectAll("path")
    .data(counties)
    .join("path")
    .attr("d", path)
    .attr("fill", d => {
      const fips = getFipsFromFeature(d);
      const row = byFips.get(fips);
      if (!row) return "#f5f5f5";
      // Use needs index color scale is set, otherwise depression color scale intially
      const val = (row.NeedsIndex != null) ? row.NeedsIndex : row.DEPRESSION_AdjPrev;
      return color(val);
    })
    .attr("data-county-name", d => {
      const fips = getFipsFromFeature(d);
      const row = byFips.get(fips);
      return row ? row.CountyName : "";
    })
    // Add stroke if county is selected
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
      // Keep the balck outline while selected
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

  drawColorLegend(g, color, legendExtent, w, h, legendTitle);
}


// Draw color legend above the map 
function drawColorLegend(g, color, legendExtent, mapWidth, mapHeight, title) {
  const legendWidth = 300;
  const legendHeight = 18;
  const tickCount = 5;
  const stops = d3.range(tickCount).map(i => {
    const value = d3.interpolateNumber(legendExtent[0], legendExtent[1])(i / (tickCount - 1));
    return { offset: `${(i / (tickCount - 1)) * 100}%`, color: color(value), value: value };
  });

  const htmlLegend = document.getElementById('map-legend');
  if (htmlLegend) {
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

    // Create title for legend
    g2.append('text')
      .attr('x', legendWidth / 2)
      .attr('y', -6)
      .attr('text-anchor', 'middle')
      .style('font-size', '12px')
      .style('font-weight', 'bold')
      .text(title || 'Legend');

    // Add legend ticks and labels to indicate scale values
    const tickValues = d3.range(tickCount).map(i => d3.interpolateNumber(legendExtent[0], legendExtent[1])(i / (tickCount - 1)));
    const tickScale = d3.scaleLinear().domain(legendExtent).range([0, legendWidth]);
    tickValues.forEach(value => {
      const x = tickScale(value);
      g2.append('line').attr('x1', x).attr('x2', x).attr('y1', legendHeight).attr('y2', legendHeight + 6).style('stroke', '#333');
      g2.append('text').attr('x', x).attr('y', legendHeight + 20).attr('text-anchor', 'middle').style('font-size', '10px').text(value.toFixed(1));
    });
    return;
  }
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


// Update details panel with selected county stats
//Update county details panel with selected county stats and add info icons for each statistic
function updateCountyDetails(row) {
  detailsTitle.text(`${row.CountyName} County`);
  detailsBox.html(`
    <p><strong>Needs index:</strong> ${row.NeedsIndex != null ? row.NeedsIndex.toFixed(2) + '/10' : 'N/A'} <span class="info-icon" style="margin-left:4px;">i<span class="info-tooltip">Custom composite score (0-10) combining income, education, depression, and poverty rates. Higher values indicate greater need.</span></span></p>
    <p><strong>Depression (age-adjusted):</strong> ${row.DEPRESSION_AdjPrev.toFixed(1)}% <span class="info-icon" style="margin-left:4px;">i<span class="info-tooltip">Percentage of adults with depression, adjusted for age distribution to allow fair comparison across counties.</span></span></p>
    <p><strong>Depression (crude):</strong> ${row.DEPRESSION_CrudePrev.toFixed(1)}% <span class="info-icon" style="margin-left:4px;">i<span class="info-tooltip">Raw percentage of adults with depression, not adjusted for age differences between counties.</span></span></p>
    <p><strong>Total population:</strong> ${row.TotalPopulation.toLocaleString()} <span class="info-icon" style="margin-left:4px;">i<span class="info-tooltip">Total number of residents in the county.</span></span></p>
    <p><strong>Median income:</strong> $${row.MedianIncome.toLocaleString()} <span class="info-icon" style="margin-left:4px;">i<span class="info-tooltip">Middle value of household income, where half of households earn more and half earn less.</span></span></p>
    <p><strong>Poverty rate:</strong> ${row.PovertyRate.toFixed(1)}% <span class="info-icon" style="margin-left:4px;">i<span class="info-tooltip">Percentage of population living below the federal poverty threshold.</span></span></p>
    <p><strong>Bachelor's degree or higher:</strong> ${row.BAplusPercent.toFixed(1)}% <span class="info-icon" style="margin-left:4px;">i<span class="info-tooltip">Percentage of adults (25+) who have completed at least a bachelor's degree.</span></span></p>
  `);
  
  //Set up tooltip positioning for dynamically added info icons
  const newInfoIcons = detailsBox.node().querySelectorAll('.info-icon');
  newInfoIcons.forEach(icon => {
    const tooltip = icon.querySelector('.info-tooltip');
    if (tooltip) {
      icon.addEventListener('mouseenter', function() {
        requestAnimationFrame(() => {
          if (window.positionTooltip) {
            window.positionTooltip(icon, tooltip);
          }
        });
      });
    }
  });
}


// Draw scatterplots graph/ outline for all three factors vs depression and align vertically
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


// Add values/ datapoints to scatterplots
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

  // Creates axes for scatterplots
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

  // Creates axis labels for scatterplots
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
      if (isBrushing) return;
      if (selectionMode !== 'individual') return;
      updateCountyDetails(d);
      highlightScatter(d.CountyName);
    });

  // Allow users to brush to select multiple points
  const brush = d3.brush()
    .extent([[0, 0], [width, height]])
    .on("start", () => { isBrushing = true; })
    .on("brush", (event) => {
      // Highlight selected points as brushing
      if (!event.selection) return;
      const [[x0, y0], [x1, y1]] = event.selection;
      const names = new Set(filtered.filter(d => {
        const cx = x(config.xValue(d));
        const cy = y(d.DEPRESSION_AdjPrev);
        return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
      }).map(d => d.CountyName));
      updateScatterHighlightsByNames(names);
    })
    .on("end", (event) => {
      isBrushing = false;
      if (!event.selection) {
        // Clear selection is clicked outside brush area
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
      // Show brush selection across all scatterplots
      brushedCountyNames = names;
      updateScatterHighlightsByNames(brushedCountyNames);
    });
  g.append("g")
    .attr("class", "brush")
    .call(brush);
}


// Sets up active tab name tracking for selected tab
function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  const panels = document.querySelectorAll(".scatter-panel");
  
  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const tabName = tab.getAttribute("data-tab");
      
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      
      panels.forEach(p => p.classList.remove("active"));
      document.getElementById(`scatter-${tabName}`).classList.add("active");
      
      currentTab = tabName;
      
      if (selectedCountyName) {
        highlightScatter(selectedCountyName);
      }
    });
  });
}


// Emphasize a selected county data point across all scatterplots and the map
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
  brushedCountyNames.clear();

  selectedCountyName = countyName;

  // Highlight in all scatterplots when a county is selected
  Object.values(scatterSvgs).forEach(svg => {
    svg.selectAll(".scatter-point")
      .attr("fill", d => d.CountyName === countyName ? "#dc2626" : "#3182bd")
      .attr("stroke", d => d.CountyName === countyName ? "#000" : "none")
      .attr("stroke-width", d => d.CountyName === countyName ? 1.5 : 0)
      .attr("r", d => d.CountyName === countyName ? 6 : 4);
  });

  mapSvg.selectAll("path").each(function() {
    const el = d3.select(this);
    const name = el.attr("data-county-name");
    const isSel = name === countyName;
    el.attr("stroke", isSel ? "#000" : "#fff")
      .attr("stroke-width", isSel ? 3 : 0.5);
  });
}

