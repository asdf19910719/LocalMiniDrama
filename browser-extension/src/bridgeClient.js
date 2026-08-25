export class BridgeClient {
  constructor({ baseUrl = 'http://127.0.0.1:5678', accessToken = '' } = {}) { this.baseUrl = baseUrl.replace(/\/$/, ''); this.accessToken = accessToken }
  async pair(pairingToken) { const response = await fetch(`${this.baseUrl}/v1/session/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pairingToken }) }); if (!response.ok) throw new Error(`Bridge pairing failed: ${response.status}`); const data = await response.json(); this.accessToken = data.accessToken; return data }
  async request(path, options = {}) { const headers = new Headers(options.headers || {}); headers.set('Authorization', `Bearer ${this.accessToken}`); const response = await fetch(`${this.baseUrl}${path}`, { ...options, headers }); if (!response.ok) throw new Error(`Bridge request failed: ${response.status}`); return response }
  async manifest(jobId) { return (await this.request(`/v1/jobs/${encodeURIComponent(jobId)}/manifest`)).json() }
  async reference(jobId, fileName) { return (await this.request(`/v1/jobs/${encodeURIComponent(jobId)}/references/${encodeURIComponent(fileName)}`)).arrayBuffer() }
  async postEvent(event) { return (await this.request('/v1/events', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event) })).json() }
}
