// build a PDF and SVG of a Faraday customer map
// usage node map.js

//////////////////////////////////////////////////////////////////////////////////////////////
// define parameters
//////////////////////////////////////////////////////////////////////////////////////////////

var fs = require('fs')
var d3 = require('d3')
var jsdom = require('jsdom')
var request = require('request')
var topojson = require('topojson')
var pdf = require('phantom-html2pdf')
var turf = require('turf')
var csv2geojson = require('csv2geojson')
var commandLineArgs = require('command-line-args')
var path = require('path')
var maki = require('maki')
var DOMParser = require('xmldom').DOMParser

var optionDefinitions = [
  { name: 'title', alias: 't', type: String },
  { name: 'output-type', alias: 'o', type: String, defaultValue: 'svg'},
  { name: 'csv-source', alias: 'c', type: String },
  { name: 'geojson-source', alias: 'g', type: String },
  { name: 'topojson-source', alias: 'p', type: String },
  { name: 'maki-icon', alias: 'm', type: String },
  { name: 'color-scheme', alias: 's', type: String, defaultValue: 'jan'},
  { name: 'theme-geometry', alias: 'h', type: String }
]
var cmdOptions = commandLineArgs(optionDefinitions)

var projTitle = cmdOptions.title
var colorMonth = cmdOptions['color-scheme']

if (!!cmdOptions['csv-source'] + !!cmdOptions['geojson-source'] + !!cmdOptions['topojson-source'] >= 2) {
  console.error('HOLD UP - try specifying a single source')
}

if (cmdOptions['theme-geometry'] && !cmdOptions['csv-source'] && !cmdOptions['geojson-source'] && !cmdOptions['topojson-source']) {
  console.error('WHOA THERE - you need to specify a source for your ' + cmdOptions['theme-geometry'] + ' layer')
}
    
if (!fs.existsSync('./projects/' + projTitle)){
  fs.mkdirSync('./projects/' + projTitle);
}

var width = 3300,
  height = 2350,
  markerSize = 11, // other acceptable option here is 15. long story.
  legendCells = 9,
  scaleCenter;

//////////////////////////////////////////////////////////////////////////////////////////////
// helper functions for building geojson from whatever
//////////////////////////////////////////////////////////////////////////////////////////////

function requestP(url) {
  return new Promise(function(resolve, reject) {
    request(url, function(error, response, body) {
      if (error) {
        reject(error);
        return;
      } else if (!error && response.statusCode == 200) {
        body = JSON.parse(body);
        resolve(body);
      }
    })
  });
}

//////////////////////////////////////////////////////////////////////////////////////////////
// data preprocessing
//////////////////////////////////////////////////////////////////////////////////////////////
// specify urls for any remote data layers, using the requestP() function
// specify paths for any local data layers, using getCsv() if not already geojson,
// or getGeojson if already geojson

console.error('pulling in the data from the hinterlands - "HERE, DATA DATA DATA!"')
var sourceGrabs;
var promiseData;
if (cmdOptions['geojson-source']) {
  promiseData = cmdOptions['geojson-source']
  sourceGrabs = function(url) {
    return new Promise(function(resolve, reject) {
      var rawData = JSON.parse(fs.readFileSync(url, 'utf8'));
      var outData = { type: 'FeatureCollection', features: [] }
      for (var f = 0; f < rawData.features.length; f++) {
        if (rawData.features[f].geometry) {
          outData.features.push(rawData.features[f])
        }
      }
      resolve(outData);
    });
  }
}
if (cmdOptions['topojson-source']) {
  promiseData = cmdOptions['topojson-source']
  sourceGrabs = function(url) {
    return new Promise(function(resolve, reject) {
      var rawData = JSON.parse(fs.readFileSync(url, 'utf8'));
      var geoData = topojson.feature(rawData, rawData.objects.counties)
      var outData = { type: 'FeatureCollection', features: [] }
      for (var f = 0; f < geoData.features.length; f++) {
        if (geoData.features[f].geometry) {
          outData.features.push(geoData.features[f])
        }
      }
      resolve(outData);
    });
  }
}
if (cmdOptions['csv-source']) {
  promiseData = cmdOptions['csv-source']
  sourceGrabs = function(url) {
    return new Promise(function(resolve, reject) {
      var rawData = fs.readFileSync(url, 'utf8');
      var geoJson = csv2geojson.csv2geojson(rawData, function(err, data) {
        if (err) {
          reject(error);
          return;
        }
        else {
          var outData = { type: 'FeatureCollection', features: [] }
          for (var f = 0; f < data.features.length; f++) {
            if (data.features[f].geometry) {
              outData.features.push(data.features[f])
            }
          }
          resolve(outData);
        }
      });
    })
  }
}

