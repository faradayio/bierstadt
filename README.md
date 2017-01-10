# bierstadt
Automated thematic print cartography with node.js and d3.js

<img src="img/domes.jpg" alt="The Domes of the Yosemite" id="domes" title="The Domes of the Yosemite"/>

<small><a href="http://www.stjathenaeum.org/albert-bierstadt-the-domes-of-the-yosemite">The Domes of the Yosemite</a> - Albert Bierstadt, 1867<small>

## Install
`npm install bierstadt -g`

## Usage

`bierstadt -t my_project -o svg -c https://gist.githubusercontent.com/wboykinm/e45cc5ec086b63339c6df8c880be9171/raw/4d331ae99eb6f1244ea90ebe12ae40e5d4fb99c7/active_wells.csv`

## Arguments
* `-t, --title` (_REQUIRED_) Project name; will be used to create working directory and files (e.g. '/bierstadt/proj_title/')
* `-o, --output-type` One of `svg` or `pdf` - default is `svg` (PDF not actually supported yet - hold tight)
* `-h, --theme-geometry` (_OPTIONAL_) One of `point` or `polygon`- must be used in tandem with a `*-source` argument:
* `-c, --csv-source` (_OPTIONAL_) Path or URL to `.csv` file of points to be rendered on the output map (e.g. '/home/ubuntu/files/file.csv') - __must be [styled](templates/base.html) and [added](scripts/map.js)__
* `-g, --geojson-source` (_OPTIONAL_) Path or URL to `.geojson` file of features to be rendered on the output map (e.g. '/home/ubuntu/files/file.geojson') - __must be [styled](templates/base.html) and [added](scripts/map.js)__
* `-p, --topojson-source` (_OPTIONAL_) Path or URL to `.topojson` file of features to be rendered on the output map (e.g. '/home/ubuntu/files/file.topojson') - __must be [styled](templates/base.html) and [added](scripts/map.js)__
* `-m, --maki-icon` (_OPTIONAL_) - name of desired [maki icon](https://www.mapbox.com/maki-icons/) for rendering points provided in a `csv-source`
