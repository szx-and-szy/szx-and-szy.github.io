Three.js r160 Cascaded Shadow Maps addon, vendored from the official three@0.160.0 npm release. The three JavaScript source files are unmodified.

Upstream source: https://github.com/mrdoob/three.js/tree/r160/examples/jsm/csm

License: MIT, see LICENSE in this directory.

The application wrapper in ../../js/shadows.js chains existing material hooks, supports mixed map resolutions, corrects fade padding for a celestial far plane, and prevents ordinary non-CSM materials from counting the shared Sun more than once. No runtime CDN is required.
