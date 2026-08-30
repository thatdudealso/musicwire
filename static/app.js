// Musicwire - Client-side manifest fetcher for dynamic pricing
// Fetches manifest from /manifest endpoint and updates pricing displays

(function () {
  'use strict';

  const MANIFEST_URL = '/manifest';
  const TIMEOUT_MS = 3000;

  // Known network labels, used only when the service does not advertise its own
  const NETWORK_LABELS = {
    'eip155:8453': 'Base mainnet',
    'eip155:84532': 'Base Sepolia',
  };

  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[character],
    );
  }

  // Prefer the label the service publishes so the page can never drift from it
  function networkLabel(payment) {
    return payment.network_label || NETWORK_LABELS[payment.network] || payment.network;
  }

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
      return formatPrice(priceUsd.solo || 0);
    }
    return '$0.00';
  }

  // Format price with label
  function formatPriceWithLabel(priceUsd, label) {
    return `<span class="price"><label>${label}</label>${formatPrice(priceUsd)}</span>`;
  }

  function setPrice(name, html) {
    const byId = document.getElementById(`price-${name}`);
    if (byId) byId.innerHTML = html;
    document.querySelectorAll(`[data-price="${name}"]`).forEach((element) => {
      element.innerHTML = html;
    });
  }

  // Update pricing elements based on manifest data
  function updatePricing(manifest) {
    const endpoints = manifest.endpoints || {};

    // Update validate price
    if (endpoints.validate)
      setPrice('validate', formatPriceWithLabel(endpoints.validate.price_usd, 'Validation'));

    // Update render pricing
    if (endpoints.render) {
      const render = endpoints.render;
      let html;

      if (render.price_usd && typeof render.price_usd === 'object') {
        // Handle solo/multi pricing
        html = `
          <span class="price"><label>Solo</label>${formatPrice(render.price_usd.solo)}</span>
          <span class="price"><label>Ensemble</label>${formatPrice(render.price_usd.multi_instrument)}</span>
        `;
      } else {
        html = formatPriceWithLabel(render.price_usd, 'Rendering');
      }

      setPrice('render', html);
    }

    // Update compose guide price
    if (endpoints.compose_guide)
      setPrice(
        'compose-guide',
        formatPriceWithLabel(endpoints.compose_guide.price_usd, 'Compose Guide'),
      );

    // Update jobs price
    if (endpoints.jobs)
      setPrice('jobs', formatPriceWithLabel(endpoints.jobs.price_usd, 'Job Status'));

    // Update network labels from the network this deployment actually advertises
    if (manifest.payment && manifest.payment.network) {
      const asset = manifest.payment.asset || 'USDC';
      const label = networkLabel(manifest.payment);

      const networkEl = document.getElementById('network-info');
      if (networkEl) {
        networkEl.innerHTML = `<code>${escapeHtml(label)}</code> - Pay with ${escapeHtml(asset)}`;
      }

      const badgeEl = document.getElementById('network-badge');
      if (badgeEl) {
        badgeEl.textContent = `Live on ${label}`;
      }
    }

    // Remove loading state
    document.body.classList.remove('manifest-loading');
    const loadingEls = document.querySelectorAll('.manifest-loading-placeholder .loading');
    loadingEls.forEach((el) => (el.style.display = 'none'));
  }

  // Handle fetch errors
  function handleError() {
    document.body.classList.remove('manifest-loading');
    const errorEls = document.querySelectorAll('.manifest-loading-placeholder');
    errorEls.forEach((el) => {
      el.innerHTML = '<span class="error">Pricing unavailable</span>';
    });
  }

  // Fetch manifest
  function fetchManifest() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    fetch(MANIFEST_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
      .then((response) => {
        clearTimeout(timeout);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then(updatePricing)
      .catch((_error) => {
        handleError(_error);
      });
  }

  function loadMusicxmlExamples() {
    const codeBlocks = document.querySelectorAll('[data-musicxml-src]');
    codeBlocks.forEach((codeBlock) => {
      fetch(codeBlock.dataset.musicxmlSrc, {
        headers: { Accept: 'application/vnd.recordare.musicxml+xml' },
      })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.text();
        })
        .then((musicxml) => {
          codeBlock.textContent = musicxml;
          const requestBlock = codeBlock
            .closest('.showcase-card')
            ?.querySelector('.render-request');
          if (requestBlock)
            requestBlock.textContent = JSON.stringify(
              { musicxml, formats: ['mp3', 'midi'] },
              null,
              2,
            );
        })
        .catch(() => {
          codeBlock.textContent = 'MusicXML could not be loaded. Use the source link in this card.';
        });
    });

    document.querySelectorAll('.copy-musicxml').forEach((button) => {
      button.addEventListener('click', async () => {
        const codeBlock = button.closest('details')?.querySelector('[data-musicxml-src]');
        if (!codeBlock || codeBlock.textContent.startsWith('MusicXML could not')) return;
        try {
          await navigator.clipboard.writeText(codeBlock.textContent);
          button.textContent = 'Copied';
          setTimeout(() => {
            button.textContent = 'Copy MusicXML';
          }, 1_500);
        } catch {
          button.textContent = 'Select the score to copy';
        }
      });
    });

    document.querySelectorAll('.copy-render-request').forEach((button) => {
      button.addEventListener('click', async () => {
        const requestBlock = button.closest('details')?.querySelector('.render-request');
        if (!requestBlock || requestBlock.textContent.startsWith('Loading')) return;
        try {
          await navigator.clipboard.writeText(requestBlock.textContent);
          button.textContent = 'Copied';
          setTimeout(() => {
            button.textContent = 'Copy render request';
          }, 1_500);
        } catch {
          button.textContent = 'Select the request to copy';
        }
      });
    });
  }

  // Initialize when DOM is ready
  function init() {
    // Add loading state
    document.body.classList.add('manifest-loading');

    loadMusicxmlExamples();

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
