(function () {
  var isLandingRoute = window.location.pathname === "/" || window.location.pathname === "/landing-new";
  if (isLandingRoute) {
    document.documentElement.setAttribute("data-theme", "dark");
    return;
  }
  var saved = localStorage.getItem("itemtraxx-theme");
  var theme = saved === "light" || saved === "dark" ? saved : "light";
  document.documentElement.setAttribute("data-theme", theme);
})();
