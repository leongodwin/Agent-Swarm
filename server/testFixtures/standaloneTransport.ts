/** Synthetic class only; never a provider, tenant or runtime proof. */
export const standaloneTransportFixture=`class SyntheticTransport {
  async ppapiRequest(method, url2, body) {
    return this.readLoop(method, url2, body);
  }
  async request(method, url2, body) {
    return this.readLoop(method, url2, body);
  }
  async ppapiRequestWithFallback(envId, ppapiPath, method, body) {
    return this.readFallback(envId, ppapiPath, method, body);
  }
  async classicFlowRpRequest(envId, ppapiPath, method, body) {
    return this.readLoop(method, ppapiPath, body);
  }
  async triggerFlowRun(envId, flowId, opts = {}) {
    return this.forbiddenFallback();
  }
}
`;
