// Standalone viewer for mermaid diagrams (opened from the chat panel).
const arg = (window.arguments && window.arguments[0]) || {};
const img = document.getElementById("img");
const stage = document.getElementById("stage");
const zoomEl = document.getElementById("zoom");
let scale = 1;
const apply = () => {
  if (!img.naturalWidth) return;
  img.style.width = img.naturalWidth * scale + "px";
  zoomEl.textContent = Math.round(scale * 100) + "%";
};
const fit = () => {
  if (!img.naturalWidth) return;
  scale = Math.min((stage.clientWidth - 40) / img.naturalWidth, (stage.clientHeight - 40) / img.naturalHeight, 4);
  apply();
};
const setScale = (s) => { scale = Math.max(0.1, Math.min(6, s)); apply(); };
img.addEventListener("load", fit);
if (arg.src && /^data:image\/svg\+xml/.test(arg.src)) img.src = arg.src;
document.getElementById("fit").onclick = fit;
document.getElementById("one").onclick = () => setScale(1);
document.getElementById("plus").onclick = () => setScale(scale * 1.25);
document.getElementById("minus").onclick = () => setScale(scale / 1.25);
document.getElementById("copy").onclick = async (e) => {
  await navigator.clipboard.writeText(arg.code || "");
  e.target.textContent = "已复制";
  setTimeout(() => (e.target.textContent = "复制源码"), 1500);
};
stage.addEventListener("wheel", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  setScale(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
}, { passive: false });
let drag = null;
stage.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, l: stage.scrollLeft, t: stage.scrollTop }; stage.classList.add("dragging"); stage.setPointerCapture(e.pointerId); });
stage.addEventListener("pointermove", (e) => { if (!drag) return; stage.scrollLeft = drag.l - (e.clientX - drag.x); stage.scrollTop = drag.t - (e.clientY - drag.y); });
stage.addEventListener("pointerup", () => { drag = null; stage.classList.remove("dragging"); });
window.addEventListener("keydown", (e) => { if (e.key === "Escape") window.close(); });
