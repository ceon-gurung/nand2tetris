# Ohm recovery dependency

`ohm-js-17.5.0-fallible-d55d10a.tgz` contains the Ohm recovery implementation
from <https://github.com/DavidSouther/ohm> at source commit `d55d10ad9661993027416dbbf18311446404f108`. It retains the
upstream package version `17.5.0`; the filename and lockfile integrity identify
this unreleased build. Installing this repository requires no sibling checkout.

SHA-256: `8952522a72f72820ad9b044797f27d44479fc62b77ccb931ab04454a7a214468`.

The archive was produced with `npm pack` from `packages/ohm-js` after the source
checkout's build and declaration generation. The root `ohm-js` override keeps
all workspaces on the same runtime and declarations. Replace this artifact and
its lockfile entry together when changing the recovery implementation.
