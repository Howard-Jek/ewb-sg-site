
(function(){
  var MOBILE = document.documentElement.getAttribute('data-variant') === 'mobile';
  var FORM_ENDPOINT = window.EWB_FORM_ENDPOINT || "/api/forms";

  // Desktop dropdown menus
  document.querySelectorAll('li.wixui-dropdown-menu__item').forEach(function(li){
    var list = li.querySelector(':scope > ul[aria-hidden]');
    if (!list) return;
    li.classList.add('static-dd'); list.classList.add('static-dd-list'); list.removeAttribute('aria-hidden'); list.style.display='';
    list.querySelectorAll('a').forEach(function(a){a.removeAttribute('tabindex');});
    var btn = li.querySelector(':scope > [aria-haspopup]');
    if (btn) btn.addEventListener('click', function(e){ e.preventDefault(); li.classList.toggle('open'); btn.setAttribute('aria-expanded', li.classList.contains('open')); });
  });

  // Mobile hamburger menu + expandable sub-menus
  var toggle = document.getElementById('MENU_AS_CONTAINER_TOGGLE');
  var menu = document.getElementById('MENU_AS_CONTAINER');
  if (toggle && menu) {
    var open = function(v){ menu.classList.toggle('static-open', v); menu.removeAttribute('data-undisplayed'); toggle.setAttribute('aria-expanded', v); document.body.style.overflow = v ? 'hidden' : ''; };
    toggle.addEventListener('click', function(){ open(!menu.classList.contains('static-open')); });
    menu.addEventListener('click', function(e){ if (e.target.id === 'overlay-MENU_AS_CONTAINER') open(false); });
    menu.querySelectorAll('a').forEach(function(a){ a.addEventListener('click', function(){ open(false); }); });
    menu.querySelectorAll('button[aria-haspopup]').forEach(function(b){
      var sub = b.closest('li').querySelector('ul');
      if (sub) sub.style.display = 'none';
      b.addEventListener('click', function(e){ e.preventDefault(); var ex = b.getAttribute('aria-expanded') === 'true'; b.setAttribute('aria-expanded', !ex); if (sub) { sub.style.display = ex ? 'none' : 'block'; sub.style.opacity = ex ? '' : '1'; sub.style.visibility = ex ? '' : 'visible'; } });
    });
  }

  // Slideshows: all slides were captured; cycle with the original arrows + autoplay
  document.querySelectorAll('[data-static-slideshow]').forEach(function(ss){
    var slides = ss.querySelectorAll('[data-static-slide]');
    if (slides.length < 2) return;
    var i = 0;
    var show = function(n){ i = (n + slides.length) % slides.length; slides.forEach(function(s, k){ s.classList.toggle('static-slide-hidden', k !== i); }); };
    ss.querySelectorAll('[aria-label=Previous], [aria-label="Previous"]').forEach(function(b){ b.addEventListener('click', function(e){ e.preventDefault(); show(i - 1); }); });
    ss.querySelectorAll('[aria-label=Next], [aria-label="Next"]').forEach(function(b){ b.addEventListener('click', function(e){ e.preventDefault(); show(i + 1); }); });
    var t = setInterval(function(){ show(i + 1); }, 6000);
    ss.addEventListener('mouseenter', function(){ clearInterval(t); });
    show(0);
  });

  // Gallery sliders: arrows scroll the strip
  document.querySelectorAll('.wixui-gallery').forEach(function(g){
    var strip = g.querySelector('[data-static-gallery-strip]');
    if (!strip) return;
    var step = function(d){ strip.scrollBy({ left: d * strip.clientWidth * 0.9, behavior: 'smooth' }); };
    g.querySelectorAll('[data-static-gallery-prev]').forEach(function(b){ b.addEventListener('click', function(e){ e.preventDefault(); step(-1); }); });
    g.querySelectorAll('[data-static-gallery-next]').forEach(function(b){ b.addEventListener('click', function(e){ e.preventDefault(); step(1); }); });
  });

  // Forms: Wix Forms submitted to Wix's backend. They now post to /api/forms (a Vercel
  // function that stores submissions in Supabase); window.EWB_FORM_ENDPOINT overrides it.
  // Each form carries data-form-kind; the original success message, if the form had one,
  // is marked data-static-success and revealed on success.
  var FAILED = 'Sorry, something went wrong. Please email secretary@ewb.sg instead.';
  document.querySelectorAll('form').forEach(function(f){
    var success = f.querySelector('[data-static-success]');
    var buttons = f.querySelectorAll('button');
    var msg = f.appendChild(Object.assign(document.createElement('div'), { className: 'static-form-msg' }));
    msg.setAttribute('role', 'status');
    var busy = function(v){ f.setAttribute('aria-busy', v); buttons.forEach(function(b){ b.disabled = v; }); };
    f.addEventListener('submit', function(e){
      e.preventDefault();
      if (f.getAttribute('aria-busy') === 'true') return;
      var data = { _kind: f.getAttribute('data-form-kind') || '', _page: location.pathname };
      f.querySelectorAll('input,select,textarea').forEach(function(x){ if (!x.name) return; x.removeAttribute('aria-invalid'); if (x.type === 'checkbox') data[x.name] = x.checked; else if (x.value !== '') data[x.name] = x.value; });
      msg.textContent = '';
      if (success) success.style.removeProperty('visibility');
      busy(true);
      fetch(FORM_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(data) })
        .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(body){ return { ok: r.ok, body: body }; }); })
        .then(function(res){
          if (res.ok) {
            f.reset();
            if (success) success.style.setProperty('visibility', 'visible', 'important');
            else msg.textContent = f.getAttribute('data-success') || 'Thank you! Your submission has been received.';
            return;
          }
          var fields = res.body.fields || {};
          var problems = Object.keys(fields).map(function(k){
            var input = f.querySelector('[name="' + k + '"]');
            if (input) input.setAttribute('aria-invalid', 'true');
            return fields[k];
          });
          msg.textContent = problems.length ? problems.join(' ') : (res.body.error || FAILED);
        })
        .catch(function(){ msg.textContent = FAILED; })
        .then(function(){ busy(false); });
    });
  });

  // Lightboxes (e.g. Membership Sign Up)
  var openLb = null;
  function closeLb(){ if (!openLb) return; openLb.style.display = 'none'; document.documentElement.style.overflow = ''; openLb = null; }
  document.querySelectorAll('[data-static-lightbox-open]').forEach(function(t){
    t.style.cursor = 'pointer';
    t.addEventListener('click', function(e){
      e.preventDefault();
      var lb = document.querySelector('[data-static-lightbox="' + t.getAttribute('data-static-lightbox-open') + '"]');
      if (!lb) return;
      closeLb(); lb.style.display = 'block'; document.documentElement.style.overflow = 'hidden'; openLb = lb;
      var f = lb.querySelector('input,select,textarea'); if (f) setTimeout(function(){ f.focus(); }, 50);
    });
  });
  document.querySelectorAll('[data-static-lightbox]').forEach(function(lb){
    lb.addEventListener('click', function(e){
      if (e.target.closest('[data-testid=popupCloseIconButtonRoot]')) return closeLb();
      var dlg = lb.querySelector('[role=dialog]'); var box = dlg && dlg.firstElementChild;
      if (e.target === dlg || (box && (e.target === box || (e.target.closest('[data-hook=bgLayers]') && e.target.closest('[data-hook=bgLayers]').parentElement === box.firstElementChild)))) closeLb();
    });
  });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeLb(); });

  // Gallery: click a photo to view it large
  var zoomItems = [].slice.call(document.querySelectorAll('[data-static-zoom]'));
  if (zoomItems.length) {
    var ov = document.createElement('div');
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true');
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.88);display:none;align-items:center;justify-content:center;flex-direction:column;gap:12px;cursor:zoom-out';
    ov.innerHTML = '<img alt="" style="max-width:92vw;max-height:82vh;object-fit:contain;box-shadow:0 8px 40px rgba(0,0,0,.5)"><div style="color:#fff;font:15px Avenir,Helvetica,Arial,sans-serif;text-align:center;max-width:90vw"></div>'
      + '<button aria-label="Previous" style="position:fixed;left:12px;top:50%;font-size:40px;color:#fff;background:none;border:0;cursor:pointer">&#8249;</button>'
      + '<button aria-label="Next" style="position:fixed;right:12px;top:50%;font-size:40px;color:#fff;background:none;border:0;cursor:pointer">&#8250;</button>'
      + '<button aria-label="Close" style="position:fixed;right:16px;top:12px;font-size:34px;color:#fff;background:none;border:0;cursor:pointer">&times;</button>';
    document.body.appendChild(ov);
    var zi = 0, zimg = ov.querySelector('img'), zcap = ov.querySelector('div');
    var zshow = function(n){ zi = (n + zoomItems.length) % zoomItems.length; zimg.src = zoomItems[zi].getAttribute('data-static-zoom'); zcap.textContent = zoomItems[zi].getAttribute('data-static-caption') || ''; };
    zoomItems.forEach(function(el, n){ el.style.cursor = 'zoom-in'; el.addEventListener('click', function(e){ e.preventDefault(); zshow(n); ov.style.display = 'flex'; document.documentElement.style.overflow = 'hidden'; }); });
    var zclose = function(){ ov.style.display = 'none'; document.documentElement.style.overflow = ''; };
    ov.addEventListener('click', function(e){ var b = e.target.closest('button'); if (b && b.getAttribute('aria-label') === 'Previous') return zshow(zi - 1); if (b && b.getAttribute('aria-label') === 'Next') return zshow(zi + 1); if (e.target !== zimg) zclose(); });
    document.addEventListener('keydown', function(e){ if (ov.style.display !== 'flex') return; if (e.key === 'Escape') zclose(); if (e.key === 'ArrowLeft') zshow(zi - 1); if (e.key === 'ArrowRight') zshow(zi + 1); });
  }

  // Blog post share / print buttons (Wix Blog app)
  var canon = (document.querySelector('link[rel=canonical]') || {}).href || location.href;
  var shares = { 'Share via Facebook': 'https://www.facebook.com/sharer/sharer.php?u=', 'Share via LinkedIn': 'https://www.linkedin.com/sharing/share-offsite/?url=', 'Share via X (Twitter)': 'https://twitter.com/intent/tweet?url=' };
  document.querySelectorAll('button[aria-label], [role=button][aria-label]').forEach(function(b){
    var l = b.getAttribute('aria-label');
    if (shares[l]) b.addEventListener('click', function(){ window.open(shares[l] + encodeURIComponent(canon), '_blank', 'noopener,width=640,height=560'); });
    else if (l === 'Share via link') b.addEventListener('click', function(){ if (navigator.clipboard) navigator.clipboard.writeText(canon); b.title = 'Link copied'; });
    else if (l === 'Print Post') b.addEventListener('click', function(){ window.print(); });
  });

  // FAQ accordions
  document.querySelectorAll('[data-static-acc]').forEach(function(h){
    var content = document.getElementById(h.getAttribute('aria-controls'));
    var panel = content && content.parentElement;
    if (!panel) return;
    h.addEventListener('click', function(e){
      e.preventDefault();
      var open = h.getAttribute('aria-expanded') !== 'true';
      h.setAttribute('aria-expanded', open); content.setAttribute('aria-hidden', !open);
      panel.style.display = open ? '' : 'none';
      requestAnimationFrame(function(){ panel.style.opacity = open ? '1' : '0'; });
    });
  });

  // Hover boxes: tap toggles the hover state (mirrors Wix's mobile behaviour)
  document.querySelectorAll('[aria-label="content changes on hover"]').forEach(function(box){
    box.addEventListener('click', function(e){ if (e.target.closest('a')) return; box.classList.toggle('static-hover'); });
  });

  // In-page anchors: account for the fixed header
  if (location.hash) { var el = document.getElementById(location.hash.slice(1)); if (el) setTimeout(function(){ el.scrollIntoView(); }, 50); }
})();
