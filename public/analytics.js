(() => {
  "use strict";

  const config = window.TALKAIR_CONFIG || {};
  const measurementId = String(config.analyticsMeasurementId || "").trim();
  const isLocal = ["localhost", "127.0.0.1", ""].includes(location.hostname);
  const consentKey = "talkair_analytics_consent_v1";

  window.talkairAnalytics = { track: () => {} };
  if (!/^G-[A-Z0-9]+$/i.test(measurementId) || isLocal) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    wait_for_update: 500
  });

  let loaded = false;
  function loadAnalytics() {
    if (loaded) return;
    loaded = true;
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.append(script);
    window.gtag("js", new Date());
    window.gtag("config", measurementId, {
      anonymize_ip: true,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_title: document.title,
      page_location: location.href
    });
    window.talkairAnalytics.track = (name, parameters = {}) => {
      if (/^[a-z][a-z0-9_]{0,39}$/i.test(name)) window.gtag("event", name, parameters);
    };
    bindEvents();
  }

  function acceptAnalytics() {
    localStorage.setItem(consentKey, "granted");
    window.gtag("consent", "update", { analytics_storage: "granted" });
    document.querySelector("#analyticsConsent")?.remove();
    loadAnalytics();
  }

  function declineAnalytics() {
    localStorage.setItem(consentKey, "denied");
    document.querySelector("#analyticsConsent")?.remove();
  }

  function showConsent() {
    const banner = document.createElement("aside");
    banner.id = "analyticsConsent";
    banner.className = "analytics-consent";
    banner.setAttribute("aria-label", "Analytics choice");
    banner.innerHTML = `<div><strong>Optional analytics</strong><p>Help improve TalkAir by allowing anonymous Google Analytics traffic measurement. No analytics loads unless you accept.</p></div><div class="analytics-actions"><button type="button" data-consent="decline">Decline</button><button type="button" data-consent="accept">Allow analytics</button></div>`;
    document.body.append(banner);
    banner.querySelector('[data-consent="accept"]').addEventListener("click", acceptAnalytics);
    banner.querySelector('[data-consent="decline"]').addEventListener("click", declineAnalytics);
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const start = event.target.closest("[data-start]");
      if (start) window.talkairAnalytics.track("start_talking_click", { page_path: location.pathname });
      const mode = event.target.closest("[data-mode], [data-setup-mode]");
      if (mode) window.talkairAnalytics.track("mode_select", { mode: mode.dataset.mode || mode.dataset.setupMode });
      const link = event.target.closest("a[href]");
      if (link && link.hostname && link.hostname !== location.hostname) {
        window.talkairAnalytics.track("outbound_click", { link_url: link.href });
      }
    });
  }

  const choice = localStorage.getItem(consentKey);
  if (choice === "granted") acceptAnalytics();
  else if (choice !== "denied" && config.analyticsRequireConsent !== false) showConsent();
  else if (config.analyticsRequireConsent === false) acceptAnalytics();
})();
