/*
 * Dot chat widget loader.
 *
 * Usage (paste before </body>):
 *   <script src="https://app.example.com/embed/widget.js" data-chatbot="cb_..." async></script>
 *
 * The loader only creates a launcher button and an iframe pointing at the
 * hosting app. All chat logic runs inside the iframe; nothing sensitive lives
 * in this file. The embed key is a public identifier, and access is enforced
 * server-side by the chatbot's allowed-domain list and status.
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;
  var chatbotKey = script.getAttribute("data-chatbot");
  if (!chatbotKey || !/^[A-Za-z0-9_-]{8,64}$/.test(chatbotKey)) return;
  if (document.getElementById("dot-widget-root")) return;

  var origin;
  try {
    origin = new URL(script.src, window.location.href).origin;
  } catch {
    return;
  }

  var position = script.getAttribute("data-position") === "bottom-left" ? "left" : "right";
  var color = script.getAttribute("data-color") || "#111111";
  var label = script.getAttribute("data-label") || "Chat with us";

  var root = document.createElement("div");
  root.id = "dot-widget-root";
  root.style.cssText = "position:fixed;bottom:16px;" + position + ":16px;z-index:2147483000;font-family:system-ui,sans-serif;";

  var frameWrap = document.createElement("div");
  frameWrap.style.cssText =
    "display:none;width:380px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 100px);margin-bottom:12px;border-radius:16px;overflow:hidden;box-shadow:0 12px 32px rgba(17,17,17,.18);background:#fff;";

  var frame = document.createElement("iframe");
  frame.title = "Chat";
  frame.src = origin + "/embed/" + encodeURIComponent(chatbotKey);
  frame.setAttribute("allow", "clipboard-write");
  frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  frame.style.cssText = "border:0;width:100%;height:100%;display:block;";
  frameWrap.appendChild(frame);

  var button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-expanded", "false");
  button.setAttribute("aria-label", label);
  button.style.cssText =
    "display:flex;align-items:center;gap:8px;height:44px;padding:0 16px;border:0;border-radius:9999px;color:#fff;font-size:14px;font-weight:500;cursor:pointer;box-shadow:0 8px 24px rgba(17,17,17,.2);margin-" +
    (position === "right" ? "left" : "right") +
    ":auto;background:" +
    color +
    ";";
  button.innerHTML =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span></span>';
  button.lastChild.textContent = label;

  var open = false;
  function setOpen(next) {
    open = next;
    frameWrap.style.display = open ? "block" : "none";
    button.setAttribute("aria-expanded", String(open));
    button.lastChild.textContent = open ? "Close" : label;
  }
  button.addEventListener("click", function () {
    setOpen(!open);
  });

  window.addEventListener("message", function (event) {
    if (event.origin !== origin) return;
    if (event.data && event.data.type === "dot:widget:close") setOpen(false);
  });

  root.appendChild(frameWrap);
  root.appendChild(button);
  document.body.appendChild(root);
})();
