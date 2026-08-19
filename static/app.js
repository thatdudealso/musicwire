// Musicwire - Client-side manifest fetcher for dynamic pricing
// Fetches manifest from /manifest endpoint and updates pricing displays

(function() {
  'use strict';

  const MANIFEST_URL = '/manifest';
  const TIMEOUT_MS = 3000;

  // Format price for display
  function formatPrice(priceUsd) {
    if (typeof priceUsd === 'string') {
      return priceUsd.startsWith('$') ? priceUsd : `$${priceUsd}`;
    }
    if (typeof priceUsd === 'number') {
      return `$${priceUsd.toFixed(2)}`;
    }
    if (priceUsd && typeof priceUsd === 'object') {
      // Handle nested price object (solo/multi)
      return formatPrice(priceUsd.solo || priceUsd.price_usd || 0);
    }
    return '$0.00';
  }

  // Format price with label
  function formatPriceWithLabel(priceUsd, label) {
    return `<span class="price"><label>${label}</label>${formatPrice(priceUsd)}</span>`;
  }

  // Update pricing elements based on manifest data
  function updatePricing(manifest) {
    const endpoints = manifest.endpoints || {};
    
    // Update validate price
    const validatePriceEl = document.getElementById('price-validate');
    if (validatePriceEl && endpoints.validate) {
      validatePriceEl.innerHTML = formatPriceWithLabel(
        endpoints.validate.price_usd,
        'Validation'
      );
    }

    // Update render pricing
    const renderPriceEl = document.getElementById('price-render');
    if (renderPriceEl && endpoints.render) {
      const render = endpoints.render;
      // eslint-disable-next-line no-useless-assignment
      let html = '';
      
      if (render.price_usd && typeof render.price_usd === 'object') {
        // Handle solo/multi pricing
        html = `
          <span class="price"><label>Solo</label>${formatPrice(render.price_usd.solo)}</span>
          <span class="price"><label>Ensemble</label>${formatPrice(render.price_usd.multi_instrument)}</span>
        `;
        // Add part boundary info
        if (render.price_usd.part_boundary) {
          html += `<span class="badge">${render.price_usd.part_boundary}+ parts = ensemble</span>`;
        }
      } else {
        html = formatPriceWithLabel(render.price_usd, 'Rendering');
      }
      
      renderPriceEl.innerHTML = html;
    }

    // Update compose guide price
    const guidePriceEl = document.getElementById('price-compose-guide');
    if (guidePriceEl && endpoints.compose_guide) {
      guidePriceEl.innerHTML = formatPriceWithLabel(
        endpoints.compose_guide.price_usd,
        'Compose Guide'
      );
    }

    // Update jobs price
    const jobsPriceEl = document.getElementById('price-jobs');
    if (jobsPriceEl && endpoints.jobs) {
      jobsPriceEl.innerHTML = formatPriceWithLabel(
        endpoints.jobs.price_usd,
        'Job Status'
      );
    }

    // Update network info
    const networkEl = document.getElementById('network-info');
    if (networkEl && manifest.payment) {
      const network = manifest.payment.network || 'eip155:84532';
      const asset = manifest.payment.asset || 'USDC';
      const label = network === 'eip155:84532' ? 'Base Sepolia' : network;
      networkEl.innerHTML = `<code>${label}</code> - Pay with ${asset}`;
    }

    // Remove loading state
    document.body.classList.remove('manifest-loading');
    const loadingEls = document.querySelectorAll('.manifest-loading-placeholder');
    loadingEls.forEach(el => el.style.display = 'none');
  }

  // Handle fetch errors
  function handleError(error) {
    console.warn('Musicwire: Failed to fetch manifest:', error);
    document.body.classList.remove('manifest-loading');
    const errorEls = document.querySelectorAll('.manifest-loading-placeholder');
    errorEls.forEach(el => {
      el.innerHTML = '<span class="error">Pricing unavailable</span>';
      el.style.display = 'inline';
    });
  }

  // Fetch manifest
  function fetchManifest() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    fetch(MANIFEST_URL, { 
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    })
      .then(response => {
        clearTimeout(timeout);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then(updatePricing)
      .catch(handleError);
  }

  // Initialize when DOM is ready
  function init() {
    // Add loading state
    document.body.classList.add('manifest-loading');
    
    // Fetch manifest
    fetchManifest();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
