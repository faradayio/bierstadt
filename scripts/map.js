// build a PDF and SVG of a Faraday customer map
// usage node map.js

var fs = require('fs');
var d3 = require('d3');
var jsdom = require('jsdom');
var request = require('request');
var topojson = require('topojson');
var pdf = require('phantom-html2pdf');
var turf = require('turf');
var csv2geojson = require('csv2geojson');

var workDir = 'data/usa'

var width = 9600,
  height = 5000,
  markerSize = 30,
  scaleCenter;

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

function getCsv(url) {
  return new Promise(function(resolve, reject) {
    var rawData = fs.readFileSync(url, 'utf8');
    var geoJson = csv2geojson.csv2geojson(rawData, function(err, data) {
      if (err) {
        reject(error);
        return;
      }
      else {
        resolve(data);
      }
    });
  })
}

console.error('pulling in the data from the hinterlands - "HERE, DATA DATA DATA!"')
Promise.all([
  // specify urls for any data layers, using the requestP() function
  // specify paths for any local data layers, using getCsv() if not already geojson
  getCsv(workDir + '/sites.csv')
])
.then(function(results) {
  // define layers arriving from the promises or local files
  var land = JSON.parse(fs.readFileSync('data/usa/usa_land.topojson', 'utf8'));
  var states = JSON.parse(fs.readFileSync('data/usa/usa_states.topojson', 'utf8'));
  var lakes = JSON.parse(fs.readFileSync('data/usa/usa_lakes.topojson', 'utf8'));
  try {
    var hillshade = JSON.parse(fs.readFileSync(workDir + '/usa_osm_hillshade.geojson', 'utf8'));  
  } catch(e) {
    console.error('no hillshade available here')
    console.log(e)
  }
  //var hexes = JSON.parse(fs.readFileSync(workDir + 'data/usa/usa_faraday_hexes.geojson', 'utf8'));
  var sites = results[0];
  
  // pull out just large cities inside the US
  console.error('getting just the biggest cities')
  var places = JSON.parse(fs.readFileSync(workDir + '/usa_osm_place_label.geojson', 'utf8'));
  var landGeo = turf.buffer(topojson.feature(land, land.objects.usa).features[0],0,'miles');
  var bigPlaces = {"type":"FeatureCollection","features":[]};
  var placeNames = [];
  for (var i = 0; i < places.features.length; i++) {
    // a passel of conditions:
    if (
      places.features[i].properties.scalerank < 7 && 
      places.features[i].properties.type == 'city' &&
      places.features[i].properties.name !== 'Syracuse' &&
      places.features[i].properties.name !== 'Columbia' &&
      places.features[i].properties.name !== 'Wenatchee' &&
      turf.inside(places.features[i], landGeo) && 
      placeNames.indexOf(places.features[i].properties.name) == -1
    ) {
      bigPlaces.features.push(places.features[i]);
      placeNames.push(places.features[i].properties.name);
    }
  }
  
  // deduplicate the tile-striped hexbins by ID
  /*console.error('deduplicating tile striping on the hexagons')
  var hexBins = {"type":"FeatureCollection","features":[]};
  var hexIds = [];
  for (var h = 0; h < hexes.features.length; h++) {
    if (hexIds.indexOf(hexes.features[h].properties.id) == -1) {
      hexBins.features.push(hexes.features[h]);
      hexIds.push(hexes.features[h].properties.id);
    }
  }*/
  
  // start the jsdom party
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
        .attr({
          width: width,
          height: height
        });
        
        //console.log(window.document.body.innerHTML)

      /*function calculateScaleCenter(features) {
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
      */
      // adaptive projection: if customer area covers more than 
      // 1M sqm, use Albers US, otherwise use Mercator
      var projection;
      //if (turf.area(turf.bboxPolygon(turf.bbox(sites))) > 2580000000000) {
        projection = d3.geoAlbersUsa()
          .scale(10000)
          .translate([width / 2, height / 2]);
          
        var path = d3.geoPath()
          .projection(projection);
          
        console.error('using Albers USA projection')
          
      /*} else {
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
      }*/

      console.error('rendering the map')
      // add land
      svg.append("path", ".graticule")
        .datum(topojson.feature(land, land.objects.usa))
        .attr("class", "land")
        .attr("d", path)
        .style("fill", "#191919");
      
      // add states
      svg.insert("path", ".graticule")
        .datum(topojson.mesh(states, states.objects.collection,
          function(a, b) {
            return a !== b;
          }))
        .attr("class", "state-boundary")
        .attr("d", path)
        
      // add lakes
      svg.append("path", ".graticule")
        .datum(topojson.feature(lakes, lakes.objects.us_lakes))
        .attr("class", "lakes")
        .attr("d", path)
        .style("fill", "#000");
      
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
          .style("fill-opacity", 0.05)
          .style("stroke", "none");
        } catch(e) {
          console.error('again, no hillshade');
          console.log(e)
        }
        
      // add hexes
      /*var hexScale = d3.scale.sqrt()
        .domain([0, d3.max(hexBins.features, function(d) { return d.properties.count; })])
        .range([0.05, 1]);
        
      svg.append("g")
        .attr("class", "hex")
      .selectAll("path")
        .data(hexBins.features)
      .enter().append("path")
        .attr("d", path)
        .style("fill-opacity", function(d) {
          return hexScale(d.properties.count)
        })
        .style("stroke", "none");
        */
      // add sites
      svg.selectAll(".marker")
        .data(sites.features)
      .enter().append("use")
    		.attr("class", "marker")
    		.attr("xlink:href", "#drop")
        .attr("transform", function(d) { 
          var coords = projection(d.geometry.coordinates)
          var adjustedCoords = [
            coords[0] - (markerSize/2),
            coords[1] - (markerSize/2)
          ]; 
          return "translate(" + adjustedCoords + ")"; 
        })
    		.attr("width", markerSize)
    		.attr("height", markerSize);
        
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
        .attr("cx", function(d) {
         return projection(d.geometry.coordinates)[0];
        })
        .attr("cy", function(d) {
         return projection(d.geometry.coordinates)[1];
        })
        .attr("r", 3)
        .style("fill", "#fff");
        
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
      // thanks to http://bl.ocks.org/larskotthoff/11406992
      function arrangeLabels() {
        var move = 1;
        while (move > 0) {
          move = 0;
          svg.selectAll(".label")
            .each(function() {
              var that = this,
                a = this.getBoundingClientRect();
              svg.selectAll(".label")
                .each(function() {
                  if (this != that) {
                    var b = this.getBoundingClientRect();
                    if ((Math.abs(a.left - b.left) * 2 < (a.width + b.width)) &&
                      (Math.abs(a.top - b.top) * 2 < (a.height + b.height))) {
                      // overlap, move labels
                      var dx = (Math.max(0, a.right - b.left) +
                          Math.min(0, a.left - b.right)) * 0.01,
                        dy = (Math.max(0, a.bottom - b.top) +
                          Math.min(0, a.top - b.bottom)) * 0.02,
                        tt = d3.transform(d3.select(this).attr("transform")),
                        to = d3.transform(d3.select(that).attr("transform"));
                      move += Math.abs(dx) + Math.abs(dy);

                      to.translate = [to.translate[0] + dx, to.translate[1] + dy];
                      tt.translate = [tt.translate[0] - dx, tt.translate[1] - dy];
                      d3.select(this).attr("transform", "translate(" + tt.translate + ")");
                      d3.select(that).attr("transform", "translate(" + to.translate + ")");
                      a = this.getBoundingClientRect();
                    }
                  }
                });
            });
        }
      }
      console.log('de-colliding labels')
      arrangeLabels();

      //write out the children of the container div
      console.log('writing the SVG composition')      
      fs.writeFileSync(workDir + '/map.svg', d3.select(window.document.body).html()) //using sync to keep the code simple

      //add the xlink namespace back in here
      console.log('repairing the svg')
      function puts(error, stdout, stderr) { console.error(stdout); console.error(stderr) };

      //write the pdf via svg
      var pdfOptions = {
        "html" : workDir + "/map.svg",
        "paperSize" : {width: width/72 + 'in', height: (width * (2/3))/72+'in', border: '0px'},
        "deleteOnAction" : true
      };

      console.log('writing the PDF')
      pdf.convert(pdfOptions, function(err, result) {
        if (err) {
          console.log(err)
          console.log(result)
        } else {
          result.toFile(workDir + "/map.pdf", function() {});
        }
      });
    }
  });
})
.catch(function(err) {
  console.error(err);
});
