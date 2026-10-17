(function () {
  var root = document.documentElement;
  var doc = document.getElementById('doc');
  var pages = Array.prototype.slice.call(document.querySelectorAll('.page'));
  var input = document.getElementById('pageInput');
  var DESIGN_W = pages.length ? parseFloat(pages[0].style.width) : 1753;
  var zoom = 1, fit = true;

  function fitZoom() {
    var avail = doc.clientWidth - 32;
    return Math.max(0.1, Math.min(1, avail / DESIGN_W));
  }
  function setZoom(z) {
    var cur = currentPage();
    zoom = Math.max(0.1, Math.min(2, z));
    root.style.setProperty('--z', zoom.toFixed(4));
    goTo(cur, true);
  }
  function currentPage() {
    var mid = window.innerHeight / 3, best = 1;
    for (var i = 0; i < pages.length; i++) {
      var r = pages[i].getBoundingClientRect();
      if (r.top <= mid) best = i + 1;
    }
    return best;
  }
  function goTo(n, instant) {
    n = Math.max(1, Math.min(pages.length, n | 0));
    pages[n - 1].scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'start' });
    input.value = n;
  }

  document.querySelector('.toolbar').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    var act = b.getAttribute('data-act');
    if (act === 'prev') goTo(currentPage() - 1);
    else if (act === 'next') goTo(currentPage() + 1);
    else if (act === 'zoom-in') { fit = false; setZoom(zoom * 1.25); }
    else if (act === 'zoom-out') { fit = false; setZoom(zoom / 1.25); }
    else if (act === 'fit') { fit = true; setZoom(fitZoom()); }
    else if (act === 'print') window.print();
  });
  input.addEventListener('change', function () { goTo(parseInt(input.value, 10) || 1); });
  window.addEventListener('scroll', function () { if (document.activeElement !== input) input.value = currentPage(); }, { passive: true });
  window.addEventListener('resize', function () { if (fit) setZoom(fitZoom()); });
  document.addEventListener('keydown', function (e) {
    if (e.target === input) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); goTo(currentPage() + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); goTo(currentPage() - 1); }
  });

  var start = parseInt((location.hash.match(/page-(\d+)/) || [])[1], 10);
  zoom = fitZoom();
  root.style.setProperty('--z', zoom.toFixed(4));
  if (start) goTo(start, true);
})();