Promise.all([sourceGrabs(promiseData)])
.then(function(results) {
  // define the default baselayers
  var land = JSON.parse(fs.readFileSync('data/usa/usa_land.topojson', 'utf8'));
  var states = JSON.parse(fs.readFileSync('data/usa/usa_states.topojson', 'utf8'));
  var lakes = JSON.parse(fs.readFileSync('data/usa/usa_lakes.topojson', 'utf8'));
  try {
    var hillshade = JSON.parse(fs.readFileSync('data/usa/usa_osm_hillshade.geojson', 'utf8'));  
  } catch(e) {
    console.error('no hillshade available here')
    console.error(e)
  }
  
  // define the user-provided layers
  var sites = results[0];
  
  // pull out just large cities inside the US
  console.error('getting just the biggest cities')
  var places = JSON.parse(fs.readFileSync('data/usa/usa_osm_place_label.geojson', 'utf8'));
  var landGeo = turf.buffer(topojson.feature(land, land.objects.usa).features[0],0,'miles');
  var bigPlaces = {"type":"FeatureCollection","features":[]};
  var placeNames = [];
  for (var i = 0; i < places.features.length; i++) {
    // a passel of conditions:
    if (
      places.features[i].properties.scalerank < 6 && 
      places.features[i].properties.type == 'city' &&
      places.features[i].properties.name !== 'Syracuse' &&
      places.features[i].properties.name !== 'Columbia' &&
      places.features[i].properties.name !== 'Wenatchee' &&
      places.features[i].properties.name !== 'San Bernardino' &&
      turf.inside(places.features[i], landGeo) && 
      placeNames.indexOf(places.features[i].properties.name) == -1
    ) {
      bigPlaces.features.push(places.features[i]);
      placeNames.push(places.features[i].properties.name);
    }
  }
  //////////////////////////////////////////////////////////////////////////////////////////////
  // start the jsdom party, creating an evironment d3 can work in
  //////////////////////////////////////////////////////////////////////////////////////////////

  console.error('configuring the document for writing')
  jsdom.env({
    file: 'templates/base.html',
    features: {
      QuerySelector: true // you need query selector for D3 to work
    },
    done: function(errors, window) {
      if (errors) {
        throw new Error(errors);
      }
      window.d3 = d3.select(window.document.body); //get d3 into the dom
      var svg = window.d3.select('svg')
      
      svg.attr('class', 'container') //make a container div to ease the saving process
        
      //////////////////////////////////////////////////////////////////////////////////////////////
      // adaptive projection: if POI area covers more than 
      // 1M sqm, use Albers US, otherwise use Mercator
      //////////////////////////////////////////////////////////////////////////////////////////////

      var projection;
      if (!sites || (turf.area(turf.bboxPolygon(turf.bbox(sites))) > 2580000000000)) {
        projection = d3.geoAlbersUsa()
          .scale(width * 1.25)
          .translate([width / 2, height / 2]);
          
        var path = d3.geoPath()
          .projection(projection);
          
        console.error('using Albers USA projection')
          
      } else {
        function calculateScaleCenter(features) {
          // Get the bounding box of the paths (in pixels!) and calculate a
          // scale factor based on the size of the bounding box and the map
          // size.
          var bbox_path = path.bounds(features),
              scale = 0.95 / Math.max(
                (bbox_path[1][0] - bbox_path[0][0]) / width,
                (bbox_path[1][1] - bbox_path[0][1]) / height
              );

          // Get the bounding box of the features (in map units!) and use it
          // to calculate the center of the features.
          var bbox_feature = d3.geo.bounds(features),
              center = [
                (bbox_feature[1][0] + bbox_feature[0][0]) / 2,
                (bbox_feature[1][1] + bbox_feature[0][1]) / 2];

          return {
            'scale': scale,
            'center': center
          };
        }
        
        projection = d3.geo.mercator()
          .scale(1)
          
        var path = d3.geo.path()
          .projection(projection);
          
        scaleCenter = calculateScaleCenter(sites);
        
        projection
          .scale(scaleCenter.scale)
          .center(scaleCenter.center)
          .translate([width/2, height/2]);
        
        console.error('using Mercator projection')
      }
          
      
        //////////////////////////////////////////////////////////////////////////////////////////////
        // add and style Polygons
        //////////////////////////////////////////////////////////////////////////////////////////////
        // suggestion: use geojson-join to prep data before passing it in, e.g.:
        // geojson-join --format=csv hockey.csv --againstField=county_id --geojsonField=GEOID < usa_counties.geojson > hockey_counties.geojson
        
        var colors = {
          "jan": { "low": "#C1E0E0", "high": "#DC8E30" },
          "feb": { "low": "#e5f5f9", "high": "#2ca25f" },
          "mar": { "low": "#CDDE90", "high": "#5BA08A" },
          "apr": { "low": "#7EC3CA", "high": "#9F71AD" },
          "may": { "low": "#D483B2", "high": "#C1E0E0" },
          "jun": { "low": "#D45964", "high": "#5A9FAC" },
          "jul": { "low": "#C21F38", "high": "#25417A" },
          "aug": { "low": "#A3BC48", "high": "#F1C93A" },
          "sep": { "low": "#B8AF29", "high": "#602E88" },
          "oct": { "low": "#6D4609", "high": "#DC8E30" },
          "nov": { "low": "#E1D1A5", "high": "#5A9FAC" },
          "dec": { "low": "#CAE0F5", "high": "#40725B" },
        }
        // or use these: https://github.com/d3/d3-scale-chromatic
        
        console.error('drawing thematic layer')
        if (cmdOptions['theme-geometry'] === 'polygon') {
          console.error('drawing ' + sites.features.length + ' polygons')
          
          var mappable = d3.map();

          var valMax = d3.max(sites.features, function(d) { return d.properties.rate; }),
              valMin = d3.min(sites.features, function(d) { return d.properties.rate; })
          console.log("Mapping data between " + valMin + " and " + valMax)
          
          var color = d3.scaleLinear()
            .domain([valMin,valMax])
            .range([colors[colorMonth].low,colors[colorMonth].high])
          
          var cellScale = d3.scaleLinear()
            .domain([1,9])
            .range([valMin,valMax])
            
          var legend = svg.append("g")
            .attr("class", "legend")
            .attr("transform", "translate(1700,2000)");

          for (var i = 0; i < legendCells; i++) {
            var cellValue = cellScale(i+1)
            legend.append("rect")
              .attr("class", "legend-cell")
              .attr("x", 90 * i)
              .attr("y", 10)
              .attr("width", 70)
              .attr("height", 30)
              .attr("fill", function(d) {
                return color(cellScale(i+1))
              })
            legend.append("text")
              .attr("x", 90 * i)
              .attr("y", 60)
              .attr("class","legend-label")
              .text(Math.round(cellScale(i+1) * 100) + '%')
          }
          
          svg.append("g")
              .attr("class", "counties")
            .selectAll("path")
            .data(sites.features)
            .enter().append("path")
              .attr("fill", function(d) { 
                if (d.properties.rate) {
                  return color(d.properties.rate); 
                } else {
                  return colors[colorMonth].low;
                }
              })
              .attr("d", path)
        }
        
        //////////////////////////////////////////////////////////////////////////////////////////////
        // add and style the default baselayers
        //////////////////////////////////////////////////////////////////////////////////////////////

        console.error('rendering the map')
        // add lakes
        svg.append("path", ".graticule")
          .datum(topojson.feature(lakes, lakes.objects.us_lakes))
          .attr("class", "lakes")
          .attr("d", path)
          
        // add land
        svg.append("path", ".graticule")
          .datum(topojson.feature(land, land.objects.usa))
          .attr("class", "land")
          .attr("d", path)
        
        // add hillshade (if it's not the middle of kansas)
        try {
          svg.append("g")
            .attr("class", "hillshade")
          .selectAll("path")
            .data(hillshade.features)
          .enter().append("path")
            .attr("d", path)
            .attr("class", function(d) {
              return d.properties.class + "-" + d.properties.level
            })
            .style("fill-opacity", 0.1)
            .style("stroke", "none");
          } catch(e) {
            console.error('again, no hillshade');
            console.error(e)
          }
          
          // add lakes
          svg.append("path", ".graticule")
            .datum(topojson.feature(lakes, lakes.objects.us_lakes))
            .attr("class", "lakes")
            .attr("d", path)
          
          // add states
          svg.insert("path", ".graticule")
            .datum(topojson.mesh(states, states.objects.collection,
              function(a, b) {
                return a !== b;
              }))
            .attr("class", "state-boundary")
            .attr("d", path)
              
          
        //////////////////////////////////////////////////////////////////////////////////////////////
        // add and style POIs
        //////////////////////////////////////////////////////////////////////////////////////////////
        
        console.error('drawing markers')
        // if a maki icon has been defined, use that:
        if (cmdOptions['theme-geometry'] === 'point' && cmdOptions['maki-icon']) {
          icon = cmdOptions['maki-icon']  
          console.error('using maki icon: ' + icon)
          iconSvg = fs.readFileSync(maki.dirname + '/icons/' + icon + '-' + markerSize + '.svg', 'utf8')
          
          var parser = new DOMParser();
          var doc = parser.parseFromString(iconSvg, "application/xml");
          
          var markerDef = svg.select('defs')
            .append("g")
            .attr("id",icon)
            .attr("viewbox", "0 0 " + markerSize + " " + markerSize)
            .attr("height", markerSize)
            .attr("width", markerSize)
            .attr("style", "enable-background:new 0 0 " + markerSize + " " + markerSize + ";")
            
          var hayStack = doc.documentElement.getElementsByTagName('path')[0].attributes
          for (var h = 0; h < hayStack.length; h++) {
            if (hayStack[h].nodeValue) {
              markerDef.append('path')
                .attr("d", hayStack[h].nodeValue)
            }
          }
          
          svg.selectAll(".marker")
            .data(sites.features)
          .enter().append("use")
        		.attr("class", "marker")
        		.attr("xlink:href", "#" + icon)
            .attr("x", function(d) {
              if (projection(d.geometry.coordinates)) {
                return projection(d.geometry.coordinates)[0];
              } else { return null }
            })
            .attr("y", function(d) {
              if (projection(d.geometry.coordinates)) {
                return projection(d.geometry.coordinates)[1];
              } else { return null }
            })
        		.attr("width", markerSize)
        		.attr("height", markerSize);
        // otherwise use a simple circle:  
      } else if (cmdOptions['theme-geometry'] === 'point' && !cmdOptions['maki-icon']) {
          svg.selectAll(".marker")
            .data(sites.features)
            .enter()
            .append("circle")
            .attr("class", "marker")
            .attr("cx", function(d) {
              if (projection(d.geometry.coordinates)) {
                return projection(d.geometry.coordinates)[0];
              } else { return null }
            })
            .attr("cy", function(d) {
              if (projection(d.geometry.coordinates)) {
                return projection(d.geometry.coordinates)[1];
              } else { return null }
            })
            .attr("r", 3)
        } else {
          console.error('no markers to draw - moving on')
        }
        
      console.error('writing labels')
      // add state labels
      svg.selectAll(".state-label")
        .data(topojson.feature(states, states.objects.collection).features)
      .enter().append("text")
        .attr("class", function(d) { return "label state-label " + d.properties.STATE; })
        .attr("transform", function(d) { return "translate(" + path.centroid(d) + ")"; })
        .attr("dy", ".35em")
        .text(function(d) { 
          return (
            d.properties.STATE !== 'U.S. Virgin Islands' && 
            d.properties.STATE !== 'Puerto Rico' && 
            d.properties.STATE !== 'District of Columbia' 
          ) ? d.properties.STATE.toUpperCase() : ''
        });
        
      svg.selectAll("circle")
        .data(bigPlaces.features)
        .enter()
        .append("circle")
        .attr('class','city')
        .attr("cx", function(d) {
         return projection(d.geometry.coordinates)[0];
        })
        .attr("cy", function(d) {
         return projection(d.geometry.coordinates)[1];
        })
        .attr("r", 3)
        
      // add city labels
      svg.selectAll(".place-label")
        .data(bigPlaces.features)
      .enter().append("text")
        .attr("class", function(d) { return "label place-label " + d.id; })
        .attr("transform", function(d) { return "translate(" + projection(d.geometry.coordinates) + ")"; })
        .attr("dy", "0.35em")
        .attr("dx", function(d) {
          return (parseFloat(d.geometry.coordinates[0]) > -97.0 || d.properties.name === 'Oakland') ? "0.35em" : "-0.35em"
        })
        .attr("text-anchor", function(d) {
          return (parseFloat(d.geometry.coordinates[0]) > -97.0 || d.properties.name === 'Oakland') ? "start" : "end"
        })
        .text(function(d) { return d.properties.name; });

      //write out the children of the container div
      console.error('writing the SVG basemap composition')      
      fs.writeFileSync('projects/' + projTitle + '/map.svg', d3.select(window.document.body).html()) //using sync to keep the code simple

      //add the xlink namespace back in here
      function puts(error, stdout, stderr) { console.error(stdout); console.error(stderr) };

    }
  })
})
.catch(function(err) {
  console.error(err);
})