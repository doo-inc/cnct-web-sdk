import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket as NodeWebSocket } from 'ws';

/**
 * Enough of CNCT to hold this SDK to its contract.
 *
 * Deliberately not a mock of `fetch`: the thing worth testing here is the whole path — a real socket
 * upgrade, real JSON, real status codes, real `x-chat-token` — because every bug this SDK has had was
 * in the seam between those, and a stubbed `fetch` is exactly the seam a stub cannot fail at.
 */
export interface MockCnct {
  baseUrl: string;
  /** Every request the SDK made, in order. Assert on headers here. */
  requests: { method: string; path: string; headers: Record<string, string>; body: unknown }[];
  /** Push a message to every connected visitor socket, as an operator reply would. */
  push(frame: unknown): void;
  /** Answer the next call to this path with a status and body. */
  stub(key: string, response: { status: number; body: unknown }): void;
  /** What the socket advertises on the handshake. Empty means "this server has no socket sends". */
  accepts: string[];
  /** Set false to make the socket refuse the token with 1008. */
  acceptToken: boolean;
  sockets: NodeWebSocket[];
  close(): Promise<void>;
}

const TOKEN = 'visitor-token-abc';

export async function startMockCnct(options: { prefix?: string } = {}): Promise<MockCnct> {
  const prefix = options.prefix ?? '';
  const requests: MockCnct['requests'] = [];
  const stubs = new Map<string, { status: number; body: unknown }>();
  const sockets: NodeWebSocket[] = [];
  const messages: Record<string, unknown>[] = [];

  const state = {
    accepts: ['ping', 'typing', 'send'] as string[],
    acceptToken: true,
  };

  const server: Server = createServer((request, response) => {
    void handle(request, response);
  });

  const json = (response: ServerResponse, status: number, body: unknown) => {
    const text = JSON.stringify(body);
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(text);
  };

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
    const raw = await readBody(request);
    const body = raw ? safeParse(raw) : undefined;
    requests.push({
      method: request.method ?? 'GET',
      path: url.pathname + (url.search || ''),
      headers: request.headers as Record<string, string>,
      body,
    });

    const stubbed = stubs.get(`${request.method} ${path}`);
    if (stubbed) {
      stubs.delete(`${request.method} ${path}`);
      return json(response, stubbed.status, stubbed.body);
    }

    const token = request.headers['x-chat-token'];
    const authorized = token === TOKEN;

    // ── Chat ───────────────────────────────────────────────────────────────────────────────────
    if (request.method === 'GET' && path === '/api/chat/public/session') {
      if (!authorized) return json(response, 401, { error: 'Unauthenticated' });
      return json(response, 200, {
        visitor: { displayName: 'Layla' },
        conversation: { status: 'OPEN', startedAt: '2026-09-19T08:00:00.000Z', withPerson: false },
        messages: messages.slice(),
      });
    }
    if (request.method === 'GET' && /^\/api\/chat\/public\/[^/]+$/.test(path)) {
      return json(response, 200, {
        business: 'Qimam Elevators',
        inbox: 'Website',
        isActive: true,
        greeting: 'How can we help?',
        requirePhone: false,
      });
    }
    if (request.method === 'POST' && /^\/api\/chat\/public\/[^/]+\/session$/.test(path)) {
      return json(response, 200, {
        token: TOKEN,
        visitor: { displayName: (body as { displayName?: string })?.displayName ?? 'Visitor' },
        conversation: { status: 'OPEN', startedAt: '2026-09-19T08:00:00.000Z', withPerson: false },
        messages: messages.slice(),
      });
    }
    if (request.method === 'POST' && path === '/api/chat/public/messages') {
      if (!authorized) return json(response, 401, { error: 'Unauthenticated' });
      const input = body as { body: string; clientKey?: string };
      // Idempotent, exactly as the platform is: the same clientKey returns the row it already wrote.
      const existing = messages.find((m) => m.clientKey && m.clientKey === input.clientKey);
      if (existing) return json(response, 200, existing);
      const stored = {
        id: `msg_${messages.length + 1}`,
        speaker: 'CALLER',
        type: 'TEXT',
        body: input.body,
        createdAt: new Date(Date.now() + messages.length).toISOString(),
        clientKey: input.clientKey ?? null,
      };
      messages.push(stored);
      return json(response, 200, stored);
    }
    if (request.method === 'POST' && path === '/api/chat/public/close') {
      if (!authorized) return json(response, 401, { error: 'Unauthenticated' });
      return json(response, 200, { ok: true });
    }
    if (request.method === 'GET' && path.startsWith('/api/chat/public/attachments/')) {
      if (!authorized) return json(response, 401, { error: 'Unauthenticated' });
      response.writeHead(200, { 'content-type': 'image/png' });
      return response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    }

    // ── Bookings and tickets ───────────────────────────────────────────────────────────────────
    // Two keys, as the platform has two kinds: a sandbox key's every answer says `sandbox: true`.
    const sandbox = AGENT_KEYS[String(request.headers.authorization)];
    // Only `/api/tools`: the platform still answers `/api/booking-tools` too, but this SDK must not
    // be the thing that keeps the old address alive, so here it 404s.
    if (request.method === 'GET' && path === '/api/tools') {
      if (sandbox === undefined) return json(response, 401, { error: 'Unauthenticated' });
      return json(response, 200, {
        sandbox,
        tools: [
          { name: 'check_availability', description: 'Free times', parameters: { type: 'object' } },
        ],
        rules: {
          timezone: 'Asia/Bahrain',
          capacity: 40,
          slotMinutes: 30,
          services: [{ id: 'svc_1', name: 'Haircut', durationMinutes: 45 }],
          resources: [{ id: 'res_1', name: 'Layla', kind: 'PERSON', seats: 1 }],
          hours: { mon: '09:00-18:00' },
        },
      });
    }
    if (request.method === 'POST' && path.startsWith('/api/tools/')) {
      if (sandbox === undefined) return json(response, 401, { error: 'Unauthenticated' });
      const tool = decodeURIComponent(path.slice('/api/tools/'.length));
      const result = toolResult(tool, body as Record<string, unknown>);
      return json(response, 200, sandbox ? { ...result, sandbox: true } : result);
    }

    return json(response, 404, { error: 'Not found' });
  }

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.endsWith('/ws/chat')) return socket.destroy();
    wss.handleUpgrade(request, socket, head, (ws) => {
      sockets.push(ws);
      ws.on('message', (data) => {
        const frame = safeParse(String(data)) as Record<string, unknown> | undefined;
        if (!frame) return;
        if (frame.type === 'auth') {
          if (!state.acceptToken || frame.token !== TOKEN) return ws.close(1008, 'Unauthenticated');
          return ws.send(JSON.stringify({ type: 'authenticated', accepts: state.accepts }));
        }
        if (frame.type === 'ping') return ws.send(JSON.stringify({ type: 'pong' }));
        if (frame.type === 'send') {
          const stored = {
            id: `msg_${messages.length + 1}`,
            speaker: 'CALLER',
            type: 'TEXT',
            body: frame.body,
            createdAt: new Date(Date.now() + messages.length).toISOString(),
            clientKey: frame.clientKey ?? null,
          };
          messages.push(stored);
          return ws.send(JSON.stringify({ type: 'ack', id: frame.id, message: stored }));
        }
      });
      ws.on('close', () => {
        const at = sockets.indexOf(ws);
        if (at >= 0) sockets.splice(at, 1);
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}${prefix}`,
    requests,
    push: (frame) => sockets.forEach((ws) => ws.send(JSON.stringify(frame))),
    stub: (key, value) => void stubs.set(key, value),
    get accepts() {
      return state.accepts;
    },
    set accepts(value: string[]) {
      state.accepts = value;
    },
    get acceptToken() {
      return state.acceptToken;
    },
    set acceptToken(value: boolean) {
      state.acceptToken = value;
    },
    sockets,
    close: async () => {
      sockets.forEach((ws) => ws.terminate());
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** The keys this mock accepts on the booking tools, and whether each is a sandbox key. */
const AGENT_KEYS: Record<string, boolean> = {
  'Bearer kaer_sk_test': false,
  'Bearer kaer_sk_test_sandbox': true,
};

function toolResult(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  switch (tool) {
    case 'check_availability':
      if (args.date === '2026-12-25') return { error: 'We are closed that day.' };
      return {
        date: args.date,
        free: [
          { time: '19:30', startsAt: '2026-09-20T16:30:00.000Z', with: 'Layla' },
          { time: '20:00', startsAt: '2026-09-20T17:00:00.000Z' },
        ],
        note: null,
      };
    case 'create_booking':
      return {
        bookingId: 'bk_1',
        when: 'Sunday 20 September at 19:30',
        name: args.name ?? null,
        partySize: args.partySize ?? null,
        with: 'Layla',
      };
    case 'find_my_booking':
      return {
        bookings: [{ bookingId: 'bk_1', when: 'Sunday 20 September at 19:30', partySize: 4 }],
      };
    case 'reschedule_booking':
      return { when: 'Monday 21 September at 19:30' };
    case 'cancel_booking':
      return { was: 'Sunday 20 September at 19:30' };
    case 'list_services':
      return { services: [{ serviceId: 'svc_1', name: 'Haircut', minutes: 45 }] };
    case 'list_people':
      return { people: [], note: 'This business assigns whoever is free.' };
    case 'list_ticket_types':
      return { types: [{ ticketTypeId: 'tt_1', name: 'Refund', description: 'Money back' }] };
    case 'get_ticket_type':
      return {
        ticketTypeId: 'tt_1',
        name: 'Refund',
        alreadyKnown: { customerPhone: '+97312345678' },
        askFor: [
          {
            key: 'orderNumber',
            required: true,
            question: 'What is the order number?',
            mustBeOneOf: [],
          },
        ],
      };
    case 'create_ticket':
      return { ticketNumber: 1042, note: 'Someone will pick this up.' };
    case 'find_my_tickets':
      return {
        tickets: [
          {
            ticketNumber: 1042,
            title: 'Refund not received',
            status: 'OPEN',
            raised: '2026-09-18',
          },
        ],
      };
    case 'get_ticket':
      if (args.ticketNumber !== 1042)
        return { error: `No ticket #${String(args.ticketNumber)} belongs to them.` };
      return {
        ticketNumber: 1042,
        title: 'Refund not received',
        kind: 'Refund',
        status: 'WAITING',
        waitingOnCustomer: true,
        raised: '2026-09-18',
        resolved: null,
        closed: null,
        customerRequest: 'My money back for order 881',
        desiredOutcome: null,
        details: [{ name: 'Order number', value: '881' }],
        history: [
          { on: '2026-09-18', what: 'Raised' },
          { on: '2026-09-19', what: 'Waiting on the customer' },
        ],
        note: 'This is waiting on the customer.',
      };
    case 'add_to_ticket':
      if (args.ticketNumber === 7)
        return { error: 'Not added. #7 is resolved, so nobody is working on it any more.' };
      return {
        ok: true,
        ticketNumber: args.ticketNumber,
        resumed: args.ticketNumber === 1042,
        note: 'Added.',
      };
    default:
      return { error: `Unknown tool ${tool}` };
  }
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => resolve(raw));
  });
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
