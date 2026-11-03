# Measured source assets

`apollo17-dem.f32` is a 513 × 513 little-endian Float32 elevation grid, centred on
20.1908°N, 30.7717°E and covering 40 × 40 km. Rows increase south; columns increase east.
The output interval is 78.125 m. Source SLDEM2015 resolution is about 60 m; this is not
the 5 m LROC NAC DTM. Centre elevation was subtracted without vertical exaggeration.

Credit: NASA/GSFC/MIT; JAXA/SELENE (Kaguya).
[Product and scientific citation](https://pgda.gsfc.nasa.gov/products/54).
Source, projection, sampling and SHA-256 are recorded in `apollo17-dem.json`.
The runtime file SHA-256 is `bc021d0be5de657815b2c80ef9a3bea724c73e97880eeccfa3ed61e64aa5cc76`.

`hapke-parameters.json` records the actual site tile extracted from the official
USGS ISIS LROC WAC calibration cube, with source URL and source SHA-256. The renderer
uses the 566 nm values for a near-neutral visible-light approximation, including
HG, SHOE and measured roughness. Regional orbital parameters at grazing view angles
remain an extrapolation, not a local laboratory fit.

`lunar-rocks/` contains derivatives of three real Apollo 17 samples from
[NASA Astromaterials3D](https://ares.jsc.nasa.gov/astromaterials3d/).
Credit: NASA Astromaterials3D, Lunar Sample Laboratory Facility, Acquisition & Curation Office.
See its `LICENSE-NASA.txt` and `manifest.json` for source downloads, processing, LOD error
measurements, physical dimensions and photographic-texture limitations.
Instances are representative geometric archetypes; field positions and scaled sizes are procedural.

`earth_albedo.jpg` is the pre-existing Earth texture retained from the project.
