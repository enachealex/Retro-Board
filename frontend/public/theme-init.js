(function () {
  var isDark = localStorage.getItem("retro_board_theme") === "dark";
  if (isDark) {
    document.body.classList.add("dark-theme");
    document.body.style.backgroundColor = "#121212";
    document.body.style.color = "#e0e0e0";
  } else {
    document.body.style.backgroundColor = "#f4f6fa";
    document.body.style.color = "#1a1a2e";
  }
  try {
    var u = localStorage.getItem("retro_board_user");
    if (u && u.charAt(0) !== "{") {
      localStorage.removeItem("retro_board_user");
    }
  } catch (e) {}
  var root = document.getElementById("root");
  if (root) root.style.visibility = "hidden";
})();
