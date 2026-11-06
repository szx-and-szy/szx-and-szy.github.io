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

## Fine terrain and spatial reflectance

The new NAC payloads below use lossless parts under `data/`, described by
`runtime_payload.parts` and `runtime_source_mask.parts`. Float grids and masks use
deterministic gzip; the lossless WebP stays uncompressed. `js/assets.js` fetches at
most six parts per payload at once and reconstructs the original byte stream.
Every payload keeps its original SHA256 and size; parting does not quantize or
resample the data. Logical `.f32`, `.u8` and `.webp` names describe those original
byte streams rather than separate files in this directory.

`apollo17-nac-near.{json,f32}` is a 4km,801² crop at5m spacing from NAC_DTM_APOLLO17v1.9.
`apollo17-nac-far.{json,f32}` is a 40km,1025² crop at39.0625m spacing. Its finite runtime
field uses SLDEM2015 only for the3.790696% genuine source gaps. `apollo17-nac-far-mask.u8`
retains255=NAC/0=SLDEM attribution and a verified SHA256; the companionPNG is a readable mask.
Runtime floats are absolute radial elevations in metres. Both levels share one site datum after blending.
Horizontal sample spacing must not be confused with the source's2.55m reported relative precision.
Credit: NASA/GSFC/Arizona State University; fallback NASA/GSFC/MIT;JAXA/SELENE(Kaguya).
Both axes use bilinear original-source sampling. The northmost regional output row is
clamped southward by0.203744m to the cached original row boundary; metadata records this exception.

`apollo17-nac-normal-detail.{json,webp}` adds residual slopes below the regional grid.
The opaque, lossless4096² image encodes negative east/south height gradients in RG;
128 is exactly zero. It derives from native5m NAC heights, smoothed with sigma11.23m,
minus the same39.0625m cubic regional field used by the runtime. The measured near4km
geometry is tapered out of this correction, and true source gaps are tapered to zero.
The source-mask sampling fraction differs slightly from the coarser elevation mask.
This is height-derived slope detail, not photo brightness interpreted as relief; it
cannot improve silhouettes or the reported source precision. Decode uses no color
conversion and no vertical flip; touch devices upload2048². Metadata binds it to the
SHA256 of the regional base field. Credit:NASA/GSFC/Arizona State University.

`apollo17-wac-reflectance.{json,f32}` is a 40km crop of the actual400m-class566nm
Hapke-normalized WAC I/F mosaic. Values are at standard i=g=60deg,e=0deg. The shader uses
only spatial ratios to the landing-site reference, replacing invented altitude-based brightening.
The129² output grid does not increase native spatial resolution. It is not a calibrated
single-scattering-albedo or RGB color measurement. All crop coordinates, offsets, SHA256,
reference values and source links are in its JSON. Credit:NASA/GSFC/Arizona State University.
