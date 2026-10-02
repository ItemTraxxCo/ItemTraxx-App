<script setup>
import { onBeforeUnmount, onMounted } from "vue";
import checkoutReturnUiImage from "../assets/landing/checkout_return_ui.png";
import { getReleaseMetadata } from "../utils/releaseMetadata";
const itemtraxxLogo = import.meta.env.VITE_BRAND_LOGO_LIGHT_URL || "/brand/logo-light.png";

const { appVersion, appBranch, currentYear, releaseChannel, showBranchName } = getReleaseMetadata();
const landingObservers = [];

onMounted(() => {
    const root = document.querySelector(".itemtraxx-page");
    if (!root) return;

    (() => {
      const section = root.querySelector(".platform-section");
      if (!section) return;
      const fill = section.querySelector(".platform-progress-fill");
      const features = [...section.querySelectorAll(".platform-feature")];
      const labels = [...section.querySelectorAll("[data-slide-label]")];
      const motionOff = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let active = 0;
      let advanceTimer;
      let transitionTimer;
      const slideshow = section.querySelector(".platform-features");
      function restartProgress() {
        fill.classList.remove("is-animating");
        void fill.offsetWidth;
        fill.classList.add("is-animating");
      }
      function changeFeature(nextIndex) {
        window.clearTimeout(advanceTimer);
        window.clearTimeout(transitionTimer);
        fill.classList.remove("is-animating");
        if (nextIndex === active) {
          slideshow.classList.remove("is-transitioning");
          if (section.classList.contains("is-running")) restartProgress();
          return;
        }
        slideshow.classList.add("is-transitioning");
        transitionTimer = window.setTimeout(() => {
          features[active].hidden = true;
          active = nextIndex;
          features[active].hidden = false;
          labels.forEach((label, index) => {
            label.classList.toggle("is-active", index === active);
            label.setAttribute("aria-pressed", String(index === active));
          });
          slideshow.classList.remove("is-transitioning");
          if (section.classList.contains("is-running")) restartProgress();
        }, motionOff ? 0 : 320);
      }
      function advance() {
        if (!section.classList.contains("is-running")) return;
        changeFeature((active + 1) % features.length);
      }
      labels.forEach((label, index) => label.addEventListener("click", () => changeFeature(index)));
      fill.addEventListener("animationend", advance);
      if (!motionOff) {
        const observer = new IntersectionObserver(([entry]) => {
          const shouldRun = entry.isIntersecting;
          section.classList.toggle("is-running", shouldRun);
          if (shouldRun) restartProgress();
          else {
            window.clearTimeout(advanceTimer);
            slideshow.classList.remove("is-transitioning");
            fill.classList.remove("is-animating");
          }
        }, {threshold: 0.25});
        observer.observe(section);
        landingObservers.push(observer);
      }
    })();
  

    (() => {
      const section = root.querySelector(".interactive-section");
      if (!section) return;
      const buttons = [...section.querySelectorAll("[data-view]")];
      const copies = [...section.querySelectorAll("[data-copy]")];
      const art = [...section.querySelectorAll("[data-art]")];
      const cells = [...section.querySelectorAll(".feature-sheet tbody td")];
      const motionOff = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const liveValues = [
        ["Camera?", "Sony? camera", "that one", "camera 1??", "the other camera??", "photo thing"],
        ["Maya C?", "Maya?", "Jordan? p4", "Sam?", "who borrowed?", "no clue", "idk", "maybe Lisa"],
        ["Today?", "yesterday?", "9/20?", "early?", "Due Friday?", "10/2?", "which day?", "soon?"],
        ["out?", "returned?", "maybe in", "check??", "late?", "still out?", "???", "not sure"]
      ];
      const chaosValues = [
        ["??????", "which one?", "thing?", "maybe camera", "that one??", "idk"],
        ["no clue", "who has it?", "someone?", "Maya?", "idk", "????"],
        ["yesterday?", "today??", "early?", "when??", "last week?", "soon?"],
        ["maybe out?", "check??", "not sure", "?????", "returned?", "maybe in"]
      ];
      const unknown = new Set(["??????", "?????", "????", "???", "no clue", "idk", "who borrowed?", "who has it?", "which one?", "which day?", "that one", "that one??", "not sure"]);
      const kinds = ["item", "person", "time", "status"];
      let visible = false;
      let liveBatches = 0;
      let finalCount = 0;
      let finalOrder = null;
      let running = false;
      const typeSpeed = 280;

      function active() {
        return visible && section.dataset.state === "problem" && !motionOff;
      }
      function pause(ms) {
        return new Promise((resolve) => window.setTimeout(resolve, ms));
      }
      async function waitUntilActive() {
        while (section.isConnected && !active()) await pause(120);
      }
      async function restWhileActive(ms) {
        let left = ms;
        while (left > 0 && section.isConnected) {
          if (active()) left -= 100;
          await pause(100);
        }
      }
      function shuffle(values) {
        for (let i = values.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [values[i], values[j]] = [values[j], values[i]];
        }
        return values;
      }
      function chooseDifferent(options, previous) {
        const choices = options.filter((value) => value !== previous);
        return choices[Math.floor(Math.random() * choices.length)] || options[0];
      }
      function selectBatch(pool) {
        const count = 1 + Math.floor(Math.random() * 2);
        return shuffle([...pool]).slice(0, count);
      }
      async function typeCell(index, text) {
        const cell = cells[index];
        const col = index % 4;
        await waitUntilActive();
        cell.classList.add("typing");
        cell.textContent = "";
        for (const character of text) {
          await waitUntilActive();
          cell.textContent += character;
          await pause(typeSpeed);
        }
        await waitUntilActive();
        cell.classList.remove("typing", "blank", "kind-item", "kind-person", "kind-time", "kind-status", "kind-unknown");
        cell.classList.add(unknown.has(text) ? "kind-unknown" : `kind-${kinds[col]}`);
      }
      async function run() {
        if (running || motionOff) return;
        running = true;
        while (section.isConnected) {
          await waitUntilActive();
          const pool = cells.map((_, index) => index);
          let indices;
          let options;
          if (liveBatches < 12) {
            indices = selectBatch(pool);
            options = liveValues;
            liveBatches++;
          } else if (finalCount < cells.length) {
            if (!finalOrder) finalOrder = shuffle([...pool]);
            const count = Math.min(2 + Math.floor(Math.random() * 2), cells.length - finalCount);
            indices = finalOrder.slice(finalCount, finalCount + count);
            finalCount += indices.length;
            options = chaosValues;
          } else {
            indices = selectBatch(pool);
            options = chaosValues;
          }
          await Promise.all(indices.map((index) => {
            const cell = cells[index];
            const col = index % 4;
            return typeCell(index, chooseDifferent(options[col], cell.textContent));
          }));
          await restWhileActive(5000 + Math.random() * 2500);
        }
      }
      buttons.forEach((button) => button.addEventListener("click", () => {
        const view = button.dataset.view;
        section.dataset.state = view;
        section.querySelector(".interactive-visual").classList.toggle("solution-view", view === "solution");
        section.querySelector(".interactive-visual").classList.toggle("messy-view", view === "problem");
        buttons.forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
        copies.forEach((item) => { const active = item.dataset.copy === view; item.classList.toggle("is-active", active); item.setAttribute("aria-hidden", String(!active)); });
        art.forEach((item) => { const active = item.dataset.art === view; item.classList.toggle("is-active", active); item.setAttribute("aria-hidden", String(!active)); item.inert = !active; });
      }));
      const observer = new IntersectionObserver((entries) => {
        visible = entries.some((entry) => entry.isIntersecting);
        if (visible && !running) run();
      }, {threshold: 0.2});
      observer.observe(section);
      landingObservers.push(observer);

      const demo = {
        stage: section.querySelector(".solution-stage"),
        itemsPanel: section.querySelector(".items-demo"),
        borrowersPanel: section.querySelector(".borrowers-demo"),
        managementLists: section.querySelector(".management-lists"),
        borrowerId: section.querySelector("#demo-borrower-id"),
        barcode: section.querySelector("#demo-barcode"),
        initialHint: section.querySelector("#demo-initial-hint"),
        afterBorrower: section.querySelector("#demo-after-borrower"),
        queuedItem: section.querySelector("#demo-queued-item"),
        actions: section.querySelector("#demo-actions"),
        replay: section.querySelector("#demo-replay"),
        itemAction: section.querySelector("#demo-item-action"),
        success: section.querySelector("#demo-success"),
        complete: section.querySelector("#demo-complete"),
        announcement: section.querySelector("#demo-announcement")
      };
      demo.stage.addEventListener("click", (event) => {
        if (!(event.target instanceof Element)) return;
        const button = event.target.closest("button");
        if (!button || button.id === "demo-replay") return;
        event.preventDefault();
        event.stopPropagation();
      }, true);
      let demoRun = 0;
      const demoDelay = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
      const demoIsCurrent = (id) => demoRun === id && section.isConnected && section.dataset.state === "solution";
      function hideItemsDemo() {
        demo.stage.classList.remove("is-management-view");
        demo.managementLists.classList.remove("is-stacked");
        demo.itemsPanel.classList.remove("is-loaded");
        demo.itemsPanel.setAttribute("aria-hidden", "true");
        demo.borrowersPanel.classList.remove("is-loaded");
        demo.borrowersPanel.setAttribute("aria-hidden", "true");
        demo.managementLists.setAttribute("aria-hidden", "true");
        section.querySelector(".interactive-visual").classList.remove("has-items-demo");
        demo.itemsPanel.querySelectorAll("[data-item-row]").forEach((row) => row.style.removeProperty("transition-delay"));
        demo.borrowersPanel.querySelectorAll("[data-borrower-row]").forEach((row) => row.style.removeProperty("transition-delay"));
      }
      async function revealItemsDemo(id) {
        if (!demoIsCurrent(id)) return;
        demo.stage.classList.add("is-management-view");
        section.querySelector(".interactive-visual").classList.add("has-items-demo");
        demo.managementLists.setAttribute("aria-hidden", "false");
        demo.itemsPanel.setAttribute("aria-hidden", "false");
        demo.borrowersPanel.setAttribute("aria-hidden", "false");
        await demoDelay(motionOff ? 0 : 260);
        if (!demoIsCurrent(id)) return;
        demo.itemsPanel.classList.add("is-loaded");
        demo.announcement.textContent = "Item management opened. Inventory rows are loading.";
        await demoDelay(motionOff ? 0 : 1550);
        if (!demoIsCurrent(id)) return;
        await demoDelay(motionOff ? 0 : 500);
        if (!demoIsCurrent(id)) return;
        demo.managementLists.classList.add("is-stacked");
        demo.borrowersPanel.classList.add("is-loaded");
        demo.announcement.textContent = "Active borrower rows are loading.";
        await demoDelay(motionOff ? 30 : 1450);
        if (!demoIsCurrent(id)) return;
        await demoDelay(2000);
        if (!demoIsCurrent(id)) return;
        demo.replay.hidden = false;
        requestAnimationFrame(() => {
          if (demoIsCurrent(id)) demo.replay.classList.add("is-visible");
        });
      }
      function resetDemo() {
        hideItemsDemo();
        demo.borrowerId.value = "";
        demo.barcode.value = "";
        demo.initialHint.hidden = false;
        demo.afterBorrower.hidden = true;
        demo.queuedItem.hidden = true;
        demo.actions.hidden = true;
        demo.replay.hidden = true;
        demo.replay.classList.remove("is-visible");
        demo.itemAction.classList.remove("return");
        demo.itemAction.classList.add("checkout");
        demo.itemAction.textContent = "Checkout";
        demo.success.hidden = true;
        demo.success.classList.remove("is-visible");
        demo.complete.classList.remove("is-pressed");
        demo.announcement.textContent = "";
      }
      async function typeDemoValue(field, value, id) {
        for (const character of value) {
          if (!demoIsCurrent(id)) return false;
          field.value += character;
          await demoDelay(105);
        }
        return demoIsCurrent(id);
      }
      async function playDemo() {
        const id = ++demoRun;
        resetDemo();
        if (!await typeDemoValue(demo.borrowerId, "6931JN", id)) return;
        await demoDelay(350);
        if (!demoIsCurrent(id)) return;
        demo.initialHint.hidden = true;
        demo.afterBorrower.hidden = false;
        demo.announcement.textContent = "Borrower Jordan Lee loaded. Barcode entry is now available.";
        if (motionOff) {
          demo.barcode.value = "IT-2048";
          demo.queuedItem.hidden = false;
          demo.actions.hidden = false;
          demo.itemAction.classList.replace("checkout", "return");
          demo.itemAction.textContent = "Return";
          demo.success.hidden = false;
          demo.success.classList.add("is-visible");
          await revealItemsDemo(id);
          return;
        }
        await demoDelay(650);
        if (!demoIsCurrent(id)) return;
        if (!await typeDemoValue(demo.barcode, "IT-2048", id)) return;
        await demoDelay(350);
        if (!demoIsCurrent(id)) return;
        demo.queuedItem.hidden = false;
        demo.actions.hidden = false;
        demo.announcement.textContent = "Wireless microphone kit added to the item list.";
        await demoDelay(850);
        if (!demoIsCurrent(id)) return;
        demo.complete.classList.add("is-pressed");
        await demoDelay(450);
        if (!demoIsCurrent(id)) return;
        demo.complete.classList.remove("is-pressed");
        demo.success.hidden = false;
        demo.success.classList.add("is-visible");
        demo.announcement.textContent = "Checkout transaction complete.";
        await demoDelay(1050);
        if (!demoIsCurrent(id)) return;
        // Reset the form so the return reads as a second real transaction.
        resetDemo();
        await demoDelay(450);
        if (!demoIsCurrent(id)) return;
        if (!await typeDemoValue(demo.borrowerId, "6931JN", id)) return;
        await demoDelay(350);
        if (!demoIsCurrent(id)) return;
        demo.initialHint.hidden = true;
        demo.afterBorrower.hidden = false;
        demo.announcement.textContent = "Borrower Jordan Lee loaded. Barcode entry is now available.";
        await demoDelay(650);
        if (!demoIsCurrent(id)) return;
        if (!await typeDemoValue(demo.barcode, "IT-2048", id)) return;
        await demoDelay(350);
        if (!demoIsCurrent(id)) return;
        demo.queuedItem.hidden = false;
        demo.actions.hidden = false;
        demo.itemAction.classList.replace("checkout", "return");
        demo.itemAction.textContent = "Return";
        demo.announcement.textContent = "Wireless microphone kit added to the return list.";
        await demoDelay(850);
        if (!demoIsCurrent(id)) return;
        demo.complete.classList.add("is-pressed");
        await demoDelay(450);
        if (!demoIsCurrent(id)) return;
        demo.complete.classList.remove("is-pressed");
        demo.success.hidden = false;
        demo.success.classList.add("is-visible");
        demo.announcement.textContent = "Return transaction complete.";
        await demoDelay(motionOff ? 0 : 500);
        await revealItemsDemo(id);
      }
      buttons.forEach((button) => button.addEventListener("click", () => {
        if (button.dataset.view === "solution") playDemo();
        else { demoRun++; hideItemsDemo(); }
      }));
      section.querySelector("#demo-replay").addEventListener("click", playDemo);
    })();
  
});

