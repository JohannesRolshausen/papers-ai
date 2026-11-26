// Page entry. The game is the default, the engine inspector stays reachable under ?dev.

const params = new URLSearchParams(window.location.search)

if (params.has('dev')) {
  void import('./main')
} else if (params.has('gallery')) {
  void import('./dev/gallery').then((m) => m.mountGallery())
} else {
  void import('./ui/app').then((m) => m.startApp())
}
