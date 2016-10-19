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
var commandLineArgs = require('command-line-args')
var path = require('path')
var maki = require('maki')
var csv = require('fast-csv')
var through2 = require('through2')

var optionDefinitions = [
  { name: 'title', alias: 't', type: String },
  { name: 'output-type', alias: 'o', type: String, defaultValue: 'svg'},
  { name: 'csv-source', alias: 'c', type: String },
  { name: 'geojson-source', alias: 'g', type: String },
  { name: 'maki-icon', alias: 'm', type: String }
]
var cmdOptions = commandLineArgs(optionDefinitions)
var icon, iconSvg

var projTitle = cmdOptions.title
if (cmdOptions['maki-icon']) {
  icon = cmdOptions['maki-icon']  
  console.log('using maki icon: ' + icon)
  console.log(maki.dirname)
  iconSvg = fs.readFileSync(maki.dirname + '/icons/' + icon + '-15.svg', 'utf8')
  console.log(iconSvg)
}
    
if (!fs.existsSync('./projects/' + projTitle)){
  fs.mkdirSync('./projects/' + projTitle);
}

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

console.log('pulling in the data from the hinterlands - "HERE, DATA DATA DATA!"')
Promise.all([
  // specify urls for any data layers, using the requestP() function
  // specify paths for any local data layers, using getCsv() if not already geojson
  // getCsv(cmdOptions['csv-source'])
])
.then(function(results) {
  // define the default baselayers
  var land = JSON.parse(fs.readFileSync('data/usa/usa_land.topojson', 'utf8'));
  var states = JSON.parse(fs.readFileSync('data/usa/usa_states.topojson', 'utf8'));
  var lakes = JSON.parse(fs.readFileSync('data/usa/usa_lakes.topojson', 'utf8'));
  try {
    var hillshade = JSON.parse(fs.readFileSync('data/usa/usa_osm_hillshade.geojson', 'utf8'));  
  } catch(e) {
    console.log('no hillshade available here')
    console.log(e)
  }
  
  // define the user-provided layers
  var sites = results[0];
  
  // pull out just large cities inside the US
  console.log('getting just the biggest cities')
  var places = JSON.parse(fs.readFileSync('data/usa/usa_osm_place_label.geojson', 'utf8'));
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
  
  // start the jsdom party
  console.log('configuring the document for writing')
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
          
        console.log('using Albers USA projection')
          
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
        
        console.log('using Mercator projection')
      }*/

      console.log('rendering the map')
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
          
      // add states
      svg.insert("path", ".graticule")
        .datum(topojson.mesh(states, states.objects.collection,
          function(a, b) {
            return a !== b;
          }))
        .attr("class", "state-boundary")
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
          console.log('again, no hillshade');
          console.log(e)
        }
        
      console.log('writing labels')
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
      console.log('writing the SVG basemap composition')      
      fs.writeFileSync('projects/' + projTitle + '/map.svg', d3.select(window.document.body).html()) //using sync to keep the code simple

      //add the xlink namespace back in here
      function puts(error, stdout, stderr) { console.log(stdout); console.log(stderr) };

      // add markers in a stream
      /*console.log('streaming markers onto the basemap')
      csv(cmdOptions['csv-source']).pipe(through2.obj(function (row, _, callback) {
        let el = `<circle x=${row.x} y=${row.y} />`
        callback(null, el)
      })).pipe(fs.createWriteStream('./output.svg', 'utf8'))*/
      
      
      //write the pdf via svg
      /*var pdfOptions = {
        "html" : 'projects/' + projTitle + "/map.svg",
        "paperSize" : {width: width/72 + 'in', height: (width * (2/3))/72+'in', border: '0px'},
        "deleteOnAction" : true
      };

      console.log('writing the PDF')
      pdf.convert(pdfOptions, function(err, result) {
        if (err) {
          console.log(err)
          console.log(result)
        } else {
          result.toFile('projects/' + projTitle + "/map.pdf", function() {});
        }
      });*/
    }
  });
})
.catch(function(err) {
  console.log(err);
});
