import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

// Load the US counties GeoJSON data
const counties = await d3.json("assets/counties.geojson");

// Combine "STATEFP" and "COUNTYFP" into "FP"
counties.features.forEach(feature => {
  feature.properties.FP = feature.properties.STATEFP + feature.properties.COUNTYFP;
  delete feature.properties.STATEFP;
  delete feature.properties.COUNTYFP;
});

// Function to load and process Rural-Urban Continuum Codes
async function loadRuralUrbanData() {
  const response = await fetch("assets/Ruralurbancontinuumcodes2023.xlsx");
  const data = await response.arrayBuffer();

  // Parse the Excel file
  const workbook = XLSX.read(data, { type: "array" });

  // Access the first sheet
  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  // Convert the sheet to JSON, starting from the second row
  const jsonData = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    range: 1
  });

  // Extract relevant data
  return jsonData.map(row => ({
    fips: row[0], // First column (FIPS code)
    type: row[5] ? row[5].split(" ")[0] : null // 6th column (Type), extracting only "Metro" or "Nonmetro"
  })).filter(d => d.type); // Keep only rows with a valid type
}

// Load and integrate Rural-Urban Continuum Codes into counties data
const ruralUrbanData = await loadRuralUrbanData();

counties.features.forEach(feature => {
  const matchingData = ruralUrbanData.find(d => d.fips === feature.properties.FP);
  if (matchingData) {
    feature.properties.type = matchingData.type; // Add the "type" property
  }
});

// Define the width and height of the SVG container
const width = 975;
const height = 610;
const margin = { top: 20, right: 100, bottom: 20, left: 20 };

// Define the projection and path generator
const projection = d3.geoAlbersUsa()
  .scale(1000)
  .translate([width / 2, height / 2]);

const path = d3.geoPath(projection);

// Create the SVG container
const svg = d3.create("svg")
  .attr("width", width + margin.left + margin.right)
  .attr("height", height + margin.top + margin.bottom)
  .attr("viewBox", [0, 0, width + margin.left + margin.right, height + margin.top + margin.bottom]);

// Create a group element that will hold the counties paths
const countiesGroup = svg.append("g")
  .attr("transform", `translate(${margin.left}, ${margin.top})`);

// Create the tooltip (hidden by default)
const tooltip = d3.select("body").append("div")
  .attr("class", "tooltip")
  .style("position", "absolute")
  .style("visibility", "hidden")
  .style("background-color", "rgba(0, 0, 0, 0.7)")
  .style("color", "#fff")
  .style("padding", "8px")
  .style("border-radius", "4px")
  .style("pointer-events", "none")
  .style("font-size", "12px");

