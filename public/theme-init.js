(function () {
  var isLandingRoute = window.location.pathname === "/" || window.location.pathname === "/landing-new";
  document.documentElement.setAttribute("data-theme", isLandingRoute ? "light" : "dark");
})();
