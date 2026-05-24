let sidebar = document.querySelector(".sidebar");
let closeBtn = document.querySelector("#btn");
document.querySelectorAll("section:not(.default):not(.category)").forEach(s => {
  s.style.display = "none";
});

closeBtn.addEventListener("click", () => {
  sidebar.classList.toggle("open");
  menuBtnChange(); //calling the function(optional)
});

sidebar.querySelectorAll("a").forEach(a => {
  a.addEventListener("click", () => {
    //sidebar.classList.remove("open");
    menuBtnChange();
    let targetClass = a.getAttribute("data-sec");
    updateItemStat(a, sidebar);
    
    document.querySelectorAll(".home-section").forEach(s => {
      if (s.classList.contains(targetClass.substring(1))) { // Remove the dot from targetClass
        s.style.display = "block"; // Show the target section
      } else {
        s.style.display = "none"; // Hide other sections
      }
    });
  });
});

function updateItemStat(a, sidebar) {
  sidebar.querySelectorAll("a").forEach(el => {
    el.removeAttribute('data-target');
  });
  a.setAttribute('data-target', "true")
}



// following are the code to change sidebar button(optional)
function menuBtnChange() {
  if (sidebar.classList.contains("open")) {
    closeBtn.classList.replace("bx-menu", "bx-menu-alt-right"); //replacing the iocns class
  } else {
    closeBtn.classList.replace("bx-menu-alt-right", "bx-menu"); //replacing the iocns class
  }
}

// popup.js (append to your file, keep your code above "Loaded.")
const LAST_TAB_KEY = 'swpfl:lastTab';

sidebar.querySelectorAll("a").forEach(a => {
  a.addEventListener("click", () => {
    menuBtnChange();
    const targetClass = a.getAttribute("data-sec");
    updateItemStat(a, sidebar);
    document.querySelectorAll(".home-section").forEach(s => {
      s.style.display = s.classList.contains(targetClass.slice(1)) ? "block" : "none";
    });
    localStorage.setItem(LAST_TAB_KEY, targetClass);
  });
});

window.onload = () => {
  document.body.style.visibility = 'visible';
  const last = localStorage.getItem(LAST_TAB_KEY) || '.dash';
  const a = Array.from(sidebar.querySelectorAll('a')).find(x => x.getAttribute('data-sec') === last) || sidebar.querySelector('a[data-sec=".dash"]');
  a?.click();
  console.log("Loaded.");
};