// Function to load and update the map based on the selected year
async function updateMap(year) {
  const sheetName = `laucnty${year.toString().slice(-2)}`;
  const response = await fetch("assets/laucnty23.xlsx");
  const data = await response.arrayBuffer();

  // Parse the Excel file
  const workbook = XLSX.read(data, { type: "array" });

  // Access the relevant sheet
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    console.error(`Sheet ${sheetName} not found.`);
    return;
  }

  // Convert the sheet to JSON
  const jsonData = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    range: 2
  });

  // Transform the data
  const transformedData = jsonData.map(row => ({
    fp: row[1] + row[2],
    county: row[3],
    laborforce: row[6],
    employed: row[7],
    unemployed: row[8],
    rate: row[9]
  }));

  // Find the min and max unemployment rates
  const minRate = d3.min(transformedData, d => d.rate);
  const maxRate = d3.max(transformedData, d => d.rate);

  // Define the color scale
  const colorScale = d3.scaleSequential(d3.interpolateYlOrRd)
    .domain([minRate, maxRate]);

  // Link the transformed data with the counties
  counties.features.forEach(feature => {
    const countyData = transformedData.find(d => d.fp === feature.properties.FP);
    if (countyData) {
      feature.properties.data = countyData;
    }
  });

  // Update the counties paths
  countiesGroup.selectAll("path")
    .data(counties.features)
    .join("path")
    .attr("d", path)
    .attr("fill", d => colorByRate(d.properties.data, colorScale))
    .attr("stroke", "#666")
    .attr("stroke-width", 0.5)
    .on("mouseover", (event, d) => {
      const countyData = d.properties.data;
      const type = d.properties.type || "Unknown";
      if (countyData) {
        tooltip.style("visibility", "visible")
          .html(`
            <strong>${d.properties.NAME}</strong><br>
            Unemployment Rate: ${countyData.rate}%<br>
            Labor Force: ${countyData.laborforce}<br>
            Unemployed: ${countyData.unemployed}<br>
            Type: ${type}
          `);
      }
    })
    .on("mousemove", (event) => {
      tooltip.style("top", (event.pageY + 10) + "px")
        .style("left", (event.pageX + 10) + "px");
    })
    .on("mouseout", () => {
      tooltip.style("visibility", "hidden");
    });

  // Remove the old legend before adding the new one
  svg.selectAll(".legend").remove();

  // Create the color legend
  const legendHeight = 300;
  const legendWidth = 20;

  const legend = svg.append("g")
    .attr("class", "legend")
    .attr("transform", `translate(${width + margin.left + 10}, ${margin.top + 120})`);

  legend.selectAll("rect")
    .data(d3.range(legendHeight))
    .join("rect")
    .attr("x", 0)
    .attr("y", d => d)
    .attr("width", legendWidth)
    .attr("height", 1)
    .attr("fill", d => colorScale(maxRate - (d / legendHeight) * (maxRate - minRate)));

  const yAxis = d3.axisRight()
    .scale(d3.scaleLinear()
      .domain([minRate, maxRate])
      .range([legendHeight, 0])
      .nice())
    .ticks(5)
    .tickFormat(d => `${d.toFixed(1)}%`);

  legend.append("g")
    .attr("transform", "translate(20,0)")
    .call(yAxis)
    .selectAll("text")
    .style("font-size", "12px");

  legend.append("text")
    .attr("x", 0)
    .attr("y", -20)
    .attr("dy", ".35em")
    .attr("text-anchor", "middle")
    .text("Unemployment Rate");

    updateStatistics();
}

// Add zoom behavior
const zoom = d3.zoom()
  .scaleExtent([1, 8])
  .translateExtent([[0, 0], [width, height]])
  .on("zoom", (event) => {
    countiesGroup.attr("transform", event.transform);
  });

// Apply zoom behavior to the SVG
svg.call(zoom);

// Add the SVG to the #map container
document.getElementById("map-container").appendChild(svg.node());

let debounceTimeout;

document.getElementById("yearSlider").addEventListener("input", (event) => {
  const selectedYear = +event.target.value;
  document.getElementById("currentYearMain").textContent = selectedYear;

  clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(async () => {
    await updateMap(selectedYear);
  }, 300);
});

// Load the initial data for the current slider value
const initialYear = +document.getElementById("yearSlider").value;
await updateMap(initialYear);

// Function to color counties based on the unemployment rate or other data
function colorByRate(data, colorScale) {
  if (!data) return "#ccc";
  return colorScale(data.rate);
}

function updateStatistics() {
  // Initialize the sums
  let totalWorkforce = 0;
  let totalUrbanUnemployed = 0;
  let totalRuralUnemployed = 0;

  // Iterate through the counties to sum the relevant values
  counties.features.forEach(feature => {
    const data = feature.properties.data;  // Data for the county
    if (data) {
      const laborforce = +data.laborforce;  // Convert laborforce to a number
      const unemployed = +data.unemployed;  // Convert unemployed to a number

      // Only add to the totals if the values are valid numbers
      if (!isNaN(laborforce)) {
        totalWorkforce += laborforce;  // Sum of all county workforce
      }

      if (feature.properties.type === "Metro" && !isNaN(unemployed)) {
        totalUrbanUnemployed += unemployed;  // Sum of unemployed in urban counties
      } else if (feature.properties.type === "Nonmetro" && !isNaN(unemployed)) {
        totalRuralUnemployed += unemployed;  // Sum of unemployed in rural counties
      }
    }
  });

  // Update the DOM elements with the calculated values
  document.getElementById("totalPop").textContent = totalWorkforce.toLocaleString();  // Total workforce
  document.getElementById("urbanPop").textContent = totalUrbanUnemployed.toLocaleString();  // Urban unemployed
  document.getElementById("ruralPop").textContent = totalRuralUnemployed.toLocaleString();  // Rural unemployed
}
