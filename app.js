// js/app.js
console.log("✅ app.js loaded, D3 version:", d3.version);

// DOM references
const mapSvg       = d3.select("#map");
<<<<<<< HEAD
const scatterSvg   = d3.select("#scatter");
=======
>>>>>>> b6e85e81fba5872a73aeeecf7b75558ad6fd59a7
const tooltip      = d3.select("#tooltip");
const detailsTitle = d3.select("#county-title");
const detailsBox   = d3.select("#county-details");

<<<<<<< HEAD
let scatterData = [];

// Load CSV + GeoJSON
Promise.all([
  d3.csv("data/NC_D3_Data.csv"),
=======
const scatterSvgs = {
  income: d3.select("#scatter-income-svg"),
  poverty: d3.select("#scatter-poverty-svg"),
  education: d3.select("#scatter-education-svg")
};

let scatterData = [];
let currentTab = "income";
let selectedCountyName = null;

// Load CSV + GeoJSON
Promise.all([
  d3.csv("data/NC_County_Data.csv"),
>>>>>>> b6e85e81fba5872a73aeeecf7b75558ad6fd59a7
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
<<<<<<< HEAD
=======
    d.BAplusPercent        = +d["BAplusPercent"];        // education %
>>>>>>> b6e85e81fba5872a73aeeecf7b75558ad6fd59a7
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
  const color = d3.scaleSequential(d3.interpolateReds).domain(depExtent);

  drawMap(counties, byFips, getFipsFromFeature, path, color, depExtent);
<<<<<<< HEAD
  drawScatter(rows);
=======
  drawAllScatters(rows);
  setupTabs();
>>>>>>> b6e85e81fba5872a73aeeecf7b75558ad6fd59a7
}).catch(err => {
  console.error("Error loading data or geojson:", err);
});

/**
 * Draw NC map with depression hotspots colored by county
 */
function drawMap(counties, byFips, getFipsFromFeature, path, color, depExtent) {
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
      return row ? color(row.DEPRESSION_AdjPrev) : "#f5f5f5";
    })
    .attr("stroke", "#fff")
    .attr("stroke-width", 0.5)
    .style("cursor", "pointer")
    .on("mouseover", function (event, d) {
      const fips = getFipsFromFeature(d);
      const row = byFips.get(fips);
      if (!row) return;
      d3.select(this).attr("stroke-width", 2).attr("stroke", "#333");

      tooltip
        .style("opacity", 1)
        .html(`
          <strong>${row.CountyName} County</strong><br/>
          Depression (age-adj): ${row.DEPRESSION_AdjPrev.toFixed(1)}%<br/>
          Depression (crude): ${row.DEPRESSION_CrudePrev.toFixed(1)}%<br/>
          Population: ${row.TotalPopulation.toLocaleString()}<br/>
          Median income: $${row.MedianIncome.toLocaleString()}<br/>
          Poverty rate: ${row.PovertyRate.toFixed(1)}%
        `)
        .style("left", (event.pageX + 10) + "px")
        .style("top",  (event.pageY + 10) + "px");
    })
    .on("mousemove", (event) => {
      tooltip
        .style("left", (event.pageX + 10) + "px")
        .style("top",  (event.pageY + 10) + "px");
    })
    .on("mouseout", function () {
      d3.select(this).attr("stroke-width", 0.5).attr("stroke", "#fff");
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
  drawColorLegend(g, color, depExtent, w, h);
}

/**
 * Draw color legend for depression scale
 */
function drawColorLegend(g, color, depExtent, mapWidth, mapHeight) {
  const legendWidth = 200;
  const legendHeight = 20;
  const legendX = mapWidth - legendWidth - 20;
  const legendY = 20;
  const tickCount = 5;

  // Create legend group
  const legend = g.append("g")
    .attr("class", "legend")
    .attr("transform", `translate(${legendX}, ${legendY})`);

  // Create gradient definition in SVG defs
  const svgDefs = mapSvg.append("defs");
  const gradient = svgDefs.append("linearGradient")
    .attr("id", "depression-gradient")
    .attr("x1", "0%")
    .attr("x2", "100%");

  // Create color stops
  const stops = d3.range(tickCount).map(i => {
    const value = d3.interpolateNumber(depExtent[0], depExtent[1])(i / (tickCount - 1));
    return { offset: `${(i / (tickCount - 1)) * 100}%`, color: color(value), value: value };
  });

  stops.forEach(stop => {
    gradient.append("stop")
      .attr("offset", stop.offset)
      .attr("stop-color", stop.color);
  });

  // Draw gradient rectangle
  legend.append("rect")
    .attr("width", legendWidth)
    .attr("height", legendHeight)
    .style("fill", "url(#depression-gradient)")
    .style("stroke", "#333")
    .style("stroke-width", 1);

  // Add title
  legend.append("text")
    .attr("x", legendWidth / 2)
    .attr("y", -5)
    .attr("text-anchor", "middle")
    .style("font-size", "12px")
    .style("font-weight", "bold")
    .text("Depression Rate (age-adjusted %)");

  // Add tick marks and labels
  const tickValues = d3.range(tickCount).map(i => 
    d3.interpolateNumber(depExtent[0], depExtent[1])(i / (tickCount - 1))
  );

  const tickScale = d3.scaleLinear()
    .domain(depExtent)
    .range([0, legendWidth]);

  tickValues.forEach((value, i) => {
    const x = tickScale(value);
    
    // Tick mark
    legend.append("line")
      .attr("x1", x)
      .attr("x2", x)
      .attr("y1", legendHeight)
      .attr("y2", legendHeight + 5)
      .style("stroke", "#333")
      .style("stroke-width", 1);

    // Label
    legend.append("text")
      .attr("x", x)
      .attr("y", legendHeight + 18)
      .attr("text-anchor", "middle")
      .style("font-size", "10px")
      .text(value.toFixed(1) + "%");
  });
}

/**
 * Update the details panel
 */
function updateCountyDetails(row) {
  detailsTitle.text(`${row.CountyName} County`);

  detailsBox.html(`
    <p><strong>Depression (age-adjusted):</strong> ${row.DEPRESSION_AdjPrev.toFixed(1)}%</p>
    <p><strong>Depression (crude):</strong> ${row.DEPRESSION_CrudePrev.toFixed(1)}%</p>
    <p><strong>Total population:</strong> ${row.TotalPopulation.toLocaleString()}</p>
    <p><strong>Median income:</strong> $${row.MedianIncome.toLocaleString()}</p>
    <p><strong>Poverty rate:</strong> ${row.PovertyRate.toFixed(1)}%</p>
<<<<<<< HEAD
=======
    <p><strong>Bachelor's degree or higher:</strong> ${row.BAplusPercent.toFixed(1)}%</p>
>>>>>>> b6e85e81fba5872a73aeeecf7b75558ad6fd59a7
  `);
}

/**
<<<<<<< HEAD
 * Draw correlation scatterplot: income vs depression (age-adjusted)
 */
function drawScatter(rows) {
  scatterData = rows;

  const svg = scatterSvg;
  svg.selectAll("*").remove();

  const margin = { top: 20, right: 20, bottom: 40, left: 50 };
  const fullWidth  = svg.node().clientWidth  || 360;
  const fullHeight = svg.node().clientHeight || 260;
=======
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

/**
 * Draw correlation scatterplot: depression vs various factors
 */
function drawScatter(rows, tabName, svg, config) {
  svg.selectAll("*").remove();

  const margin = { top: 20, right: 20, bottom: 40, left: 50 };
  const fullWidth  = 360;
  const fullHeight = 260;
>>>>>>> b6e85e81fba5872a73aeeecf7b75558ad6fd59a7
  const width  = fullWidth  - margin.left - margin.right;
  const height = fullHeight - margin.top  - margin.bottom;

  const g = svg
    .attr("viewBox", `0 0 ${fullWidth} ${fullHeight}`)
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const filtered = rows.filter(d =>
<<<<<<< HEAD
    !isNaN(d.MedianIncome) && !isNaN(d.DEPRESSION_AdjPrev)
  );

  const x = d3.scaleLinear()
    .domain(d3.extent(filtered, d => d.MedianIncome)).nice()
=======
    !isNaN(config.xValue(d)) && !isNaN(d.DEPRESSION_AdjPrev)
  );

  const x = d3.scaleLinear()
    .domain(d3.extent(filtered, config.xValue)).nice()
>>>>>>> b6e85e81fba5872a73aeeecf7b75558ad6fd59a7
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
<<<<<<< HEAD
        .tickFormat(d => `$${(d/1000).toFixed(0)}k`)
=======
        .tickFormat(config.xFormat)
>>>>>>> b6e85e81fba5872a73aeeecf7b75558ad6fd59a7
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
<<<<<<< HEAD
    .text("Median household income");
=======
    .text(config.xLabel);
>>>>>>> b6e85e81fba5872a73aeeecf7b75558ad6fd59a7

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
<<<<<<< HEAD
    .attr("class", "scatter-point")
    .attr("cx", d => x(d.MedianIncome))
=======
    .attr("class", `scatter-point scatter-${tabName}`)
    .attr("cx", d => x(config.xValue(d)))
>>>>>>> b6e85e81fba5872a73aeeecf7b75558ad6fd59a7
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
          Depression: ${d.DEPRESSION_AdjPrev.toFixed(1)}%<br/>
<<<<<<< HEAD
          Income: $${d.MedianIncome.toLocaleString()}
=======
          ${config.xLabel.split(" (")[0]}: ${config.tooltipValue(d)}
>>>>>>> b6e85e81fba5872a73aeeecf7b75558ad6fd59a7
        `)
        .style("left", (event.pageX + 10) + "px")
        .style("top",  (event.pageY + 10) + "px");
    })
    .on("mouseout", () => tooltip.style("opacity", 0))
    .on("click", (event, d) => {
      updateCountyDetails(d);
      highlightScatter(d.CountyName);
    });
}

/**
<<<<<<< HEAD
 * Highlight scatterpoint when its county is selected on map
 */
function highlightScatter(countyName) {
  scatterSvg.selectAll(".scatter-point")
    .attr("fill", d => d.CountyName === countyName ? "#dc2626" : "#3182bd")
    .attr("stroke", "none")
    .attr("r", d => d.CountyName === countyName ? 6 : 4);
=======
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

/**
 * Highlight scatterpoint when its county is selected on map
 */
function highlightScatter(countyName) {
  selectedCountyName = countyName;
  
  // Highlight in all scatterplots
  Object.values(scatterSvgs).forEach(svg => {
    svg.selectAll(".scatter-point")
      .attr("fill", d => d.CountyName === countyName ? "#dc2626" : "#3182bd")
      .attr("stroke", d => d.CountyName === countyName ? "#dc2626" : "none")
      .attr("stroke-width", d => d.CountyName === countyName ? 1.5 : 0)
      .attr("r", d => d.CountyName === countyName ? 6 : 4);
  });
>>>>>>> b6e85e81fba5872a73aeeecf7b75558ad6fd59a7
}
