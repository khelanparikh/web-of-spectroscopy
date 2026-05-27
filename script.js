(() => {
  const canvas    = document.getElementById('canvas');
  const entries   = Array.from(document.querySelectorAll('.entry'));
  const events    = Array.from(document.querySelectorAll('.event-line'));
  const eraLines  = Array.from(document.querySelectorAll('.era-line'));
  const rail      = document.getElementById('eraRail');
  const marker    = document.getElementById('eraMarker');
  const eraItems  = Array.from(document.querySelectorAll('.era-list li'));
  const readout   = document.getElementById('eraReadout');
  const svg       = document.getElementById('connections');
  const modal     = document.getElementById('entryModal');

  /* ---------- Year → vertical position (piecewise) ---------- */
  // Heavily compressed pre-1700 era — most of the canvas belongs to the
  // 1850-onward span, where entries cluster.
  const BREAKPOINTS = [
    { year: -1600, frac: 0.00 },
    { year:   200, frac: 0.04 },
    { year:  1500, frac: 0.07 },
    { year:  1700, frac: 0.10 },
    { year:  1800, frac: 0.16 },
    { year:  1850, frac: 0.24 },
    { year:  1900, frac: 0.40 },
    { year:  1950, frac: 0.65 },
    { year:  2030, frac: 1.00 },
  ];

  const yearToFrac = (y) => {
    if (y <= BREAKPOINTS[0].year) return 0;
    if (y >= BREAKPOINTS.at(-1).year) return 1;
    for (let i = 0; i < BREAKPOINTS.length - 1; i++) {
      const a = BREAKPOINTS[i], b = BREAKPOINTS[i + 1];
      if (y >= a.year && y <= b.year) {
        const t = (y - a.year) / (b.year - a.year);
        return a.frac + t * (b.frac - a.frac);
      }
    }
    return 1;
  };

  /* ---------- Column layout ---------- */
  const COLUMN_CENTER_PCT = {
    observation: 12.5,
    theory:      37.5,
    technique:   62.5,
    discoveries: 87.5,
  };
  const ENTRY_WIDTH_PX      = 220;
  const JITTER_PX           = 20;
  const MIN_GAP_PX          = 14;
  const TIMELINE_H_PX       = 6800;
  const TIMELINE_TOP_OFFSET = 120;

  const seededRand = (seed) => {
    let s = 0;
    for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) | 0;
    s ^= 0xdeadbeef;
    s = (s + 0x9e3779b9) | 0;
    return ((s >>> 0) % 10000) / 10000;
  };

  /* ---------- Build records ---------- */
  const items = entries.map((el, i) => {
    const year = parseFloat(el.dataset.year);
    const col  = el.dataset.col;
    const baseY = yearToFrac(year) * TIMELINE_H_PX;
    const jitter = (seededRand(el.id + col + i) - 0.5) * 2 * JITTER_PX;
    return { el, year, col, y: baseY, jitter };
  });

  const eventItems = events.map((el) => {
    const year = parseFloat(el.dataset.year);
    return { el, year };
  });

  /* ---------- Nobel medals ---------- */
  entries.forEach((el) => {
    const year = el.dataset.nobelYear;
    const url  = el.dataset.nobelUrl;
    if (!year || !url) return;
    const a = document.createElement('a');
    a.className = 'nobel-medal';
    a.href      = url;
    a.target    = '_blank';
    a.rel       = 'noopener';
    a.title     = `Nobel Prize ${year}`;
    a.setAttribute('aria-label', `Nobel Prize ${year}`);
    a.innerHTML = `<span class="nobel-year">${year}</span>`;
    // medal click shouldn't open the entry modal
    a.addEventListener('click', (e) => e.stopPropagation());
    el.appendChild(a);
  });

  /* ---------- Position pass ---------- */
  // Set baseline positions, measure, then resolve column collisions.
  entries.forEach((el) => {
    el.style.top   = '0px';
    el.style.left  = '0px';
    el.style.width = ENTRY_WIDTH_PX + 'px';
  });

  requestAnimationFrame(() => {
    canvas.style.minHeight = TIMELINE_H_PX + 'px';

    const byCol = { observation: [], theory: [], technique: [], discoveries: [] };
    items.forEach((it) => byCol[it.col].push(it));
    let maxBottom = 0;

    for (const col of Object.keys(byCol)) {
      const list = byCol[col].sort((a, b) => a.y - b.y);
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const h  = it.el.getBoundingClientRect().height;
        if (i > 0) {
          const prev = list[i - 1];
          const prevH = prev.el.getBoundingClientRect().height;
          const minTop = prev.y + prevH + MIN_GAP_PX;
          if (it.y < minTop) it.y = minTop;
        }
        maxBottom = Math.max(maxBottom, it.y + h);
      }
    }

    const finalHeight = Math.max(TIMELINE_H_PX, maxBottom + 200);
    canvas.style.minHeight = (finalHeight + TIMELINE_TOP_OFFSET + 100) + 'px';

    items.forEach((it) => {
      const left = `calc(${COLUMN_CENTER_PCT[it.col]}% - ${ENTRY_WIDTH_PX / 2}px + ${it.jitter}px)`;
      it.el.style.top  = (it.y + TIMELINE_TOP_OFFSET) + 'px';
      it.el.style.left = left;
    });

    eventItems.forEach((ev) => {
      ev.el.style.top = (yearToFrac(ev.year) * finalHeight + TIMELINE_TOP_OFFSET) + 'px';
    });

    eraLines.forEach((line) => {
      const y = parseFloat(line.dataset.year);
      line.style.top = (yearToFrac(y) * finalHeight + TIMELINE_TOP_OFFSET) + 'px';
    });

    initIntersection();
    drawConnections();
    layoutRail();
  });

  /* ---------- Reveal-on-scroll ---------- */
  const initIntersection = () => {
    const io = new IntersectionObserver(
      (records) => {
        records.forEach((r) => {
          if (r.isIntersecting) r.target.classList.add('in-view');
        });
      },
      { threshold: 0.12 }
    );
    entries.forEach((el) => io.observe(el));
  };

  /* ---------- SVG connections (discoveries → sources) ---------- */
  const drawConnections = () => {
    svg.innerHTML = '';
    const ns = 'http://www.w3.org/2000/svg';
    const w  = canvas.scrollWidth;
    const h  = canvas.scrollHeight;
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

    document.querySelectorAll('.entry.discovery').forEach((disc) => {
      const targets = (disc.dataset.connectsTo || '').split(/\s+/).filter(Boolean);
      if (!targets.length) return;
      // start point: left-middle of the discovery card
      const dx = disc.offsetLeft + 4;
      const dy = disc.offsetTop + disc.offsetHeight / 2;
      targets.forEach((id) => {
        const t = document.getElementById(id);
        if (!t) return;
        // end point: right-middle of the target card
        const tx = t.offsetLeft + t.offsetWidth - 4;
        const ty = t.offsetTop + t.offsetHeight / 2;

        // gentle S-curve with horizontal tangents at both ends
        const span = Math.max(60, Math.abs(dx - tx) * 0.42);
        const cp1x = dx - span;
        const cp1y = dy;
        const cp2x = tx + span;
        const cp2y = ty;

        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d',
          `M ${dx} ${dy} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tx} ${ty}`);
        path.dataset.from = disc.id;
        path.dataset.to   = id;
        svg.appendChild(path);
      });
    });
  };

  // Highlight connections on entry hover
  const highlightFor = (id) => {
    svg.querySelectorAll('path').forEach((p) => {
      if (p.dataset.from === id || p.dataset.to === id) {
        p.classList.add('highlight');
      } else {
        p.classList.remove('highlight');
      }
    });
  };
  const clearHighlight = () => {
    svg.querySelectorAll('path.highlight').forEach((p) => p.classList.remove('highlight'));
  };
  entries.forEach((el) => {
    el.addEventListener('mouseenter', () => highlightFor(el.id));
    el.addEventListener('mouseleave', clearHighlight);
    el.addEventListener('focus',      () => highlightFor(el.id));
    el.addEventListener('blur',       clearHighlight);
  });

  // Re-draw connections + rail layout on resize
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      drawConnections();
      layoutRail();
    }, 80);
  });

  /* ---------- Modal: open / close / cross-links ---------- */
  let lastFocused = null;

  const openEntry = (entry) => {
    if (!entry) return;
    const detail = entry.querySelector('.entry-detail');
    const title  = entry.querySelector('.entry-title')?.innerHTML || '';
    const who    = entry.querySelector('.who')?.innerHTML || '';
    const year   = detail?.querySelector('.entry-year-display')?.innerHTML || '';
    const bodyHTML = detail?.querySelector('.entry-body')?.innerHTML || '';
    const seeHTML  = detail?.querySelector('.see-also')?.outerHTML || '';

    const img = entry.querySelector('.entry-image');
    const imgHTML = img
      ? `<img class="entry-modal-image" src="${img.getAttribute('src')}" alt="${img.getAttribute('alt') || ''}">`
      : '';

    modal.querySelector('#modalTitle').innerHTML = title;
    modal.querySelector('#modalWho').innerHTML   = who;
    modal.querySelector('#modalYear').innerHTML  = year;
    modal.querySelector('#modalBody').innerHTML  = imgHTML + bodyHTML + seeHTML;

    const nobel = modal.querySelector('#modalNobel');
    if (entry.dataset.nobelYear && entry.dataset.nobelUrl) {
      nobel.href        = entry.dataset.nobelUrl;
      nobel.textContent = `Nobel Prize ${entry.dataset.nobelYear}  →`;
      nobel.hidden      = false;
    } else {
      nobel.hidden = true;
    }

    lastFocused = document.activeElement;
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    modal.querySelector('.entry-modal-close').focus();
  };

  const closeModal = () => {
    modal.hidden = true;
    document.body.style.overflow = '';
    if (lastFocused && typeof lastFocused.focus === 'function') {
      lastFocused.focus();
    }
  };

  // Click-to-open on each entry
  entries.forEach((el) => {
    el.addEventListener('click', (e) => {
      // ignore clicks on links inside the card (medals etc.)
      if (e.target.closest('a')) return;
      openEntry(el);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openEntry(el);
      }
    });
  });

  // Close on backdrop / close-button click
  modal.addEventListener('click', (e) => {
    if (e.target.matches('[data-close]')) closeModal();
  });

  // Cross-links inside the modal body navigate to another entry
  modal.addEventListener('click', (e) => {
    const link = e.target.closest('a.see-link');
    if (!link) return;
    e.preventDefault();
    const id = link.getAttribute('href').replace('#', '');
    const target = document.getElementById(id);
    if (!target) return;
    closeModal();
    // small pause for close animation, then scroll + open
    setTimeout(() => {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => openEntry(target), 350);
    }, 80);
  });

  // ESC closes
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  /* ---------- Era rail ---------- */
  const yearToEra = (y) => {
    for (const li of eraItems) {
      const from = parseFloat(li.dataset.from);
      const to   = parseFloat(li.dataset.to);
      if (y >= from && y < to) return li;
    }
    return eraItems.at(-1);
  };

  // Place the era labels on the rail proportional to where their start year
  // sits on the canvas's piecewise scale — with a minimum gap so the bunched
  // early labels don't overlap. Result: Ancient/Medieval/Renaissance/
  // Enlightenment cluster near the top; Modern and Contemporary stretch
  // across the bottom of the rail.
  const LABEL_MIN_GAP = 14;
  const layoutRail = () => {
    const tH = trackHeight();
    let lastTop = -Infinity;
    eraItems.forEach((li) => {
      const from = parseFloat(li.dataset.from);
      let top = yearToFrac(Math.max(from, BREAKPOINTS[0].year)) * tH;
      if (top < lastTop + LABEL_MIN_GAP) top = lastTop + LABEL_MIN_GAP;
      li.style.top = top + 'px';
      li.dataset.layoutTop = top;
      lastTop = top;
    });
  };

  // Marker top = position interpolated between the active era label and the
  // next era label, based on where the year sits in that era's range.
  const yearToRailPos = (y) => {
    for (let i = 0; i < eraItems.length; i++) {
      const from = parseFloat(eraItems[i].dataset.from);
      const to   = parseFloat(eraItems[i].dataset.to);
      if (y >= from && y < to) {
        const top = parseFloat(eraItems[i].dataset.layoutTop || 0);
        const nextTop = (i + 1 < eraItems.length)
          ? parseFloat(eraItems[i + 1].dataset.layoutTop || 0)
          : trackHeight();
        const t = (y - from) / (to - from);
        return top + t * (nextTop - top);
      }
    }
    return 0;
  };

  const formatYear = (y) => {
    if (y < 0)   return `${Math.abs(Math.round(y))} BCE`;
    if (y < 100) return `${Math.round(y)} CE`;
    return `${Math.round(y)}`;
  };

  const trackHeight = () => {
    const track = document.querySelector('.era-track');
    return track ? track.getBoundingClientRect().height : 360;
  };

  const updateRail = () => {
    if (!items.length) return;
    const midY = window.innerHeight / 2;
    let best = null, bestDist = Infinity;
    items.forEach((it) => {
      const rect = it.el.getBoundingClientRect();
      const c = rect.top + rect.height / 2;
      const d = Math.abs(c - midY);
      if (d < bestDist) { bestDist = d; best = it; }
    });

    const canvasRect = canvas.getBoundingClientRect();
    const inCanvas   = canvasRect.top < window.innerHeight * 0.5
                     && canvasRect.bottom > 0;

    if (best && inCanvas) {
      rail.classList.add('visible');
      const era = yearToEra(best.year);
      eraItems.forEach((li) => li.classList.toggle('active', li === era));
      marker.style.top = yearToRailPos(best.year) + 'px';
      readout.textContent = formatYear(best.year);
    } else {
      rail.classList.remove('visible');
    }
  };

  let ticking = false;
  const onScroll = () => {
    if (!ticking) {
      requestAnimationFrame(() => { updateRail(); ticking = false; });
      ticking = true;
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  setTimeout(updateRail, 100);
})();
