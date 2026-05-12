/**
 * Mock VPN Gateway Status MCP Server
 * Demo: Autonomous Incident Resolution — ServiceNow AI Agent
 * Instance: demoalectriallwfzi126819.service-now.com
 *
 * Simulates an external network monitoring tool that the ServiceNow
 * AI Agent calls via MCP to check VPN gateway health.
 *
 * Run: node server.js
 * Listens on: http://localhost:3000
 */

const http = require('http');
const url = require('url');

// ─── Demo State (toggle to drive different agent decisions) ───────────────────
let DEMO_STATE = 'degraded'; // 'healthy' | 'degraded' | 'critical'

// ─── VPN Gateway Data (simulated) ────────────────────────────────────────────
const GATEWAY_DATA = {
  healthy: {
    gateway_id: 'vpn-gw-apac-01',
    region: 'APAC',
    location: 'Bangalore-DC-01',
    status: 'operational',
    health_score: 98,
    active_connections: 142,
    max_connections: 500,
    cpu_utilization: 22,
    memory_utilization: 31,
    packet_loss_pct: 0.01,
    avg_latency_ms: 18,
    last_restart: '2025-11-01T06:00:00Z',
    alerts: [],
    recommended_action: 'none',
    change_risk: 'none'
  },
  degraded: {
    gateway_id: 'vpn-gw-apac-01',
    region: 'APAC',
    location: 'Bangalore-DC-01',
    status: 'degraded',
    health_score: 41,
    active_connections: 487,
    max_connections: 500,
    cpu_utilization: 91,
    memory_utilization: 88,
    packet_loss_pct: 12.4,
    avg_latency_ms: 2840,
    last_restart: '2025-08-15T14:22:00Z',
    alerts: [
      { severity: 'HIGH', code: 'CPU_THRESHOLD_EXCEEDED', message: 'CPU utilization above 90% for 18 minutes' },
      { severity: 'HIGH', code: 'CONNECTION_POOL_NEAR_LIMIT', message: 'Active connections at 97% capacity' },
      { severity: 'MEDIUM', code: 'PACKET_LOSS_ELEVATED', message: 'Packet loss 12.4% — above 5% threshold' }
    ],
    recommended_action: 'restart_service',
    change_risk: 'low',
    standard_change_applicable: true,
    standard_change_id: 'CHG_STD_VPN_RESTART_001',
    estimated_recovery_minutes: 3
  },
  critical: {
    gateway_id: 'vpn-gw-apac-01',
    region: 'APAC',
    location: 'Bangalore-DC-01',
    status: 'down',
    health_score: 0,
    active_connections: 0,
    max_connections: 500,
    cpu_utilization: 0,
    memory_utilization: 0,
    packet_loss_pct: 100,
    avg_latency_ms: null,
    last_restart: '2025-11-19T09:14:00Z',
    alerts: [
      { severity: 'CRITICAL', code: 'GATEWAY_UNREACHABLE', message: 'VPN gateway not responding to health checks for 6 minutes' },
      { severity: 'CRITICAL', code: 'ALL_SESSIONS_DROPPED', message: '489 active sessions terminated' }
    ],
    recommended_action: 'escalate_to_network_team',
    change_risk: 'high',
    standard_change_applicable: false,
    requires_human_approval: true
  }
};

// ─── Remediation Result ───────────────────────────────────────────────────────
const REMEDIATION_RESULT = {
  success: true,
  action_taken: 'service_restart',
  gateway_id: 'vpn-gw-apac-01',
  started_at: new Date().toISOString(),
  completed_at: new Date(Date.now() + 3000).toISOString(),
  new_status: 'operational',
  new_health_score: 96,
  sessions_restored: 0,
  message: 'VPN gateway service restarted successfully. Connections will re-establish automatically.'
};

// ─── Router ───────────────────────────────────────────────────────────────────
const routes = {
  // GET /vpn/status?region=APAC
  '/vpn/status': (req, res, params) => {
    const data = { ...GATEWAY_DATA[DEMO_STATE], queried_at: new Date().toISOString() };
    respond(res, 200, data);
  },

  // GET /vpn/history?gateway_id=vpn-gw-apac-01&hours=24
  '/vpn/history': (req, res, params) => {
    respond(res, 200, {
      gateway_id: 'vpn-gw-apac-01',
      period_hours: parseInt(params.hours || 24),
      incidents_last_30_days: 2,
      last_incident: '2025-10-28T11:00:00Z',
      last_incident_cause: 'firmware_update_side_effect',
      mttr_minutes: 4.2,
      uptime_pct_30d: 99.87
    });
  },

  // POST /vpn/remediate  body: { action: "restart_service", gateway_id: "..." }
  '/vpn/remediate': (req, res, params, body) => {
    if (DEMO_STATE === 'critical') {
      respond(res, 403, { success: false, message: 'Remediation blocked — gateway unreachable. Escalation required.' });
    } else {
      DEMO_STATE = 'healthy'; // simulate recovery
      respond(res, 200, REMEDIATION_RESULT);
    }
  },

  // POST /demo/state  body: { state: "healthy"|"degraded"|"critical" }
  '/demo/state': (req, res, params, body) => {
    if (body && ['healthy', 'degraded', 'critical'].includes(body.state)) {
      DEMO_STATE = body.state;
      respond(res, 200, { message: `Demo state set to: ${DEMO_STATE}` });
    } else {
      respond(res, 400, { error: 'Invalid state. Use: healthy | degraded | critical' });
    }
  },

  // GET /health
  '/health': (req, res) => {
    respond(res, 200, { status: 'ok', demo_state: DEMO_STATE, server: 'vpn-mock-mcp', version: '1.0.0' });
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function respond(res, code, data) {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-sn-mcp-key'
  });
  res.end(JSON.stringify(data, null, 2));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

// ─── Server ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;
  const params = parsed.query;

  // CORS preflight
  if (req.method === 'OPTIONS') { respond(res, 200, {}); return; }

  // Optional: simple API key check (for showing "governed access" in demo)
  // const apiKey = req.headers['x-sn-mcp-key'];
  // if (apiKey !== 'demo-key-123') { respond(res, 401, { error: 'Unauthorized' }); return; }

  const handler = routes[path];
  if (!handler) { respond(res, 404, { error: `Route not found: ${path}` }); return; }

  const body = req.method === 'POST' ? await parseBody(req) : null;

  console.log(`[${new Date().toISOString()}] ${req.method} ${path} | state=${DEMO_STATE}`);
  handler(req, res, params, body);
});

server.listen(3000, () => {
  console.log('');
  console.log('┌─────────────────────────────────────────────────────────────┐');
  console.log('│   VPN Mock MCP Server — ServiceNow Agentic Demo             │');
  console.log('│   http://localhost:3000                                      │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  console.log('│  GET  /health                 → server status               │');
  console.log('│  GET  /vpn/status?region=APAC → gateway health check        │');
  console.log('│  GET  /vpn/history            → incident history            │');
  console.log('│  POST /vpn/remediate          → trigger restart             │');
  console.log('│  POST /demo/state             → set state (for demo reset)  │');
  console.log('├─────────────────────────────────────────────────────────────┤');
  console.log(`│  Current demo state: ${DEMO_STATE.padEnd(36)}│`);
  console.log('│  Set to "degraded" before demo starts                       │');
  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log('Quick demo reset:');
  console.log('  curl -X POST http://localhost:3000/demo/state -H "Content-Type: application/json" -d \'{"state":"degraded"}\'');
  console.log('');
});
