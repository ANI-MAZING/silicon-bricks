# Vendored geometry kernel

Upstream: https://github.com/IRobot1/clipper2-ts/tree/master/projects/clipper2-js

Source: npm `clipper2-js@1.2.4`, `fesm2020/clipper2-js.mjs` and published type declarations.

Runtime SHA-256: `f04de757e6d894ce2badf2be97b652e717750c76f94c1a773a7dcbef7b07fe90`

The runtime and type declarations are unmodified. The package wrapper intentionally omits the upstream Angular peer dependencies: the published README explicitly states the library does not depend on Angular, and the runtime has no imports. No Angular runtime is used by this React application. This avoids installing unrelated obsolete Angular peers without disabling npm audit or peer validation globally.

Copyright notices remain in the runtime. The Boost Software License 1.0 is included in LICENSE. Known upstream offset defects remain: this application uses tested strips and boolean operations for insets. Updating this copy requires comparing upstream changes, updating this hash and running the geometry regression suite.
