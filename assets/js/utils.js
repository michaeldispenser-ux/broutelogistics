/* Shared helpers: safe DOM building (no innerHTML), icons, dates, nav. */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /** Create an element. Children are appended as text nodes, so user input can never inject HTML. */
  function h(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }

  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) return child.forEach(function (c) { append(node, c); });
    node.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }

  /** Inline SVG icon referencing the <symbol> sprite on the page. */
  function icon(name) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  var fmt;
  try { fmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { fmt = null; }
  function formatDate(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return fmt ? fmt.format(d) : d.toLocaleString();
  }

  /** Fill [data-company="key"] elements from config; hide the ones with no value. */
  function fillCompany() {
    var c = (global.BROUTE_CONFIG && global.BROUTE_CONFIG.company) || {};
    var nodes = document.querySelectorAll('[data-company]');
    Array.prototype.forEach.call(nodes, function (el) {
      var key = el.getAttribute('data-company');
      var val = c[key];
      var wrap = el.closest('[data-company-wrap]') || el;
      if (!val) { wrap.hidden = true; return; }
      el.textContent = val;
      if (el.tagName === 'A') {
        if (key === 'email') el.setAttribute('href', 'mailto:' + val);
        if (key === 'phone') el.setAttribute('href', 'tel:' + String(val).replace(/[^\d+]/g, ''));
      }
    });
  }

  function initNav() {
    fillCompany();
    var btn = document.getElementById('menuBtn');
    var nav = document.getElementById('siteNav');
    var year = document.getElementById('year');
    if (year) year.textContent = new Date().getFullYear();
    if (!btn || !nav) return;
    function setOpen(open) {
      nav.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    }
    btn.addEventListener('click', function () { setOpen(!nav.classList.contains('open')); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
  }

  global.BrouteUtils = { h: h, icon: icon, formatDate: formatDate, initNav: initNav };
})(window);
