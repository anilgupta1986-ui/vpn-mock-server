/**
 * VPN Gateway MCP Server — MCP Protocol Compliant
 * Transport: Streamable HTTP (JSON-RPC 2.0)
 * Protocol version: 2025-03-26
 * Compatible with: ServiceNow AI Agent Studio MCP Client (Zurich Patch 4+)
 *
 * Endpoints:
 *   POST /mcp  — MCP JSON-RPC messages (initialize, tools/list, tools/call)
 *   GET  /mcp  — Health / transport probe
 *   POST /demo/state — Reset demo state (healthy | degraded | critical)
 *   GET  /health     — Server liveness
 */

const http = require('http');
const url  = require('url');
const crypto = require('crypto');

// ── Demo state ────────────────────────────────────────────────────────────────
let DEMO_STATE = 'degraded';

const GATEWAY = {
  healthy: {
    gateway_id: 'vpn-gw-apac-01', region: 'APAC', location: 'Bangalore-DC-01',
    status: 'operational', health_score: 98, active_connections: 142,
    max_connections: 500, cpu_utilization: 22, memory_utilization: 31,
    packet_loss_pct: 0.01, avg_latency_ms: 18,
    alerts: [], recommended_action: 'none', change_risk: 'none',
    standard_change_applicable: false
  },
  degraded: {
    gateway_id: 'vpn-gw-apac-01', region: 'APAC', location: 'Bangalore-DC-01',
    status: 'degraded', health_score: 41, active_connections: 487,
    max_connections: 500, cpu_utilization: 91, memory_utilization: 88,
    packet_loss_pct: 12.4, avg_latency_ms: 2840,
    alerts: [
      { severity: 'HIGH', code: 'CPU_THRESHOLD_EXCEEDED',
        message: 'CPU utilization above 90% for 18 minutes' },
      { severity: 'HIGH', code: 'CONNECTION_POOL_NEAR_LIMIT',
        message: 'Active connections at 97% capacity' },
      { severity: 'MEDIUM', code: 'PACKET_LOSS_ELEVATED',
        message: 'Packet loss 12.4% — above 5% threshold' }
    ],
    recommended_action: 'restart_service', change_risk: 'low',
    standard_change_applicable: true,
    standard_change_id: 'CHG_STD_VPN_RESTART_001',
    estimated_recovery_minutes: 3
  },
  critical: {
    gateway_id: 'vpn-gw-apac-01', region: 'APAC', location: 'Bangalore-DC-01',
    status: 'down', health_score: 0, active_connections: 0,
    max_connections: 500, cpu_utilization: 0, memory_utilization: 0,
    packet_loss_pct: 100, avg_latency_ms: null,
    alerts: [
      { severity: 'CRITICAL', code: 'GATEWAY_UNREACHABLE',
        message: 'VPN gateway not responding to health checks for 6 minutes' },
      { severity: 'CRITICAL', code: 'ALL_SESSIONS_DROPPED',
        message: '489 active sessions terminated' }
    ],
    recommended_action: 'escalate_to_network_team', change_risk: 'high',
    standard_change_applicable: false, requires_human_approval: true
  }
};

