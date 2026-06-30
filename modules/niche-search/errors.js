class SearchProviderBlockedError extends Error {
  constructor(provider, message, htmlPreview) {
    super(message || `${provider} rate-limited or blocked this request`);
    this.name = 'SearchProviderBlockedError';
    this.provider = provider;
    this.htmlPreview = htmlPreview;
  }
}

class SearchProviderError extends Error {
  constructor(provider, message) {
    super(message);
    this.name = 'SearchProviderError';
    this.provider = provider;
  }
}

module.exports = { SearchProviderBlockedError, SearchProviderError };