onBeforeUnmount(() => {
  landingObservers.forEach((observer) => observer.disconnect());
});
</script>

<template>
  <div id="top" class="itemtraxx-page">
<header class="site-header wrap">
    <a class="brand" href="#top" aria-label="ItemTraxx home"><img :src="itemtraxxLogo" alt="ItemTraxx Co"></a>
    <nav class="main-nav" aria-label="Main navigation"><a href="/pricing">Pricing</a><a href="/contact-support">Support</a><a href="/getting-started">Getting Started</a><a href="/security">Security</a><a href="https://status.itemtraxx.com/" target="_blank" rel="noopener noreferrer">Status <span aria-hidden="true">↗</span></a></nav>
    <a class="cta" href="/login">Login</a>
  </header>
  <main>
    <section class="hero" id="comparison" aria-labelledby="hero-title">
      <div class="wrap">
        <div class="comparison-stage">
          <div class="comparison" aria-label="A messy inventory spreadsheet compared with the ItemTraxx checkout and return interface">
            <article class="compare-panel">
              <div class="media-frame spreadsheet-window">
                <table class="sheet-grid" aria-label="Messy inventory spreadsheet example">
                  <colgroup><col class="row-number"><col class="name"><col class="borrower"><col class="due"><col class="status"></colgroup>
                  <thead><tr><th></th><th>Item</th><th>Borrower</th><th>Due back</th><th>Status</th></tr></thead>
                  <tbody>
                    <tr><th class="row-number">1</th><td>Camera — Sony A7 iii</td><td>Maya C.</td><td class="stale">9/20</td><td>out</td></tr>
                    <tr><th class="row-number">2</th><td>Camera — Sony A7 C2</td><td class="blank"></td><td>9/23</td><td>check</td></tr>
                    <tr><th class="row-number">3</th><td>Wireless mic set</td><td>Jordan Lee · p4</td><td class="late">9/17</td><td class="late">late</td></tr>
                    <tr><th class="row-number">4</th><td>USB-C adapter</td><td>Sam R.</td><td>—</td><td class="blank"></td></tr>
                    <tr><th class="row-number">5</th><td>Tripod, Manfrotto</td><td>—</td><td class="stale">10/2</td><td>out</td></tr>
                  </tbody>
                </table>
              </div>
            </article>
            <div class="transform-arrow" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="M5 20h27m-10-10 10 10-10 10" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" stroke-linejoin="miter"/></svg></div>
            <article class="compare-panel" id="checkout">
              <div class="media-frame checkout-image"><img :src="checkoutReturnUiImage" alt="ItemTraxx checkout and return screen showing borrower details, checked-out items and checkout controls" width="2780" height="1798"></div>
            </article>
          </div>
        </div>
        <div class="hero-copy">
          <h1 id="hero-title">Inventory Tracking Made Simple</h1>
          <p>Bring your items, borrowers, checkouts and returns into one clear place with ItemTraxx.</p>
          <div class="hero-actions" aria-label="Get started"><a class="hero-action primary" href="/request-demo">Get a demo</a><a class="hero-action secondary" href="/pricing">Pricing</a></div>
        </div>
      </div>
    </section>
    <section class="what-section" id="workflow" aria-labelledby="what-title">
      <div class="wrap">
        <div class="what-intro">
          <div><h2 id="what-title">Keep every item in view.</h2></div>
          <p>ItemTraxx brings inventory, borrowers, checkouts and returns together, so teams can quickly see what is available and who has each item.</p>
        </div>
        <div class="what-list" aria-label="ItemTraxx workflows">
          <article class="what-row"><span class="number">01</span><h3>Organize inventory</h3><p>Keep shared items and their details in one clear, searchable place.</p></article>
          <article class="what-row"><span class="number">02</span><h3>Track checkouts and returns</h3><p>Record who has an item, when it leaves, and when it comes back.</p></article>
          <article class="what-row"><span class="number">03</span><h3>Review activity</h3><p>Follow item history and keep each transaction easy to understand.</p></article>
        </div>
      </div>
    </section>
    <section class="interactive-section" id="before-after" data-state="problem" aria-labelledby="compare-title">
      <div class="wrap">
        <div class="interactive-switch" role="group" aria-label="Choose an inventory view">
          <button class="comparison-toggle" type="button" data-view="problem" aria-pressed="true">The messy way</button>
          <button class="comparison-toggle" type="button" data-view="solution" aria-pressed="false">With ItemTraxx</button>
        </div>
        <div class="interactive-copy" aria-live="polite">
          <div data-copy="problem" class="is-active" aria-hidden="false"><h2 id="compare-title">A spreadsheet leaves too much to guess.</h2><p>Duplicates, blank cells, and unknowns make it hard to know what is actually available.</p></div>
          <div data-copy="solution" aria-hidden="true"><h2>Checkout and returns, without the guesswork.</h2><p>ItemTraxx keeps checkout and returns simple for hassle-free inventory management.</p></div>
        </div>
        <div class="interactive-visual messy-view" aria-label="Inventory management before and after ItemTraxx">
          <div class="interactive-art feature-messy is-active" data-art="problem" aria-hidden="false">
            <div class="feature-sheet">
              <div class="live-sheet-bar"><span class="live-sheet-title">Equipment inventory</span></div>
              <table class="sheet-grid" aria-label="Messy inventory spreadsheet being edited"><colgroup><col class="row-number"><col class="name"><col class="borrower"><col class="due"><col class="status"></colgroup><thead><tr><th></th><th>Item</th><th>Borrower</th><th>Due back</th><th>Status</th></tr></thead><tbody><tr><th class="row-number">1</th><td class="head">Camera maybe Sony?</td><td>Maya C?</td><td class="stale">9/20?</td><td>out?</td></tr><tr><th class="row-number">2</th><td class="duplicate">Camera? (same?)</td><td class="blank"></td><td>9/23</td><td>check</td></tr></tbody></table>
            </div>
          </div>
          <div class="interactive-art feature-checkout" data-art="solution" aria-hidden="true" inert>
            <div class="solution-stage">
            <div class="demo-app" aria-label="Interactive checkout and return demo">
              <img class="demo-brand" :src="itemtraxxLogo" alt="ItemTraxx Co">
              <span class="demo-menu" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M5 6.5h10M5 10h10M5 13.5h10"/></svg></span>
              <div class="demo-body">
                <h3 class="demo-page-title">Checkout and return</h3>
                <section class="demo-transaction" aria-label="Checkout transaction">
                  <label class="demo-label" for="demo-borrower-id">Borrower ID</label>
                  <div class="demo-input-row">
                    <input class="demo-input" id="demo-borrower-id" type="text" placeholder="Enter borrower ID" readonly aria-label="Demo borrower ID">
                    <button class="demo-button" type="button" tabindex="-1" aria-disabled="true">Load borrower</button>
                  </div>
                  <button class="demo-camera" type="button" tabindex="-1" aria-disabled="true">Use device camera to scan barcode</button>
                  <p class="demo-hint" id="demo-initial-hint">Enter a borrower ID to begin.</p>
                  <div id="demo-after-borrower" hidden>
                    <p class="demo-borrower" id="demo-borrower"><strong>Jordan Lee</strong> <span>ID: 6931JN</span></p>
                    <label class="demo-label" for="demo-barcode">Item barcode</label>
                    <div class="demo-input-row">
                      <input class="demo-input" id="demo-barcode" type="text" placeholder="Scan or enter barcode" readonly aria-label="Demo item barcode">
                      <button class="demo-button" type="button" tabindex="-1" aria-disabled="true">Add barcode</button>
                    </div>
                    <button class="demo-camera" type="button" tabindex="-1" aria-disabled="true">Use device camera to scan barcode</button>
                    <p class="demo-hint demo-barcode-hint">Press Enter or click “Add barcode” to add.</p>
                    <p class="demo-subhead">Items</p>
                    <ul class="demo-items"><li id="demo-queued-item" hidden><span class="demo-item-name">Wireless microphone kit <span class="demo-item-code">(IT-2048)</span></span><span class="demo-tag checkout" id="demo-item-action">Checkout</span><button class="demo-remove" type="button" tabindex="-1" aria-disabled="true">Remove</button></li></ul>
                    <div class="demo-actions" id="demo-actions" hidden>
                      <button class="demo-complete" id="demo-complete" type="button" tabindex="-1" aria-disabled="true">Complete transaction</button>
                    </div>
                    <p class="demo-success" id="demo-success" aria-live="polite" hidden>Transaction complete.</p>
                  </div>
                  <p class="demo-visually-hidden" id="demo-announcement" aria-live="polite"></p>
                </section>
              </div>
            </div>
            <div class="management-lists" aria-hidden="true">
            <aside class="items-demo" aria-label="Item management list" aria-hidden="true">
              <div class="items-demo-heading">
                <div><h3>Item List</h3></div>
                <span class="items-demo-count">5 items</span>
              </div>
              <div class="items-demo-search"><span aria-hidden="true">⌕</span> Search by name, barcode, serial, status, or notes</div>
              <div class="items-demo-table-scroll">
                <table class="items-demo-table">
                  <thead><tr><th>Name</th><th>Barcode</th><th>Serial</th><th>Status</th><th>Notes</th><th>Tenant Accounts</th></tr></thead>
                  <tbody>
                    <tr data-item-row><td>Wireless mic kit</td><td>IT-2048</td><td>WM-8821</td><td><span class="items-status available">Available</span></td><td>Audio room</td><td>All</td></tr>
                    <tr data-item-row><td>Sony A7 III camera</td><td>IT-1032</td><td>ILCE-7M3</td><td><span class="items-status checked-out">Checked out</span></td><td>Photo kit</td><td>Media team</td></tr>
                    <tr data-item-row><td>Manfrotto tripod</td><td>IT-1186</td><td>MVK500</td><td><span class="items-status available">Available</span></td><td>Camera gear</td><td>All</td></tr>
                    <tr data-item-row><td>LED panel light</td><td>IT-2204</td><td>LP-600</td><td><span class="items-status repair">Needs repair</span></td><td>Power cable</td><td>Studio</td></tr>
                    <tr data-item-row><td>Portable audio recorder</td><td>IT-0914</td><td>H6-BLK-42</td><td><span class="items-status available">Available</span></td><td>Field audio</td><td>All</td></tr>
                  </tbody>
                </table>
              </div>
            </aside>
            <aside class="borrowers-demo" aria-label="Active borrowers list" aria-hidden="true">
              <div class="borrowers-demo-heading">
                <h3>Borrowers</h3>
                <span class="items-demo-count">5 active</span>
              </div>
              <div class="borrowers-demo-search">⌕ &nbsp; Search by username or borrower ID</div>
              <div class="items-demo-table-scroll">
                <table class="borrowers-demo-table">
                  <thead><tr><th>Username</th><th>Borrower ID</th><th>Tenant Accounts</th><th>Details</th></tr></thead>
                  <tbody>
                    <tr data-borrower-row><td>xsmith</td><td>6931JN</td><td>All</td><td><span class="borrower-details">Details</span></td></tr>
                    <tr data-borrower-row><td>msantos</td><td>8426KP</td><td>media@school.org</td><td><span class="borrower-details">Details</span></td></tr>
                    <tr data-borrower-row><td>xnguyen</td><td>3174RB</td><td>All</td><td><span class="borrower-details">Details</span></td></tr>
                    <tr data-borrower-row><td>rpatel</td><td>6208WD</td><td>studio@school.org</td><td><span class="borrower-details">Details</span></td></tr>
                    <tr data-borrower-row><td>awilson</td><td>5593LC</td><td>media@school.org</td><td><span class="borrower-details">Details</span></td></tr>
                  </tbody>
                </table>
              </div>
              <button class="demo-replay borrower-replay" id="demo-replay" type="button" aria-label="Replay checkout demo" hidden>↻ Replay</button>
            </aside>
            </div>
            </div>
          </div>
        </div>
      </div>
    </section>
    <section class="platform-section" id="platform" aria-labelledby="platform-title">
      <div class="wrap">
        <header class="platform-heading"><h2 id="platform-title">Meet the platform keeping your shared inventory organized</h2></header>
        <div class="platform-slide-index" role="group" aria-label="Choose a platform feature">
          <button class="is-active" type="button" data-slide-label="0" aria-pressed="true">Checkout</button>
          <button type="button" data-slide-label="1" aria-pressed="false">Admin</button>
          <button type="button" data-slide-label="2" aria-pressed="false">Workspace</button>
        </div>
        <div class="platform-progress" aria-hidden="true"><span class="platform-progress-fill"></span></div>
        <div class="platform-features" aria-label="ItemTraxx platform feature slideshow">
          <article class="platform-feature" data-feature="0" role="group" aria-roledescription="slide" aria-label="Checkout and returns"><h3>Checkout and return, all in one clear flow</h3><p>Start by entering a borrower ID. Once the borrower is loaded, scan or type one or more item barcodes; ItemTraxx checks each item's current checkout status to label the action Checkout or Return. Review the item list, remove a mis-scanned item, then complete the transaction. The borrower and each item receive linked activity records, so staff can later check who had an item and when it moved. Admins also have Quick Return for items coming back without a borrower lookup. On prepared devices, eligible transactions can queue locally during a connection loss and sync later.</p></article>
          <article class="platform-feature" data-feature="1" role="group" aria-roledescription="slide" aria-label="Inventory and borrower management" hidden><h3>Manage inventory, borrowers, and activity</h3><p>Search items by name, barcode, serial number, status, or notes, then open a record to review or update it. Track whether an item is available, checked out, damaged, lost, or being repaired. Manage borrower records, filter checkout and return logs by action, person, item, or date range, and export the current view as CSV or PDF. For setup work, import items from CSV with a preview and validation report, or create printable PDF barcode labels in batches. Bulk actions can update or archive multiple items at once.</p></article>
          <article class="platform-feature" data-feature="2" role="group" aria-roledescription="slide" aria-label="Workspace for organizations" hidden><h3>One Workspace for shared inventory</h3><p>ItemTraxx Workspaces bring multiple tenant accounts under one organization's management, with shared inventory across teams and/or locations. Item-level access controls let admins make records available to all accounts or limit them to selected accounts. Workspace admins can add, suspend, restore, or remove tenant accounts; manage administrator access; set Workspace details and checkout defaults; and review logs that identify the account tied to each action. This helps an organization coordinate shared equipment while controlling which teams can see specific records.</p></article>
        </div>
        <div class="platform-rule" aria-hidden="true"></div>
      </div>
    </section>
    <div class="closing-area">
    <section class="final-cta" aria-labelledby="final-cta-title">
      <div class="final-cta-inner">
        <h2 id="final-cta-title">Built for teams where inventory chaos isn’t an option</h2>
        <p class="final-cta-copy"><span>Ready to integrate ItemTraxx to organize your inventory?</span><span>Request a demo today</span></p>
        <div class="final-cta-actions"><a class="final-cta-action" href="/request-demo">Get a demo</a><a class="final-cta-action secondary" href="/pricing">Explore pricing</a></div>
      </div>
    </section>
  
  <footer class="site-footer">
    <div class="footer-grid">
      <div class="footer-meta">
        <span>©{{ currentYear }} ItemTraxx Co</span>
        <span>{{ releaseChannel }}</span>
        <span>v-{{ appVersion }}</span>
        <span v-if="showBranchName" class="footer-branch">{{ appBranch }}</span>
      </div>
      <nav class="footer-group" aria-label="Product"><h2>Product</h2><ul><li><a href="/login">Login</a></li><li><a href="/pricing">Pricing</a></li><li><a href="/contact">Contact Sales</a></li><li><a href="/contact">Request Demo</a></li><li><a href="/getting-started">Getting Started</a></li><li><a href="/forgot-password">Forgot Password</a></li></ul></nav>
      <nav class="footer-group" aria-label="Support"><h2>Support</h2><ul><li><a href="/contact-support">Contact Support</a></li><li><a href="/security">Report Security Issue</a></li><li><a href="/changelog">Changelog</a></li><li><a href="/faq">FAQ</a></li><li><a href="https://status.itemtraxx.com/">Status</a></li></ul></nav>
      <nav class="footer-group" aria-label="Legal"><h2>Legal</h2><ul><li><a href="/legal">Legal Home</a></li><li><a href="/privacy">Privacy</a></li><li><a href="/legal/student-privacy">Student Privacy</a></li><li><a href="/legal/dpa">Data Processing Addendum</a></li><li><a href="/privacy-request">Privacy Request</a></li><li><a href="/cookies">Cookies</a></li><li><a href="/accessibility">Accessibility</a></li><li><a href="/security">Security</a></li><li><a href="/trust">Trust</a></li><li><a href="/compliance">Compliance</a></li></ul></nav>
      <nav class="footer-group" aria-label="Company"><h2>Company</h2><ul><li><a href="/">Home</a></li><li><a href="/contact">Contact</a></li><li><a href="/about">About</a></li><li><a href="https://github.com/ItemTraxxCo/ItemTraxx-App">GitHub</a></li></ul></nav>
    </div>
  </footer>
    </div>
  </main>
  </div>
</template>

<style scoped src="./LandingPageNew.css"></style>