// ── MCP Tool definitions ──────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'vpn_gateway_status_check',
    description: 'Checks the real-time health and status of VPN gateways in a specified region. Returns health score, active alerts, CPU and memory utilization, packet loss, and recommended remediation action including whether a standard change is applicable.',
    inputSchema: {
      type: 'object',
      properties: {
        region: {
          type: 'string',
          description: 'Geographic region of the VPN gateway to check. Use APAC for Bangalore and India offices.',
          enum: ['APAC', 'EMEA', 'AMER'],
          default: 'APAC'
        },
        gateway_id: {
          type: 'string',
          description: 'Optional specific gateway identifier. If omitted, checks all gateways in region.',
          example: 'vpn-gw-apac-01'
        }
      },
      required: ['region']
    }
  },
  {
    name: 'vpn_gateway_remediate',
    description: 'Executes a pre-approved remediation action on a VPN gateway. Only callable when standard_change_applicable is true in the status check response. Supported actions: restart_service. Requires a valid standard change ID.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Remediation action to execute.',
          enum: ['restart_service', 'scale_connections', 'flush_sessions']
        },
        gateway_id: {
          type: 'string',
          description: 'Target gateway identifier.',
          example: 'vpn-gw-apac-01'
        },
        change_id: {
          type: 'string',
          description: 'Standard change record number authorizing this action.',
          example: 'CHG_STD_VPN_RESTART_001'
        }
      },
      required: ['action', 'gateway_id', 'change_id']
    }
  },
  {
    name: 'vpn_incident_history',
    description: 'Returns incident history for a VPN gateway including number of incidents in last 30 days, mean time to resolution, uptime percentage, and last incident cause. Useful for context enrichment before deciding on remediation.',
    inputSchema: {
      type: 'object',
      properties: {
        gateway_id: {
          type: 'string',
          description: 'Gateway identifier to retrieve history for.',
          example: 'vpn-gw-apac-01'
        },
        period_hours: {
          type: 'number',
          description: 'Number of hours of history to retrieve. Default 720 (30 days).',
          default: 720
        }
      },
      required: ['gateway_id']
    }
  }
];

// ── Tool execution ────────────────────────────────────────────────────────────
function executeTool(name, args) {
  if (name === 'vpn_gateway_status_check') {
    const data = { ...GATEWAY[DEMO_STATE], queried_at: new Date().toISOString() };
    return JSON.stringify(data, null, 2);
  }

  if (name === 'vpn_gateway_remediate') {
    if (DEMO_STATE === 'critical') {
      return JSON.stringify({
        success: false,
        error: 'Remediation blocked — gateway unreachable. Manual escalation to Network Operations required.',
        change_risk: 'high'
      }, null, 2);
    }
    DEMO_STATE = 'healthy';
    return JSON.stringify({
      success: true,
      action_taken: args.action || 'restart_service',
      gateway_id: args.gateway_id || 'vpn-gw-apac-01',
      change_id: args.change_id,
      started_at: new Date().toISOString(),
      completed_at: new Date(Date.now() + 3000).toISOString(),
      new_status: 'operational',
      new_health_score: 96,
      message: 'VPN gateway service restarted successfully. Sessions will re-establish automatically within 2 minutes.'
    }, null, 2);
  }

  if (name === 'vpn_incident_history') {
    return JSON.stringify({
      gateway_id: args.gateway_id || 'vpn-gw-apac-01',
      period_hours: args.period_hours || 720,
      incidents_last_30_days: 2,
      last_incident_date: '2025-10-28T11:00:00Z',
      last_incident_cause: 'firmware_update_side_effect',
      last_incident_resolution: 'service_restart',
      mttr_minutes: 4.2,
      uptime_pct_30d: 99.87,
      pattern_note: 'Both incidents resolved by service restart within 5 minutes. Low risk remediation pattern established.'
    }, null, 2);
  }

  throw new Error(`Unknown tool: ${name}`);
}

