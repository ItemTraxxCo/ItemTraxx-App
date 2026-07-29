(function () {
  var saved = localStorage.getItem("itemtraxx-theme");
  var theme = saved === "light" || saved === "dark" ? saved : "light";
  document.documentElement.setAttribute("data-theme", theme);
})();