// ── JSON-RPC helpers ──────────────────────────────────────────────────────────
function jsonRpcSuccess(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ── MCP message handler ───────────────────────────────────────────────────────
function handleMcpMessage(msg) {
  const { method, params, id } = msg;
  console.log(`[MCP] ${method} id=${id}`);

  // Initialize handshake
  if (method === 'initialize') {
    return jsonRpcSuccess(id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'vpn-gateway-mcp-server', version: '1.0.0' },
      instructions: 'VPN Gateway diagnostic and remediation tools for the APAC region. Always call vpn_gateway_status_check before vpn_gateway_remediate.'
    });
  }

  // Client confirms ready — no response needed
  if (method === 'notifications/initialized') {
    return null;
  }

  // Tool discovery
  if (method === 'tools/list') {
    return jsonRpcSuccess(id, { tools: TOOLS });
  }

  // Tool execution
  if (method === 'tools/call') {
    const toolName = params && params.name;
    const toolArgs = (params && params.arguments) || {};
    if (!toolName) {
      return jsonRpcError(id, -32602, 'Missing tool name in params');
    }
    const knownTool = TOOLS.find(t => t.name === toolName);
    if (!knownTool) {
      return jsonRpcError(id, -32601, `Tool not found: ${toolName}`);
    }
    try {
      const text = executeTool(toolName, toolArgs);
      return jsonRpcSuccess(id, {
        content: [{ type: 'text', text }]
      });
    } catch (err) {
      return jsonRpcError(id, -32603, err.message);
    }
  }

  // Ping
  if (method === 'ping') {
    return jsonRpcSuccess(id, {});
  }

  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function respond(res, code, data, extraHeaders) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Mcp-Session-Id, Authorization, x-api-key',
    ...(extraHeaders || {})
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const path   = parsed.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') { respond(res, 200, {}); return; }

  // ── /mcp endpoint — MCP Streamable HTTP transport ──
  if (path === '/mcp') {

    // GET /mcp — transport probe / health
    if (req.method === 'GET') {
      respond(res, 200, {
        status: 'ok',
        transport: 'streamable-http',
        protocol: '2025-03-26',
        server: 'vpn-gateway-mcp-server',
        demo_state: DEMO_STATE,
        tools: TOOLS.map(t => t.name)
      });
      return;
    }

    // POST /mcp — JSON-RPC messages
    if (req.method === 'POST') {
      let body;
      try { body = await readBody(req); }
      catch {
        respond(res, 400, jsonRpcError(null, -32700, 'Parse error — invalid JSON'));
        return;
      }

      // Generate session ID on initialize, echo it back
      const sessionId = req.headers['mcp-session-id'] || crypto.randomUUID();
      const responseHeaders = { 'Mcp-Session-Id': sessionId };

      const result = handleMcpMessage(body);

      // notifications/initialized expects 202 with empty body
      if (result === null) {
        res.writeHead(202, responseHeaders);
        res.end();
        return;
      }

      respond(res, 200, result, responseHeaders);
      return;
    }

    respond(res, 405, { error: 'Method not allowed' });
    return;
  }

  // ── /demo/state — reset demo state ──
  if (path === '/demo/state' && req.method === 'POST') {
    let body;
    try { body = await readBody(req); } catch { body = {}; }
    if (body && ['healthy', 'degraded', 'critical'].includes(body.state)) {
      DEMO_STATE = body.state;
      respond(res, 200, { message: `Demo state set to: ${DEMO_STATE}` });
    } else {
      respond(res, 400, { error: 'Invalid state. Use: healthy | degraded | critical' });
    }
    return;
  }

  // ── /health — liveness ──
  if (path === '/health') {
    respond(res, 200, {
      status: 'ok', demo_state: DEMO_STATE,
      server: 'vpn-gateway-mcp-server',
      mcp_endpoint: '/mcp', version: '1.0.0'
    });
    return;
  }

  respond(res, 404, { error: `Route not found: ${path}` });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│   VPN Gateway MCP Server — Streamable HTTP (JSON-RPC 2.0)   │');
  console.log(`│   Listening on port ${String(PORT).padEnd(41)}│`);
  console.log('├──────────────────────────────────────────────────────────────┤');
  console.log('│  MCP endpoint:  /mcp  (GET + POST)                          │');
  console.log('│  Tools:         vpn_gateway_status_check                    │');
  console.log('│                 vpn_gateway_remediate                       │');
  console.log('│                 vpn_incident_history                        │');
  console.log('├──────────────────────────────────────────────────────────────┤');
  console.log(`│  Demo state: ${DEMO_STATE.padEnd(48)}│`);
  console.log('│  Reset:  POST /demo/state  {"state":"degraded"}             │');
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log('');
});
